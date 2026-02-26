/**
 * agentlib — Chain-of-Thought Reasoning Example
 * 
 * Forces the model to think explicitly before answering.
 */
import "dotenv/config"

import {  createAgent, AgentInstance, ReasoningStep  } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import { ChainOfThoughtEngine } from '@agentlib/reasoning'

const model = openai({ apiKey: process.env['OPENAI_API_KEY']!, model: process.env['OPENAI_MODEL']!, baseURL: process.env['OPENAI_BASE_URL']! })

async function main() {
    const agent = createAgent({ name: 'cot-agent' })
        .provider(model)
        .reasoning(new ChainOfThoughtEngine({
            useThinkingTags: true,
            maxToolSteps: 3,
        }))

    agent.on('step:reasoning', (step: ReasoningStep) => {
        if (step.type === 'thought') {
            console.log('💭 Thinking:', step.content)
        }
    })

    const result = await agent.run(
        'If a train travels 120km in 1.5 hours, what is its average speed? ' +
        'Is that faster or slower than a car driving at 90km/h?'
    )
    console.log('Final output:', result.output)
}

main().catch(console.error)
