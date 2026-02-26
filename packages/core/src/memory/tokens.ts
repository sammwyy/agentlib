import type { ModelMessage } from '../types'

/**
 * Rough token count estimate: ~4 chars per token.
 * Good enough for budget enforcement without requiring a tokenizer.
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
}

/**
 * Estimate total tokens for an array of messages.
 */
export function estimateMessagesTokens(messages: ModelMessage[]): number {
    return messages.reduce((acc, msg) => acc + estimateTokens(msg.content) + 4, 0)
}

/**
 * Trim messages from the front (oldest) to fit within a token budget.
 * Always preserves system messages at the start.
 */
export function trimToTokenBudget(messages: ModelMessage[], maxTokens: number): ModelMessage[] {
    const system = messages.filter((m) => m.role === 'system')
    const rest = messages.filter((m) => m.role !== 'system')

    let tokens = estimateMessagesTokens(system)
    const result: ModelMessage[] = []

    // Walk from newest to oldest, include what fits
    for (let i = rest.length - 1; i >= 0; i--) {
        const msg = rest[i]
        if (!msg) continue
        const t = estimateTokens(msg.content) + 4
        if (tokens + t > maxTokens) break
        result.unshift(msg)
        tokens += t
    }

    return [...system, ...result]
}