/**
 * agentlib — Custom Reasoning Engine Example
 * 
 * Any object implementing ReasoningEngine works.
 */
import "dotenv/config"

import {  createAgent, AgentInstance, ReasoningEngine, ReasoningContext  } from '@agentlib/core'
import { openai } from '@agentlib/openai'

const model = openai({ apiKey: process.env['OPENAI_API_KEY']!, model: process.env['OPENAI_MODEL']!, baseURL: process.env['OPENAI_BASE_URL']! })

const myEngine: ReasoningEngine = {
    name: 'my-engine',
    async execute(rCtx: ReasoningContext) {
        console.log('--- Custom engine executing ---')
        const response = await rCtx.model.complete({
            messages: rCtx.ctx.state.messages
        })

        rCtx.pushStep({
            type: 'response',
            content: response.message.content,
            engine: 'my-engine'
        })

        return response.message.content
    },
}

async function main() {
    const agent = createAgent({ name: 'custom-agent' })
        .provider(model)
        .reasoning(myEngine)

    const result = await agent.run('Hello!')
    console.log('Final output:', result.output)
}

main().catch(console.error)
