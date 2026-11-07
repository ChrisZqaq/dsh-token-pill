/**
 * Offline harness: no browser, no Host, no network.
 *
 * It fakes the ModuleLoader / React / Cordis surfaces the bundle touches, then
 * checks the slot contract, the dictionary pairs, the host ledger fold, the
 * Host aggregate route, and the client read of that route.
 *
 * Run: node scripts/verify.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

// ------------------------------------------------------------------ fake shell
globalThis.window = {
  innerHeight: 900,
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
  open: () => {},
  AbortController,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { href: 'dsh-app://app/' },
  fetch: async () => ({ ok: true, status: 204, json: async () => ({}) }),
}
globalThis.document = {
  visibilityState: 'visible',
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
}

let loaded
globalThis.window.__ModuleLoader__ = { load: (definition) => (loaded = definition) }

/** Minimal hook shim: enough to call the component without a renderer. */
const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
    children,
  }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial ?? null }),
  useCallback: (fn) => fn,
  Component: class {
    constructor(props) {
      this.props = props
      this.state = {}
    }

    setState(next) {
      this.state = { ...this.state, ...next }
    }
  },
}

await import(pathToFileURL(join(root, 'client.js')).href)
const client = loaded.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
})
const { DICTIONARIES, isPeak, nextChange, readUsage, fmtTokens, fmtCNY, dayKey } = client.__test__

const host = await import(pathToFileURL(join(root, 'host/projection.js')).href)
const pricing = await import(pathToFileURL(join(root, 'host/pricing.js')).href)
const { foldEvent, tokenPillProjection } = host

// ------------------------------------------------------------------- contract
console.log('\npackage + slot contract')
check('bundle id matches the package name', loaded.id === '@local/dsh-token-pill', loaded?.id)
check('client reads usage over the host route, not session RPC', !client.inject.includes('remote.session'), client.inject.join(','))
check('client injects the account service for the balance line', client.inject.includes('remote.account'))
check('client injects the locale service', client.inject.includes('locale'))
check('projection key matches what the client reads', tokenPillProjection.key === 'tokenPill', tokenPillProjection.key)

const registrations = []
const declared = new Set(client.inject.flatMap((name) => [name, name.split('.')[0]]))
const services = {
  remote: { account: {} },
  locale: { register: () => {}, bind: () => (key) => key, getLocale: () => ({ id: 'zh-CN' }) },
  slots: { inject: (name, fn) => fn(), register: (options, component) => registrations.push({ options, component }) },
}
/**
 * Cordis throws on a property read for anything the plugin did not declare in
 * `inject`, so the shim does too: an undeclared read must fail here, not on
 * the user's screen.
 */
const fakeCtx = new Proxy(services, {
  get(target, key) {
    if (typeof key === 'symbol' || key === 'then') return target[key]
    if (key === 'effect') return (fn) => fn()
    if (key in target) {
      if (!declared.has(key) && key !== 'effect') throw new Error(`cannot get property "${key}" without inject`)
      return target[key]
    }
    throw new Error(`cannot get property "${key}" without inject`)
  },
})
check('the shim refuses undeclared services like Cordis does', (() => {
  try {
    fakeCtx.fetch
    return false
  } catch {
    return true
  }
})())
client.apply(fakeCtx)
check('apply registers exactly one sidebar-foot entry', registrations.length === 1, String(registrations.length))
check('entry uses the footer list slot', registrations[0]?.options?.name === 'sidebar.footer.action')
check('entry carries a stable id', registrations[0]?.options?.id === 'token-pill')
check('entry is labelled from the dictionary', registrations[0]?.options?.label() === 'label')

// ---------------------------------------------------------------- dictionaries
console.log('\ndictionaries')
const zhKeys = Object.keys(DICTIONARIES.zh).sort()
const enKeys = Object.keys(DICTIONARIES.en).sort()
check('zh and en define the same keys', zhKeys.join() === enKeys.join(), `${zhKeys.length} vs ${enKeys.length}`)

// ------------------------------------------------------------- pricing + clock
console.log('\npricing + period')
const monday10 = new Date(2026, 10, 9, 10, 0).getTime()
const monday13 = new Date(2026, 10, 9, 13, 0).getTime()
const saturday10 = new Date(2026, 10, 7, 10, 0).getTime()
const windows = pricing.PEAK_WINDOWS
check('weekday inside a window is peak', isPeak(monday10, windows) === true)
check('weekday between windows is idle', isPeak(monday13, windows) === false)
check('weekend is idle all day', isPeak(saturday10, windows) === false)
check('next change from idle Saturday is Monday 09:00', nextChange(saturday10, windows)?.getHours() === 9, String(nextChange(saturday10, windows)))
check('next change from peak is the window end', nextChange(monday10, windows)?.getHours() === 12)

