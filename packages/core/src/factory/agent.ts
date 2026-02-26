import { AgentInstance } from '../agent/agent'
import type { AgentConfig, ToolDefinition } from '../types'
import { getAgentMetadata, getToolMetadata, getArgMetadata } from './decorators'

/**
 * Creates an agent instance from a configuration object or a decorated class.
 */
export function createAgent<TData = unknown>(
    configOrClass?: AgentConfig<TData> | (new (...args: any[]) => any),
): AgentInstance<TData> {
    // Case 1: No arguments or object configuration
    if (!configOrClass || (typeof configOrClass === 'object' && !Array.isArray(configOrClass))) {
        return new AgentInstance<TData>(configOrClass as AgentConfig<TData>)
    }

    // Case 2: Class-based configuration (Decorators)
    if (typeof configOrClass === 'function') {
        const TargetClass = configOrClass
        const metadata = getAgentMetadata(TargetClass)

        if (!metadata) {
            throw new Error(`Class ${TargetClass.name} is not decorated with @Agent`)
        }

        const instance = new TargetClass()
        const tools: ToolDefinition<TData>[] = []

        // Extract tools from class methods
        const prototype = TargetClass.prototype
        for (const methodName of Object.getOwnPropertyNames(prototype)) {
            if (methodName === 'constructor') continue

            const toolMeta = getToolMetadata(prototype, methodName)
            if (toolMeta) {
                const args = getArgMetadata(prototype, methodName)
                const paramTypes = Reflect.getMetadata('design:paramtypes', prototype, methodName) || []

                const properties: Record<string, any> = {}
                const required: string[] = []

                for (let i = 0; i < args.length; i++) {
                    const arg = args[i]!
                    const paramType = paramTypes[i]

                    let jsonType = 'string'
                    if (paramType === Number) jsonType = 'number'
                    if (paramType === Boolean) jsonType = 'boolean'
                    if (paramType === Array) jsonType = 'array'
                    if (paramType === Object) jsonType = 'object'

                    properties[arg.name] = {
                        type: arg.type || jsonType,
                        description: arg.description,
                    }
                    if (arg.required !== false) {
                        required.push(arg.name)
                    }
                }

                tools.push({
                    schema: {
                        name: toolMeta.name,
                        description: toolMeta.description,
                        parameters: {
                            type: 'object',
                            properties,
                            required,
                        },
                    },
                    execute: async (callArgs: Record<string, any>) => {
                        const orderedArgs = args.map(arg => callArgs[arg.name])
                        return await instance[methodName](...orderedArgs)
                    }
                })
            }
        }

        const agentConfig: AgentConfig<TData> = {
            ...metadata,
            tools: [...((metadata as any).tools || []), ...tools],
            data: metadata.data as any
        }

        return new AgentInstance<TData>(agentConfig)
    }

    throw new Error('Invalid agent configuration. Provide an AgentConfig object or an @Agent decorated class.')
}
