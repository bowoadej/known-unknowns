import { test } from "node:test";
import assert from "node:assert/strict";
import { gradedMatch } from "../gradedMatch.js";
import { defineSubject, known, unknown, LLMAdapter } from "../types.js";

function fakeAdapter(response: string): LLMAdapter {
    return {
        async complete(_systemPrompt: string, _userPrompt: string): Promise<string> {
            return response;
        },
    };
}

const subject = defineSubject({
    budget: known(500),
    timeline: unknown(),
});

test("parses a well-formed JSON response and returns rankings", async () => {
    const response = JSON.stringify({
        rankings: [
            {
                candidateId: "a",
                candidateTitle: "Option A",
                rank: 1,
                confidence: "High",
                evidenceType: "measurement",
                reasoning: "fits budget",
            },
        ],
    });

    const result = await gradedMatch({
        subject,
        candidates: [{ id: "a", title: "Option A" }],
        llm: fakeAdapter(response),
    });

    assert.equal(result.rankings.length, 1);
    assert.equal(result.rankings[0].candidateId, "a");
});

test("strips markdown code fences before parsing", async () => {
    const response = "```json\n" + JSON.stringify({
        rankings: [
            { candidateId: "a", candidateTitle: "A", rank: 1, confidence: "Medium", evidenceType: "inferred", reasoning: "" },
        ],
    }) + "\n```";

    const result = await gradedMatch({
        subject,
        candidates: [{ id: "a", title: "A" }],
        llm: fakeAdapter(response),
    });

    assert.equal(result.rankings.length, 1);
});

test("sorts rankings by rank even if the LLM returns them out of order", async () => {
    const response = JSON.stringify({
        rankings: [
            { candidateId: "b", candidateTitle: "B", rank: 2, confidence: "Medium", evidenceType: "measurement", reasoning: "" },
            { candidateId: "a", candidateTitle: "A", rank: 1, confidence: "High", evidenceType: "measurement", reasoning: "" },
        ],
    });

    const result = await gradedMatch({
        subject,
        candidates: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
        llm: fakeAdapter(response),
    });

    assert.deepEqual(result.rankings.map((r) => r.candidateId), ["a", "b"]);
});

test("throws a descriptive error when the LLM response is not valid JSON", async () => {
    await assert.rejects(
        () =>
            gradedMatch({
                subject,
                candidates: [{ id: "a", title: "A" }],
                llm: fakeAdapter("not json at all"),
            }),
        /LLM response was not valid JSON/
    );
});

test("an unknown() field is sent to the LLM as the string 'unknown', never as null or a default value", async () => {
    let capturedUserPrompt = "";
    const capturingAdapter: LLMAdapter = {
        async complete(_system, user) {
            capturedUserPrompt = user;
            return JSON.stringify({
                rankings: [
                    { candidateId: "a", candidateTitle: "A", rank: 1, confidence: "Medium", evidenceType: "measurement", reasoning: "" },
                ],
            });
        },
    };

    await gradedMatch({
        subject,
        candidates: [{ id: "a", title: "A" }],
        llm: capturingAdapter,
    });

    assert.match(capturedUserPrompt, /"timeline": "unknown"/);
    assert.doesNotMatch(capturedUserPrompt, /"timeline": null/);
});