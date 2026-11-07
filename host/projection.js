/**
 * A Session projection that keeps a per-day token ledger, priced as each
 * response happens. The client only sums the wire views it receives from
 * `session/list`, so nothing has to replay a transcript in the browser.
 */

import {
  OFF_PEAK_FACTOR,
  PEAK_WINDOWS,
  PRICES,
  costOf,
  dayKey,
  isPeak,
  priceFor,
  usageOf,
} from './pricing.js'

/** Days kept per Session; the sidebar only ever reads today. */
const KEEP_DAYS = 7

function emptyDay() {
  return { requests: 0, hit: 0, miss: 0, out: 0, cost: 0, peakCost: 0, models: {}, unpriced: {} }
}

function emptyState() {
  return { model: '', days: {} }
}

/**
 * The projection runtime parses a stored checkpoint with `stateSchema.parse`
 * when a Session is resumed from disk, so this only has to reject shapes the
 * fold cannot read — it is not a general validator.
 */
function restoreState(value) {
  const days = {}
  const source = value && typeof value === 'object' && value.days && typeof value.days === 'object' ? value.days : {}
  for (const [key, day] of Object.entries(source)) {
    if (!day || typeof day !== 'object') continue
    days[key] = {
      ...emptyDay(),
      ...day,
      models: day.models && typeof day.models === 'object' ? day.models : {},
      unpriced: day.unpriced && typeof day.unpriced === 'object' ? day.unpriced : {},
    }
  }
  return { model: typeof value?.model === 'string' ? value.model : '', days }
}

function addModel(models, price, usage, cost) {
  const prev = models[price.key] ?? { label: price.label, requests: 0, hit: 0, miss: 0, out: 0, cost: 0 }
  models[price.key] = {
    label: price.label,
    requests: prev.requests + 1,
    hit: prev.hit + usage.hit,
    miss: prev.miss + usage.miss,
    out: prev.out + usage.out,
    cost: prev.cost + cost,
  }
}

/** Fold one Session event into the ledger. Returns the same state when nothing changes. */
export function foldEvent(state, event) {
  if (!event || typeof event !== 'object') return state

  /* The model is announced once per request, on the header event. */
  if (event.type === 'request/header') {
    const model = event.data?.header?.config?.model
    if (typeof model !== 'string' || model === '' || model === state.model) return state
    return { ...state, model }
  }

  if (event.type !== 'assistant/message') return state
  const usage = usageOf(event.data?.usage)
  if (!usage) return state

  /* A message that names its own model wins over the last announced one, and an
     unknown model stays unpriced instead of borrowing a neighbouring price. */
  const model = event.data?.message?.source?.model ?? state.model
  const price = priceFor(model)
  const at = Number.isFinite(event.time) ? event.time : Date.now()
  const peak = isPeak(at)
  const cost = price ? costOf(usage, price, peak) : 0

  const key = dayKey(at)
  const prev = state.days[key] ?? emptyDay()
  const day = {
    requests: prev.requests + 1,
    hit: prev.hit + usage.hit,
    miss: prev.miss + usage.miss,
    out: prev.out + usage.out,
    cost: prev.cost + cost,
    peakCost: prev.peakCost + (price ? costOf(usage, price, true) : 0),
    models: { ...prev.models },
    unpriced: { ...prev.unpriced },
  }

  if (price) addModel(day.models, price, usage, cost)
  else day.unpriced[model || 'unknown'] = (day.unpriced[model || 'unknown'] ?? 0) + 1

  const days = { ...state.days, [key]: day }
  const keys = Object.keys(days).sort()
  for (const stale of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[stale]
  return { ...state, days }
}

export const tokenPillProjection = {
  key: 'tokenPill',
  stateVersion: 1,
  stateSchema: { parse: restoreState },
  init: emptyState,
  apply: foldEvent,
  /* `wire` is what `session/list` hands to the client. The rate card travels
     with it so the browser bundle holds no prices of its own. `viewSchema.parse`
     runs on every produced value; the fold already guarantees this shape. */
  wire: {
    viewSchema: { parse: (value) => value },
    view: (state) => ({
      prices: PRICES,
      windows: PEAK_WINDOWS,
      offPeak: OFF_PEAK_FACTOR,
      days: state.days,
    }),
    summary: true,
  },
}
