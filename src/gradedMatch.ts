import { AvoidRule, Candidate, GradedMatchResult, LLMAdapter, Subject } from "./types.js";

const SYSTEM_PROMPT = `You are a matching assistant. You are given a "subject" (a set of
fields, some marked "known" with a value, others explicitly marked "unknown" -
unknown fields are intentionally unspecified, not zero or average) and a list
of candidates to rank against that subject.

Your job: rank the candidates from best to worst match, and explain your
reasoning for each one.

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

5. Be concise. One short paragraph of reasoning per candidate, not an essay.

Return your answer as JSON matching this shape:
{
  "rankings": [
    {
      "candidateId": "...",
      "candidateTitle": "...",
      "rank": 1,
      "confidence": "High" | "Medium" | "Low",
      "evidenceType": "measurement" | "descriptor" | "inferred" | "mixed",
      "reasoning": "..."
    }
  ]
}

Return ONLY the JSON, no other text, no markdown code fences.`;

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
    const rawResponse = await llm.complete(SYSTEM_PROMPT, userPrompt);

    let cleaned = rawResponse.trim();
    if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(json)?/, "").replace(/```$/, "").trim();
    }

    let parsed: GradedMatchResult;
    try {
        parsed = JSON.parse(cleaned) as GradedMatchResult;
    } catch (err) {
        throw new Error(
            `known-unknowns: LLM response was not valid JSON.\nRaw response:\n${rawResponse}`
        );
    }

    parsed.rankings.sort((a, b) => a.rank - b.rank);
    return parsed;
}