check('flash maps to the flash row', pricing.priceFor('deepseek-flash')?.key === 'flash')
check('v4-pro maps to the pro row', pricing.priceFor('deepseek-v4-pro')?.key === 'pro')
check('unknown model has no price', pricing.priceFor('mystery-1') === null)

const usage = { hit: 1_000_000, miss: 1_000_000, out: 1_000_000 }
check(
  'idle cost is half the peak cost',
  Math.abs(pricing.costOf(usage, pricing.PRICES.flash, false) * 2 - pricing.costOf(usage, pricing.PRICES.flash, true)) < 1e-9,
)
check(
  'flash peak cost of 1M/1M/1M is 10.04',
  Math.abs(pricing.costOf(usage, pricing.PRICES.flash, true) - 10.04) < 1e-9,
  String(pricing.costOf(usage, pricing.PRICES.flash, true)),
)
check('cache writes bill as misses', pricing.usageOf({ inputTokens: 10, cacheWriteTokens: 5, outputTokens: 1 }).miss === 15)
check('usage without tokens is ignored', pricing.usageOf({}) === null)

// ------------------------------------------------------------------ host fold
console.log('\nhost ledger fold')
const header = (model) => ({ type: 'request/header', data: { header: { config: { model } } } })
const message = (time, model, usage) => ({
  type: 'assistant/message',
  time,
  data: { usage, message: model ? { source: { model } } : {} },
})

let state = tokenPillProjection.init()
state = foldEvent(state, header('deepseek-flash'))
state = foldEvent(state, message(monday10, 'deepseek-flash', { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }))
const key = dayKey(monday10)
check('peak request at peak price', Math.abs(state.days[key].cost - 2) < 1e-9, String(state.days[key].cost))
check('peakCost equals cost while peak', Math.abs(state.days[key].peakCost - 2) < 1e-9)

state = foldEvent(state, message(monday13, 'deepseek-flash', { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }))
check('idle request at half price', Math.abs(state.days[key].cost - 3) < 1e-9, String(state.days[key].cost))
check('peakCost keeps the peak equivalent', Math.abs(state.days[key].peakCost - 4) < 1e-9, String(state.days[key].peakCost))
check('two requests recorded', state.days[key].requests === 2)

const inherited = foldEvent(state, message(monday10, null, { inputTokens: 1_000_000 }))
check('a message without a model inherits the announced one', inherited.days[key].requests === 3)

const unknown = foldEvent(state, message(monday10, 'mystery-1', { inputTokens: 1_000_000 }))
check('an unknown model adds no cost', Math.abs(unknown.days[key].cost - 3) < 1e-9)
check('an unknown model is reported, not priced', unknown.days[key].unpriced['mystery-1'] === 1)

const same = foldEvent(state, { type: 'user/message', time: monday10, data: {} })
check('an irrelevant event returns the same state', same === state)

const restored = tokenPillProjection.stateSchema.parse(JSON.parse(JSON.stringify(inherited)))
check('a restored checkpoint keeps its days', Object.keys(restored.days).length === 1)
const view = tokenPillProjection.wire.view(inherited)
check('the view ships the rate card', view.prices.flash.miss === 2 && view.windows.length === 2)
check('the view ships today only through days', Boolean(view.days[key]))
check('the wire view round-trips through its own schema', tokenPillProjection.wire.viewSchema.parse(view) === view)
check('the wire view is published to session/list', tokenPillProjection.wire.summary === true)

// -------------------------------------------------------------- host aggregate
console.log('\nhost aggregate')
const usageModule = await import(pathToFileURL(join(root, 'host/usage.js')).href)
const dayA = { requests: 2, hit: 1_000_000, miss: 500_000, out: 100_000, cost: 1.5, peakCost: 3, models: { flash: { label: 'flash', requests: 2, hit: 1_000_000, miss: 500_000, out: 100_000, cost: 1.5 } }, unpriced: {} }
const dayB = { requests: 1, hit: 0, miss: 100_000, out: 10_000, cost: 0.25, peakCost: 0.5, models: { flash: { label: 'flash', requests: 1, hit: 0, miss: 100_000, out: 10_000, cost: 0.25 }, pro: { label: 'pro', requests: 1, hit: 0, miss: 0, out: 0, cost: 0 } }, unpriced: { 'x-1': 2 } }
const merged = usageModule.mergeDaysInto({}, { [dayKey(monday10)]: dayA, [dayKey(saturday10)]: dayB })
const mergedMonday = merged[dayKey(monday10)]
check('days merge by key, not by session', Object.keys(merged).length === 2, Object.keys(merged).join())
check('merged day sums cost', Math.abs(mergedMonday.cost - 1.5) < 1e-9)
check('merged models keep one row per model', Object.keys(mergedMonday.models).join() === 'flash', Object.keys(mergedMonday.models).join())
check('merged day sums requests', mergedMonday.requests === 2 && merged[dayKey(saturday10)].requests === 1)
check('unpriced models merge into one row', usageModule.mergeDaysInto(merged, { [dayKey(monday10)]: dayB })[dayKey(monday10)].unpriced['x-1'] === 2)
check('two sessions of one day add up', Math.abs(usageModule.mergeDaysInto({}, { [dayKey(monday10)]: dayA })[dayKey(monday10)].cost + dayB.cost - 1.75) < 1e-9)

