import type { ToolDefinition, ToolDefinitionBase, ToolSchema } from '../types'

/**
 * Manages registered tools for an agent instance.
 */
export class ToolRegistry<TData = unknown> {
    private readonly tools = new Map<string, ToolDefinition<TData>>()

    register(tool: ToolDefinition<TData>): this {
        this.tools.set(tool.schema.name, tool)
        return this
    }

    get(name: string): ToolDefinitionBase | undefined {
        return this.tools.get(name)
    }

    getAll(): ToolDefinition<TData>[] {
        return [...this.tools.values()]
    }

    getSchemas(): ToolSchema[] {
        return this.getAll().map((t) => t.schema)
    }

    has(name: string): boolean {
        return this.tools.has(name)
    }

    isAllowed(name: string, allowedTools?: string[]): boolean {
        if (!allowedTools) return true
        return allowedTools.includes(name)
    }
}

/**
 * Helper to define a tool with full type inference.
 */
export function defineTool<TData = unknown>(
    definition: ToolDefinition<TData>,
): ToolDefinition<TData> {
    return definition
}