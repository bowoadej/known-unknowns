export { known, unknown, defineSubject } from "./src/types.js";
export type {
    Field,
    Subject,
    EvidenceType,
    Confidence,
    AvoidRule,
    Candidate,
    Ranking,
    GradedMatchResult,
    LLMAdapter,
} from "./src/types.js";

export { gradedMatch } from "./src/gradedMatch.js";
export type { GradedMatchOptions } from "./src/gradedMatch.js";

export { auditConfidence } from "./src/auditConfidence.js";
export type { AuditWarning } from "./src/auditConfidence.js";

export { anthropicAdapter } from "./src/adapters/anthropic.js";
export type { AnthropicAdapterOptions } from "./src/adapters/anthropic.js";