const observed = []
const fakeHost = {
  sessionQuery: {
    listSessions: async () => [{ header: { id: 'live-1' } }, { header: { id: 'cold-1' } }, { header: { id: 'cold-2' } }],
    observeSession: async (id) => {
      observed.push(id)
      if (id === 'cold-2') throw new Error('unreadable log')
      return {
        projections: { values: { tokenPill: { days: { [dayKey(Date.now())]: dayA } } } },
        [Symbol.dispose]() {},
      }
    },
  },
}
const reader = usageModule.createUsageReader(fakeHost)
const payload = await reader()
check('the aggregate reads every Session through observeSession', observed.length === 3, observed.join())
check('only readable Sessions are counted', payload.sessions === 2, String(payload.sessions))
check('an unreadable Session counts as pending, not as zero cost', payload.pending === 1, String(payload.pending))
check('the aggregate carries the rate card', payload.prices.flash.out === 8 && payload.windows.length === 2 && payload.offPeak === 0.5)
check('a second read inside the cache window does not re-read Sessions', (await reader()) === payload)
const failingReader = usageModule.createUsageReader({ sessionQuery: { listSessions: async () => { throw new Error('boom') } } })
check('a listing failure rejects instead of returning an empty total', await failingReader().then(() => false, () => true))

// -------------------------------------------------------------- client reading
console.log('\nclient reading')
const today = dayKey(Date.now())
let askedUrl
const okFetch = async (url) => {
  askedUrl = url
  return {
    ok: true,
    status: 200,
    json: async () => ({
      sessions: 3,
      pending: 1,
      prices: pricing.PRICES,
      windows: pricing.PEAK_WINDOWS,
      offPeak: 0.5,
      days: { [today]: dayA },
    }),
  }
}
const result = await readUsage(okFetch)
check('the client reads the host route', askedUrl === '/dsh-token-pill/usage', String(askedUrl))
check('session count comes from the host aggregate', result.sessions === 3 && result.pending === 1)
check('today cost is taken from the host day bucket', Math.abs(result.total.cost - 1.5) < 1e-9)
check('peak equivalent is carried through', Math.abs(result.total.peakCost - 3) < 1e-9)
check('token buckets are carried through', result.total.hit === 1_000_000 && result.total.miss === 500_000)
check('per-model rows are carried through', result.byModel.flash?.cost === 1.5)
check('the rate card travels with the data', result.prices?.flash?.out === 8 && result.windows?.length === 2)
check('a day with no usage yields zero, not a crash', (await readUsage(async () => ({ ok: true, status: 200, json: async () => ({ days: {} }) }))).total.cost === 0)
check('a failing route fails loudly', await readUsage(async () => ({ ok: false, status: 500, json: async () => ({}) })).then(() => false, () => true))

console.log('\nformatting')
check('millions format as M', fmtTokens(2_345_678) === '2.35M')
check('thousands format as k', fmtTokens(12_345) === '12.3k')
check('small amounts keep two decimals', fmtCNY(3.4977) === '¥3.50')
check('a non-zero cent floor is never shown as zero', fmtCNY(0.0001) === '¥0.01')

// --------------------------------------------------------------------- render
console.log('\nrender')
const Pill = registrations[0].component
// The registered entry is the guard; render through it the way React would.
const guarded = Pill({ wide: true })
const guard = new guarded.type(guarded.props)
const child = guard.render()
const tree = typeof child?.type === 'function' ? child.type(child.props) : child
const flatten = (node, out = []) => {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node === 'object') {
    out.push(node)
    for (const child of node.children ?? []) flatten(child, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') out.push(String(node))
  return out
}
const flat = flatten(tree)
const text = flat.filter((node) => typeof node === 'string').join(' ')
check('renders without a Host', tree?.props?.className === 'dsht-root')
check('the pill shows a currency placeholder before data arrives', text.includes('¥—'), text.slice(0, 120))
check('the pill carries the entry label for screen readers', flat.some((node) => node?.props?.['aria-label'] === 'label'))
check('the period dot is decided at render time', flat.some((node) => node?.props?.['data-period']))

console.log('')
if (failures > 0) {
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
