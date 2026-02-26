// ─── Model Provider Types ───────────────────────────────────────────────────

export interface ModelMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    reasoning?: string | undefined
    toolCallId?: string | undefined
    toolCalls?: ToolCall[] | undefined
}

export interface ToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
}

export interface ModelRequest {
    messages: ModelMessage[]
    tools?: ToolSchema[]
    stream?: boolean
}

export interface ModelResponse {
    message: ModelMessage
    toolCalls?: ToolCall[] | undefined
    usage?: TokenUsage | undefined
    raw?: unknown | undefined
}

export interface TokenUsage {
    promptTokens: number
    completionTokens: number
    totalTokens: number
}

export interface ModelProvider {
    name: string
    complete(request: ModelRequest): Promise<ModelResponse>
    stream?(request: ModelRequest): AsyncIterable<ModelResponseChunk>
}

export interface ModelResponseChunk {
    delta: string
    done: boolean
}

// ─── Tool Types ──────────────────────────────────────────────────────────────

export interface ToolSchema {
    name: string
    description: string
    parameters: Record<string, unknown> // JSON Schema
}

/** Base interface for tool lookup — avoids circular dependency with ReasoningContext */
export interface ToolDefinitionBase {
    schema: ToolSchema
    execute(args: Record<string, unknown>, ctx: unknown): Promise<unknown>
}

export interface ToolDefinition<TData = unknown> extends ToolDefinitionBase {
    schema: ToolSchema
    execute(args: Record<string, unknown>, ctx: ExecutionContext<TData>): Promise<unknown>
}

// ─── Memory Types ────────────────────────────────────────────────────────────

/**
 * A single stored memory entry — wraps a conversation turn with metadata.
 */
export interface MemoryEntry {
    id: string
    sessionId: string
    messages: ModelMessage[]
    metadata: MemoryMetadata
}

export interface MemoryMetadata {
    createdAt: Date
    /** ISO string of when this memory was last accessed */
    accessedAt?: Date | undefined
    /** Agent that created this memory */
    agentName?: string | undefined
    /** Arbitrary key/value tags for filtering */
    tags?: Record<string, string> | undefined
    /** Token count estimate for this entry */
    tokenCount?: number | undefined
}

/**
 * Options passed to MemoryProvider.read() to control what is retrieved.
 */
export interface MemoryReadOptions {
    /** Max number of messages to return (provider may trim older ones) */
    limit?: number | undefined
    /** Only return messages from this session */
    sessionId?: string | undefined
    /** Semantic query for vector-based providers */
    query?: string | undefined
    /** Filter by metadata tags */
    tags?: Record<string, string> | undefined
}

/**
 * Options passed to MemoryProvider.write().
 */
export interface MemoryWriteOptions {
    sessionId?: string | undefined
    tags?: Record<string, string> | undefined
    agentName?: string | undefined
}

/**
 * Core memory provider interface.
 * All memory implementations must satisfy this contract.
 */
export interface MemoryProvider {
    readonly type: string
    /** Load prior conversation history to inject before the current run */
    read(options: MemoryReadOptions): Promise<ModelMessage[]>
    /** Persist the messages produced by a completed run */
    write(messages: ModelMessage[], options: MemoryWriteOptions): Promise<void>
    /** Remove all stored memory (optional — not all providers support this) */
    clear?(sessionId?: string): Promise<void>
    /** Return raw entries for inspection/debugging */
    entries?(sessionId?: string): Promise<MemoryEntry[]>
}

// ─── Reasoning Types ─────────────────────────────────────────────────────────

export type ReasoningStrategy = 'react' | 'planner' | 'cot' | 'reflect' | 'autonomous'

/**
 * A single reasoning step emitted by an engine during execution.
 * Steps are appended to ctx.state.steps and emitted as events.
 */
export type ReasoningStep =
    | ThoughtStep
    | PlanStep
    | ToolCallStep
    | ToolResultStep
    | ReflectionStep
    | ResponseStep

export interface ThoughtStep {
    type: 'thought'
    content: string
    /** Engine that produced this step */
    engine: string
}

export interface PlanStep {
    type: 'plan'
    /** Ordered list of subtasks to complete */
    tasks: PlanTask[]
    engine: string
}

export interface PlanTask {
    id: string
    description: string
    dependsOn?: string[]
    status: 'pending' | 'in_progress' | 'done' | 'failed'
    result?: unknown
}

export interface ToolCallStep {
    type: 'tool_call'
    toolName: string
    args: Record<string, unknown>
    callId: string
    engine: string
}

export interface ToolResultStep {
    type: 'tool_result'
    toolName: string
    callId: string
    result: unknown
    error?: string
    engine: string
}

