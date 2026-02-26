import { randomUUID } from 'node:crypto'
import type {
    ModelMessage,
    PlanStep,
    PlanTask,
    ReasoningContext,
    ReasoningEngine,
    ResponseStep,
    ThoughtStep,
} from '@agentlib/core'
import { callModel, executeToolCalls, parseJSON, extractText } from '../utils'

export interface PlannerEngineConfig {
    /**
     * Max steps allowed during plan execution.
     * @default 20
     */
    maxExecutionSteps?: number

    /**
     * Whether to re-plan mid-execution if a task fails.
     * @default false
     */
    allowReplan?: boolean

    /**
     * Custom system prompt for the planning phase.
     */
    plannerPrompt?: string

    /**
     * Custom system prompt for the execution phase.
     */
    executorPrompt?: string
}

const DEFAULT_PLANNER_PROMPT = `You are a planning assistant. Break the user's request into a clear, ordered list of subtasks.

Respond with ONLY a JSON array of tasks in this exact format (no markdown, no preamble):
[
  { "id": "t1", "description": "...", "dependsOn": [] },
  { "id": "t2", "description": "...", "dependsOn": ["t1"] }
]

Rules:
- Each task must be atomic and independently executable
- dependsOn lists task ids that must complete first
- Order tasks so dependencies come first
- Be specific — the executor will act on each description`

const DEFAULT_EXECUTOR_PROMPT = `You are an execution assistant. Complete the given subtask using available tools.
Focus only on the current task. Be concise and direct.`

/**
 * PlannerEngine — plan-then-execute reasoning.
 *
 * Two-phase approach:
 *   Phase 1 (Plan): Model produces a structured list of subtasks as JSON
 *   Phase 2 (Execute): Each task is executed sequentially (with tool access)
 *
 * Emits a PlanStep at the start, then executes each task.
 * Failed tasks can optionally trigger replanning.
 *
 * @example
 * ```ts
 * import { PlannerEngine } from '@agentlib/reasoning'
 * agent.reasoning(new PlannerEngine({ allowReplan: true }))
 * ```
 */
export class PlannerEngine<TData = unknown> implements ReasoningEngine<TData> {
    readonly name = 'planner'
    private readonly maxExecutionSteps: number
    private readonly allowReplan: boolean
    private readonly plannerPrompt: string
    private readonly executorPrompt: string

    constructor(config: PlannerEngineConfig = {}) {
        this.maxExecutionSteps = config.maxExecutionSteps ?? 20
        this.allowReplan = config.allowReplan ?? false
        this.plannerPrompt = config.plannerPrompt ?? DEFAULT_PLANNER_PROMPT
        this.executorPrompt = config.executorPrompt ?? DEFAULT_EXECUTOR_PROMPT
    }

