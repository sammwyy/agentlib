import type {
    ModelMessage,
    ReasoningContext,
    ReasoningEngine,
    ThoughtStep,
    ResponseStep,
} from '@agentlib/core'
import { callModel, executeToolCalls, extractText } from '../utils'

export interface ChainOfThoughtEngineConfig {
    /**
     * Whether to use XML-style <thinking> tags to separate reasoning from response.
     * When true, the engine strips the thinking block before returning the final answer.
     * @default true
     */
    useThinkingTags?: boolean

    /**
     * Max tool-using steps after the initial CoT reasoning pass.
     * @default 5
     */
    maxToolSteps?: number

    /**
     * Custom instruction appended to the system prompt to elicit step-by-step reasoning.
     */
    thinkingInstruction?: string
}

const DEFAULT_THINKING_INSTRUCTION = `Before answering, reason step by step inside <thinking> tags.
Work through the problem carefully, considering all relevant information.
Then provide your final answer outside the tags.`

/**
 * ChainOfThoughtEngine — explicit step-by-step reasoning.
 *
 * Forces the model to reason through the problem before answering.
 * Thinking is captured as a ThoughtStep for observability.
 *
 * Flow:
 *   1. Inject CoT instruction into system prompt
 *   2. Model produces <thinking>...</thinking> + answer (or tool calls)
 *   3. Extract and emit the thinking as a step
 *   4. If tool calls: execute them and loop (up to maxToolSteps)
 *   5. Return clean final answer
 *
 * @example
 * ```ts
 * import { ChainOfThoughtEngine } from '@agentlib/reasoning'
 * agent.reasoning(new ChainOfThoughtEngine())
 * ```
 */
export class ChainOfThoughtEngine<TData = unknown> implements ReasoningEngine<TData> {
    readonly name = 'cot'
    private readonly useThinkingTags: boolean
    private readonly maxToolSteps: number
    private readonly thinkingInstruction: string

    constructor(config: ChainOfThoughtEngineConfig = {}) {
        this.useThinkingTags = config.useThinkingTags ?? true
        this.maxToolSteps = config.maxToolSteps ?? 5
        this.thinkingInstruction = config.thinkingInstruction ?? DEFAULT_THINKING_INSTRUCTION
    }

    async execute(rCtx: ReasoningContext<TData>): Promise<string> {
        const { ctx } = rCtx
        const messages = this._injectInstruction(ctx.state.messages)

        // ── Pass 1: Initial reasoning + possible tool call ──
        const response = await callModel(rCtx, messages)
        ctx.state.messages.push(response.message)

        // Extract and emit the thinking portion
        if (this.useThinkingTags) {
            const thinking = this._extractThinking(response.message.content)
            if (thinking) {
                const thoughtStep: ThoughtStep = {
                    type: 'thought',
                    content: thinking,
                    engine: this.name,
                }
                rCtx.pushStep(thoughtStep)
            }
        }

        // No tool calls → extract clean answer
        if (!response.toolCalls?.length) {
            const answer = extractText(response.message.content)
            rCtx.pushStep({ type: 'response', content: answer, engine: this.name })
            return answer
        }

        // ── Tool execution loop (if model called tools during reasoning) ──
        await executeToolCalls(rCtx, response)
        let toolSteps = 1

        while (toolSteps < this.maxToolSteps) {
            const next = await callModel(rCtx, ctx.state.messages)
            ctx.state.messages.push(next.message)

            if (!next.toolCalls?.length) {
                const answer = extractText(next.message.content)
                rCtx.pushStep({ type: 'response', content: answer, engine: this.name })
                return answer
            }

            await executeToolCalls(rCtx, next)
            toolSteps++
        }

        throw new Error(`[ChainOfThoughtEngine] Max tool steps (${this.maxToolSteps}) reached.`)
    }

    private _injectInstruction(messages: ModelMessage[]): ModelMessage[] {
        if (!this.useThinkingTags) return messages

        const result = [...messages]
        const systemIdx = result.findIndex((m) => m.role === 'system')

        if (systemIdx >= 0) {
            const sys = result[systemIdx]!
            result[systemIdx] = {
                ...sys,
                content: `${sys.content}\n\n${this.thinkingInstruction}`,
            }
        } else {
            result.unshift({ role: 'system', content: this.thinkingInstruction })
        }

        return result
    }

    private _extractThinking(content: string): string | null {
        const match = content.match(/<thinking>([\s\S]*?)<\/thinking>/i)
        return match ? match[1]!.trim() : null
    }
}