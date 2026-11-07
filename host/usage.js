/**
 * Aggregate today's cost across every Session the Host can see.
 *
 * `session/list` serves a Session's projection column from the persisted
 * projection cache when that Session is cold; a cache row only exists once some
 * read has folded the log with the unit registered. A freshly installed unit
 * therefore has *no* row for older Sessions, so listing alone silently reports
 * zero for them. This reader folds each Session through `observeSession`, which
 * is cold-safe and materializes the row on first use, and merges the days into
 * one map for the client.
 */

import { OFF_PEAK_FACTOR, PEAK_WINDOWS, PRICES } from './pricing.js'

/** How long one computed aggregate may be reused across requests. */
const CACHE_MS = 15_000

/** One day bucket with no usage yet. */
export function emptyDay() {
  return { requests: 0, hit: 0, miss: 0, out: 0, cost: 0, peakCost: 0, models: {}, unpriced: {} }
}

/** Add one Session's day bucket into a running bucket, in place. */
export function mergeDayInto(target, day) {
  target.requests += Number(day.requests) || 0
  target.hit += Number(day.hit) || 0
  target.miss += Number(day.miss) || 0
  target.out += Number(day.out) || 0
  target.cost += Number(day.cost) || 0
  target.peakCost += Number(day.peakCost) || 0
  for (const [key, bucket] of Object.entries(day.models ?? {})) {
    const into = (target.models[key] ??= {
      label: bucket.label ?? key,
      requests: 0,
      hit: 0,
      miss: 0,
      out: 0,
      cost: 0,
    })
    into.requests += Number(bucket.requests) || 0
    into.hit += Number(bucket.hit) || 0
    into.miss += Number(bucket.miss) || 0
    into.out += Number(bucket.out) || 0
    into.cost += Number(bucket.cost) || 0
  }
  for (const [key, count] of Object.entries(day.unpriced ?? {})) {
    target.unpriced[key] = (target.unpriced[key] ?? 0) + (Number(count) || 0)
  }
  return target
}

/** Merge a whole `{ dayKey: bucket }` map into `sum`, in place. */
export function mergeDaysInto(sum, days) {
  for (const [key, day] of Object.entries(days ?? {})) {
    if (!day || typeof day !== 'object') continue
    mergeDayInto((sum[key] ??= emptyDay()), day)
  }
  return sum
}

/**
 * Build the reader the Host route calls.
 * @param ctx host context carrying `sessionQuery`.
 * @returns an async function producing the aggregate payload.
 */
export function createUsageReader(ctx) {
  let cache

  return async function read(signal) {
    const now = Date.now()
    if (cache !== undefined && now - cache.at < CACHE_MS) return cache.payload

    const records = await ctx.sessionQuery.listSessions(signal)
    const days = {}
    let sessions = 0
    let pending = 0

    for (const record of records) {
      signal?.throwIfAborted?.()
      let observation
      try {
        observation = await ctx.sessionQuery.observeSession(record.header.id, {
          projectionMode: 'all',
          ...(signal === undefined ? {} : { signal }),
        })
        const view = observation.projections?.values?.tokenPill
        if (view === undefined || view.days === undefined) {
          pending += 1
          continue
        }
        sessions += 1
        mergeDaysInto(days, view.days)
      } catch {
        pending += 1
      } finally {
        observation?.[Symbol.dispose]?.()
      }
    }

    const payload = {
      at: now,
      prices: PRICES,
      windows: PEAK_WINDOWS,
      offPeak: OFF_PEAK_FACTOR,
      sessions,
      pending,
      days,
    }
    cache = { at: now, payload }
    return payload
  }
}
