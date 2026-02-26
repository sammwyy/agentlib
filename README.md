# AgentLIB

**A type-safe, composable AI agent framework.**

Build production-ready AI agents with pluggable reasoning engines, memory providers, tool calling, middleware, and full observability — all with a clean, fluent TypeScript API.

---

## Packages

| Package | Description | Version |
|---|---|---|
| [`@agentlib/core`](packages/core) | Core runtime — Agent, types, tool system, events, middleware | [![npm](https://img.shields.io/npm/v/@agentlib/core)](https://www.npmjs.com/package/@agentlib/core) |
| [`@agentlib/openai`](packages/openai) | OpenAI model provider (GPT-4o, o1, o3-mini, any OpenAI-compatible API) | [![npm](https://img.shields.io/npm/v/@agentlib/openai)](https://www.npmjs.com/package/@agentlib/openai) |
| [`@agentlib/memory`](packages/memory) | Memory providers — Buffer, SlidingWindow, Summarizing, Composite | [![npm](https://img.shields.io/npm/v/@agentlib/memory)](https://www.npmjs.com/package/@agentlib/memory) |
| [`@agentlib/reasoning`](packages/reasoning) | Reasoning engines — ReAct, Planner, CoT, Reflect, Autonomous | [![npm](https://img.shields.io/npm/v/@agentlib/reasoning)](https://www.npmjs.com/package/@agentlib/reasoning) |
| [`@agentlib/logger`](packages/logger) | Structured logging middleware with timing and custom transports | [![npm](https://img.shields.io/npm/v/@agentlib/logger)](https://www.npmjs.com/package/@agentlib/logger) |

---

## Quick Start

```bash
npm install @agentlib/core @agentlib/openai
```

```ts
import {  createAgent, AgentInstance, defineTool  } from '@agentlib/core'
import { openai } from '@agentlib/openai'

const weatherTool = defineTool({
  schema: {
    name: 'get_weather',
    description: 'Get the current weather for a location.',
    parameters: {
      type: 'object',
      properties: { location: { type: 'string' } },
      required: ['location'],
    },
  },
  async execute({ location }) {
    return { location, temperature: 22, condition: 'sunny' }
  },
})

const agent = createAgent({ name: 'assistant' })
  .provider(openai({ apiKey: process.env.OPENAI_API_KEY! }))
  .tool(weatherTool)

const result = await agent.run('What is the weather in Tokyo?')
console.log(result.output)
```

---

## Features

- **Fluent builder API** — chainable `.provider()`, `.tool()`, `.memory()`, `.reasoning()`, `.use()`
- **Type-safe** — full generics for agent state (`AgentInstance<TData>`) and typed tool arguments
- **Pluggable reasoning** — swap engines without changing agent code
- **Persistent memory** — multiple strategies for conversation history management
- **Middleware system** — intercept any lifecycle event (`run:before`, `step:after`, `tool:before`, …)
- **Event emitter** — lightweight pub/sub for observability (`run:start`, `tool:after`, `error`, …)
- **Session support** — multi-user memory isolation via `sessionId`
- **Token budget enforcement** — stop runs before hitting cost limits
- **Custom engines** — implement `ReasoningEngine` interface to plug in any logic

---

## Memory

```bash
npm install @agentlib/memory
```

### BufferMemory

Simplest option. Keeps the last N messages in process memory.

```ts
import { BufferMemory } from '@agentlib/memory'

const agent = createAgent({ name: 'chat-bot' })
  .provider(openai({ apiKey: process.env.OPENAI_API_KEY! }))
  .memory(new BufferMemory({ maxMessages: 20 }))

// Same sessionId → conversation context is preserved
await agent.run({ input: 'My name is Alice.', sessionId: 'user-1' })
await agent.run({ input: 'What is my name?', sessionId: 'user-1' })
```

### SlidingWindowMemory

Token-aware memory that evicts the oldest turns when the budget is exceeded.

```ts
import { SlidingWindowMemory } from '@agentlib/memory'

const memory = new SlidingWindowMemory({ maxTokens: 8000, maxTurns: 30 })
agent.memory(memory)
```

### SummarizingMemory

Uses a dedicated (cheap/fast) LLM to compress older context into a summary instead of discarding it. Best for long-running conversations.

```ts
import { SummarizingMemory } from '@agentlib/memory'

const memory = new SummarizingMemory({
  model: openai({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o-mini' }),
  activeWindowTokens: 3000,
  summaryPrompt: 'Summarize the conversation, preserving key facts.',
})
agent.memory(memory)
```

### CompositeMemory

Chain memory providers together — e.g. fast local buffer as primary, remote store as fallback.

```ts
import { CompositeMemory } from '@agentlib/memory'

const memory = new CompositeMemory([fastCache, persistentStore])
agent.memory(memory)
```

---

## Reasoning Engines

```bash
npm install @agentlib/reasoning
```

Import the package to auto-register all built-in engines:

```ts
import '@agentlib/reasoning'

// Then use strategy strings:
agent.reasoning('react')
agent.reasoning('planner')
agent.reasoning('cot')
agent.reasoning('reflect')
agent.reasoning('autonomous')
```

Or inject an engine instance directly for more control:

```ts
import { ReactEngine, PlannerEngine, ChainOfThoughtEngine, ReflectEngine, AutonomousEngine } from '@agentlib/reasoning'

agent.reasoning(new ReactEngine({ maxSteps: 10 }))
```

### Engine Overview

| Engine | Best For | How It Works |
|---|---|---|
| **ReAct** | Tool-using agents | Interleaves _Thought → Action → Observation_ in a loop until a final answer |
| **ChainOfThought** | Complex math / logic | Forces explicit step-by-step reasoning before answering |
| **Planner** | Multi-step decomposable tasks | Creates a JSON subtask plan, executes each, synthesizes results |
| **Reflect** | High-stakes / accuracy-critical tasks | Generates an answer, self-critiques (score 0–10), revises if below threshold |
| **Autonomous** | Long-horizon open-ended tasks | Loops until the agent explicitly calls a `finish` tool |

### Custom Engine

Any object implementing `ReasoningEngine` works:

```ts
import { ReasoningEngine, ReasoningContext } from '@agentlib/core'

const myEngine: ReasoningEngine = {
  name: 'my-engine',
  async execute(rCtx: ReasoningContext) {
    // Seed the conversation
    const response = await rCtx.model.complete({ messages: rCtx.ctx.state.messages })
    rCtx.pushStep({ type: 'response', content: response.message.content, engine: 'my-engine' })
    return response.message.content
  },
}

agent.reasoning(myEngine)
```

---

## Middleware

```ts
agent.use({
  name: 'rate-limiter',
  scope: 'run:before',
  async run(mCtx, next) {
    await checkRateLimit(mCtx.ctx.data.userId)
    await next()
  },
})
```

Available scopes: `run:before`, `run:after`, `step:before`, `step:after`, `tool:before`, `tool:after`

---

## Logging

```bash
npm install @agentlib/logger
```

```ts
import { createLogger } from '@agentlib/logger'

agent.use(createLogger({
  level: 'debug',        // 'debug' | 'info' | 'warn' | 'error' | 'silent'
  timing: true,          // log duration per scope pair
  prefix: '[my-agent]',  // custom log prefix
}))
```

---

## Events

```ts
agent.on('run:start', ({ input }) => console.log('Starting:', input))
agent.on('tool:after', ({ tool, result }) => console.log(`${tool} →`, result))
agent.on('step:reasoning', (step) => {
  if (step.type === 'thought') console.log('💭', step.content)
})
agent.on('error', (err) => console.error('Agent error:', err))
```

Available events: `run:start`, `run:end`, `step:start`, `step:end`, `model:request`, `model:response`, `tool:before`, `tool:after`, `memory:read`, `memory:write`, `step:reasoning`, `cancel`, `error`

---

## Policy

```ts
const agent = createAgent({
  name: 'safe-agent',
  policy: {
    maxSteps: 10,         // max reasoning steps per run
    tokenBudget: 50_000,  // abort if total tokens exceed this
    allowedTools: ['search', 'calculator'], // tool allowlist
    timeout: 30_000,      // ms (when timeout support is added)
  },
})
```

---

## Multiple Sessions

```ts
const memory = new BufferMemory({ maxMessages: 20 })

const agent = createAgent({ name: 'chat' })
  .provider(openai({ apiKey: process.env.OPENAI_API_KEY! }))
  .memory(memory)

// Each user gets their own isolated conversation history
await agent.run({ input: 'Hello!', sessionId: req.session.userId })
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL_SUMMARIZER=gpt-4o-mini
OPENAI_MODEL_REASONING=o3-mini
```

Load them in your app:

```ts
import 'dotenv/config'
```

---

## Contributing

This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turbo.build/).

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run an example
pnpm example example/basic-agent.ts
pnpm example example/chat-history.ts
pnpm example example/reasoning/react.ts

# Watch mode (all packages)
pnpm dev
```

---

## License

MIT © [sammwy](https://github.com/sammwy)