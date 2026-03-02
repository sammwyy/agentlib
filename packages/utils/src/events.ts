/**
 * A map of event names to their corresponding payload types.
 */
export type EventMap = Record<string, any>

/**
 * A callback function for an event.
 */
export type EventHandler<T = any> = (payload: T) => void | Promise<void>

/**
 * Extensible, fully typed event emitter.
 */
export class EventEmitter<TEvents extends EventMap = EventMap> {
    private readonly handlers = new Map<keyof TEvents, EventHandler[]>()

    /**
     * Subscribe to an event.
     */
    on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): this {
        const list = this.handlers.get(event) ?? []
        list.push(handler)
        this.handlers.set(event, list)
        return this
    }

    /**
     * Subscribe to an event once.
     */
    once<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): this {
        const wrapper: EventHandler<TEvents[K]> = async (payload) => {
            this.off(event, wrapper)
            return await handler(payload)
        }
        return this.on(event, wrapper)
    }

    /**
     * Unsubscribe from an event.
     */
    off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): this {
        const list = this.handlers.get(event)
        if (list) {
            this.handlers.set(
                event,
                list.filter((h) => h !== handler),
            )
        }
        return this
    }

    /**
     * Emit an event asynchronously, waiting for all handlers to complete.
     */
    async emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): Promise<void> {
        const list = this.handlers.get(event) ?? []
        await Promise.all(list.map((h) => h(payload)))
    }

    /**
     * Emit an event synchronously, not waiting for completion.
     */
    emitSync<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
        const list = this.handlers.get(event) ?? []
        for (const handler of list) {
            handler(payload)
        }
    }
}
