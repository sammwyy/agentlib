import type {
    ModelMessage,
    ReasoningContext,
    ReasoningEngine,
    ReflectionStep,
    ResponseStep,
    ThoughtStep,
} from '@agentlib/core'
import { callModel, executeToolCalls, extractText } from '../utils'

export interface ReflectEngineConfig {
    /**
     * Max number of reflection + revision cycles.
     * @default 2
     */
    maxReflections?: number

    /**
     * Score threshold (0–10) below which the engine revises.
     * If the critique score is >= this, the answer is accepted as-is.
     * @default 8
     */
    acceptanceThreshold?: number

    /**
     * Max tool steps during initial answer generation.
     * @default 5
     */
    maxAnswerSteps?: number

    /**
     * Custom critique prompt.
     */
    critiquePrompt?: string
}

const DEFAULT_CRITIQUE_PROMPT = `You are a critical evaluator. Review the answer below and assess its quality.

Respond in this exact JSON format (no markdown):
{
  "score": <0-10>,
  "issues": ["<issue 1>", "<issue 2>"],
  "suggestion": "<one-sentence improvement suggestion>",
  "needs_revision": <true|false>
}

Be strict. Score 10 only for perfect answers. Score < 8 if the answer is incomplete, incorrect, or could be substantially improved.`

/**
 * ReflectEngine — generate, critique, revise.
 *
 * Three-phase loop:
 *   1. Generate an initial answer (with tool access)
 *   2. Self-critique the answer using a separate model call
 *   3. If critique score < threshold, revise and repeat
 *
 * Produces high-quality output for tasks where accuracy matters more than speed.
 *
 * @example
 * ```ts
 * import { ReflectEngine } from '@agentlib/reasoning'
 * agent.reasoning(new ReflectEngine({ maxReflections: 3, acceptanceThreshold: 9 }))
 * ```
 */
export class ReflectEngine<TData = unknown> implements ReasoningEngine<TData> {
    readonly name = 'reflect'
    private readonly maxReflections: number
    private readonly acceptanceThreshold: number
    private readonly maxAnswerSteps: number
    private readonly critiquePrompt: string

    constructor(config: ReflectEngineConfig = {}) {
        this.maxReflections = config.maxReflections ?? 2
        this.acceptanceThreshold = config.acceptanceThreshold ?? 8
        this.maxAnswerSteps = config.maxAnswerSteps ?? 5
        this.critiquePrompt = config.critiquePrompt ?? DEFAULT_CRITIQUE_PROMPT
    }

    async execute(rCtx: ReasoningContext<TData>): Promise<string> {
        const { ctx } = rCtx

        // ── Phase 1: Generate initial answer ──
        let answer = await this._generateAnswer(rCtx, ctx.state.messages)
        rCtx.pushStep({ type: 'thought', content: `Initial answer generated.`, engine: this.name })

        // ── Phase 2: Reflection loop ──
        for (let i = 0; i < this.maxReflections; i++) {
            const critique = await this._critique(rCtx, ctx.input, answer)

            const reflectionStep: ReflectionStep = {
                type: 'reflection',
                assessment: `Score: ${critique.score}/10. Issues: ${critique.issues.join('; ')}. ${critique.suggestion}`,
                needsRevision: critique.needs_revision,
                engine: this.name,
            }
            rCtx.pushStep(reflectionStep)

            if (!critique.needs_revision || critique.score >= this.acceptanceThreshold) {
                break
            }

            // ── Phase 3: Revise ──
            rCtx.pushStep({
                type: 'thought',
                content: `Revising answer (attempt ${i + 1}/${this.maxReflections})...`,
                engine: this.name,
            })

            answer = await this._revise(rCtx, ctx.input, answer, critique)
        }

        const responseStep: ResponseStep = {
            type: 'response',
            content: answer,
            engine: this.name,
        }
        rCtx.pushStep(responseStep)
        return answer
    }

    // ─── Private ─────────────────────────────────────────────────────────────────

    private async _generateAnswer(
        rCtx: ReasoningContext<TData>,
        messages: ModelMessage[],
    ): Promise<string> {
        let steps = 0

        while (steps < this.maxAnswerSteps) {
            const response = await callModel(rCtx, messages)
            messages.push(response.message)

            if (!response.toolCalls?.length) {
                return extractText(response.message.content)
            }

            await executeToolCalls(rCtx, response)
            steps++
        }

        throw new Error(`[ReflectEngine] Max answer steps (${this.maxAnswerSteps}) reached.`)
    }

    private async _critique(
        rCtx: ReasoningContext<TData>,
        question: string,
        answer: string,
    ): Promise<CritiqueResult> {
        const critiqueMessages: ModelMessage[] = [
            { role: 'system', content: this.critiquePrompt },
            {
                role: 'user',
                content: `Question:\n${question}\n\nAnswer to evaluate:\n${answer}`,
            },
        ]

        const response = await callModel(rCtx, critiqueMessages, { noTools: true })

        try {
            const raw = response.message.content.replace(/```(?:json)?\s*([\s\S]*?)```/, '$1').trim()
            return JSON.parse(raw) as CritiqueResult
        } catch {
            // If JSON parsing fails, default to accepting the answer
            return { score: 9, issues: [], suggestion: '', needs_revision: false }
        }
    }

    private async _revise(
        rCtx: ReasoningContext<TData>,
        question: string,
        currentAnswer: string,
        critique: CritiqueResult,
    ): Promise<string> {
        const revisionMessages: ModelMessage[] = [
            {
                role: 'system',
                content:
                    'You are revising your previous answer based on critique. Produce an improved, complete answer.',
            },
            {
                role: 'user',
                content: `Original question:\n${question}`,
            },
            {
                role: 'assistant',
                content: currentAnswer,
            },
            {
                role: 'user',
                content: `Critique of your answer:\n- Score: ${critique.score}/10\n- Issues: ${critique.issues.join(', ')}\n- Suggestion: ${critique.suggestion}\n\nPlease revise your answer to address these issues.`,
            },
        ]

        const response = await callModel(rCtx, revisionMessages)

        // May trigger tool calls during revision
        if (response.toolCalls?.length) {
            rCtx.ctx.state.messages.push(response.message)
            await executeToolCalls(rCtx, response)
            // One more pass after tools
            const final = await callModel(rCtx, rCtx.ctx.state.messages, { noTools: true })
            return extractText(final.message.content)
        }

        return extractText(response.message.content)
    }
}

// ─── Internals ────────────────────────────────────────────────────────────────

interface CritiqueResult {
    score: number
    issues: string[]
    suggestion: string
    needs_revision: boolean
}