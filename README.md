# known-unknowns

> Force your LLM agent to say "I'm not sure" instead of guessing.

A small TypeScript library for building agents that reason honestly over
incomplete data. It draws a hard line between "not asked" and "asked and
genuinely unknown," and grades every output by how much real evidence backs
it - not by how confident the model sounds.

## Install

```bash
npm install known-unknowns
```

Bring your own LLM client - the Anthropic SDK is supported out of the box
via `anthropicAdapter`, and the `LLMAdapter` interface is small enough to
implement for any other provider.

## Quick example

```ts
import { defineSubject, known, unknown, gradedMatch, auditConfidence, anthropicAdapter } from "known-unknowns";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const subject = defineSubject({
  budget: known(500),
  timeline: unknown(),
});

const result = await gradedMatch({
  subject,
  candidates: [
    { id: "a", title: "Option A" },
    { id: "b", title: "Option B" },
  ],
  avoidRules: [{ field: "contractLength", values: ["12-month-lock-in"] }],
  llm: anthropicAdapter(client),
});

console.log(result.rankings);

const warnings = auditConfidence(result);
// flags things like: a top-ranked result with Low confidence, or
// inconsistent confidence across similarly-evidenced candidates
```

## Why this exists

Built out of a real bug, not a thought experiment. While building
[Suitability](https://github.com/bowoadej/suitability) - an agent that
matches clothing to a person's fit constraints - two near-identical
candidates each had a conflict inferred only from a style descriptor, with
no supporting measurement. One got rated High confidence, the other Low,
with no stated reason for the difference. Individually each result read as
reasonable. Side by side, the inconsistency was the actual bug.

Most LLM apps let this kind of thing hide inside plausible-sounding text.
`known-unknowns` makes it structurally harder to do that - both by forcing
the model to distinguish measurement-backed conclusions from inferred ones,
and by giving you `auditConfidence` to catch the cases where it didn't apply
that distinction consistently.

## API

- **`known(value)` / `unknown()`** - wrap a subject field so "not provided"
  can never silently collapse into an assumed default.
- **`defineSubject(fields)`** - a typed bag of `Field`s describing the thing
  you're matching against candidates.
- **`gradedMatch({ subject, candidates, avoidRules, llm })`** - ranks
  candidates, returning confidence and evidenceType per ranking.
- **`auditConfidence(result)`** - scans a result for unexplained confidence
  inconsistencies and returns structured warnings.
- **`anthropicAdapter(client, options?)`** - reference `LLMAdapter`
  implementation for the Anthropic SDK.

## Status

v0.1 - core matching and audit logic is implemented and type-checks cleanly.
Not yet published to npm. Extracted from and validated against a real,
working project (Suitability) rather than built in isolation.

## License

MIT