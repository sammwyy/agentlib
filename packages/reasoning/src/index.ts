import { registerEngine } from '@agentlib/core'
import { ReactEngine } from './engines/react'
import { ChainOfThoughtEngine } from './engines/cot'
import { PlannerEngine } from './engines/planner'
import { ReflectEngine } from './engines/reflect'
import { AutonomousEngine } from './engines/autonomous'

// ─── Auto-register all built-in engines ──────────────────────────────────────
//
// Importing @agentlib/reasoning registers all engines with the global registry.
// After this import, agents can use strategy strings:
//
//   agent.reasoning('react')
//   agent.reasoning('planner')
//   agent.reasoning('cot')
//   agent.reasoning('reflect')
//   agent.reasoning('autonomous')

registerEngine('react', () => new ReactEngine())
registerEngine('planner', () => new PlannerEngine())
registerEngine('cot', () => new ChainOfThoughtEngine())
registerEngine('reflect', () => new ReflectEngine())
registerEngine('autonomous', () => new AutonomousEngine())

// ─── Exports ──────────────────────────────────────────────────────────────────

export { ReactEngine } from './engines/react'
export type { ReactEngineConfig } from './engines/react'

export { ChainOfThoughtEngine } from './engines/cot'
export type { ChainOfThoughtEngineConfig } from './engines/cot'

export { PlannerEngine } from './engines/planner'
export type { PlannerEngineConfig } from './engines/planner'

export { ReflectEngine } from './engines/reflect'
export type { ReflectEngineConfig } from './engines/reflect'

export { AutonomousEngine } from './engines/autonomous'
export type { AutonomousEngineConfig } from './engines/autonomous'