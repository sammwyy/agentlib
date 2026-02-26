import 'dotenv/config'

import { createAgent } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import { SlidingWindowMemory } from '@agentlib/memory'
import { createLogger } from '@agentlib/logger'

/**
 * Sliding Window Memory Example
 * 
 * Demonstrates memory that tracks conversation "turns" and enforces
 * a token budget, avoiding context window overflow while keeping
 * recent context intact.
 */

async function main() {
    // 1. Setup Sliding Window Memory
    // We set a very small token budget (200 tokens) to demonstrate 
    // how it automatically slides and trims older context.
    const memory = new SlidingWindowMemory({
        maxTokens: 300,
        maxTurns: 5
    })

    const agent = createAgent({
        name: 'sliding-agent',
        systemPrompt: 'You are a concise assistant. Help the user track their list of favorite fruits.',
    })
        .provider(openai({
            apiKey: process.env['OPENAI_API_KEY'] ?? '',
            model: 'gpt-4o-mini'
        }))
        .memory(memory)
        .use(createLogger({ level: 'info' }))

    const sessionId = 'fruit-session'

    console.log('--- Sliding Window Demo (Small Budget: 300 tokens) ---\n')

    const turns = [
        "My first favorite fruit is Apple.",
        "My second favorite fruit is Banana.",
        "My third favorite fruit is Cherry.",
        "My fourth favorite fruit is Dragonfruit.",
        "My fifth favorite fruit is Elderberry.",
        "Can you list all the fruits I mentioned so far?"
    ]

    for (const input of turns) {
        console.log(`> User: ${input}`)
        const res = await agent.run({ input, sessionId })
        console.log(`Agent: ${res.output}\n`)
    }

    // Inspect stats
    const stats = memory.stats(sessionId)
    console.log('--- Memory Stats ---')
    console.log(`Current turns in memory: ${stats?.turns}`)
    console.log(`Estimated tokens used: ${stats?.estimatedTokens} / 300`)
}

main().catch(console.error)
