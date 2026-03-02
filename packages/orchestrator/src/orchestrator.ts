import { AgentInstance, defineTool, type RunResult, type ModelMessage } from '@agentlib/core'
import { BufferMemory } from '@agentlib/memory'
import { EventEmitter } from '@agentlib/utils'

import type { OrchestratorConfig, AgentState, StepSummary, OrchestratorEvents } from './types'

export class Orchestrator extends EventEmitter<OrchestratorEvents> {
    private readonly planner: AgentInstance
    private readonly agents: Record<string, AgentInstance>
    private readonly config: OrchestratorConfig
    private readonly states = new Map<string, AgentState>()
    private readonly stepContext: StepSummary[] = []
    private readonly runningAgents = new Map<string, Promise<RunResult>>()

    constructor(planner: AgentInstance, config: OrchestratorConfig) {
        super()
        this.planner = planner
        this.config = config
        this.agents = config.agents ?? {}

        this._prepareAgents()
        this._registerPlannerTools()
        this._injectContext()
    }

    private _prepareAgents(): void {
        for (const [name, agent] of Object.entries(this.agents)) {
            // Initialize state
            this.states.set(name, {
                name,
                status: 'idle',
            })

            // Inject BufferMemory if no memory is provided
            if (!(agent as any)._memory) {
                agent.memory(new BufferMemory())
            }

            // Forward agent events
            agent.on('step:reasoning', async (step: any) => {
                const stepWithAgent = { ...step, agent: name }
                void this.emit('agent:step', { agent: name, step })

                if (this.config.onStep) {
                    const result = await (this.config as any).onStep(stepWithAgent)
                    if (result === 'abort') {
                        agent.cancel('Aborted by Orchestrator onStep')
                    }
                }
            })
        }

        // Forward planner events
        this.planner.on('step:reasoning', async (step: any) => {
            void this.emit('planner:step', { step })

            if (this.config.onStep) {
                const stepWithAgent = { ...step, agent: 'planner' }

                // If it's a tool result from calling a sub-agent tool directly (if exposed as separate tools)
                if (step.type === 'tool_result' && this.agents[step.toolName]) {
                    stepWithAgent.agent = step.toolName
                }

                const result = await (this.config as any).onStep(stepWithAgent)
                if (result === 'abort') {
                    this.planner.cancel('Aborted by Orchestrator onStep')
                }
            }
        })
    }

    private _injectContext(): void {
        if (!this.config.context) return

        const contextStr = JSON.stringify(this.config.context, null, 2)
        const injection = `\n\n### Global Context (READ ONLY):\n${contextStr}\n`

        // Inject into planner
        this._injectToAgent(this.planner, injection)

        // Inject into sub-agents
        for (const agent of Object.values(this.agents)) {
            this._injectToAgent(agent, injection)
        }
    }

    private _injectToAgent(agent: AgentInstance, content: string): void {
        const config = (agent as any).config
        if (config && !config.systemPrompt?.includes(content)) {
            config.systemPrompt = (config.systemPrompt ?? '') + content
        }
    }

    private _registerPlannerTools(): void {
        if (this.config.exposeAgentsAsTools === false) return

        // Wait for specific agent
        this.planner.tool(defineTool({
            schema: {
                name: 'wait_for_agent',
                description: 'Wait for a specific agent to finish its execution.',
                parameters: {
                    type: 'object',
                    properties: {
                        agentName: { type: 'string', description: 'Name of the agent to wait for.' }
                    },
                    required: ['agentName']
                }
            },
            execute: async ({ agentName }) => {
                if (!agentName) return 'Error: Missing agentName'
                return await this.waitAgent(agentName as string)
            }
        }))

        // Wait for all agents
        this.planner.tool(defineTool({
            schema: {
                name: 'wait_all_agents',
                description: 'Wait for all currently running agents to finish.',
                parameters: { type: 'object', properties: {} }
            },
            execute: async () => {
                const results = await this.waitAll()
                return JSON.stringify(results, null, 2)
            }
        }))

        // Get agent state
        this.planner.tool(defineTool({
            schema: {
                name: 'get_agent_state',
                description: 'Get the current state and last output of a specific agent.',
                parameters: {
                    type: 'object',
                    properties: {
                        agentName: { type: 'string', description: 'Name of the agent.' }
                    },
                    required: ['agentName']
                }
            },
            execute: async ({ agentName }) => {
                if (!agentName) return 'Error: Missing agentName'
                const state = this.getAgentState(agentName as string)
                return JSON.stringify(state || { error: 'Agent not found' }, null, 2)
            }
        }))

        // Get all states
        this.planner.tool(defineTool({
            schema: {
                name: 'get_all_agent_states',
                description: 'Get the current status of all agents in the orchestrator.',
                parameters: { type: 'object', properties: {} }
            },
            execute: async () => {
                const states = this.getAllStates()
                return JSON.stringify(states, null, 2)
            }
        }))

        // Invoke agent
        this.planner.tool(defineTool({
            schema: {
                name: 'invoke_agent',
                description: 'Launch an agent with a specific prompt. It runs in parallel.',
                parameters: {
                    type: 'object',
                    properties: {
                        agentName: { type: 'string', description: 'Name of the agent to invoke.' },
                        prompt: { type: 'string', description: 'Prompt to send to the agent.' }
                    },
                    required: ['agentName', 'prompt']
                }
            },
            execute: async ({ agentName, prompt }) => {
                if (!agentName || !prompt) return 'Error: Missing agentName or prompt'
                try {
                    await this.invokeAgent(agentName as string, prompt as string)
                    return `Agent ${agentName} invoked successfully. You MUST call wait_for_agent to get its result.`
                } catch (err) {
                    return `Error invoking agent: ${err instanceof Error ? err.message : String(err)}`
                }
            }
        }))

        // Clear history
        this.planner.tool(defineTool({
            schema: {
                name: 'clear_agent_history',
                description: 'Clear the temporary history/memory of a specific agent.',
                parameters: {
                    type: 'object',
                    properties: {
                        agentName: { type: 'string', description: 'Name of the agent.' }
                    },
                    required: ['agentName']
                }
            },
            execute: async ({ agentName }) => {
                if (!agentName) return 'Error: Missing agentName'
                await this.clearAgentHistory(agentName as string)
                return `History for agent ${agentName} has been cleared.`
            }
        }))

        // Add sub-agents descriptions to planner context
        const agentsList = Object.entries(this.agents)
            .map(([name, agent]) => `- ${name}: ${(agent as any).config.description ?? 'No description provided.'}`)
            .join('\n')

        const agentContext = `
\n### Available Sub-Agents You Can Control:
${agentsList}

### Orchestration Guidelines:
1. **Parallel Execution**: You can invoke multiple agents in sequence using \`invoke_agent\`. They will run in parallel.
2. **Getting Results**: After invoking an agent, you **MUST** call \`wait_for_agent\` to get their output.
3. **Control Flow**:
   - Sequential: \`invoke_agent(A)\` -> \`wait_for_agent(A)\` -> \`invoke_agent(B)\` -> \`wait_for_agent(B)\`.
   - Parallel: \`invoke_agent(A)\` -> \`invoke_agent(B)\` -> \`wait_for_agent(A)\` -> \`wait_for_agent(B)\`.
\n`
        this._injectToAgent(this.planner, agentContext)
    }

