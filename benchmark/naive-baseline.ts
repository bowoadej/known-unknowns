import type { BenchmarkCase } from "./cases.js";

/**
 * The naive baseline: what a competent developer would reasonably write in
 * ~20 minutes WITHOUT known-unknowns. This is deliberately NOT a strawman -
 * it's a sensible prompt that asks for exactly what the library provides
 * (ranked results with confidence and reasoning), using the same model. The
 * ONLY things it lacks are the two disciplines known-unknowns adds:
 *
 *   1. No explicit known/unknown scaffolding. Unknown fields are just
 *      described in prose ("budget: not specified") the way a developer
 *      would naturally write them, rather than structurally marked.
 *   2. No measurement-vs-descriptor evidence discipline and no cross-result
 *      consistency instruction.
 *
 * The whole point of the benchmark is to measure whether those two
 * disciplines actually change behavior. If the naive prompt already handles
 * unknowns and consistency well on its own, the benchmark will show a small
 * gap - and that's an honest result, not a failure. The prompt below is
 * printed verbatim into the report so readers can judge its fairness.
 */

export const NAIVE_SYSTEM_PROMPT = `You are a helpful matching assistant. Given a set of
requirements and a list of candidates, rank the candidates from best to worst
match for the requirements. For each candidate, give:
- a rank (1 = best)
- a confidence level: High, Medium, or Low
- a short reason

Some requirements may not be fully specified. Use your best judgment. Respond
in clear, readable text.`;

function describeRequirements(subject: BenchmarkCase["subject"]): string {
    const lines: string[] = [];
    for (const [key, field] of Object.entries(subject)) {
        if (field.status === "known") {
            lines.push(`- ${key}: ${JSON.stringify(field.value)}`);
        } else {
            // A developer without known-unknowns would naturally write the unknown
            // as prose like this - not omit it, but not structurally flag it either.
            lines.push(`- ${key}: not specified`);
        }
    }
    return lines.join("\n");
}

function describeCandidates(candidates: BenchmarkCase["candidates"]): string {
    return candidates
        .map((c) => {
            const { id, title, ...rest } = c;
            const details = Object.entries(rest)
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(", ");
            return `- [${id}] ${title}${details ? ` (${details})` : ""}`;
        })
        .join("\n");
}

export function buildNaiveUserPrompt(testCase: BenchmarkCase): string {
    const avoid =
        testCase.avoidRules.length > 0
            ? `\n\nThings to avoid:\n${testCase.avoidRules
                .map((r) => `- ${r.field}: avoid ${r.values.join(", ")}${r.note ? ` (${r.note})` : ""}`)
                .join("\n")}`
            : "";

    return `Requirements:
${describeRequirements(testCase.subject)}

Candidates:
${describeCandidates(testCase.candidates)}${avoid}

Rank the candidates from best to worst match, with a confidence level and a
short reason for each.`;
}