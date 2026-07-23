import { Confidence, GradedMatchResult, Ranking } from "./types.js";

export interface AuditWarning {
    type:
    | "inconsistent-inferred-confidence"
    | "top-rank-low-confidence"
    | "high-confidence-without-measurement";
    message: string;
    rankings: Ranking[];
}

const CONFIDENCE_ORDER: Record<Confidence, number> = {
    High: 3,
    Medium: 2,
    Low: 1,
};

/**
 * Checks a GradedMatchResult for patterns that usually mean the model was
 * inconsistent about how it applied its own confidence rules - not wrong
 * about any single ranking, but inconsistent across rankings in a way a
 * reader wouldn't be able to spot without comparing every reasoning
 * paragraph by hand.
 *
 * This exists because of a real run where two candidates had near-identical
 * "conflict inferred from a descriptor, no supporting measurement" situations,
 * and the model rated one High confidence and the other Low, with no stated
 * reason for the difference. Individually each ranking read as reasonable;
 * side by side, the inconsistency was the actual bug.
 */
export function auditConfidence(result: GradedMatchResult): AuditWarning[] {
    const warnings: AuditWarning[] = [];
    const { rankings } = result;

    if (rankings.length === 0) {
        return warnings;
    }

    // Check 1: top-ranked item has low confidence - the rank/confidence
    // display problem. Not wrong, but easy to misread if only the rank is
    // glanced at.
    const top = rankings[0];
    if (top.confidence === "Low") {
        warnings.push({
            type: "top-rank-low-confidence",
            message: `Rank #1 (${top.candidateTitle}) has Low confidence. This is the best guess available, not a verified strong match - don't let the rank alone imply certainty it hasn't earned.`,
            rankings: [top],
        });
    }

    // Check 2: among candidates whose evidenceType is "descriptor" or
    // "inferred" (i.e. no hard measurement backing the conflict/match),
    // flag cases where confidence varies without the reasoning text
    // acknowledging why.
    const inferredGroup = rankings.filter(
        (r) => r.evidenceType === "descriptor" || r.evidenceType === "inferred"
    );

    if (inferredGroup.length >= 2) {
        const confidenceLevels = new Set(inferredGroup.map((r) => r.confidence));
        if (confidenceLevels.size > 1) {
            // Multiple different confidence levels within the same "no hard
            // evidence" evidenceType group is the exact shape of the bug this
            // function was built to catch. Flag the outliers specifically -
            // anything rated High within this group is the most suspicious,
            // since the rule is that descriptor-only conflicts should generally
            // not reach High confidence.
            const suspiciousHigh = inferredGroup.filter((r) => r.confidence === "High");
            if (suspiciousHigh.length > 0) {
                warnings.push({
                    type: "inconsistent-inferred-confidence",
                    message: `${suspiciousHigh.length} candidate(s) with "${suspiciousHigh[0].evidenceType}" evidence (no hard measurement) were rated High confidence, while other candidates with the same evidence type were rated lower. Check whether the reasoning explains why these specific ones deserve higher confidence than the rest of the group.`,
                    rankings: suspiciousHigh,
                });
            }
        }
    }

    return warnings;
}