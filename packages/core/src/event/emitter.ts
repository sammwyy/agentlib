import type { CoreEvent, EventHandler } from '../types'

type AnyHandler = EventHandler<unknown>

/**
 * Lightweight typed event emitter used internally by the Agent runtime.
 */
export class EventEmitter {
    private readonly handlers = new Map<string, AnyHandler[]>()

    on<TPayload = unknown>(event: CoreEvent | string, handler: EventHandler<TPayload>): this {
        const list = this.handlers.get(event) ?? []
        list.push(handler as AnyHandler)
        this.handlers.set(event, list)
        return this
    }

    off(event: CoreEvent | string, handler: AnyHandler): this {
        const list = this.handlers.get(event)
        if (list) {
            this.handlers.set(
                event,
                list.filter((h) => h !== handler),
            )
        }
        return this
    }

    async emit(event: CoreEvent | string, payload?: unknown): Promise<void> {
        const list = this.handlers.get(event) ?? []
        await Promise.all(list.map((h) => h(payload)))
    }
}