/**
 * Host half of the sidebar token pill.
 *
 * It owns one thing: a per-Session, per-day token ledger with the list price
 * applied at the moment each response arrives. The client half renders it.
 */

import { tokenPillProjection } from './host/projection.js'

export const name = 'dsh-token-pill'
export const inject = ['sessionProjections']

export function apply(ctx) {
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(tokenPillProjection)
  })
}
