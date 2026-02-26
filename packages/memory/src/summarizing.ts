import { randomUUID } from 'node:crypto'
import type {
    MemoryEntry,
    MemoryProvider,
    MemoryReadOptions,
    MemoryWriteOptions,
    ModelMessage,
    ModelProvider,
} from '@agentlib/core'
import { estimateMessagesTokens } from '@agentlib/core'

export interface SummarizingMemoryConfig {
    /**
     * The model provider used to generate summaries.
     * Should be a fast/cheap model (e.g. gpt-4o-mini).
     */
    model: ModelProvider

    /**
     * Token budget for the active (non-summarized) window.
     * When exceeded, the oldest messages are compressed into a summary.
     * @default 3000
     */
    activeWindowTokens?: number

    /**
     * Max tokens to allow for the compressed summary itself.
     * @default 600
     */
    summaryMaxTokens?: number

    /**
     * Prompt used to generate summaries.
     */
    summaryPrompt?: string
}

const DEFAULT_SUMMARY_PROMPT = `You are a memory compression assistant.
Summarize the following conversation concisely, preserving key facts, decisions, and context.
Output only the summary — no preamble or commentary.`

/**
 * SummarizingMemory — compresses old conversation context using the model.
 *
 * When the stored history exceeds `activeWindowTokens`, older messages are
 * summarized into a single system-style message. This lets agents maintain
 * coherent long conversations without blowing the context window.
 *
 * @example
 * ```ts
 * const memory = new SummarizingMemory({
 *   model: openai({ apiKey: '...', model: 'gpt-4o-mini' }),
 *   activeWindowTokens: 3000,
 * })
 * agent.memory(memory)
 * ```
 */
export class SummarizingMemory implements MemoryProvider {
    readonly type = 'summarizing'

    private readonly model: ModelProvider
    private readonly activeWindowTokens: number
    private readonly summaryMaxTokens: number
    private readonly summaryPrompt: string
    private readonly sessions = new Map<string, SessionData>()

    constructor(config: SummarizingMemoryConfig) {
        this.model = config.model
        this.activeWindowTokens = config.activeWindowTokens ?? 3000
        this.summaryMaxTokens = config.summaryMaxTokens ?? 600
        this.summaryPrompt = config.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT
    }

    async read(options: MemoryReadOptions): Promise<ModelMessage[]> {
        const sessionId = options.sessionId ?? 'default'
        const session = this.sessions.get(sessionId)
        if (!session) return []

        const messages: ModelMessage[] = []

        // Inject summary as a system message if one exists
        if (session.summary) {
            messages.push({
                role: 'system',
                content: `[Conversation summary so far]\n${session.summary}`,
            })
        }

        // Then inject the recent (active) window
        messages.push(...session.activeMessages)

        session.accessedAt = new Date()
        return messages
    }

    async write(messages: ModelMessage[], options: MemoryWriteOptions): Promise<void> {
        const sessionId = options.sessionId ?? 'default'
        const existing = this.sessions.get(sessionId) ?? {
            id: randomUUID(),
            sessionId,
            summary: null,
            activeMessages: [],
            createdAt: new Date(),
            accessedAt: new Date(),
            agentName: options.agentName,
        }

        // Store non-system messages in the active window
        const nonSystem = messages.filter((m) => m.role !== 'system')
        existing.activeMessages = nonSystem
        existing.accessedAt = new Date()

        // Check if active window exceeds budget
        const tokens = estimateMessagesTokens(existing.activeMessages)
        if (tokens > this.activeWindowTokens) {
            await this._compress(existing)
        }

        this.sessions.set(sessionId, existing)
    }

    async clear(sessionId?: string): Promise<void> {
        if (sessionId) {
            this.sessions.delete(sessionId)
        } else {
            this.sessions.clear()
        }
    }

    async entries(sessionId?: string): Promise<MemoryEntry[]> {
        const toReturn = sessionId
            ? [this.sessions.get(sessionId)].filter(Boolean)
            : [...this.sessions.values()]

        return (toReturn as SessionData[]).map((s) => ({
            id: s.id,
            sessionId: s.sessionId,
            messages: s.activeMessages,
            metadata: {
                createdAt: s.createdAt,
                accessedAt: s.accessedAt,
                agentName: s.agentName,
                tokenCount: estimateMessagesTokens(s.activeMessages),
            },
        }))
    }

    /** Get the current summary for a session (for debugging/inspection) */
    getSummary(sessionId: string): string | null {
        return this.sessions.get(sessionId)?.summary ?? null
    }

    // ─── Private ────────────────────────────────────────────────────────────────

    private async _compress(session: SessionData): Promise<void> {
        // Split: keep a fresh tail, compress the head
        const messages = session.activeMessages
        const splitAt = Math.floor(messages.length / 2)
        const toCompress = messages.slice(0, splitAt)
        const toKeep = messages.slice(splitAt)

        const existingSummary = session.summary
            ? `Previous summary:\n${session.summary}\n\nNew conversation to add:`
            : ''

        const compressInput = [
            ...toCompress.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
        ].join('\n')

        const response = await this.model.complete({
            messages: [
                { role: 'system', content: this.summaryPrompt },
                { role: 'user', content: `${existingSummary}\n${compressInput}` },
            ],
        })

        // Clamp summary length
        const rawSummary = response.message.content
        const trimmedSummary = rawSummary.slice(0, this.summaryMaxTokens * 4) // ~4 chars/token

        session.summary = trimmedSummary
        session.activeMessages = toKeep
    }
}

// ─── Internals ────────────────────────────────────────────────────────────────

interface SessionData {
    id: string
    sessionId: string
    summary: string | null
    activeMessages: ModelMessage[]
    createdAt: Date
    accessedAt: Date
    agentName?: string | undefined
}