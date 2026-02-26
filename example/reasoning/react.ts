/**
 * agentlib — ReAct Reasoning Example
 * 
 * Interleaves reasoning and tool calls.
 */
import "dotenv/config"

import {  createAgent, AgentInstance, defineTool, ReasoningStep  } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import { ReactEngine } from '@agentlib/reasoning'

const model = openai({ apiKey: process.env['OPENAI_API_KEY']!, model: process.env['OPENAI_MODEL']!, baseURL: process.env['OPENAI_BASE_URL']! })

const searchTool = defineTool({
    schema: {
        name: 'search',
        description: 'Search the web for information',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
        },
    },
    async execute({ query }) {
        return { results: [`Result for: ${query}`] }
    },
})

const calculatorTool = defineTool({
    schema: {
        name: 'calculator',
        description: 'Evaluate a math expression',
        parameters: {
            type: 'object',
            properties: { expression: { type: 'string' } },
            required: ['expression'],
        },
    },
    async execute({ expression }) {
        return { result: eval(String(expression)) }
    },
})

async function main() {
    const agent = createAgent({ name: 'react-agent' })
        .provider(model)
        .tool(searchTool)
        .tool(calculatorTool)
        .reasoning(new ReactEngine({ maxSteps: 8 }))

    agent.on('step:reasoning', (step: ReasoningStep) => {
        console.log(`[${step.type}]`, step.type === 'thought' ? step.content : '')
    })

    const result = await agent.run('What is the population of Tokyo multiplied by 2?')
    console.log('Final output:', result.output)
}

main().catch(console.error)
