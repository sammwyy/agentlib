/**
 * agentlib — Usage Example
 *
 * This file shows the intended developer experience.
 * It does not run directly (requires a built environment), but it
 * type-checks against the packages and serves as living documentation.
 */

import 'dotenv/config'

import { createAgent, defineTool } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import { createLogger } from '@agentlib/logger'
import { BufferMemory } from '@agentlib/memory'

// ─── 1. Define Tools ──────────────────────────────────────────────────────────

interface WeatherResult {
    location: string
    temperature: number
    condition: string
}

const getWeatherTool = defineTool({
    schema: {
        name: 'get_weather',
        description: 'Get the current weather for a location.',
        parameters: {
            type: 'object',
            properties: {
                location: { type: 'string', description: 'The city to get weather for.' },
            },
            required: ['location'],
        },
    },
    async execute({ location }): Promise<WeatherResult> {
        // In production: call a real weather API
        return { location: String(location), temperature: 22, condition: 'sunny' }
    },
})

// ─── 2. Typed Agent ───────────────────────────────────────────────────────────

interface AppData {
    userId: string
    plan: 'free' | 'pro'
}

const agent = createAgent<AppData>({
    name: 'assistant',
    systemPrompt: 'You are a helpful assistant. Use tools when appropriate.',
    data: { userId: 'default', plan: 'free' },
    policy: {
        maxSteps: 10,
        tokenBudget: 10_000,
    },
})
    // Provider
    .provider(openai({ apiKey: process.env['OPENAI_API_KEY'] ?? '', model: process.env['OPENAI_MODEL'] ?? 'gpt-4o', baseURL: process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1' }))
    // Memory
    .memory(new BufferMemory({ maxMessages: 20 }))
    // Tools
    .tool(getWeatherTool)
    // Middleware
    .use(
        createLogger({
            level: 'debug',
            timing: true,
            prefix: '[weather-agent]',
        }),
    )
    // Custom middleware: enforce plan limits
    .use({
        name: 'plan-guard',
        scope: 'run:before',
        async run(mCtx, next) {
            if (mCtx.ctx.data.plan === 'free' && mCtx.ctx.input.length > 500) {
                throw new Error('Input too long for free plan.')
            }
            await next()
        },
    })

// ─── 3. Event Listeners ───────────────────────────────────────────────────────

agent.on('run:start', ({ input }: { input: string }) => {
    console.log(`[run:start] input="${input}"`)
})

agent.on('tool:after', ({ tool, result }: { tool: string; result: unknown }) => {
    console.log(`[tool:after] ${tool} →`, result)
})

agent.on('run:end', ({ output }: { output: string }) => {
    console.log(`[run:end] output="${output}"`)
})

// ─── 4. Run ───────────────────────────────────────────────────────────────────

async function main() {
    const result = await agent.run({
        input: 'What is the weather in Buenos Aires and Tokyo?',
        data: { userId: 'user-123', plan: 'pro' },
    })

    console.log('\nFinal response:')
    console.log(result.output)
    console.log('\nToken usage:', result.state.usage)
    console.log('Steps taken:', result.state.steps.length)
}

main().catch(console.error)