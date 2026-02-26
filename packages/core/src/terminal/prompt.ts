import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { AgentInstance } from '../agent/agent';

/**
 * Starts a loop that reads input from the console and sends it to the agent.
 * The response from the agent is then printed back to the console.
 * 
 * @param agent The agent instance to interact with.
 */
export async function loopConsolePrompting(agent: AgentInstance): Promise<void> {
    const rl = readline.createInterface({ input, output });

    agent.on('step:reasoning', (step: any) => {
        if (step.type === 'thought') {
            console.log(`\x1b[38;5;244m💡 [Thought]\x1b[0m ${step.content}`);
        } else if (step.type === 'tool_call') {
            console.log(`\x1b[33m🛠️  [Tool Call]\x1b[0m ${step.toolName}(${JSON.stringify(step.args)})`);
        } else if (step.type === 'tool_result') {
            console.log(`\x1b[32m✅ [Tool Result]\x1b[0m ${JSON.stringify(step.result)}`);
        } else if (step.type === 'plan') {
            console.log(`\x1b[36m📋 [Plan]\x1b[0m`);
            step.tasks.forEach((t: any) => {
                console.log(`  - [${t.id}] ${t.description}`);
            });
        }
    });

    process.stdout.write('> ');
    for await (const line of rl) {
        const userInput = line.trim();

        if (userInput) {
            try {
                const result = await agent.run(userInput);
                console.log(`\x1b[35m[Response]\x1b[0m ${result.output}`);
            } catch (error) {
                console.error('\nError:', error);
            }
        }

        process.stdout.write('> ');
    }

    rl.close();
}
