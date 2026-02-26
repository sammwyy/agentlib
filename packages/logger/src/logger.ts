import type { Middleware, MiddlewareContext, MiddlewareScope, NextFn } from '@agentlib/core'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export interface LogEntry {
    level: LogLevel
    scope: MiddlewareScope
    agentInput?: string | undefined
    tool?: string | undefined
    timestamp: string
    durationMs?: number | undefined
    meta?: Record<string, unknown> | undefined
}

export type LogTransport = (entry: LogEntry) => void

export interface LoggerMiddlewareConfig {
    /**
     * Minimum log level to emit.
     * @default 'info'
     */
    level?: LogLevel

    /**
     * Which middleware scopes to log.
     * Defaults to all scopes.
     */
    scopes?: MiddlewareScope[]

    /**
     * Custom transport. Defaults to structured console output.
     */
    transport?: LogTransport

    /**
     * Whether to measure and log duration per scope pair (e.g. before→after).
     * @default true
     */
    timing?: boolean

    /**
     * Prefix prepended to all log output (when using default transport).
     * @default '[agentlib]'
     */
    prefix?: string
}

const LEVEL_RANK: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 99,
}

function shouldLog(entry: LogLevel, min: LogLevel): boolean {
    return LEVEL_RANK[entry] >= LEVEL_RANK[min]
}

function defaultTransport(prefix: string): LogTransport {
    return (entry: LogEntry) => {
        const { level, scope, timestamp, durationMs, tool, meta } = entry

        const parts: string[] = [
            prefix,
            `[${timestamp}]`,
            `[${level.toUpperCase()}]`,
            `scope=${scope}`,
        ]

        if (tool) parts.push(`tool=${tool}`)
        if (durationMs !== undefined) parts.push(`duration=${durationMs}ms`)
        if (meta && Object.keys(meta).length) parts.push(JSON.stringify(meta))

        const line = parts.join(' ')

        switch (level) {
            case 'debug':
                console.debug(line)
                break
            case 'info':
                console.info(line)
                break
            case 'warn':
                console.warn(line)
                break
            case 'error':
                console.error(line)
                break
        }
    }
}

function scopeToLevel(scope: MiddlewareScope): LogLevel {
    switch (scope) {
        case 'run:before':
        case 'run:after':
            return 'info'
        case 'step:before':
        case 'step:after':
            return 'debug'
        case 'tool:before':
        case 'tool:after':
            return 'debug'
        default:
            return 'info'
    }
}

/**
 * Structured logging middleware for agentlib.
 *
 * Logs lifecycle events across all (or selected) scopes with optional timing.
 *
 * @example
 * ```ts
 * agent.use(createLogger())
 * agent.use(createLogger({ level: 'debug', timing: true }))
 * agent.use(createLogger({ transport: (entry) => myLogger.log(entry) }))
 * ```
 */
export function createLogger<TData = unknown>(
    config: LoggerMiddlewareConfig = {},
): Middleware<TData> {
    const {
        level: minLevel = 'info',
        scopes,
        timing = true,
        prefix = '[agentlib]',
        transport = defaultTransport(prefix),
    } = config

    // Timing store: scope-pair key → start time
    const timers = new Map<string, number>()

    return {
        name: 'logger',
        run: async (mCtx: MiddlewareContext<TData>, next: NextFn) => {
            const { scope, ctx, tool } = mCtx

            // Scope filter
            if (scopes && !scopes.includes(scope)) {
                await next()
                return
            }

            const level = scopeToLevel(scope)
            if (!shouldLog(level, minLevel)) {
                await next()
                return
            }

            const timestamp = new Date().toISOString()
            const timerKey = `${scope}-${ctx.input.slice(0, 20)}-${tool?.name ?? ''}`

            // ── BEFORE scopes: start timer & log entry ──
            if (scope.endsWith(':before')) {
                if (timing) timers.set(timerKey, Date.now())

                transport({
                    level,
                    scope,
                    timestamp,
                    agentInput: ctx.input,
                    tool: tool?.name,
                    meta: tool?.args ? { args: tool.args } : undefined,
                })

                await next()
                return
            }

            // ── AFTER scopes: compute duration & log ──
            let durationMs: number | undefined
            if (timing) {
                const beforeKey = timerKey.replace(':after', ':before')
                const start = timers.get(beforeKey)
                if (start !== undefined) {
                    durationMs = Date.now() - start
                    timers.delete(beforeKey)
                }
            }

            await next()

            transport({
                level,
                scope,
                timestamp: new Date().toISOString(),
                agentInput: ctx.input,
                tool: tool?.name,
                durationMs,
                meta: tool?.result !== undefined ? { result: tool.result } : undefined,
            })
        },
    }
}