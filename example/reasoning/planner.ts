/**
 * agentlib — Planner Reasoning Example
 * 
 * Creates a structured plan and executes subtasks.
 */
import "dotenv/config"

import {  createAgent, AgentInstance, defineTool, ReasoningStep  } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import { PlannerEngine } from '@agentlib/reasoning'

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

const writeFileTool = defineTool({
    schema: {
        name: 'write_file',
        description: 'Write content to a file',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                content: { type: 'string' },
            },
            required: ['path', 'content'],
        },
    },
    async execute({ path }) {
        console.log(`Writing to ${path}...`)
        return { success: true }
    },
})

async function main() {
    const agent = createAgent({ name: 'planner-agent' })
        .provider(model)
        .tool(searchTool)
        .tool(writeFileTool)
        .reasoning(new PlannerEngine({ maxExecutionSteps: 15 }))

    agent.on('step:reasoning', (step: ReasoningStep) => {
        if (step.type === 'plan') {
            console.log('📋 Plan:')
            step.tasks.forEach((t) => console.log(`  [${t.id}] ${t.description}`))
        }
        if (step.type === 'thought') {
            console.log('▶', step.content)
        }
    })

    const result = await agent.run(
        'Research the top 3 JavaScript frameworks in 2025 and write a comparison report to /tmp/frameworks.md'
    )
    console.log('Final output:', result.output)
}

main().catch(console.error)
