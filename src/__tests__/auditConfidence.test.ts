import { test } from "node:test";
import assert from "node:assert/strict";
import { auditConfidence } from "../auditConfidence.js";
import { GradedMatchResult, Ranking } from "../types.js";

function ranking(overrides: Partial<Ranking> & Pick<Ranking, "candidateId">): Ranking {
    return {
        candidateId: overrides.candidateId,
        candidateTitle: overrides.candidateTitle ?? overrides.candidateId,
        rank: overrides.rank ?? 1,
        confidence: overrides.confidence ?? "Medium",
        evidenceType: overrides.evidenceType ?? "measurement",
        reasoning: overrides.reasoning ?? "",
    };
}

test("returns no warnings for an empty result", () => {
    const result: GradedMatchResult = { rankings: [] };
    assert.deepEqual(auditConfidence(result), []);
});

test("flags a Low-confidence top rank", () => {
    const result: GradedMatchResult = {
        rankings: [
            ranking({ candidateId: "a", rank: 1, confidence: "Low", evidenceType: "measurement" }),
            ranking({ candidateId: "b", rank: 2, confidence: "Medium" }),
        ],
    };

    const warnings = auditConfidence(result);
    const topRankWarning = warnings.find((w) => w.type === "top-rank-low-confidence");

    assert.ok(topRankWarning, "expected a top-rank-low-confidence warning");
    assert.equal(topRankWarning!.rankings[0].candidateId, "a");
});

test("does not flag a Low-confidence top rank when confidence is Medium or High", () => {
    const result: GradedMatchResult = {
        rankings: [ranking({ candidateId: "a", rank: 1, confidence: "Medium" })],
    };

    const warnings = auditConfidence(result);
    assert.equal(warnings.find((w) => w.type === "top-rank-low-confidence"), undefined);
});

test("reproduces the exact README bug: near-identical descriptor-only conflicts rated High vs Low with no stated reason", () => {
    // This is the real bug the library was built to catch: two candidates,
    // both with evidenceType "descriptor" (a conflict inferred from a style
    // descriptor, no supporting measurement), rated High and Low with
    // nothing in the data to justify the difference.
    const result: GradedMatchResult = {
        rankings: [
            ranking({
                candidateId: "jeans-a",
                candidateTitle: "Slim fit jeans",
                rank: 1,
                confidence: "High",
                evidenceType: "descriptor",
                reasoning: "Style described as 'slim cut', likely conflicts with a wide-leg preference.",
            }),
            ranking({
                candidateId: "jeans-b",
                candidateTitle: "Tapered jeans",
                rank: 2,
                confidence: "Low",
                evidenceType: "descriptor",
                reasoning: "Style described as 'tapered', likely conflicts with a wide-leg preference.",
            }),
        ],
    };

    const warnings = auditConfidence(result);
    const inconsistencyWarning = warnings.find((w) => w.type === "inconsistent-inferred-confidence");

    assert.ok(inconsistencyWarning, "expected an inconsistent-inferred-confidence warning");
    assert.equal(inconsistencyWarning!.rankings.length, 1);
    assert.equal(inconsistencyWarning!.rankings[0].candidateId, "jeans-a");
});

test("does not flag descriptor/inferred candidates when confidence is consistent across the group", () => {
    const result: GradedMatchResult = {
        rankings: [
            ranking({ candidateId: "a", rank: 1, confidence: "Medium", evidenceType: "descriptor" }),
            ranking({ candidateId: "b", rank: 2, confidence: "Medium", evidenceType: "inferred" }),
        ],
    };

    const warnings = auditConfidence(result);
    assert.equal(warnings.find((w) => w.type === "inconsistent-inferred-confidence"), undefined);
});

test("ignores measurement-backed rankings when checking for inferred-confidence inconsistency", () => {
    // A High-confidence measurement-backed ranking next to a Low-confidence
    // descriptor-based one is not the bug this check targets - there's only
    // one candidate in the "no hard evidence" group, so there's nothing to
    // be inconsistent with.
    const result: GradedMatchResult = {
        rankings: [
            ranking({ candidateId: "a", rank: 1, confidence: "High", evidenceType: "measurement" }),
            ranking({ candidateId: "b", rank: 2, confidence: "Low", evidenceType: "descriptor" }),
        ],
    };

    const warnings = auditConfidence(result);
    assert.equal(warnings.find((w) => w.type === "inconsistent-inferred-confidence"), undefined);
});
