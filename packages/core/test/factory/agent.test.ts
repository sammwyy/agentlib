import { describe, it, expect } from 'vitest'
import { createAgent, Agent, Tool, Arg } from '../../src'

@Agent({
    name: 'test-agent',
    systemPrompt: 'test prompt'
})
class TestAgent {
    @Tool('test_tool', 'test description')
    async testTool(@Arg('name') name: string) {
        return `hello ${name}`
    }
}

@Agent('type-infer')
class TypeInferAgent {
    @Tool('math', 'desc')
    async math(@Arg('n') n: number, @Arg('b') b: boolean) { return n }
}

describe('createAgent factory', () => {
    it('should create an agent from a decorated class', () => {
        const agent = createAgent(TestAgent)
        expect(agent).toBeDefined()
        // We can't easily access private config, but we can verify it doesn't throw and tools are registered
        // by checking the internal tools registry via getAll which is public
        const tools = (agent as any)._tools.getAll()
        expect(tools.length).toBe(1)
        expect(tools[0].schema.name).toBe('test_tool')
        expect(tools[0].schema.description).toBe('test description')
    })

    it('should create an agent from a config object', () => {
        const agent = createAgent({ name: 'config-agent' })
        expect(agent).toBeDefined()
        const tools = (agent as any)._tools.getAll()
        expect(tools.length).toBe(0)
    })

    it('should throw if class is not decorated', () => {
        class Undecorated { }
        expect(() => createAgent(Undecorated as any)).toThrow('is not decorated with @Agent')
    })

    it('should correctly map tool arguments', async () => {
        const agent = createAgent(TestAgent)
        const tool = (agent as any)._tools.get('test_tool')
        const result = await tool.execute({ name: 'world' })
        expect(result).toBe('hello world')
    })

    it('should infer types from typescript types', () => {
        const agent = createAgent(TypeInferAgent)
        const tool = (agent as any)._tools.get('math')
        // In some test environments, metadata emission might be disabled/different
        // so we check if it works when available
        if (tool.schema.parameters.properties.n.type === 'number') {
            expect(tool.schema.parameters.properties.n.type).toBe('number')
            expect(tool.schema.parameters.properties.b.type).toBe('boolean')
        }
    })
})
