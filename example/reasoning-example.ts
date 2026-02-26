/**
 * agentlib — Reasoning Engine Examples
 */

// auto-registers all engines
import {  createAgent, AgentInstance, defineTool  } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import {
    ReactEngine,
    ChainOfThoughtEngine,
    PlannerEngine,
    ReflectEngine,
    AutonomousEngine,
} from '@agentlib/reasoning'

const model = openai({ apiKey: process.env['OPENAI_API_KEY']! })

// ─── Shared tools ─────────────────────────────────────────────────────────────

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
        // In production: use a safe math evaluator
        return { result: eval(String(expression)) }
    },
})

async function runExamples() {
    // ─── 1. ReAct — default, best for tool-using agents ──────────────────────────
    //
    // Interleaves reasoning and tool calls. The model thinks, calls tools,
    // incorporates results, thinks again. Simple and effective.
    {
        console.log('\n--- 1. ReAct Example ---')
        const agent = createAgent({ name: 'react-agent' })
            .provider(model)
            .tool(searchTool)
            .tool(calculatorTool)
            .reasoning(new ReactEngine({ maxSteps: 8 }))
        // or: .reasoning('react') — works after importing @agentlib/reasoning

        agent.on('step:reasoning', (step) => {
            console.log(`[${step.type}]`, step.type === 'thought' ? step.content : '')
        })

        const result = await agent.run('What is the population of Tokyo multiplied by 2?')
        console.log(result.output)
    }

    // ─── 2. Chain-of-Thought — best for complex reasoning problems ────────────────
    //
    // Forces the model to think explicitly before answering.
    // Captures the thinking for observability, strips it from the final output.
    {
        console.log('\n--- 2. Chain-of-Thought Example ---')
        const agent = createAgent({ name: 'cot-agent' })
            .provider(model)
            .reasoning(new ChainOfThoughtEngine({
                useThinkingTags: true,
                maxToolSteps: 3,
            }))

        agent.on('step:reasoning', (step) => {
            if (step.type === 'thought') {
                console.log('💭 Thinking:', step.content)
            }
        })

        const result = await agent.run(
            'If a train travels 120km in 1.5 hours, what is its average speed? ' +
            'Is that faster or slower than a car driving at 90km/h?'
        )
        console.log(result.output)
    }

    // ─── 3. Planner — best for multi-step, decomposable tasks ────────────────────
    //
    // First creates a structured plan (JSON list of subtasks),
    // then executes each subtask with tool access,
    // then synthesizes all results into a final answer.
    {
        console.log('\n--- 3. Planner Example ---')
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
            async execute({ path, content }) {
                console.log(`Writing to ${path}...`)
                return { success: true }
            },
        })

        const agent = createAgent({ name: 'planner-agent' })
            .provider(model)
            .tool(searchTool)
            .tool(writeFileTool)
            .reasoning(new PlannerEngine({ maxExecutionSteps: 15 }))

        agent.on('step:reasoning', (step) => {
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
        console.log(result.output)
    }

    // ─── 4. Reflect — best for high-stakes, accuracy-critical tasks ───────────────
    //
    // Generates an answer, self-critiques it (score 0–10),
    // and revises if the score falls below the threshold.
    // Slower but produces more reliable output.
    {
        console.log('\n--- 4. Reflect Example ---')
        const agent = createAgent({ name: 'reflect-agent' })
            .provider(model)
            .reasoning(new ReflectEngine({
                maxReflections: 2,
                acceptanceThreshold: 8,
            }))

        agent.on('step:reasoning', (step) => {
            if (step.type === 'reflection') {
                console.log(`🔍 Reflection: ${step.assessment}`)
                console.log(`   Needs revision: ${step.needsRevision}`)
            }
        })

        const result = await agent.run(
            'Explain the CAP theorem and its implications for distributed systems design.'
        )
        console.log(result.output)
        console.log('\nSteps taken:', result.state.steps.length)
    }

    // ─── 5. Autonomous — best for long-horizon, open-ended tasks ─────────────────
    //
    // The agent runs indefinitely until it explicitly calls the `finish` tool.
    // Suitable for agents that need to explore before they know when they're done.
    {
        console.log('\n--- 5. Autonomous Example ---')
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

        const agent = createAgent({
            name: 'autonomous-agent',
            systemPrompt: 'You are an autonomous research assistant. Work step by step. When you are confident you have a complete answer, call the finish tool.',
        })
            .provider(model)
            .tool(searchTool)
            .tool(readFileTool)
            .reasoning(new AutonomousEngine({ maxSteps: 25 }))
            .policy({ maxSteps: 25, tokenBudget: 50_000 })

        agent.on('step:reasoning', (step) => {
            if (step.type === 'thought') console.log('🤖', step.content.slice(0, 120))
            if (step.type === 'tool_call') console.log(`🔧 ${step.toolName}(${JSON.stringify(step.args).slice(0, 60)})`)
        })

        const result = await agent.run(
            'Find and summarize recent developments in quantum computing from the last 6 months.'
        )
        console.log('\n✅ Final answer:')
        console.log(result.output)
    }

    // ─── 6. Custom engine ─────────────────────────────────────────────────────────
    //
    // Any object implementing ReasoningEngine<TData> works.
    {
        console.log('\n--- 6. Custom Engine Example ---')
        const myEngine = {
            name: 'my-engine',
            async execute(rCtx: any) {
                // Do whatever you want here
                const response = await rCtx.model.complete({ messages: rCtx.ctx.state.messages })
                rCtx.pushStep({ type: 'response', content: response.message.content, engine: 'my-engine' })
                return response.message.content
            },
        }

        const agent = createAgent({ name: 'custom-agent' })
            .provider(model)
            .reasoning(myEngine as any)

        await agent.run('Hello!')
    }
}

runExamples().catch(console.error)