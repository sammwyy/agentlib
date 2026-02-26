/**
 * agentlib — Reflect Reasoning Example
 * 
 * Generates an answer, self-critiques, and revises if needed.
 */
import "dotenv/config"

import {  createAgent, AgentInstance, ReasoningStep  } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import { ReflectEngine } from '@agentlib/reasoning'

const model = openai({ apiKey: process.env['OPENAI_API_KEY']!, model: process.env['OPENAI_MODEL']!, baseURL: process.env['OPENAI_BASE_URL']! })

async function main() {
    const agent = createAgent({ name: 'reflect-agent' })
        .provider(model)
        .reasoning(new ReflectEngine({
            maxReflections: 2,
            acceptanceThreshold: 8,
        }))

    agent.on('step:reasoning', (step: ReasoningStep) => {
        if (step.type === 'reflection') {
            console.log(`🔍 Reflection: ${step.assessment}`)
            console.log(`   Needs revision: ${step.needsRevision}`)
        }
    })

    const result = await agent.run(
        'Explain the CAP theorem and its implications for distributed systems design.'
    )
    console.log('Final output:', result.output)
    console.log('\nSteps taken:', result.state.steps.length)
}

main().catch(console.error)
