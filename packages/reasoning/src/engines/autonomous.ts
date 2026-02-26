import type {
    ModelMessage,
    ReasoningContext,
    ReasoningEngine,
    ResponseStep,
    ThoughtStep,
} from '@agentlib/core'
import { callModel, executeToolCalls, extractText } from '../utils'

export interface AutonomousEngineConfig {
    /**
     * Absolute max steps before forcing termination.
     * @default 30
     */
    maxSteps?: number

    /**
     * Tool name the agent must call to signal it is done.
     * When called, its `result` argument is used as the final output.
     * @default 'finish'
     */
    finishToolName?: string

    /**
     * Description shown to the model for the finish tool.
     */
    finishToolDescription?: string
}

const DEFAULT_FINISH_DESCRIPTION =
    'Signal that you have completed the task. Call this with your final answer.'

/**
 * AutonomousEngine — open-ended agentic loop.
 *
 * The agent runs until it explicitly calls a `finish` tool.
 * This is the most open-ended engine — suitable for long-horizon tasks,
 * research, or multi-step automation where the agent decides when it's done.
 *
 * The `finish` tool is automatically injected into the tool list.
 * The agent must call it to terminate the loop.
 *
 * @example
 * ```ts
 * import { AutonomousEngine } from '@agentlib/reasoning'
 * agent.reasoning(new AutonomousEngine({ maxSteps: 50 }))
 * ```
 */
export class AutonomousEngine<TData = unknown> implements ReasoningEngine<TData> {
    readonly name = 'autonomous'
    private readonly maxSteps: number
    private readonly finishToolName: string
    private readonly finishToolDescription: string

    constructor(config: AutonomousEngineConfig = {}) {
        this.maxSteps = config.maxSteps ?? 30
        this.finishToolName = config.finishToolName ?? 'finish'
        this.finishToolDescription = config.finishToolDescription ?? DEFAULT_FINISH_DESCRIPTION
    }

    async execute(rCtx: ReasoningContext<TData>): Promise<string> {
        const { ctx, tools, policy } = rCtx

        // Inject the finish tool into the schema list for this run
        const finishSchema = {
            name: this.finishToolName,
            description: this.finishToolDescription,
            parameters: {
                type: 'object',
                properties: {
                    result: {
                        type: 'string',
                        description: 'Your final answer or output.',
                    },
                },
                required: ['result'],
            },
        }

        const baseSchemas = tools
            .getSchemas()
            .filter((t) => tools.isAllowed(t.name, policy.allowedTools))

        const allSchemas = [...baseSchemas, finishSchema]

        let steps = 0

        while (steps < this.maxSteps) {
            const response = await rCtx.model.complete({
                messages: ctx.state.messages,
                tools: allSchemas,
            })

            // Accumulate usage
            if (response.usage) {
                ctx.state.usage.promptTokens += response.usage.promptTokens
                ctx.state.usage.completionTokens += response.usage.completionTokens
                ctx.state.usage.totalTokens += response.usage.totalTokens
                if (policy.tokenBudget && ctx.state.usage.totalTokens >= policy.tokenBudget) {
                    throw new Error('[AutonomousEngine] Token budget exceeded.')
                }
            }

            ctx.state.messages.push(response.message)

            // Emit thought if there's content alongside tool calls
            if (response.message.content) {
                rCtx.pushStep({
                    type: 'thought',
                    content: response.message.content,
                    engine: this.name,
                } satisfies ThoughtStep)
            }

            // Check for finish tool call
            if (response.toolCalls?.length) {
                const finishCall = response.toolCalls.find((tc) => tc.name === this.finishToolName)

                if (finishCall) {
                    const result = String(
                        (finishCall.arguments as { result?: unknown }).result ?? response.message.content,
                    )

                    // Append finish tool result to messages
                    ctx.state.messages.push({
                        role: 'tool',
                        content: JSON.stringify({ done: true }),
                        toolCallId: finishCall.id,
                    })

                    rCtx.pushStep({ type: 'response', content: result, engine: this.name } satisfies ResponseStep)
                    return result
                }

                // Execute non-finish tool calls
                const regularCalls = response.toolCalls.filter((tc) => tc.name !== this.finishToolName)
                for (const tc of regularCalls) {
                    await rCtx.callTool(tc.name, tc.arguments, tc.id)
                }
            } else if (!response.toolCalls?.length) {
                // Model responded without calling any tool — treat as final answer
                const answer = extractText(response.message.content)
                rCtx.pushStep({ type: 'response', content: answer, engine: this.name })
                return answer
            }

            steps++
        }

        throw new Error(
            `[AutonomousEngine] Max steps (${this.maxSteps}) reached. The agent did not call "${this.finishToolName}".`,
        )
    }
}