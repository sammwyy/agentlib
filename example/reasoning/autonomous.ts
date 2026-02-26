/**
 * agentlib — Autonomous Reasoning Example
 * 
 * Runs indefinitely until it explicitly calls the `finish` tool.
 */
import "dotenv/config"

import {  createAgent, AgentInstance, defineTool, ReasoningStep  } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import { AutonomousEngine } from '@agentlib/reasoning'

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

const readFileTool = defineTool({
    schema: {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
        },
    },
    async execute({ path }) {
        return { content: `# Contents of ${path}\n...` }
    },
})

async function main() {
    const agent = createAgent({
        name: 'autonomous-agent',
        systemPrompt: 'You are an autonomous research assistant. Work step by step. When you are confident you have a complete answer, call the finish tool.',
    })
        .provider(model)
        .tool(searchTool)
        .tool(readFileTool)
        .reasoning(new AutonomousEngine({ maxSteps: 25 }))
        .policy({ maxSteps: 25, tokenBudget: 50_000 })

    agent.on('step:reasoning', (step: ReasoningStep) => {
        if (step.type === 'thought') console.log('🤖', step.content.slice(0, 120))
        if (step.type === 'tool_call') console.log(`🔧 ${step.toolName}(${JSON.stringify(step.args).slice(0, 60)})`)
    })

    const result = await agent.run(
        'Find and summarize recent developments in quantum computing from the last 6 months.'
    )
    console.log('\n✅ Final answer:')
    console.log(result.output)
}

main().catch(console.error)
