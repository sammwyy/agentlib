import { randomUUID } from 'node:crypto'
import type {
    MemoryEntry,
    MemoryProvider,
    MemoryReadOptions,
    MemoryWriteOptions,
    ModelMessage,
} from '@agentlib/core'
import { trimToTokenBudget } from '@agentlib/core'

export interface BufferMemoryConfig {
    /**
     * Maximum number of messages to retain per session (counts pairs: user+assistant).
     * Oldest messages are dropped first. System messages are always kept.
     * @default 20
     */
    maxMessages?: number | undefined

    /**
     * If set, trim history to fit within this token budget.
     * Applied after maxMessages trimming.
     */
    maxTokens?: number | undefined

    /**
     * Optional pre-populated store.
     * Useful for seeding memory or testing.
     */
    defaultStore?: Map<string, ModelMessage[]> | undefined
}

/**
 * BufferMemory — simplest in-process memory.
 *
 * Stores messages in a Map keyed by sessionId.
 * Persists for the lifetime of the process.
 * Best for: single-process apps, development, testing.
 *
 * @example
 * ```ts
 * const memory = new BufferMemory({ maxMessages: 40 })
 * agent.memory(memory)
 *
 * // Same sessionId → conversation continues
 * await agent.run({ input: 'Hello', sessionId: 'user-123' })
 * await agent.run({ input: 'What did I just say?', sessionId: 'user-123' })
 * ```
 */
export class BufferMemory implements MemoryProvider {
    readonly type = 'buffer'

    private readonly maxMessages: number
    private readonly maxTokens: number | undefined
    private readonly store: Map<string, ModelMessage[]>
    private readonly meta = new Map<string, MemoryEntry>()

    constructor(config: BufferMemoryConfig = {}) {
        this.maxMessages = config.maxMessages ?? 20
        this.maxTokens = config.maxTokens
        this.store = config.defaultStore ?? new Map<string, ModelMessage[]>()
    }

    async read(options: MemoryReadOptions): Promise<ModelMessage[]> {
        const sessionId = options.sessionId ?? 'default'
        let messages = this.store.get(sessionId) ?? []

        // Update access time
        const entry = this.meta.get(sessionId)
        if (entry) entry.metadata.accessedAt = new Date()

        // Apply token budget if configured
        if (this.maxTokens) {
            messages = trimToTokenBudget(messages, this.maxTokens)
        }

        return messages
    }

    async write(messages: ModelMessage[], options: MemoryWriteOptions): Promise<void> {
        const sessionId = options.sessionId ?? 'default'

        // Filter out system messages from storage (they're re-injected by the agent)
        const toStore = messages.filter((m) => m.role !== 'system')

        // Trim to maxMessages (keep newest)
        const trimmed =
            toStore.length > this.maxMessages ? toStore.slice(-this.maxMessages) : toStore

        this.store.set(sessionId, trimmed)

        this.meta.set(sessionId, {
            id: this.meta.get(sessionId)?.id ?? randomUUID(),
            sessionId,
            messages: trimmed,
            metadata: {
                createdAt: this.meta.get(sessionId)?.metadata.createdAt ?? new Date(),
                accessedAt: new Date(),
                agentName: options.agentName,
                tags: options.tags,
            },
        })
    }

    async clear(sessionId?: string): Promise<void> {
        if (sessionId) {
            this.store.delete(sessionId)
            this.meta.delete(sessionId)
        } else {
            this.store.clear()
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

    /** Number of active sessions currently in memory */
    get sessionCount(): number {
        return this.store.size
    }
}