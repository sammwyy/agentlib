import type { AgentInstance, ModelMessage } from '@agentlib/core'

export interface OrchestratorConfig {
    agents: Record<string, AgentInstance>
    maxSteps?: number
    summarize?: boolean
    exposeAgentsAsTools?: boolean
    context?: Record<string, unknown>
    extendedSubBuffers?: boolean
    onStep?: (step: any) => Promise<string | void> | string | void
}

export type AgentStatus = 'idle' | 'running' | 'error'

export interface AgentState {
    name: string
    status: AgentStatus
    lastOutput?: string
    error?: unknown
}

export interface StepSummary {
    agent: string
    summary: string
    timestamp: Date
}

export interface OrchestratorEvents extends Record<string, any> {
    'planner:step': { step: any }
    'agent:invoke': { agent: string; prompt: string }
    'agent:completed': { agent: string; output: string }
    'agent:step': { agent: string; step: any }
    'step:summary': StepSummary
    'finished': { output: string }
}
