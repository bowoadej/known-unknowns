import type { LLMAdapter } from "../types.js";
import { withRetry, type RetryOptions } from "../retry.js";

// The Anthropic SDK is a peer dependency, not a hard dependency - this
// keeps known-unknowns provider-agnostic. Import type only here; the actual
// client instance is passed in by the caller, who already has it installed
// and configured.
interface AnthropicLikeClient {
    messages: {
        create(params: {
            model: string;
            max_tokens: number;
            system: string;
            messages: { role: "user"; content: string }[];
        }): Promise<{ content: { type: string; text?: string }[] }>;
    };
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
        async complete(systemPrompt: string, userPrompt: string): Promise<string> {
            const response = await withRetry(
                () =>
                    client.messages.create({
                        model,
                        max_tokens: maxTokens,
                        system: systemPrompt,
                        messages: [{ role: "user", content: userPrompt }],
                    }),
                retryOptions
            );

            const textBlock = response.content.find((block) => block.type === "text");
            if (!textBlock?.text) {
                throw new Error("known-unknowns: Anthropic response contained no text block.");
            }
            return textBlock.text;
        },
    };
}