import 'dotenv/config'
import {  createAgent, AgentInstance  } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import { BufferMemory } from '@agentlib/memory'
import { createLogger } from '@agentlib/logger'

/**
 * Chat History Example
 * 
 * This example demonstrates how to use the MemoryProvider to maintain
 * context across multiple runs using sessions.
 */

async function main() {
    // 1. Initialize Memory
    // BufferMemory keeps history in-process. 
    // In a real app, you might use a Redis or Database provider.
    const memory = new BufferMemory({
        maxMessages: 10 // Keep last 10 messages
    })

    // 2. Setup the Agent
    const agent = createAgent({
        name: 'memory-demo-agent',
        systemPrompt: "You are a friendly assistant. Remember the user's name and preferences.",
    })
        .provider(openai({
            apiKey: process.env['OPENAI_API_KEY'] ?? '',
            model: process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini'
        }))
        .memory(memory)
        .use(createLogger({ level: 'info' }))

    const sessionId = 'user-session-123'

    console.log('--- Conversation Start ---\n')

    // First Turn: Introduce ourselves
    console.log('> User: Hi! My name is Sammy and I love coding in TypeScript.')
    const res1 = await agent.run({
        input: 'Hi! My name is Sammy and I love coding in TypeScript.',
        sessionId
    })
    console.log(`\nAgent: ${res1.output}\n`)

    // Second Turn: Ask a follow-up without repeating the context
    console.log('> User: What is my favorite language?')
    const res2 = await agent.run({
        input: 'What is my favorite language?',
        sessionId
    })
    console.log(`\nAgent: ${res2.output}\n`)

    // Third Turn: Ask about the name
    console.log('> User: Do you remember my name?')
    const res3 = await agent.run({
        input: 'Do you remember my name?',
        sessionId
    })
    console.log(`\nAgent: ${res3.output}\n`)

    console.log('--- Inspecting Memory ---')
    const entries = await memory.entries(sessionId)
    console.log(`Messages in session "${sessionId}":`, entries[0]?.messages.length)

    console.log('\n--- Conversation End ---')
}

main().catch(console.error)