export interface ReflectionStep {
    type: 'reflection'
    /** What the engine assessed about its previous output */
    assessment: string
    /** Whether the engine decided the answer needs revision */
    needsRevision: boolean
    engine: string
}

export interface ResponseStep {
    type: 'response'
    content: string
    engine: string
}

/**
 * The contract every reasoning engine must implement.
 *
 * Engines receive a `ReasoningContext` (the full runtime environment)
 * and return the final string output. They may push steps to
 * `rCtx.pushStep()` during execution for observability.
 */
export interface ReasoningEngine<TData = unknown> {
    readonly name: string
    execute(rCtx: ReasoningContext<TData>): Promise<string>
}

/**
 * Runtime context passed into every engine.
 * Gives engines access to the model, tools, messages, policies, and step tracking.
 */
export interface ReasoningContext<TData = unknown> {
    /** The enclosing execution context */
    ctx: ExecutionContext<TData>
    /** The configured model provider */
    model: ModelProvider
    /** All registered tools */
    tools: ToolRegistry
    /** Agent policy constraints */
    policy: AgentPolicy
    /** System prompt (if set) */
    systemPrompt?: string | undefined
    /** Append a step to state.steps and emit a 'step:reasoning' event */
    pushStep(step: ReasoningStep): void
    /** Execute a tool by name and record the result */
    callTool(name: string, args: Record<string, unknown>, callId: string): Promise<unknown>
}

/** Minimal tool registry interface exposed to reasoning engines */
export interface ToolRegistry {
    get(name: string): ToolDefinitionBase | undefined
    getSchemas(): ToolSchema[]
    isAllowed(name: string, allowedTools?: string[]): boolean
}

// ─── Execution Context ───────────────────────────────────────────────────────

export interface ExecutionState {
    steps: ReasoningStep[]
    messages: ModelMessage[]
    toolCalls: Array<{ call: ToolCall; result: unknown }>
    usage: TokenUsage
    startedAt: Date
    finishedAt?: Date
}

export interface ExecutionContext<TData = unknown> {
    /** User input for this run */
    input: string
    /** User-defined typed state */
    data: TData
    /** Internal runtime state — do not mutate */
    state: ExecutionState
    /** Active session ID for this run */
    sessionId: string
    /** Memory provider scoped to this run */
    memory: MemoryProvider | null
    /** Cancel the current execution */
    cancel(): void
    /** Emit a custom event */
    emit(event: string, payload?: unknown): void
}

// ─── Middleware Types ─────────────────────────────────────────────────────────

export type MiddlewareScope =
    | 'run:before'
    | 'run:after'
    | 'step:before'
    | 'step:after'
    | 'tool:before'
    | 'tool:after'

export interface MiddlewareContext<TData = unknown> {
    scope: MiddlewareScope
    ctx: ExecutionContext<TData>
    /** Tool-specific context, present when scope is tool:* */
    tool?: {
        name: string
        args: Record<string, unknown>
        result?: unknown
    }
}

export type NextFn = () => Promise<void>

export interface Middleware<TData = unknown> {
    name?: string
    scope?: MiddlewareScope | MiddlewareScope[]
    run(mCtx: MiddlewareContext<TData>, next: NextFn): Promise<void>
}

// ─── Event Types ─────────────────────────────────────────────────────────────

export type CoreEvent =
    | 'run:start'
    | 'run:end'
    | 'step:start'
    | 'step:end'
    | 'model:request'
    | 'model:response'
    | 'tool:before'
    | 'tool:after'
    | 'memory:read'
    | 'memory:write'
    | 'cancel'
    | 'error'

export type EventHandler<TPayload = unknown> = (payload: TPayload) => void | Promise<void>

// ─── Agent Policy Types ───────────────────────────────────────────────────────

export interface AgentPolicy {
    maxSteps?: number
    maxCost?: number
    timeout?: number
    allowedTools?: string[]
    tokenBudget?: number
    maxParallelTools?: number
}

// ─── Agent Config Types ───────────────────────────────────────────────────────

export interface AgentConfig<TData = unknown> {
    name: string
    model?: ModelProvider
    tools?: ToolDefinition<TData>[]
    memory?: MemoryProvider
    reasoning?: ReasoningStrategy | ReasoningEngine<TData>
    middleware?: Middleware<TData>[]
    policy?: AgentPolicy
    systemPrompt?: string
    data?: TData
}

export interface RunOptions<TData = unknown> {
    input: string
    data?: Partial<TData>
    signal?: AbortSignal
    /** Session identifier for memory scoping. Defaults to a random UUID per run. */
    sessionId?: string
}

export interface RunResult {
    output: string
    state: ExecutionState
}