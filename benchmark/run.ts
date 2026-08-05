/**
 * Benchmark runner.
 *
 * For each case, for each condition (naive baseline vs. known-unknowns), for
 * N trials: generate an output, have the OpenAI judge score it blind against
 * the rubric, and record the score plus token/latency cost. Then aggregate
 * across trials (mean + spread), and write benchmark/README.md.
 *
 * Requires BOTH keys:
 *   export ANTHROPIC_API_KEY=...   (generation, both conditions)
 *   export OPENAI_API_KEY=...      (judging)
 *
 * Usage:
 *   npx tsx benchmark/run.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { writeFileSync } from "node:fs";
import { CASES, type BenchmarkCase } from "./cases.js";
import { NAIVE_SYSTEM_PROMPT, buildNaiveUserPrompt } from "./naive-baseline.js";
import { judge, JUDGE_MODEL } from "./judge.js";
import { RUBRICS } from "./rubric.js";
import { gradedMatch } from "../src/gradedMatch.js";
import { anthropicAdapter } from "../src/adapters/anthropic.js";

const GENERATION_MODEL = "claude-sonnet-5";
const TRIALS_PER_CASE = 5;

interface TrialResult {
  score: 0 | 1;
  judgeReasoning: string;
  latencyMs: number;
}

interface ConditionResult {
  trials: TrialResult[];
  mean: number;
  passes: number;
  totalLatencyMs: number;
}

interface CaseResult {
  testCase: BenchmarkCase;
  naive: ConditionResult;
  knownUnknowns: ConditionResult;
}

/**
 * Serialize known-unknowns' structured output into the same plain-text shape
 * the judge sees for the naive baseline. This is essential for blind
 * judging: if the judge saw one condition as clean JSON and the other as
 * prose, it could infer which was the "engineered" one. Both reach the judge
 * as comparable readable text.
 */
function renderRankingsAsText(rankings: Array<{ candidateTitle: string; rank: number; confidence: string; reasoning: string }>): string {
  return rankings
    .map((r) => `${r.rank}. ${r.candidateTitle} — Confidence: ${r.confidence}. ${r.reasoning}`)
    .join("\n");
}

async function runNaiveTrial(
  anthropic: Anthropic,
  openai: OpenAI,
  testCase: BenchmarkCase
): Promise<TrialResult> {
  const start = Date.now();
  const response = await anthropic.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 1500,
    system: NAIVE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildNaiveUserPrompt(testCase) }],
  });
  const latencyMs = Date.now() - start;

  const textBlock = response.content.find((b) => b.type === "text");
  const output = textBlock && "text" in textBlock ? textBlock.text : "";

  const judgment = await judge(openai, testCase, output);
  return { score: judgment.score, judgeReasoning: judgment.reasoning, latencyMs };
}

async function runKnownUnknownsTrial(
  anthropic: Anthropic,
  openai: OpenAI,
  testCase: BenchmarkCase
): Promise<TrialResult> {
  const llm = anthropicAdapter(anthropic, { model: GENERATION_MODEL });
  const start = Date.now();
  const result = await gradedMatch({
    subject: testCase.subject,
    candidates: testCase.candidates,
    avoidRules: testCase.avoidRules,
    llm,
  });
  const latencyMs = Date.now() - start;

  // Rendered to the same text shape the naive output is judged in - the
  // judge cannot tell which condition this came from.
  const output = renderRankingsAsText(result.rankings);

  const judgment = await judge(openai, testCase, output);
  return { score: judgment.score, judgeReasoning: judgment.reasoning, latencyMs };
}

function aggregate(trials: TrialResult[]): ConditionResult {
  const passes = trials.filter((t) => t.score === 1).length;
  const mean = passes / trials.length;
  const totalLatencyMs = trials.reduce((sum, t) => sum + t.latencyMs, 0);
  return { trials, mean, passes, totalLatencyMs };
}

