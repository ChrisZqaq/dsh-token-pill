/**
 * DeepSeek list prices in CNY per million tokens, and the peak / off-peak rule.
 *
 * Source: api-docs.deepseek.com/zh-cn/quick_start/pricing (checked 2026-11).
 * Peak  = Monday–Friday 09:00–12:00 and 14:00–18:00 local time.
 * Idle  = everything else, and costs exactly half of the peak rate.
 *
 * Public holidays are not modelled: DeepSeek bills those as idle, but the
 * holiday calendar changes every year, so a wrong table would be worse than a
 * documented gap.
 */

export const PRICES = {
  flash: { key: 'flash', label: 'flash', hit: 0.04, miss: 2, out: 8 },
  pro: { key: 'pro', label: 'v4-pro', hit: 0.3, miss: 9, out: 27 },
}

export const PEAK_WINDOWS = [
  [9, 12],
  [14, 18],
]

export const OFF_PEAK_FACTOR = 0.5

/** Local `YYYY-MM-DD` for an epoch millisecond value. */
export function dayKey(ms) {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Peak is a weekday inside a peak window; weekends are idle all day. */
export function isPeak(ms) {
  const date = new Date(ms)
  const weekday = date.getDay()
  if (weekday === 0 || weekday === 6) return false
  const hour = date.getHours() + date.getMinutes() / 60
  return PEAK_WINDOWS.some(([from, to]) => hour >= from && hour < to)
}

/** Map a model id to a price row, or `null` when the model has no price on file. */
export function priceFor(model) {
  const id = String(model || '').toLowerCase()
  if (!id) return null
  if (id.includes('v4-pro') || id.includes('deepseek-pro')) return PRICES.pro
  if (id.includes('flash')) return PRICES.flash
  return null
}

/**
 * Split a reported usage into the three billed buckets.
 * `inputTokens` excludes cache hits, and cache writes are billed as misses.
 */
export function usageOf(usage) {
  if (!usage || typeof usage !== 'object') return null
  const hit = Number(usage.cacheReadTokens ?? 0) || 0
  const miss = (Number(usage.inputTokens ?? 0) || 0) + (Number(usage.cacheWriteTokens ?? 0) || 0)
  const out = Number(usage.outputTokens ?? 0) || 0
  if (hit + miss + out <= 0) return null
  return { hit, miss, out }
}

/** Cost in CNY for one response at one rate period. */
export function costOf(usage, price, peak) {
  const factor = peak ? 1 : OFF_PEAK_FACTOR
  return ((usage.miss * price.miss + usage.hit * price.hit + usage.out * price.out) / 1_000_000) * factor
}
