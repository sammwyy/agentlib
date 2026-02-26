import type {
    MemoryEntry,
    MemoryProvider,
    MemoryReadOptions,
    MemoryWriteOptions,
    ModelMessage,
} from '@agentlib/core'

export interface CompositeMemoryConfig {
    /**
     * Providers chained in order.
     * - read() queries them in order and returns the first non-empty result
     * - write() fans out to ALL providers
     */
    providers: MemoryProvider[]

    /**
     * read() strategy:
     * - 'first-hit': return the first provider that has data (default)
     * - 'merge': merge results from all providers (deduplicates by content)
     */
    readStrategy?: 'first-hit' | 'merge'
}

/**
 * CompositeMemory — chains multiple MemoryProvider implementations.
 *
 * Useful for combining fast local memory with slow persistent memory:
 *
 * @example
 * ```ts
 * const memory = new CompositeMemory({
 *   providers: [
 *     new BufferMemory({ maxMessages: 20 }),   // fast L1 cache
 *     new RedisMemory({ url: process.env.REDIS_URL! }), // persistent L2
 *   ],
 * })
 * ```
 *
 * Writes go to ALL providers. Reads try providers in order.
 */
export class CompositeMemory implements MemoryProvider {
    readonly type = 'composite'

    private readonly providers: MemoryProvider[]
    private readonly readStrategy: 'first-hit' | 'merge'

    constructor(config: CompositeMemoryConfig) {
        if (!config.providers.length) throw new Error('[CompositeMemory] At least one provider required.')
        this.providers = config.providers
        this.readStrategy = config.readStrategy ?? 'first-hit'
    }

    async read(options: MemoryReadOptions): Promise<ModelMessage[]> {
        if (this.readStrategy === 'first-hit') {
            for (const provider of this.providers) {
                const messages = await provider.read(options)
                if (messages.length > 0) return messages
            }
            return []
        }

        // merge: combine all, deduplicate by content fingerprint
        const all = await Promise.all(this.providers.map((p) => p.read(options)))
        const seen = new Set<string>()
        const merged: ModelMessage[] = []

        for (const messages of all) {
            for (const msg of messages) {
                const key = `${msg.role}:${msg.content.slice(0, 100)}`
                if (!seen.has(key)) {
                    seen.add(key)
                    merged.push(msg)
                }
            }
        }

        return merged
    }

    async write(messages: ModelMessage[], options: MemoryWriteOptions): Promise<void> {
        await Promise.all(this.providers.map((p) => p.write(messages, options)))
    }

    async clear(sessionId?: string): Promise<void> {
        await Promise.all(
            this.providers.map((p) => p.clear?.(sessionId)),
        )
    }

    async entries(sessionId?: string): Promise<MemoryEntry[]> {
        const all = await Promise.all(
            this.providers.map((p) => p.entries?.(sessionId) ?? Promise.resolve([])),
        )
        return all.flat()
    }
}