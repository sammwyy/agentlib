import "dotenv/config";
import "@agentlib/reasoning";

import { createAgent } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import { Orchestrator } from '@agentlib/orchestrator'

// Simplified setup for demonstration
async function main() {
    const provider = openai({
        apiKey: process.env['OPENAI_API_KEY']!,
        model: process.env['OPENAI_MODEL']!,
        baseURL: process.env['OPENAI_BASE_URL']!
    });

    // 1. Define sub-agents
    const researcher = createAgent({
        name: 'researcher',
        description: 'Finds detailed information about specific topics.',
        systemPrompt: 'You are a researcher. Provide concise summaries of facts.'
    }).provider(provider).reasoning('react');

    const coder = createAgent({
        name: 'coder',
        description: 'Writes efficient code based on requirements.',
        systemPrompt: 'You are an expert coder. Wrap your code in markdown blocks.'
    }).provider(provider).reasoning('react');

    const critic = createAgent({
        name: 'critic',
        description: 'Reviews work and provides a score from 0 to 1.',
        systemPrompt: 'You are a critical reviewer. Always end your message with "Score: X.X"'
    }).provider(provider).reasoning('react');

    // 2. Define the planner agent (the meta-agent)
    const planner = createAgent({
        name: 'planner',
        description: 'Main coordinator that uses sub-agents to solve complex tasks.',
        systemPrompt: 'You are a project manager. Use the available agents to research, code, and review.'
    }).provider(provider).reasoning('react');

    // 3. Initialize the Orchestrator
    const orchestrator = new Orchestrator(planner, {
        agents: {
            researcher,
            coder,
            critic
        },
        maxSteps: 10,
        summarize: true,
        exposeAgentsAsTools: true,
        context: {
            company: 'ACME Corp',
            constraints: 'You are running on ACME Corp'
        },
        onStep: (step) => {
            console.log(`[Step] Agent: ${step.agent} | Type: ${step.type}`)
            if (step.agent === 'critic' && step.content?.includes('Score: 0.3')) {
                console.warn('Low quality work detected! Aborting...')
                return 'abort'
            }
        }
    })

    // 4. Add event listeners
    orchestrator.on('agent:invoke', ({ agent, prompt }) => {
        console.log(`\n🚀 Invoking agent: ${agent}`)
        console.log(`Prompt: ${prompt}`)
    })

    orchestrator.on('agent:completed', ({ agent, output }) => {
        console.log(`\n✅ Agent ${agent} finished!`)
        console.log(`Output: ${output.substring(0, 100)}...`)
    })

    // 5. Run the orchestrator
    console.log('--- Starting Orchestration ---')
    await orchestrator.run('Design and implement a scalable image processing system.');
    console.log('\n--- Orchestration Finished ---')

    // 6. Access history or states manually if needed
    const states = orchestrator.getAllStates()
    console.log('\nFinal States:', states.map(s => `${s.name}: ${s.status}`))
}

main().catch(console.error)
