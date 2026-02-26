import type {
    ModelMessage,
    ModelResponse,
    ReasoningContext,
    ToolSchema,
} from '@agentlib/core'

export interface ModelCallOptions {
    /** Override which tools to expose. Defaults to all allowed tools. */
    tools?: ToolSchema[]
    /** Force no tools in this call */
    noTools?: boolean
}

/**
 * Call the model, accumulate token usage, push the assistant message,
 * and return the full response.
 */
export async function callModel<TData>(
    rCtx: ReasoningContext<TData>,
    messages: ModelMessage[],
    options: ModelCallOptions = {},
): Promise<ModelResponse> {
    const { model, tools: toolRegistry, policy } = rCtx

    const tools = options.noTools
        ? []
        : (options.tools ??
            toolRegistry.getSchemas().filter((t) =>
                toolRegistry.isAllowed(t.name, policy.allowedTools),
            ))

    const response = await model.complete({ messages, tools })

    // Accumulate usage
    if (response.usage) {
        const { ctx } = rCtx
        ctx.state.usage.promptTokens += response.usage.promptTokens
        ctx.state.usage.completionTokens += response.usage.completionTokens
        ctx.state.usage.totalTokens += response.usage.totalTokens

        if (policy.tokenBudget && ctx.state.usage.totalTokens >= policy.tokenBudget) {
            throw new Error('[Reasoning] Token budget exceeded.')
        }
    }

    return response
}

/**
 * Execute all tool calls from a model response using rCtx.callTool().
 * Returns when all tools have run.
 */
export async function executeToolCalls<TData>(
    rCtx: ReasoningContext<TData>,
    response: ModelResponse,
): Promise<void> {
    if (!response.toolCalls?.length) return

    for (const tc of response.toolCalls) {
        await rCtx.callTool(tc.name, tc.arguments, tc.id)
    }
}

/**
 * Parse a fenced JSON block from a model response.
 * Falls back to direct JSON.parse if no fence found.
 */
export function parseJSON<T>(text: string): T {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const raw = fenced ? fenced[1]! : text
    return JSON.parse(raw.trim()) as T
}

/**
 * Extract plain text from a model response, stripping thinking tags if present.
 */
export function extractText(content: string): string {
    return content
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .trim()
}