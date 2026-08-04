import { AvoidRule, Candidate, GradedMatchResult, LLMAdapter, Subject, ToolSchema } from "./types.js";

const SYSTEM_PROMPT = `You are a matching assistant. You are given a "subject" (a set of
fields, some marked "known" with a value, others explicitly marked "unknown" -
unknown fields are intentionally unspecified, not zero or average) and a list
of candidates to rank against that subject.

Your job: rank the candidates from best to worst match, and explain your
reasoning for each one, by calling the record_rankings tool.

Rules you must follow:

1. Never silently assume a default value for a field marked "unknown" on the
   subject. If a ranking depends on an unknown field, say so explicitly in
   your reasoning and lower your confidence for that ranking accordingly.

2. Distinguish between what you know (stated subject fields, stated
   candidate data) and what you're inferring (e.g. reasoning from a category
   name, a style descriptor, or an indirect reference point). Label
   inferences as inferences in your reasoning text.

3. If a candidate conflicts with an explicit avoid rule, flag that clearly
   even if other data looks fine. Distinguish two kinds of conflict, and
   treat their confidence differently:
   a) A conflict confirmed by an actual stated measurement or fact can be
      "measurement" evidenceType and High confidence.
   b) A conflict inferred only from a descriptor, category name, or indirect
      reference, with NO supporting hard data, should generally be
      "descriptor" or "inferred" evidenceType and Medium confidence, not
      High - unless the descriptor is unambiguous and leaves little room for
      interpretation. Be consistent about this distinction across all
      candidates in a single run - don't rate one descriptor-only conflict
      High and another Medium without a stated reason for the difference.

4. Give each candidate a confidence level (High, Medium, or Low) based on how
   much real data supports the ranking, not on how good the match seems, AND
   an evidenceType ("measurement", "descriptor", "inferred", or "mixed")
   describing what kind of evidence the ranking rests on.

5. Be concise. One short paragraph of reasoning per candidate, not an essay.`;

// The JSON Schema for the tool the model is forced to call. This replaces the
// old "return JSON shaped like this" instruction in the prompt - instead of
// asking and hoping, the schema is enforced by the provider's tool-use
// mechanism. additionalProperties:false and a full required list are needed
// for Anthropic's strict mode to engage.
const RANKING_TOOL_SCHEMA: ToolSchema = {
    name: "record_rankings",
    description:
        "Record the ranked candidates with confidence and evidence type for each. " +
        "Call this exactly once with the full ranked list.",
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["rankings"],
        properties: {
            rankings: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["candidateId", "candidateTitle", "rank", "confidence", "evidenceType", "reasoning"],
                    properties: {
                        candidateId: { type: "string" },
                        candidateTitle: { type: "string" },
                        rank: { type: "integer" },
                        confidence: { type: "string", enum: ["High", "Medium", "Low"] },
                        evidenceType: {
                            type: "string",
                            enum: ["measurement", "descriptor", "inferred", "mixed"],
                        },
                        reasoning: { type: "string" },
                    },
                },
            },
        },
    },
};

function serializeSubject(subject: Subject): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(subject)) {
        out[key] = field.status === "known" ? field.value : "unknown";
    }
    return out;
}

function buildUserPrompt(
    subject: Subject,
    candidates: Candidate[],
    avoidRules: AvoidRule[]
): string {
    return `SUBJECT:
${JSON.stringify(serializeSubject(subject), null, 2)}

AVOID RULES:
${JSON.stringify(avoidRules, null, 2)}

CANDIDATES:
${JSON.stringify(candidates, null, 2)}

Rank these candidates against the subject and explain your reasoning,
following the rules in your instructions.`;
}

// Even with strict tool use guaranteeing the STRUCTURE, this validates the
// result is actually shaped like a GradedMatchResult before we trust it -
// a cheap defensive check, and the one place a non-Anthropic adapter that
// doesn't enforce the schema as strictly would get caught.
function isGradedMatchResult(value: unknown): value is GradedMatchResult {
    if (typeof value !== "object" || value === null) return false;
    const maybe = value as { rankings?: unknown };
    return Array.isArray(maybe.rankings);
}

export interface GradedMatchOptions {
    subject: Subject;
    candidates: Candidate[];
    avoidRules?: AvoidRule[];
    llm: LLMAdapter;
}

export async function gradedMatch(
    options: GradedMatchOptions
): Promise<GradedMatchResult> {
    const { subject, candidates, avoidRules = [], llm } = options;

    const userPrompt = buildUserPrompt(subject, candidates, avoidRules);
    const result = await llm.completeStructured(SYSTEM_PROMPT, userPrompt, RANKING_TOOL_SCHEMA);

    if (!isGradedMatchResult(result)) {
        throw new Error(
            `known-unknowns: structured response did not match the expected shape.\n` +
            `Got: ${JSON.stringify(result)}`
        );
    }

    result.rankings.sort((a, b) => a.rank - b.rank);
    return result;
}