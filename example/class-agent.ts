import 'dotenv/config'
import "reflect-metadata";

import { createAgent, Agent, Tool, Arg, loopConsolePrompting } from '@agentlib/core'
import { openai } from '@agentlib/openai'
import '@agentlib/reasoning'

@Agent({
    name: "smart-asistant",
    systemPrompt: "You are a helpful assistant with specialized tools."
})
class MyAgent {
    @Tool({
        name: "weather",
        description: "Get the weather in a city."
    })
    async weather(
        @Arg({ name: "city", description: "The city" }) city: string
    ) {
        return { city, temperature: "25°C" }
    }
}

async function main() {
    const agent = createAgent(MyAgent)
        .provider(
            openai({
                apiKey: process.env['OPENAI_API_KEY']!,
                model: process.env['OPENAI_MODEL']!,
                baseURL: process.env['OPENAI_BASE_URL']!
            }))
        .reasoning("planner");

    await loopConsolePrompting(agent);
}

main().catch(console.error)
