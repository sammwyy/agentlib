import { randomUUID } from 'node:crypto'

import type { ExecutionContext, ExecutionState, MemoryProvider, TokenUsage } from '../types/'
import type { EventEmitter } from '../event/emitter'

function emptyUsage(): TokenUsage {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

function emptyState(): ExecutionState {
    return {
        steps: [],
        messages: [],
        toolCalls: [],
        usage: emptyUsage(),
        startedAt: new Date(),
    }
}

export interface CreateContextOptions<TData> {
    input: string
    data: TData
    memory: MemoryProvider | null
    emitter: EventEmitter
    sessionId?: string | undefined
    signal?: AbortSignal | undefined
}

/**
 * Creates an isolated ExecutionContext for a single `.run()` call.
 */
export function createContext<TData>(options: CreateContextOptions<TData>): ExecutionContext<TData> {
    const { input, data, memory, emitter, signal } = options
    const state = emptyState()
    const sessionId = options.sessionId ?? randomUUID()

    signal?.addEventListener('abort', () => {
        void emitter.emit('cancel', { reason: signal.reason })
    })

    return {
        input,
        data,
        state,
        sessionId,
        memory,
        cancel() {
            void emitter.emit('cancel')
        },
        emit(event, payload) {
            void emitter.emit(event, payload)
        },
    }
}