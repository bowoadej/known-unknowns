import type { LLMAdapter, ToolSchema } from "../types.js";
import { withRetry, type RetryOptions } from "../retry.js";

// The Anthropic SDK is a peer dependency, not a hard dependency - this
// keeps known-unknowns provider-agnostic. Import type only here; the actual
// client instance is passed in by the caller, who already has it installed
// and configured.
// Structural interface for just the slice of the Anthropic client we use.
// Deliberately loose on the response type: mirroring the SDK's exact Message
// type here would couple us to its internal shape and break on every SDK
// revision (e.g. ContentBlock has no index signature, ours would need to
// match it exactly). We narrow the response safely at runtime instead - see
// the tool_use lookup and stop_reason check below.
interface AnthropicLikeClient {
    messages: {
        create(params: {
            model: string;
            max_tokens: number;
            system: string;
            messages: { role: "user"; content: string }[];
            tools: Array<{
                name: string;
                description: string;
                input_schema: { type: "object";[key: string]: unknown };
                strict?: boolean;
            }>;
            tool_choice: { type: "tool"; name: string };
        }): Promise<AnthropicResponse>;
    };
}

// What we actually read off the response, structurally. `content` is typed
// as unknown[] because the SDK's block union doesn't carry an index
// signature - we narrow each block at runtime rather than trusting a
// hand-mirrored static type.
interface AnthropicResponse {
    content: unknown[];
    stop_reason?: string | null;
}

export interface AnthropicAdapterOptions {
    model?: string;
    maxTokens?: number;
    /** Retry behavior for transient failures (rate limits, 5xx). Pass
     * `{ maxRetries: 0 }` to disable retries entirely. */
    retry?: RetryOptions;
}

export function anthropicAdapter(
    client: AnthropicLikeClient,
    options: AnthropicAdapterOptions = {}
): LLMAdapter {
    const model = options.model ?? "claude-sonnet-5";
    const maxTokens = options.maxTokens ?? 2000;
    const retryOptions = options.retry ?? {};

    return {
        async completeStructured(
            systemPrompt: string,
            userPrompt: string,
            schema: ToolSchema
        ): Promise<unknown> {
            const response = await withRetry(
                () =>
                    client.messages.create({
                        model,
                        max_tokens: maxTokens,
                        system: systemPrompt,
                        messages: [{ role: "user", content: userPrompt }],
                        // Define the schema as a strict tool. `strict: true` uses
                        // grammar-constrained sampling so the model's output is
                        // guaranteed to conform - not "usually valid JSON" the way a
                        // "please return JSON" prompt instruction is.
                        tools: [
                            {
                                name: schema.name,
                                description: schema.description,
                                input_schema: schema.inputSchema,
                                strict: true,
                            },
                        ],
                        // Force the model to call this specific tool, so it can't
                        // respond with prose instead. The result comes back as an
                        // already-structured tool_use block, not text to parse.
                        tool_choice: { type: "tool", name: schema.name },
                    }),
                retryOptions
            );

            // With max_tokens hit mid-generation the tool call can be truncated -
            // detect that specifically rather than letting it surface later as a
            // confusing downstream shape error.
            if (response.stop_reason === "max_tokens") {
                throw new Error(
                    "known-unknowns: the model hit max_tokens before completing its structured " +
                    "response. Increase maxTokens in the adapter options and retry."
                );
            }

            const toolUse = response.content.find(
                (block): block is { type: "tool_use"; name: string; input: unknown } =>
                    typeof block === "object" &&
                    block !== null &&
                    (block as { type?: unknown }).type === "tool_use"
            );

            if (!toolUse) {
                throw new Error(
                    "known-unknowns: expected a tool_use block in the response but found none."
                );
            }

            // toolUse.input is already a parsed object conforming to the schema -
            // no JSON.parse, no fence-stripping, no hoping the model complied.
            return toolUse.input;
        },
    };
}