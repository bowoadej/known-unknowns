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

See [`examples/basic-example.ts`](./examples/basic-example.ts) for the full
runnable version. Deliberately not about clothing, to show this isn't just
Suitability's fit-matching logic renamed - here it's ranking apartment
listings against a budget, a pet-ownership constraint, and an unknown
move-in date:

```ts
const subject = defineSubject({
  monthlyBudget: known(1800),
  hasPet: known(true),
  moveInDate: unknown(),
});

const result = await gradedMatch({
  subject,
  candidates: apartmentListings, // mixed data quality on purpose - some listings
                                  // give an exact rent, one only says "affordable"
  avoidRules: [{ field: "floor", values: ["0"], note: "no ground-floor units" }],
  llm: anthropicAdapter(client),
});

const warnings = auditConfidence(result);
```

### Real output from a live run

No hand-editing below - this is what came back the first time this example
was actually run against Claude:

```
#1 2-bed flat, 3rd floor, Clapham [High confidence, measurement]
Rent $1750 is within the $1800 budget, petsAllowed is true matching hasPet,
and floor 3 does not violate the ground-floor avoid rule. All relevant
fields are stated and consistent with the subject.

#2 Cosy studio, central location [Medium confidence, descriptor]
The description explicitly states 'no pets policy strictly enforced,' which
conflicts with the subject's hasPet=true. This is a fairly clear
descriptor-based conflict but not a structured field, so confidence is
Medium rather than High. Rent and floor are unknown for this listing, so
budget fit and the ground-floor rule cannot be verified.

#3 1-bed flat, ground floor, Brixton [High confidence, measurement]
Rent $1600 and petsAllowed=true both match well, but floor is explicitly
stated as 0, which directly violates the avoid rule. This is a confirmed
measurement-based conflict, so it outweighs the otherwise good rent/pet
match and ranks this candidate last.
```

No audit warnings fired on this run - confidence levels tracked evidence
quality correctly without any manual correction.

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

## MCP Server

known-unknowns also ships as an MCP server, so `graded_match` and
`audit_confidence` can be used as tools by any MCP-compatible client -
CrewAI, LangChain, Claude Desktop, Claude Code, or your own agent.

```bash
export ANTHROPIC_API_KEY=your_key_here
npx known-unknowns-mcp
```

**A gotcha worth knowing before you wire this into your own client:** MCP's
stdio transport does not automatically forward your shell's environment
variables to the spawned server - this is a deliberate security choice
(a spawned server shouldn't automatically see every secret sitting in your
shell), not a bug. Whatever client you connect with needs to explicitly
declare `ANTHROPIC_API_KEY` in its own MCP server config (e.g. an `env`
block in a `.mcp.json` or `claude_desktop_config.json`, or an `env` option
if you're wiring up `StdioClientTransport` yourself) - just having the key
exported in your terminal is not enough. `scripts/test-mcp-client.ts` in
this repo shows a working example of forwarding it explicitly.

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

v0.1 - core matching and audit logic is implemented, fully tested (11
passing tests including a reproduction of the exact bug that motivated
this package), and validated live against Claude on a domain it wasn't
built for (apartment hunting, not clothing) with zero manual correction
needed. An MCP server exposing both tools is built and verified
end-to-end via a real client (spawn, connect, discover tools, call a tool,
get back the expected result) - not just a mock. Not yet published to npm.

## Roadmap

- [x] MCP server exposing `graded_match` and `audit_confidence` - this is
  the actual mechanism that makes known-unknowns usable from CrewAI (which
  has no official JS/TS SDK) as well as LangChain, Claude Desktop, and any
  other MCP-compatible client, without maintaining a separate adapter per
  framework
- [ ] Once used in a real agent pipeline, use it inside
  [Suitability](https://github.com/bowoadej/suitability)'s planned
  multi-agent orchestration, so the two projects reinforce each other
  instead of duplicating logic
- [ ] Multi-provider MCP support - the MCP server currently hardcodes
  Anthropic. The core library is already provider-agnostic (any
  `LLMAdapter` works), so adding an `openaiAdapter` and a provider-select
  env var to the MCP server should be a small increment, not a rewrite -
  deliberately scoped out of v0.1 to validate the Anthropic path first

## License

MIT