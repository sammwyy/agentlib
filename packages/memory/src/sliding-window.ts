import { randomUUID } from 'node:crypto'
import type {
    MemoryEntry,
    MemoryProvider,
    MemoryReadOptions,
    MemoryWriteOptions,
    ModelMessage,
} from '@agentlib/core'
import { estimateMessagesTokens, trimToTokenBudget } from '@agentlib/core'

export interface SlidingWindowMemoryConfig {
    /**
     * Maximum token budget for the retrieved history window.
     * @default 4000
     */
    maxTokens?: number

    /**
     * Maximum number of conversation turns (user+assistant pairs) to keep.
     * Older turns are evicted to make room for newer ones.
     * @default 50
     */
    maxTurns?: number
}

/**
 * SlidingWindowMemory — token-aware in-process memory.
 *
 * Instead of counting raw messages, it tracks conversation turns (user+assistant pairs)
 * and enforces a token budget when retrieving history. This is closer to how
 * production systems typically manage context windows.
 *
 * @example
 * ```ts
 * const memory = new SlidingWindowMemory({ maxTokens: 8000, maxTurns: 30 })
 * agent.memory(memory)
 * ```
 */
export class SlidingWindowMemory implements MemoryProvider {
    readonly type = 'sliding-window'

    private readonly maxTokens: number
    private readonly maxTurns: number
    private readonly sessions = new Map<string, ConversationTurn[]>()
    private readonly meta = new Map<string, MemoryEntry>()

    constructor(config: SlidingWindowMemoryConfig = {}) {
        this.maxTokens = config.maxTokens ?? 4000
        this.maxTurns = config.maxTurns ?? 50
    }

    async read(options: MemoryReadOptions): Promise<ModelMessage[]> {
        const sessionId = options.sessionId ?? 'default'
        const turns = this.sessions.get(sessionId) ?? []

        // Flatten turns to messages
        const messages = turns.flatMap((t) => t.messages)

        // Apply token budget
        const trimmed = trimToTokenBudget(messages, this.maxTokens)

        // Update access time
        const entry = this.meta.get(sessionId)
        if (entry) entry.metadata.accessedAt = new Date()

        return trimmed
    }

    async write(messages: ModelMessage[], options: MemoryWriteOptions): Promise<void> {
        const sessionId = options.sessionId ?? 'default'
        const existing = this.sessions.get(sessionId) ?? []

        // Group non-system messages into turns
        const nonSystem = messages.filter((m) => m.role !== 'system')
        const newTurns = groupIntoTurns(nonSystem)

        // Merge with existing, keep the most recent maxTurns
        const merged = [...existing, ...newTurns].slice(-this.maxTurns)
        this.sessions.set(sessionId, merged)

        const allMessages = merged.flatMap((t) => t.messages)
        this.meta.set(sessionId, {
            id: this.meta.get(sessionId)?.id ?? randomUUID(),
            sessionId,
            messages: allMessages,
            metadata: {
                createdAt: this.meta.get(sessionId)?.metadata.createdAt ?? new Date(),
                accessedAt: new Date(),
                agentName: options.agentName,
                tags: options.tags,
                tokenCount: estimateMessagesTokens(allMessages),
            },
        })
    }

    async clear(sessionId?: string): Promise<void> {
        if (sessionId) {
            this.sessions.delete(sessionId)
            this.meta.delete(sessionId)
        } else {
            this.sessions.clear()
            this.meta.clear()
        }
    }

    async entries(sessionId?: string): Promise<MemoryEntry[]> {
        if (sessionId) {
            const entry = this.meta.get(sessionId)
            return entry ? [entry] : []
        }
        return [...this.meta.values()]
    }

    stats(sessionId: string): { turns: number; estimatedTokens: number } | null {
        const turns = this.sessions.get(sessionId)
        if (!turns) return null
        const messages = turns.flatMap((t) => t.messages)
        return { turns: turns.length, estimatedTokens: estimateMessagesTokens(messages) }
    }
}

// ─── Internals ────────────────────────────────────────────────────────────────

interface ConversationTurn {
    messages: ModelMessage[]
}

/**
 * Groups a flat message list into logical turns (user → assistant → tool responses).
 */
function groupIntoTurns(messages: ModelMessage[]): ConversationTurn[] {
    const turns: ConversationTurn[] = []
    let current: ModelMessage[] = []

    for (const msg of messages) {
        current.push(msg)

        // A turn ends when the assistant finishes (no pending tool calls)
        if (msg.role === 'assistant' && !msg.toolCalls?.length) {
            turns.push({ messages: current })
            current = []
        }
    }

    // Flush any trailing messages (e.g. incomplete tool call sequences)
    if (current.length) turns.push({ messages: current })

    return turns
}