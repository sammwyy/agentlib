import type { Middleware, MiddlewareContext, MiddlewareScope, NextFn } from '../types'

/**
 * Composable Koa-style async middleware pipeline.
 * Middleware runs in registration order, each calling `next()` to continue.
 */
export class MiddlewarePipeline<TData = unknown> {
    private readonly middlewares: Middleware<TData>[] = []

    use(middleware: Middleware<TData>): this {
        this.middlewares.push(middleware)
        return this
    }

    /**
     * Execute all middleware matching the given scope.
     */
    async run(ctx: MiddlewareContext<TData>): Promise<void> {
        const scoped = this.middlewares.filter((m) => {
            if (!m.scope) return true
            const scopes = Array.isArray(m.scope) ? m.scope : [m.scope]
            return scopes.includes(ctx.scope as MiddlewareScope)
        })

        const dispatch = async (index: number): Promise<void> => {
            if (index >= scoped.length) return
            const middleware = scoped[index]
            if (!middleware) return
            const next: NextFn = () => dispatch(index + 1)
            await middleware.run(ctx, next)
        }

        await dispatch(0)
    }
}