    async execute(rCtx: ReasoningContext<TData>): Promise<string> {
        const { ctx } = rCtx

        // ── Phase 1: Planning ──
        const plan = await this._makePlan(rCtx)

        const planStep: PlanStep = {
            type: 'plan',
            tasks: plan,
            engine: this.name,
        }
        rCtx.pushStep(planStep)

        // ── Phase 2: Execution ──
        const taskResults = new Map<string, string>()
        let executionSteps = 0

        for (const task of plan) {
            if (executionSteps >= this.maxExecutionSteps) {
                throw new Error(`[PlannerEngine] Max execution steps (${this.maxExecutionSteps}) reached.`)
            }

            // Check dependencies are done
            const unmetDeps = (task.dependsOn ?? []).filter((dep) => !taskResults.has(dep))
            if (unmetDeps.length) {
                // Skip for now — will be hit when dependencies are resolved
                continue
            }

            task.status = 'in_progress'

            const thoughtStep: ThoughtStep = {
                type: 'thought',
                content: `Executing task [${task.id}]: ${task.description}`,
                engine: this.name,
            }
            rCtx.pushStep(thoughtStep)

            try {
                const result = await this._executeTask(rCtx, task, taskResults)
                task.status = 'done'
                task.result = result
                taskResults.set(task.id, String(result))
                executionSteps++
            } catch (err) {
                task.status = 'failed'
                if (!this.allowReplan) {
                    throw new Error(
                        `[PlannerEngine] Task "${task.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
                    )
                }
                // TODO: replan hook
            }
        }

        // ── Phase 3: Synthesize results ──
        const summary = await this._synthesize(rCtx, plan, taskResults)
        rCtx.pushStep({ type: 'response', content: summary, engine: this.name })
        return summary
    }

    // ─── Private ─────────────────────────────────────────────────────────────────

    private async _makePlan(rCtx: ReasoningContext<TData>): Promise<PlanTask[]> {
        const { ctx } = rCtx

        const planMessages: ModelMessage[] = [
            { role: 'system', content: this.plannerPrompt },
            { role: 'user', content: ctx.input },
        ]

        const response = await callModel(rCtx, planMessages, { noTools: true })

        try {
            const rawTasks = parseJSON<Array<{ id: string; description: string; dependsOn?: string[] }>>(
                response.message.content,
            )
            return rawTasks.map((t) => ({
                id: t.id ?? randomUUID(),
                description: t.description,
                dependsOn: t.dependsOn ?? [],
                status: 'pending' as const,
            }))
        } catch {
            // If JSON parsing fails, make a single-task plan
            return [
                {
                    id: 't1',
                    description: ctx.input,
                    dependsOn: [],
                    status: 'pending' as const,
                },
            ]
        }
    }

    private async _executeTask(
        rCtx: ReasoningContext<TData>,
        task: PlanTask,
        previousResults: Map<string, string>,
    ): Promise<string> {
        const { ctx } = rCtx

        // Build task-specific context
        const depContext =
            task.dependsOn && task.dependsOn.length > 0
                ? `\n\nContext from previous tasks:\n${task.dependsOn
                    .map((id) => `[${id}]: ${previousResults.get(id) ?? 'N/A'}`)
                    .join('\n')}`
                : ''

        const taskMessages: ModelMessage[] = [
            { role: 'system', content: this.executorPrompt },
            {
                role: 'user',
                content: `Original goal: ${ctx.input}\n\nCurrent task: ${task.description}${depContext}`,
            },
        ]

        let steps = 0
        const maxTaskSteps = 5

        while (steps < maxTaskSteps) {
            const response = await callModel(rCtx, taskMessages)
            taskMessages.push(response.message)

            if (!response.toolCalls?.length) {
                return extractText(response.message.content)
            }

            // Execute tools and append results to task messages
            for (const tc of response.toolCalls) {
                const result = await rCtx.callTool(tc.name, tc.arguments, tc.id)
                taskMessages.push({
                    role: 'tool',
                    content: JSON.stringify(result),
                    toolCallId: tc.id,
                })
            }

            steps++
        }

        throw new Error(`[PlannerEngine] Task "${task.id}" exceeded max steps.`)
    }

    private async _synthesize(
        rCtx: ReasoningContext<TData>,
        plan: PlanTask[],
        results: Map<string, string>,
    ): Promise<string> {
        const { ctx } = rCtx

        const summaryContext = plan
            .filter((t) => t.status === 'done')
            .map((t) => `[${t.id}] ${t.description}:\n${results.get(t.id) ?? 'no result'}`)
            .join('\n\n')

        const synthMessages: ModelMessage[] = [
            {
                role: 'system',
                content:
                    'Synthesize the results of the completed tasks into a clear, direct answer to the original user request.',
            },
            {
                role: 'user',
                content: `Original request: ${ctx.input}\n\nTask results:\n${summaryContext}`,
            },
        ]

        const response = await callModel(rCtx, synthMessages, { noTools: true })
        return response.message.content
    }
}