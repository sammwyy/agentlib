import type {
    AgentConfig,
    AgentPolicy,
    CoreEvent,
    EventHandler,
    ExecutionContext,
    Middleware,
    MemoryProvider,
    ModelProvider,
    ReasoningEngine,
    ReasoningStrategy,
    RunOptions,
    RunResult,
    ToolDefinition,
} from '../types'
import { EventEmitter } from '../event/emitter'
import { ToolRegistry, defineTool } from '../tool/registry'
import { MiddlewarePipeline } from '../middleware/pipeline'
import { createContext } from '../context/factory'
import { createReasoningContext } from '../reasoning/context'

/**
 * Agent — the central runtime orchestrator.
 * Delegates the step loop to a pluggable ReasoningEngine.
 */
export class AgentInstance<TData = unknown> {
    private readonly config: AgentConfig<TData>
    private _model: ModelProvider | undefined
    private _memory: MemoryProvider | null = null
    private _engine: ReasoningEngine<TData> | undefined
    private _policy: AgentPolicy = {}
    private readonly _tools: ToolRegistry<TData> = new ToolRegistry()
    private readonly _middleware: MiddlewarePipeline<TData> = new MiddlewarePipeline()
    private readonly _emitter: EventEmitter = new EventEmitter()
    private readonly _store = new Map<string, unknown>()

    constructor(config: AgentConfig<TData> = { name: 'agent' }) {
        this.config = config
        if (config.model) this._model = config.model
        if (config.memory) this._memory = config.memory
        if (config.policy) this._policy = config.policy
        if (config.tools) config.tools.forEach((t) => this._tools.register(t))
        if (config.middleware) config.middleware.forEach((m) => this._middleware.use(m))
        if (config.data !== undefined) this._store.set('__defaultData', config.data)
        if (config.reasoning) {
            if (typeof config.reasoning === 'string') {
                this._store.set('__reasoningStrategy', config.reasoning)
            } else {
                this._engine = config.reasoning
            }
        }
    }

    provider(model: ModelProvider): this { this._model = model; return this }
    tool(definition: ToolDefinition<TData>): this { this._tools.register(definition); return this }
    use(middleware: Middleware<TData>): this { this._middleware.use(middleware); return this }
    memory(provider: MemoryProvider): this { this._memory = provider; return this }
    policy(policy: AgentPolicy): this { this._policy = { ...this._policy, ...policy }; return this }

    reasoning(engine: ReasoningEngine<TData> | ReasoningStrategy): this {
        if (typeof engine === 'string') {
            this._store.set('__reasoningStrategy', engine)
        } else {
            this._engine = engine
        }
        return this
    }

    set(key: string, value: unknown): this { this._store.set(key, value); return this }
    get(key: string): unknown { return this._store.get(key) }

    on<TPayload = unknown>(event: CoreEvent | string, handler: EventHandler<TPayload>): this {
        this._emitter.on(event, handler)
        return this
    }

    async run(options: RunOptions<TData> | string): Promise<RunResult> {
        const opts: RunOptions<TData> = typeof options === 'string' ? { input: options } : options
        const defaultData = (this._store.get('__defaultData') ?? {}) as TData
        const data = { ...defaultData, ...(opts.data ?? {}) } as TData

        const ctx = createContext<TData>({
            input: opts.input, data, memory: this._memory,
            emitter: this._emitter, sessionId: opts.sessionId, signal: opts.signal,
        })

        await this._emitter.emit('run:start', { input: opts.input, sessionId: ctx.sessionId })

        try {
            await this._middleware.run({ scope: 'run:before', ctx })
            const output = await this._executeWithEngine(ctx)
            ctx.state.finishedAt = new Date()
            await this._middleware.run({ scope: 'run:after', ctx })
            await this._emitter.emit('run:end', { output, state: ctx.state })
            return { output, state: ctx.state }
        } catch (err) {
            await this._emitter.emit('error', err)
            throw err
        }
    }

    private async _executeWithEngine(ctx: ExecutionContext<TData>): Promise<string> {
        if (!this._model) throw new Error(`[Agent:${this.config.name}] No model provider configured.`)

        const engine = this._resolveEngine()

        // Seed messages
        ctx.state.messages = []
        if (this.config.systemPrompt) {
            ctx.state.messages.push({ role: 'system', content: this.config.systemPrompt })
        }
        ctx.state.messages.push({ role: 'user', content: ctx.input })

        // Load memory
        if (ctx.memory) {
            await this._emitter.emit('memory:read', { sessionId: ctx.sessionId })
            const history = await ctx.memory.read({ sessionId: ctx.sessionId })
            ctx.state.messages = [...history, ...ctx.state.messages]
        }

        const rCtx = createReasoningContext({
            ctx, model: this._model, tools: this._tools,
            policy: this._policy, systemPrompt: this.config.systemPrompt,
            emitter: this._emitter, middleware: this._middleware,
        })

        const output = await engine.execute(rCtx)

        // Persist to memory
        if (ctx.memory) {
            await this._emitter.emit('memory:write', { sessionId: ctx.sessionId })
            await ctx.memory.write(ctx.state.messages, {
                sessionId: ctx.sessionId, agentName: this.config.name,
            })
        }

        return output
    }

    private _resolveEngine(): ReasoningEngine<TData> {
        if (this._engine) return this._engine

        const strategyName = this._store.get('__reasoningStrategy') as ReasoningStrategy | undefined
        const registry = engineRegistry as Map<string, () => ReasoningEngine<unknown>>

        if (strategyName) {
            const factory = registry.get(strategyName)
            if (factory) return factory() as ReasoningEngine<TData>
            throw new Error(
                `[Agent] Reasoning strategy "${strategyName}" not registered. ` +
                `Import @agentlib/reasoning and call registerEngines() first.`,
            )
        }

        const reactFactory = registry.get('react')
        if (reactFactory) return reactFactory() as ReasoningEngine<TData>

        return createPassthroughEngine<TData>()
    }
}

export const engineRegistry = new Map<string, () => ReasoningEngine<unknown>>()

export function registerEngine(
    name: ReasoningStrategy | string,
    factory: () => ReasoningEngine<unknown>,
): void {
    engineRegistry.set(name, factory)
}

function createPassthroughEngine<TData>(): ReasoningEngine<TData> {
    return {
        name: 'passthrough',
        async execute(rCtx) {
            const { model, ctx } = rCtx
            const response = await model.complete({ messages: ctx.state.messages })
            if (response.usage) {
                ctx.state.usage.promptTokens += response.usage.promptTokens
                ctx.state.usage.completionTokens += response.usage.completionTokens
                ctx.state.usage.totalTokens += response.usage.totalTokens
            }
            ctx.state.messages.push(response.message)
            rCtx.pushStep({ type: 'response', content: response.message.content, engine: 'passthrough' })
            return response.message.content
        },
    }
}

export { defineTool }