#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { gradedMatch, auditConfidence, anthropicAdapter } from "./index.js";
import type { Field, Candidate, AvoidRule, GradedMatchResult } from "./types.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
    console.error(
        "known-unknowns MCP server: ANTHROPIC_API_KEY environment variable is not set. " +
        "This server calls Claude internally to do the actual matching, so it needs a key."
    );
    process.exit(1);
}

const anthropicClient = new Anthropic({ apiKey });
const llm = anthropicAdapter(anthropicClient);

const server = new McpServer({ name: "known-unknowns", version: "0.1.1" });

// Subject fields arrive over MCP as plain JSON, in exactly the same shape the
// library's own Field<T> type uses - {status: "known", value} or
// {status: "unknown"} - so nothing gets silently defaulted at this boundary
// either. An MCP client (or the agent calling it) has to be explicit about
// what it actually knows, same as any other caller of this library.
const fieldSchema = z.union([
    z.object({ status: z.literal("known"), value: z.unknown() }),
    z.object({ status: z.literal("unknown") }),
]);

const subjectSchema = z.record(z.string(), fieldSchema);

const candidateSchema = z
    .object({
        id: z.string(),
        title: z.string(),
    })
    .catchall(z.unknown());

const avoidRuleSchema = z.object({
    field: z.string(),
    values: z.array(z.string()),
    note: z.string().optional(),
});

const rankingSchema = z.object({
    candidateId: z.string(),
    candidateTitle: z.string(),
    rank: z.number(),
    confidence: z.enum(["High", "Medium", "Low"]),
    evidenceType: z.enum(["measurement", "descriptor", "inferred", "mixed"]),
    reasoning: z.string(),
});

server.registerTool(
    "graded_match",
    {
        title: "Graded Match",
        description:
            "Rank a set of candidates against a subject's known/unknown constraints, " +
            "returning a confidence level and evidence type for each result rather " +
            "than a bare ranking. Never silently guesses at fields marked unknown - " +
            "if a result depends on missing information, that's reflected in a lower " +
            "confidence, not hidden. Also runs a consistency audit and includes any " +
            "warnings about unexplained confidence differences across similar results.",
        inputSchema: {
            subject: subjectSchema.describe(
                "Map of field name to {status: 'known', value: <any>} or {status: 'unknown'}. " +
                "Every field the caller has an opinion on should be explicit - don't omit " +
                "a field just because it's unknown, mark it as such."
            ),
            candidates: z.array(candidateSchema).describe(
                "Candidates to rank. Each needs at minimum an id and a title; any other " +
                "fields (price, description, measurements, etc.) are passed through as-is."
            ),
            avoidRules: z
                .array(avoidRuleSchema)
                .optional()
                .describe("Optional hard constraints - candidates matching these get flagged as conflicts."),
        },
        outputSchema: {
            rankings: z.array(rankingSchema),
            auditWarnings: z.array(
                z.object({
                    type: z.string(),
                    message: z.string(),
                })
            ),
        },
    },
    async ({ subject, candidates, avoidRules }) => {
        const result = await gradedMatch({
            subject: subject as Record<string, Field<unknown>>,
            candidates: candidates as Candidate[],
            avoidRules: (avoidRules ?? []) as AvoidRule[],
            llm,
        });

        const warnings = auditConfidence(result);

        const output = {
            rankings: result.rankings,
            auditWarnings: warnings.map((w) => ({ type: w.type, message: w.message })),
        };

        return {
            content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
        };
    }
);

server.registerTool(
    "audit_confidence",
    {
        title: "Audit Confidence",
        description:
            "Check an already-computed set of rankings for unexplained confidence " +
            "inconsistencies - e.g. a top-ranked result with Low confidence, or two " +
            "descriptor-only conflicts rated differently with no stated reason. Useful " +
            "if rankings came from somewhere other than graded_match and you want the " +
            "same consistency check applied to them.",
        inputSchema: {
            rankings: z
                .array(rankingSchema)
                .describe("Rankings to audit, in the same shape graded_match returns."),
        },
        outputSchema: {
            warnings: z.array(
                z.object({
                    type: z.string(),
                    message: z.string(),
                })
            ),
        },
    },
    async ({ rankings }) => {
        const warnings = auditConfidence({ rankings } as GradedMatchResult);
        const output = { warnings: warnings.map((w) => ({ type: w.type, message: w.message })) };
        return {
            content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
        };
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("known-unknowns MCP server running on stdio");
}

main().catch((err) => {
    console.error("Fatal error starting known-unknowns MCP server:", err);
    process.exit(1);
});