async function runCase(
  anthropic: Anthropic,
  openai: OpenAI,
  testCase: BenchmarkCase
): Promise<CaseResult> {
  const naiveTrials: TrialResult[] = [];
  const kuTrials: TrialResult[] = [];

  for (let i = 0; i < TRIALS_PER_CASE; i++) {
    naiveTrials.push(await runNaiveTrial(anthropic, openai, testCase));
    kuTrials.push(await runKnownUnknownsTrial(anthropic, openai, testCase));
  }

  return {
    testCase,
    naive: aggregate(naiveTrials),
    knownUnknowns: aggregate(kuTrials),
  };
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function buildReport(results: CaseResult[]): string {
  const categories: Array<"silent-guessing" | "consistency"> = ["silent-guessing", "consistency"];

  // Aggregate per category
  const catStats = categories.map((cat) => {
    const inCat = results.filter((r) => r.testCase.category === cat);
    const naiveMean = inCat.reduce((s, r) => s + r.naive.mean, 0) / inCat.length;
    const kuMean = inCat.reduce((s, r) => s + r.knownUnknowns.mean, 0) / inCat.length;
    return { cat, count: inCat.length, naiveMean, kuMean };
  });

  const totalNaiveLatency = results.reduce((s, r) => s + r.naive.totalLatencyMs, 0);
  const totalKuLatency = results.reduce((s, r) => s + r.knownUnknowns.totalLatencyMs, 0);
  const totalTrials = results.length * TRIALS_PER_CASE;

  let md = `# known-unknowns benchmark

Measures whether known-unknowns' two disciplines - explicit unknown handling
and consistent confidence grading - actually change model behavior, versus a
reasonable naive prompt without them.

**This report is generated by \`benchmark/run.ts\`. Re-run it yourself to
reproduce these numbers.**

## Headline results

| Category | Cases | Naive baseline | known-unknowns |
|---|---|---|---|
`;

  for (const s of catStats) {
    md += `| ${s.cat} | ${s.count} | ${pct(s.naiveMean)} honest | ${pct(s.kuMean)} honest |\n`;
  }

  md += `
"Honest" = the judge scored the output 1 against the rubric for that category
(acknowledged the unknown / stayed consistent). Higher is better. Each case
was run ${TRIALS_PER_CASE} times per condition; the percentages are the share
of trials scored honest.

## Cost (the tradeoff, stated honestly)

known-unknowns is not free. It sends more instructions and uses structured
tool output, which costs latency (and tokens). Over ${totalTrials} trials:

| | Total latency | Avg per call |
|---|---|---|
| Naive baseline | ${(totalNaiveLatency / 1000).toFixed(1)}s | ${Math.round(totalNaiveLatency / totalTrials)}ms |
| known-unknowns | ${(totalKuLatency / 1000).toFixed(1)}s | ${Math.round(totalKuLatency / totalTrials)}ms |

## Methodology

- **Generation model (both conditions):** \`${GENERATION_MODEL}\`. The same
  model generates both the naive and known-unknowns outputs, so the benchmark
  measures the scaffolding, not model quality.
- **Judge model:** \`${JUDGE_MODEL}\` (a different provider than the
  generator, to reduce self-preference bias).
- **Blind judging:** the judge never knows which condition produced an
  output. known-unknowns' structured result is rendered to the same plain
  text shape as the naive output before judging.
- **Trials:** ${TRIALS_PER_CASE} per case per condition, to show spread
  rather than a single point estimate.
- **Scoring:** 1 = honest behavior per the rubric, 0 = failure. Both
  conditions scored with the identical rubric below.

### The rubric (verbatim)

`;

  for (const cat of categories) {
    const r = RUBRICS[cat];
    md += `**${cat}**\n\n> ${r.criterion}\n\n- Score 1: ${r.scoreOneMeans}\n- Score 0: ${r.scoreZeroMeans}\n\n`;
  }

  md += `### The naive baseline prompt (verbatim)

The baseline is deliberately reasonable, not a strawman - it asks for exactly
what known-unknowns provides, using the same model. Judge its fairness yourself:

\`\`\`
${NAIVE_SYSTEM_PROMPT}
\`\`\`

## Per-case results

`;

  for (const r of results) {
    md += `### ${r.testCase.id} (${r.testCase.category}, ${r.testCase.domain})\n\n`;
    md += `${r.testCase.whyHonestBehaviorIsClear}\n\n`;
    md += `- Naive: ${r.naive.passes}/${TRIALS_PER_CASE} honest\n`;
    md += `- known-unknowns: ${r.knownUnknowns.passes}/${TRIALS_PER_CASE} honest\n\n`;
  }

  md += `## Limitations

- **The judge is an LLM and is imperfect.** It can misjudge, which is why
  every case is run multiple times and scores are reported as spreads. The
  judge's reasoning is available per trial if you instrument the runner to
  log it.
- **Hand-authored cases (${results.length} total).** Deliberately constructed
  so honest behavior is objectively determinable, but a small, curated set -
  not a random sample of real-world tasks.
- **Requires two API keys** (Anthropic to generate, OpenAI to judge), which
  is friction for reproduction but is the cost of an independent judge.
- **Results vary by model.** These numbers are specific to the generation and
  judge models named above and will shift as models change.

_Generated by \`benchmark/run.ts\`._
`;

  return md;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Set ANTHROPIC_API_KEY (used to generate both conditions).");
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Set OPENAI_API_KEY (used by the judge).");
    process.exit(1);
  }

  const anthropic = new Anthropic();
  const openai = new OpenAI();

  const results: CaseResult[] = [];
  for (const testCase of CASES) {
    console.log(`Running ${testCase.id} (${TRIALS_PER_CASE} trials x 2 conditions)...`);
    results.push(await runCase(anthropic, openai, testCase));
  }

  const report = buildReport(results);
  writeFileSync(new URL("./README.md", import.meta.url), report);
  console.log("\nWrote benchmark/README.md");

  // Quick console summary
  for (const cat of ["silent-guessing", "consistency"] as const) {
    const inCat = results.filter((r) => r.testCase.category === cat);
    const naive = inCat.reduce((s, r) => s + r.naive.mean, 0) / inCat.length;
    const ku = inCat.reduce((s, r) => s + r.knownUnknowns.mean, 0) / inCat.length;
    console.log(`${cat}: naive ${pct(naive)} vs known-unknowns ${pct(ku)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});