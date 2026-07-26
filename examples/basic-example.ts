/**
 * Live end-to-end example - deliberately NOT about clothing, to prove
 * known-unknowns is genuinely general-purpose and not just Suitability's
 * fit-matching logic renamed.
 *
 * Scenario: apartment hunting. Budget and pet ownership are known; move-in
 * date is not. One avoid rule (no ground-floor units). Listings have mixed
 * data quality on purpose - some give an exact rent, one only says
 * "affordable" with no number, to exercise both the measurement and
 * descriptor evidence paths.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your_key_here
 *   npx tsx examples/basic-example.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import {
    defineSubject,
    known,
    unknown,
    gradedMatch,
    auditConfidence,
    anthropicAdapter,
} from "../src/index.js";

async function main() {
    const client = new Anthropic();

    const subject = defineSubject({
        monthlyBudget: known(1800),
        hasPet: known(true),
        moveInDate: unknown(),
    });

    const candidates = [
        {
            id: "listing-1",
            title: "2-bed flat, 3rd floor, Clapham",
            rent: 1750,
            petsAllowed: true,
            floor: 3,
        },
        {
            id: "listing-2",
            title: "1-bed flat, ground floor, Brixton",
            rent: 1600,
            petsAllowed: true,
            floor: 0,
        },
        {
            id: "listing-3",
            title: "Cosy studio, central location",
            description: "Affordable studio in a quiet building, no pets policy strictly enforced.",
            // deliberately no numeric rent or floor - descriptor-only data
        },
    ];

    const result = await gradedMatch({
        subject,
        candidates,
        avoidRules: [
            { field: "floor", values: ["0"], note: "no ground-floor units - security preference" },
        ],
        llm: anthropicAdapter(client),
    });

    console.log("\n=== RANKINGS ===\n");
    for (const r of result.rankings) {
        console.log(`#${r.rank} ${r.candidateTitle} [${r.confidence} confidence, ${r.evidenceType}]`);
        console.log(r.reasoning);
        console.log("---");
    }

    const warnings = auditConfidence(result);
    if (warnings.length > 0) {
        console.log("\n=== AUDIT WARNINGS ===\n");
        for (const w of warnings) {
            console.log(`[${w.type}] ${w.message}`);
        }
    } else {
        console.log("\nNo audit warnings - confidence levels were applied consistently.");
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});