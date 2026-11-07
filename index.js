/**
 * Host half of the sidebar token pill.
 *
 * Two jobs: register the per-Session, per-day token ledger as a Session
 * projection (list price applied at the moment each response arrives), and
 * expose the cross-Session aggregate the client cannot compute itself, because
 * a cold Session's projection column is only served from the persisted cache.
 */

import { tokenPillProjection } from './host/projection.js'
import { createUsageReader } from './host/usage.js'

export const name = 'dsh-token-pill'
export const inject = ['sessionProjections', 'sessionQuery', 'webServer']

/** Route the client half reads; served from the same origin as the UI. */
const ROUTE = '/dsh-token-pill/usage'

export function apply(ctx) {
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(tokenPillProjection)
  })

  ctx.inject(['sessionQuery', 'webServer'], (scope) => {
    const readUsage = createUsageReader(scope)
    scope.effect(() =>
      scope.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (request, response) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.statusCode = 405
            response.end()
            return
          }
          try {
            const payload = await readUsage()
            const body = JSON.stringify(payload)
            response.statusCode = 200
            response.setHeader('content-type', 'application/json; charset=utf-8')
            response.setHeader('cache-control', 'no-store')
            response.end(request.method === 'HEAD' ? undefined : body)
          } catch (error) {
            response.statusCode = 500
            response.setHeader('content-type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
          }
        },
      }),
    )
  })
}
