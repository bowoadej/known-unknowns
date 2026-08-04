/**
 * A field value that is either explicitly known, or explicitly marked
 * unknown. The point of this wrapper is to make it structurally impossible
 * to confuse "not asked" with "asked and confirmed absent" - both a
 * missing key and a bare `null` collapse that distinction, and an LLM
 * prompted with either will often silently assume an average value rather
 * than admitting the gap.
 */
export type Field<T> =
    | { status: "known"; value: T }
    | { status: "unknown" };

export function known<T>(value: T): Field<T> {
    return { status: "known", value };
}

export function unknown<T = never>(): Field<T> {
    return { status: "unknown" };
}

/** A subject is just a named bag of Fields - the thing being matched against candidates. */
export type Subject = Record<string, Field<unknown>>;

export function defineSubject<T extends Subject>(fields: T): T {
    return fields;
}

/**
 * Where a conflict or match determination actually came from. This is the
 * distinction that matters for confidence: a conclusion backed by a real
 * measurement is a different kind of claim than one inferred from a style
 * descriptor or category name, even when both point to the same verdict.
 */
export type EvidenceType = "measurement" | "descriptor" | "inferred" | "mixed";

export type Confidence = "High" | "Medium" | "Low";

export interface AvoidRule {
    field: string;
    values: string[];
    /** Optional note to help the LLM reason about *why* this should be avoided. */
    note?: string;
}

export interface Candidate {
    id: string;
    title: string;
    [key: string]: unknown;
}

export interface Ranking {
    candidateId: string;
    candidateTitle: string;
    rank: number;
    confidence: Confidence;
    evidenceType: EvidenceType;
    reasoning: string;
}

export interface GradedMatchResult {
    rankings: Ranking[];
}

/**
 * A JSON Schema for a tool the LLM must call, forcing its response into
 * that exact shape instead of free text the caller has to parse and hope
 * is valid. This is the raw schema format Anthropic's tool-use API expects
 * (and most other providers' function-calling APIs use something close to
 * the same shape), not a TypeScript type - it has to be a real runtime
 * value the adapter sends to the provider.
 */
export interface ToolSchema {
    name: string;
    description: string;
    /** Raw JSON Schema object describing the tool's expected input shape.
     * Must be an object-type schema at the top level - that's what tool-use /
     * function-calling APIs require. */
    inputSchema: { type: "object";[key: string]: unknown };
}

/**
 * Minimal interface an LLM adapter must satisfy. Keeping this narrow means
 * known-unknowns isn't tied to any one provider - see src/adapters/ for a
 * reference implementation against the Anthropic SDK.
 *
 * completeStructured returns already-parsed, schema-conforming data - not
 * a string the caller has to JSON.parse and hope is well-formed. It's the
 * adapter's job to use its provider's structured-output/tool-use mechanism
 * (not prompt instructions) to guarantee that.
 */
export interface LLMAdapter {
    completeStructured(systemPrompt: string, userPrompt: string, schema: ToolSchema): Promise<unknown>;
}