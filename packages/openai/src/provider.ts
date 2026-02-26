import OpenAI from 'openai'
import type {
    ModelMessage,
    ModelProvider,
    ModelRequest,
    ModelResponse,
    ModelResponseChunk,
    ToolCall,
    TokenUsage,
} from '@agentlib/core'

export interface OpenAIProviderConfig {
    apiKey: string
    model?: string | undefined
    baseURL?: string | undefined
    organization?: string | undefined
    temperature?: number | undefined
    maxTokens?: number | undefined
}

function toOpenAIMessages(
    messages: ModelMessage[],
    model?: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
        if (msg.role === 'tool') {
            return {
                role: 'tool',
                content: msg.content,
                tool_call_id: msg.toolCallId ?? '',
            } satisfies OpenAI.Chat.ChatCompletionToolMessageParam
        }

        if (msg.role === 'assistant' && msg.toolCalls?.length) {
            return {
                role: 'assistant',
                content: msg.content || null,
                tool_calls: msg.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: {
                        name: tc.name,
                        arguments: JSON.stringify(tc.arguments),
                    },
                })),
            } satisfies OpenAI.Chat.ChatCompletionAssistantMessageParam
        }

        const role = msg.role === 'system' && (model?.startsWith('o1') || model?.startsWith('o3'))
            ? 'user'
            : msg.role as 'system' | 'user' | 'assistant'

        return {
            role,
            content: msg.content,
        } satisfies
            | OpenAI.Chat.ChatCompletionSystemMessageParam
            | OpenAI.Chat.ChatCompletionUserMessageParam
            | OpenAI.Chat.ChatCompletionAssistantMessageParam
    })
}

function toOpenAITools(
    tools: ModelRequest['tools'],
): OpenAI.Chat.ChatCompletionTool[] {
    if (!tools || tools.length === 0) return []
    return tools.map((t) => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as OpenAI.FunctionParameters,
        },
    }))
}

function extractToolCalls(
    choice: OpenAI.Chat.ChatCompletion.Choice,
): ToolCall[] | undefined {
    const calls = choice.message.tool_calls
    if (!calls?.length) return undefined
    return calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }))
}

function extractUsage(usage: OpenAI.CompletionUsage | undefined): TokenUsage | undefined {
    if (!usage) return undefined
    return {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
    }
}

export class OpenAIProvider implements ModelProvider {
    readonly name = 'openai'

    private readonly client: OpenAI
    private readonly config: OpenAIProviderConfig & { model: string; temperature: number }

    constructor(config: OpenAIProviderConfig) {
        this.config = {
            model: 'gpt-4o',
            temperature: 0.7,
            ...config,
        } as OpenAIProviderConfig & { model: string; temperature: number }

        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            organization: config.organization,
        })
    }

    async complete(request: ModelRequest): Promise<ModelResponse> {
        const completion = await this.client.chat.completions.create({
            model: this.config.model,
            temperature: this.config.temperature,
            messages: toOpenAIMessages(request.messages, this.config.model),
            ...(this.config.maxTokens ? { max_tokens: this.config.maxTokens } : {}),
            ...(request.tools && request.tools.length > 0
                ? {
                    tools: toOpenAITools(request.tools),
                    tool_choice: 'auto' as const,
                }
                : {}),
        })

        const choice = completion.choices[0]
        if (!choice) throw new Error('[OpenAIProvider] Empty response from API.')

        const toolCalls = extractToolCalls(choice)

        const message: ModelMessage = {
            role: 'assistant',
            content: choice.message.content ?? '',
            reasoning: (choice.message as any).reasoning_content,
            toolCalls,
        }

        return {
            message,
            toolCalls,
            usage: extractUsage(completion.usage),
            raw: completion,
        }
    }

    async *stream(request: ModelRequest): AsyncIterable<ModelResponseChunk> {
        const stream = await this.client.chat.completions.create({
            model: this.config.model,
            temperature: this.config.temperature,
            messages: toOpenAIMessages(request.messages, this.config.model),
            stream: true,
        })

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? ''
            const done = chunk.choices[0]?.finish_reason !== null
            yield { delta, done }
        }
    }
}

/**
 * Create an OpenAI model provider.
 *
 * @example
 * ```ts
 * agent.provider(openai({ apiKey: process.env.OPENAI_API_KEY! }))
 * agent.provider(openai({ apiKey: '...', model: 'gpt-4o-mini' }))
 * ```
 */
export function openai(config: OpenAIProviderConfig): OpenAIProvider {
    return new OpenAIProvider(config)
}