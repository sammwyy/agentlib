import 'reflect-metadata'
import type { AgentConfig } from '../types'

export const AGENT_METADATA_KEY = Symbol('agentlib:agent')
export const TOOL_METADATA_KEY = Symbol('agentlib:tool')
export const ARG_METADATA_KEY = Symbol('agentlib:arg')

export interface AgentDecoratorConfig extends Partial<Omit<AgentConfig, 'tools'>> {
    name: string
}

export function Agent(configOrName: string | AgentDecoratorConfig): ClassDecorator {
    return (target: any) => {
        const config = typeof configOrName === 'string' ? { name: configOrName } : configOrName
        Reflect.defineMetadata(AGENT_METADATA_KEY, config, target)
    }
}

export interface ToolDecoratorConfig {
    name: string
    description: string
}

export function Tool(nameOrConfig: string | ToolDecoratorConfig, description?: string): MethodDecorator {
    return (target: any, propertyKey: string | symbol) => {
        const config = typeof nameOrConfig === 'string' ? { name: nameOrConfig, description: description! } : nameOrConfig
        Reflect.defineMetadata(TOOL_METADATA_KEY, config, target, propertyKey)
    }
}

export interface ArgDecoratorConfig {
    name: string
    description?: string
    type?: string
    required?: boolean
}

export function Arg(nameOrConfig: string | ArgDecoratorConfig): ParameterDecorator {
    return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
        if (!propertyKey) return
        const config = typeof nameOrConfig === 'string' ? { name: nameOrConfig } : nameOrConfig
        const existingArgs = Reflect.getMetadata(ARG_METADATA_KEY, target, propertyKey) || []
        existingArgs[parameterIndex] = config
        Reflect.defineMetadata(ARG_METADATA_KEY, existingArgs, target, propertyKey)
    }
}

export function getAgentMetadata(target: any): AgentDecoratorConfig | undefined {
    return Reflect.getMetadata(AGENT_METADATA_KEY, target)
}

export function getToolMetadata(target: any, propertyKey: string): ToolDecoratorConfig | undefined {
    return Reflect.getMetadata(TOOL_METADATA_KEY, target, propertyKey)
}

export function getArgMetadata(target: any, propertyKey: string): ArgDecoratorConfig[] {
    return Reflect.getMetadata(ARG_METADATA_KEY, target, propertyKey) || []
}
