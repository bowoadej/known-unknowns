import { test } from "node:test";
import assert from "node:assert/strict";
import { gradedMatch } from "../gradedMatch.js";
import { defineSubject, known, unknown, LLMAdapter, ToolSchema } from "../types.js";

// The adapter now returns already-structured data (what a real tool-use
// adapter produces), not a string to be parsed - so mocks return objects.
function fakeAdapter(structured: unknown): LLMAdapter {
    return {
        async completeStructured(_system: string, _user: string, _schema: ToolSchema): Promise<unknown> {
            return structured;
        },
    };
}

const subject = defineSubject({
    budget: known(500),
    timeline: unknown(),
});

test("returns rankings from a well-formed structured response", async () => {
    const structured = {
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
    };

    const result = await gradedMatch({
        subject,
        candidates: [{ id: "a", title: "Option A" }],
        llm: fakeAdapter(structured),
    });

    assert.equal(result.rankings.length, 1);
    assert.equal(result.rankings[0].candidateId, "a");
});

test("sorts rankings by rank even if the LLM returns them out of order", async () => {
    const structured = {
        rankings: [
            { candidateId: "b", candidateTitle: "B", rank: 2, confidence: "Medium", evidenceType: "measurement", reasoning: "" },
            { candidateId: "a", candidateTitle: "A", rank: 1, confidence: "High", evidenceType: "measurement", reasoning: "" },
        ],
    };

    const result = await gradedMatch({
        subject,
        candidates: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
        llm: fakeAdapter(structured),
    });

    assert.deepEqual(result.rankings.map((r) => r.candidateId), ["a", "b"]);
});

test("throws a descriptive error when the structured response has the wrong shape", async () => {
    // With structured tool use the failure mode is no longer 'unparseable
    // text' - it's a response that's structurally valid JSON but not shaped
    // like a GradedMatchResult (e.g. missing the rankings array).
    await assert.rejects(
        () =>
            gradedMatch({
                subject,
                candidates: [{ id: "a", title: "A" }],
                llm: fakeAdapter({ somethingElse: true }),
            }),
        /did not match the expected shape/
    );
});

test("the tool schema passed to the adapter enforces the ranking shape", async () => {
    let capturedSchema: ToolSchema | null = null;
    const capturingAdapter: LLMAdapter = {
        async completeStructured(_system, _user, schema) {
            capturedSchema = schema;
            return {
                rankings: [
                    { candidateId: "a", candidateTitle: "A", rank: 1, confidence: "Medium", evidenceType: "measurement", reasoning: "" },
                ],
            };
        },
    };

    await gradedMatch({
        subject,
        candidates: [{ id: "a", title: "A" }],
        llm: capturingAdapter,
    });

    assert.ok(capturedSchema, "expected a schema to be passed to the adapter");
    const schema = capturedSchema as unknown as ToolSchema;
    assert.equal(schema.name, "record_rankings");
    // the schema must require a rankings array - this is what makes the
    // provider enforce structure instead of us parsing text
    const props = (schema.inputSchema as any).properties;
    assert.equal(props.rankings.type, "array");
});

test("an unknown() field is sent to the LLM as the string 'unknown', never as null or a default value", async () => {
    let capturedUserPrompt = "";
    const capturingAdapter: LLMAdapter = {
        async completeStructured(_system, user, _schema) {
            capturedUserPrompt = user;
            return {
                rankings: [
                    { candidateId: "a", candidateTitle: "A", rank: 1, confidence: "Medium", evidenceType: "measurement", reasoning: "" },
                ],
            };
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