    async invokeAgent(name: string, prompt: string): Promise<void> {
        const agent = this.agents[name]
        if (!agent) throw new Error(`Agent "${name}" not found.`)

        const state = this.states.get(name)!
        state.status = 'running'
        delete state.error

        void this.emit('agent:invoke', { agent: name, prompt })

        const promise = agent.run(prompt).then(async (result) => {
            state.status = 'idle'
            state.lastOutput = result.output
            this.runningAgents.delete(name)

            void this.emit('agent:completed', { agent: name, output: result.output })

            if (this.config.summarize) {
                const summary: StepSummary = {
                    agent: name,
                    summary: result.output.length > 500 ? result.output.substring(0, 500) + '...' : result.output,
                    timestamp: new Date()
                }
                this.stepContext.push(summary)
                void this.emit('step:summary', summary)
            }

            return result
        }).catch(async (err) => {
            state.status = 'error'
            state.error = err
            this.runningAgents.delete(name)
            throw err
        })

        this.runningAgents.set(name, promise)
    }

    async waitAgent(name: string): Promise<string> {
        const promise = this.runningAgents.get(name)
        if (!promise) {
            const state = this.states.get(name)
            if (state?.status === 'error') throw state.error
            return state?.lastOutput ?? `Agent "${name}" is not running and has no previous output.`
        }
        const result = await promise
        return result.output
    }

    async waitAll(): Promise<Record<string, string>> {
        const results: Record<string, string> = {}
        if (this.runningAgents.size === 0) {
            for (const [name, state] of this.states.entries()) {
                results[name] = state.lastOutput ?? 'No output.'
            }
            return results
        }

        await Promise.allSettled(Array.from(this.runningAgents.values()))
        for (const name of Object.keys(this.agents)) {
            results[name] = this.states.get(name)?.lastOutput ?? 'No output.'
        }
        return results
    }

    getAgentState(name: string): AgentState | undefined {
        return this.states.get(name)
    }

    getAllStates(): AgentState[] {
        return Array.from(this.states.values())
    }

    async clearAgentHistory(name: string): Promise<void> {
        const agent = this.agents[name]
        if (!agent) return
        const memory = (agent as any)._memory
        if (memory && typeof memory.clear === 'function') {
            await memory.clear()
        }
    }

    async run(input: string, options?: any): Promise<RunResult> {
        if (this.config.summarize && this.stepContext.length > 0) {
            const contextSummary = this.stepContext
                .map(s => `[${s.timestamp.toISOString()}] ${s.agent}: ${s.summary}`)
                .join('\n')

            const summaryInjection = `\n\n### Previous Agent Work Summaries:\n${contextSummary}\n`

            this.planner.use({
                name: 'orchestrator-summary-injector',
                scope: 'run:before',
                run: async (mCtx, next) => {
                    const sysMsg = mCtx.ctx.state.messages.find(m => m.role === 'system')
                    if (sysMsg) {
                        if (!sysMsg.content.includes(summaryInjection)) {
                            sysMsg.content += summaryInjection
                        }
                    } else {
                        mCtx.ctx.state.messages.unshift({ role: 'system', content: summaryInjection })
                    }
                    await next()
                }
            })
        }

        const result = await this.planner.run(input)
        void this.emit('finished', { output: result.output })
        return result
    }

    async getHistory(): Promise<ModelMessage[]> {
        const history: ModelMessage[] = []
        if (this.config.extendedSubBuffers) {
            for (const [name, agent] of Object.entries(this.agents)) {
                const memory = (agent as any)._memory
                if (memory) {
                    const messages = await memory.read({})
                    const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant')
                    if (lastAssistantMessage) {
                        history.push({
                            role: 'system',
                            content: `Last activity from ${name}: ${lastAssistantMessage.content}`
                        })
                    }
                }
            }
        }
        return history
    }
}
