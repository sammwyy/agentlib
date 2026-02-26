import type { ReasoningContext, ReasoningEngine, ThoughtStep, ResponseStep } from '@agentlib/core'
import { callModel, executeToolCalls } from '../utils'

export interface ReactEngineConfig {
    /**
     * Max number of reasoning steps before forcing a final answer.
     * @default 10
     */
    maxSteps?: number
}

/**
 * ReactEngine — Reason + Act (ReAct) loop.
 *
 * The canonical agent reasoning loop:
 *   1. Model thinks and optionally calls tools
 *   2. Tool results are appended to the conversation
 *   3. Model thinks again, incorporating results
 *   4. Repeat until no tool calls → final response
 *
 * This is the default engine when no reasoning strategy is configured.
 *
 * Paper: "ReAct: Synergizing Reasoning and Acting in Language Models" (Yao et al., 2022)
 *
 * @example
 * ```ts
 * import { ReactEngine } from '@agentlib/reasoning'
 * agent.reasoning(new ReactEngine({ maxSteps: 8 }))
 * ```
 */
export class ReactEngine<TData = unknown> implements ReasoningEngine<TData> {
    readonly name = 'react'
    private readonly maxSteps: number

    constructor(config: ReactEngineConfig = {}) {
        this.maxSteps = config.maxSteps ?? 10
    }

    async execute(rCtx: ReasoningContext<TData>): Promise<string> {
        const { ctx } = rCtx
        let steps = 0

        while (steps < this.maxSteps) {
            const response = await callModel(rCtx, ctx.state.messages)
            ctx.state.messages.push(response.message)

            // Model has thoughts but no tools → emit thought step and continue
            if (response.message.content && response.toolCalls?.length) {
                const thoughtStep: ThoughtStep = {
                    type: 'thought',
                    content: response.message.content,
                    engine: this.name,
                }
                rCtx.pushStep(thoughtStep)
            }

            // No tool calls → done
            if (!response.toolCalls?.length) {
                const responseStep: ResponseStep = {
                    type: 'response',
                    content: response.message.content,
                    engine: this.name,
                }
                rCtx.pushStep(responseStep)
                return response.message.content
            }

            // Execute all tool calls (appends tool result messages to ctx.state.messages)
            await executeToolCalls(rCtx, response)
            steps++
        }

        throw new Error(`[ReactEngine] Max steps (${this.maxSteps}) reached without a final answer.`)
    }
}