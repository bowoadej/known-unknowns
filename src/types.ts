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
 * Minimal interface an LLM adapter must satisfy. Keeping this narrow means
 * known-unknowns isn't tied to any one provider - see src/adapters/ for a
 * reference implementation against the Anthropic SDK.
 */
export interface LLMAdapter {
    complete(systemPrompt: string, userPrompt: string): Promise<string>;
}