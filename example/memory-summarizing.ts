import 'dotenv/config'

import { createAgent } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import { SummarizingMemory } from '@agentlib/memory'
import { createLogger } from '@agentlib/logger'

/**
 * Summarizing Memory Example
 * 
 * Demonstrates how to use a dedicated (usually cheaper/faster) LLM 
 * to compress old conversation history into a concise summary.
 */

async function main() {
    // 1. Setup the dedicated model for summarization
    const summarizerModel = openai({
        apiKey: process.env['OPENAI_API_KEY'] ?? '',
        model: process.env['OPENAI_MODEL_SUMMARIZER'] ?? '',
        baseURL: process.env['OPENAI_BASE_URL'] ?? ''
    })

    // 2. Setup Summarizing Memory
    // We trigger summarization after 200 tokens to see it in action
    const memory = new SummarizingMemory({
        model: summarizerModel,
        activeWindowTokens: 250,
        summaryPrompt: 'Summarize the user profile and preferences accurately.'
    })

    const agent = createAgent({
        name: 'summarizer-agent',
        systemPrompt: 'You are a personalized assistant. Help the user plan a trip.',
    })
        .provider(openai({
            apiKey: process.env['OPENAI_API_KEY'] ?? '',
            model: process.env['OPENAI_MODEL'] ?? '',
            baseURL: process.env['OPENAI_BASE_URL'] ?? ''
        }))
        .memory(memory)
        .use(createLogger({ level: 'info' }))

    const sessionId = 'travel-planner'

    console.log('--- Summarizing Memory Demo (Compression at 250 tokens) ---\n')

    const interaction = [
        "I am planning a trip to Japan next April. I love sushi and nature.",
        "I want to stay for 2 weeks. My budget is around $5000.",
        "I prefer boutique hotels over large chains.",
        "I also want to visit some hidden gems, not just tourist spots.",
        "Tell me what you know about my travel preferences so far."
    ]

    for (const input of interaction) {
        console.log(`> User: ${input}`)
        const res = await agent.run({ input, sessionId })
        console.log(`Agent: ${res.output}\n`)

        // Check if a summary has been generated yet
        const currentSummary = memory.getSummary(sessionId)
        if (currentSummary) {
            console.log('-- CURRENT COMPRESSED SUMMARY --')
            console.log(currentSummary)
            console.log('--------------------------------\n')
        }
    }
}

main().catch(console.error)
