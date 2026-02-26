import type {
    AgentPolicy,
    ExecutionContext,
    ModelProvider,
    ReasoningContext,
    ReasoningStep,
    ToolCallStep,
    ToolResultStep,
} from '../types'
import type { ToolRegistry } from '../tool/registry'
import type { EventEmitter } from '../event/emitter'
import type { MiddlewarePipeline } from '../middleware/pipeline'

export interface CreateReasoningContextOptions<TData> {
    ctx: ExecutionContext<TData>
    model: ModelProvider
    tools: ToolRegistry<TData>
    policy: AgentPolicy
    systemPrompt?: string | undefined
    emitter: EventEmitter
    middleware: MiddlewarePipeline<TData>
}

/**
 * Creates a ReasoningContext that bridges the Agent runtime to any ReasoningEngine.
 *
 * Engines use this to:
 * - Push typed steps for observability
 * - Call tools (which fires middleware and events)
 * - Access the model, messages, policy
 */
export function createReasoningContext<TData>(
    options: CreateReasoningContextOptions<TData>,
): ReasoningContext<TData> {
    const { ctx, model, tools, policy, systemPrompt, emitter, middleware } = options

    return {
        ctx,
        model,
        tools,
        policy,
        systemPrompt,

        pushStep(step: ReasoningStep): void {
            ctx.state.steps.push(step)
            void emitter.emit('step:reasoning', step)
        },

        async callTool(name: string, args: Record<string, unknown>, callId: string): Promise<unknown> {
            const tool = tools.get(name)
            if (!tool) throw new Error(`[Reasoning] Unknown tool: "${name}"`)

            if (!tools.isAllowed(name, policy.allowedTools)) {
                throw new Error(`[Reasoning] Tool not allowed by policy: "${name}"`)
            }

            const callStep: ToolCallStep = {
                type: 'tool_call',
                toolName: name,
                args,
                callId,
                engine: 'runtime',
            }

            void emitter.emit('tool:before', { tool: name, args })
            await middleware.run({ scope: 'tool:before', ctx, tool: { name, args } })

            let result: unknown
            let error: string | undefined

            try {
                result = await tool.execute(args, ctx)
            } catch (err) {
                error = err instanceof Error ? err.message : String(err)
                const resultStep: ToolResultStep = {
                    type: 'tool_result',
                    toolName: name,
                    callId,
                    result: null,
                    error,
                    engine: 'runtime',
                }
                ctx.state.steps.push(resultStep)
                ctx.state.toolCalls.push({ call: { id: callId, name, arguments: args }, result: null })

                ctx.state.messages.push({
                    role: 'tool',
                    content: JSON.stringify({ error }),
                    toolCallId: callId,
                })

                void emitter.emit('tool:after', { tool: name, error })
                await middleware.run({ scope: 'tool:after', ctx, tool: { name, args, result: null } })
                throw err
            }

            const resultStep: ToolResultStep = {
                type: 'tool_result',
                toolName: name,
                callId,
                result,
                engine: 'runtime',
            }
            ctx.state.steps.push(resultStep)
            ctx.state.toolCalls.push({ call: { id: callId, name, arguments: args }, result })

            ctx.state.messages.push({
                role: 'tool',
                content: JSON.stringify(result),
                toolCallId: callId,
            })

            void emitter.emit('tool:after', { tool: name, result })
            await middleware.run({ scope: 'tool:after', ctx, tool: { name, args, result } })

            return result
        },
    }
}