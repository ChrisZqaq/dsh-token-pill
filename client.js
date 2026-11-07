window.__ModuleLoader__.load({
  id: '@local/dsh-token-pill',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Dictionary namespace; also used as the slot locale seat. */
    const NS = 'token-pill'
    /** List slot in the sidebar foot; the pill renders above the Settings row. */
    const SLOT = 'sidebar.footer.action'
    const ENTRY_ID = 'token-pill'
    /** Projection key registered by the host half. */
    const PROJECTION = 'tokenPill'

    const REFRESH_MS = 60_000
    const STALE_MS = 20_000
    const HOVER_CLOSE_MS = 140
    const TICK_MS = 30_000
    const USAGE_URL = 'https://platform.deepseek.com/usage'

    /** Peak windows used only until the host view supplies the real ones. */
    const FALLBACK_WINDOWS = [
      [9, 12],
      [14, 18],
    ]
    const FALLBACK_OFF_PEAK = 0.5

    const DICTIONARIES = {
      en: {
        label: 'Today’s DeepSeek spend',
        today: 'Today',
        peak: 'Peak',
        offpeak: 'Idle',
        halfPrice: 'half price',
        peakEquiv: 'At peak, {value}',
        input: 'Input',
        output: 'Output',
        cached: '{share} cached · {miss} new',
        nextChange: 'Next change',
        inDays: '{d}d {h}h',
        inHours: '{h}h {m}m',
        inMinutes: '{m}m',
        atTime: '→ {day} {clock} {period} (×{factor})',
        priceTitle: 'Current rate',
        perMillion: 'CNY / million tokens',
        model: 'Model',
        hit: 'Cached',
        miss: 'Input',
        out: 'Output',
        detail: 'Details',
        hide: 'Collapse',
        openUsage: 'Open usage page',
        balance: 'Balance',
        requests: 'Requests',
        byModel: 'By model',
        hitRate: 'Cache hit rate',
        unpriced: 'No price on file: {models}',
        unpricedNote: 'Those tokens are left out of the total.',
        empty: 'No DeepSeek usage today yet',
        loading: 'Reading sessions…',
        sessions: '{n} sessions',
        pending: '{n} sessions still indexing',
        failed: 'Could not read session usage',
      },
      zh: {
        label: '今日 DeepSeek 花费',
        today: '今日',
        peak: '高峰',
        offpeak: '空闲',
        halfPrice: '半价',
        peakEquiv: '同量高峰价 {value}',
        input: '输入',
        output: '输出',
        cached: '缓存命中 {share} · 新增 {miss}',
        nextChange: '下次变价',
        inDays: '{d} 天 {h} 小时',
        inHours: '{h} 小时 {m} 分',
        inMinutes: '{m} 分',
        atTime: '→ {day} {clock} 转{period}（×{factor}）',
        priceTitle: '当前价目',
        perMillion: '元 / 百万 tokens',
        model: '模型',
        hit: '命中',
        miss: '未命中',
        out: '输出',
        detail: '查看明细',
        hide: '收起',
        openUsage: '打开官方用量页',
        balance: '余额',
        requests: '请求',
        byModel: '按模型',
        hitRate: '缓存命中率',
        unpriced: '无价目：{models}',
        unpricedNote: '这些 token 未计入合计。',
        empty: '今天还没有 DeepSeek 用量',
        loading: '正在读取会话…',
        sessions: '{n} 个会话',
        pending: '{n} 个会话尚未就绪',
        failed: '读取会话用量失败',
      },
    }

    // ---------------------------------------------------------------- helpers

    function dayKey(ms) {
      const date = new Date(ms)
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${date.getFullYear()}-${month}-${day}`
    }

    function isPeak(ms, windows) {
      const date = new Date(ms)
      const weekday = date.getDay()
      if (weekday === 0 || weekday === 6) return false
      const hour = date.getHours() + date.getMinutes() / 60
      return windows.some(([from, to]) => hour >= from && hour < to)
    }

    /** First instant after `now` whose period differs from the period at `now`. */
    function nextChange(now, windows) {
      const current = isPeak(now, windows)
      const midnight = new Date(now)
      midnight.setHours(0, 0, 0, 0)
      for (let day = 0; day < 10; day += 1) {
        const base = midnight.getTime() + day * 86_400_000
        for (const hour of [0, 9, 12, 14, 18]) {
          const at = new Date(base + hour * 3_600_000)
          if (at.getTime() <= now) continue
          if (isPeak(at.getTime(), windows) !== current) return at
        }
      }
      return null
    }

    function fmtTokens(value) {
      const n = Number(value) || 0
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
      return String(Math.round(n))
    }

    function fmtCNY(value) {
      const n = Number(value) || 0
      if (n > 0 && n < 0.01) return '¥0.01'
      return `¥${n.toFixed(2)}`
    }

    function fmtDuration(ms, t) {
      const total = Math.max(0, Math.round(ms / 60_000))
      const days = Math.floor(total / 1440)
      const hours = Math.floor((total % 1440) / 60)
      const minutes = total % 60
      if (days > 0) return t('inDays', { d: days, h: hours })
      if (hours > 0) return t('inHours', { h: hours, m: minutes })
      return t('inMinutes', { m: minutes })
    }

    function fmtClock(date) {
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }

    function formatDay(date, locale) {
      try {
        return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short' }).format(date)
      } catch {
        return `${date.getMonth() + 1}/${date.getDate()}`
      }
    }

    function weekdayName(date, locale) {
      try {
        return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
      } catch {
        return ''
      }
    }

    // ----------------------------------------------------------------- reading

    function emptyBucket() {
      return { cost: 0, peakCost: 0, hit: 0, miss: 0, out: 0, requests: 0 }
    }

    /** RPC answers arrive wrapped as `{ ok, value }`; peel the envelope. */
    function unwrap(value) {
      let current = value
      for (let depth = 0; depth < 3; depth += 1) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) break
        const inner = current.value ?? current.data ?? current.result
        if (inner === undefined || inner === null || typeof inner !== 'object') break
        current = inner
      }
      return current
    }

    function listRows(input) {
      const value = unwrap(input)
      if (Array.isArray(value)) return value
      if (!value || typeof value !== 'object') return []
      for (const key of ['items', 'rows', 'sessions']) {
        if (Array.isArray(value[key])) return value[key]
      }
      const firstArray = Object.values(value).find((entry) => Array.isArray(entry))
      return firstArray ?? []
    }

    function withTimeout(promise, ms, label) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        Promise.resolve(promise).then(
          (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          (error) => {
            clearTimeout(timer)
            reject(error)
          },
        )
      })
    }

    function mergeDay(result, day) {
      const total = result.total
      total.cost += Number(day.cost) || 0
      total.peakCost += Number(day.peakCost) || 0
      total.hit += Number(day.hit) || 0
      total.miss += Number(day.miss) || 0
      total.out += Number(day.out) || 0
      total.requests += Number(day.requests) || 0
      for (const [key, bucket] of Object.entries(day.models ?? {})) {
        const target = (result.byModel[key] ??= { label: bucket.label ?? key, hit: 0, miss: 0, out: 0, cost: 0, requests: 0 })
        target.hit += Number(bucket.hit) || 0
        target.miss += Number(bucket.miss) || 0
        target.out += Number(bucket.out) || 0
        target.cost += Number(bucket.cost) || 0
        target.requests += Number(bucket.requests) || 0
      }
      for (const [key, count] of Object.entries(day.unpriced ?? {})) {
        result.unpriced[key] = (result.unpriced[key] ?? 0) + (Number(count) || 0)
      }
    }

    /**
     * Every Session carries the host projection, so today's spend is the sum of
     * the per-day ledgers — no transcript replay, and no ceiling on history.
     */
    async function readUsage(remote, signal) {
      const session = remote?.session
      if (!session?.list) throw new Error('session service unavailable')
      const rows = listRows(await withTimeout(session.list({}, signal), 8_000, 'session.list'))
      const today = dayKey(Date.now())
      const result = {
        day: today,
        total: emptyBucket(),
        byModel: {},
        unpriced: {},
        sessions: 0,
        pending: 0,
        prices: null,
        windows: null,
        offPeak: FALLBACK_OFF_PEAK,
      }
      for (const row of rows) {
        const view = row?.projections?.values?.[PROJECTION]
        if (!view) {
          result.pending += 1
          continue
        }
        result.sessions += 1
        result.prices ??= view.prices ?? null
        if (Array.isArray(view.windows) && view.windows.length > 0) result.windows ??= view.windows
        if (typeof view.offPeak === 'number') result.offPeak = view.offPeak
        const day = view.days?.[today]
        if (day) mergeDay(result, day)
      }
      return result
    }

    // ---------------------------------------------------------------- styling

    const CSS = `
.dsht-root{position:relative;display:flex;align-items:center;min-width:0}
.dsht-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;box-sizing:border-box;
  border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;cursor:pointer;
  transition:background .12s ease,border-color .12s ease}
.dsht-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsht-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsht-pill[data-pinned='yes']{border-color:var(--dsw-alias-border-l3)}
.dsht-rail{width:28px;padding:0;justify-content:center}
.dsht-pill[data-error='yes'] .dsht-dot{background:var(--dsw-alias-state-error-primary)}
.dsht-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}
.dsht-dot[data-period='off']{background:var(--dsw-alias-state-success-primary)}
.dsht-dot[data-period='peak']{background:var(--dsw-alias-state-warn-primary)}
.dsht-name{color:var(--dsw-alias-label-secondary)}
.dsht-sep{color:var(--dsw-alias-label-tertiary)}
.dsht-cost{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.dsht-muted{color:var(--dsw-alias-label-tertiary)}

.dsht-card{position:fixed;z-index:60;width:304px;padding:14px 14px 12px;box-sizing:border-box;
  border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 12px 32px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.dsht-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;
  color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsht-title{display:flex;align-items:center;gap:8px;margin-top:4px}
.dsht-amount{font-size:24px;line-height:30px;font-weight:600;font-variant-numeric:tabular-nums}
.dsht-chip{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;box-sizing:border-box;
  border-radius:999px;font-size:11px;border:1px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-secondary)}
.dsht-chip[data-period='off']{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dsht-chip[data-period='peak']{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dsht-rule{height:1px;background:var(--dsw-alias-border-l1);margin:10px 0}
.dsht-row{display:flex;align-items:baseline;gap:8px;margin:3px 0}
.dsht-row-label{width:34px;flex:none;color:var(--dsw-alias-label-secondary)}
.dsht-row-value{font-variant-numeric:tabular-nums}
.dsht-row-note{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:11px;text-align:right}
.dsht-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.dsht-table th{font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:11px;text-align:right;padding:1px 0}
.dsht-table th:first-child,.dsht-table td:first-child{text-align:left}
.dsht-table td{padding:1px 0;text-align:right;color:var(--dsw-alias-label-primary)}
.dsht-table tr[data-idle='yes'] td{color:var(--dsw-alias-label-secondary)}
.dsht-foot{display:flex;align-items:center;gap:6px;margin-top:10px}
.dsht-btn{flex:1;height:26px;padding:0 8px;box-sizing:border-box;border-radius:7px;cursor:pointer;
  background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);
  font:inherit;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsht-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsht-btn[data-primary='yes']{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}
.dsht-detail{margin-top:10px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}
.dsht-detail-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:3px 0}
.dsht-badge{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsht-warn{margin-top:6px;color:var(--dsw-alias-state-warn-primary);font-size:11px}
`.trim()

    // -------------------------------------------------------------- component

    function makeTokenPill(ctx) {
      return function TokenPill(props) {
        const wide = props?.wide !== false
        const [data, setData] = useState(null)
        const [error, setError] = useState(null)
        const [loading, setLoading] = useState(true)
        const [open, setOpen] = useState(false)
        const [pinned, setPinned] = useState(false)
        const [now, setNow] = useState(() => Date.now())
        const [balance, setBalance] = useState(null)
        const [usageUrl, setUsageUrl] = useState(null)
        const [position, setPosition] = useState(null)

        const anchorRef = useRef(null)
        const closeTimer = useRef(0)
        const dataAt = useRef(0)

        const load = useCallback(
          async (options) => {
            try {
              const value = await readUsage(ctx.remote, options?.signal)
              setData(value)
              setError(null)
              dataAt.current = Date.now()
            } catch (cause) {
              if (cause && cause.name === 'AbortError') return
              setError(cause instanceof Error ? cause.message : String(cause))
            } finally {
              setLoading(false)
            }
          },
          [ctx],
        )

        useEffect(() => {
          const controller = new window.AbortController()
          void load({ signal: controller.signal })
          const refresh = window.setInterval(() => {
            if (document.visibilityState === 'hidden') return
            void load({})
          }, REFRESH_MS)
          const tick = window.setInterval(() => setNow(Date.now()), TICK_MS)
          return () => {
            controller.abort()
            window.clearInterval(refresh)
            window.clearInterval(tick)
          }
        }, [load])

        useEffect(() => {
          if (!open) return undefined
          const onKey = (event) => {
            if (event.key !== 'Escape') return
            setPinned(false)
            setOpen(false)
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [open])

        useEffect(() => {
          if (!open) return undefined
          const onDown = (event) => {
            const card = document.querySelector('.dsht-card')
            if (anchorRef.current?.contains(event.target)) return
            if (card?.contains(event.target)) return
            setPinned(false)
            setOpen(false)
          }
          document.addEventListener('mousedown', onDown, true)
          return () => document.removeEventListener('mousedown', onDown, true)
        }, [open])

        const measure = useCallback(() => {
          const anchor = anchorRef.current?.getBoundingClientRect()
          if (!anchor) return
          setPosition({ left: anchor.left, bottom: Math.max(8, window.innerHeight - anchor.top + 8) })
        }, [])

        const loadAccount = useCallback(async () => {
          const remote = ctx.remote
          if (!remote?.account) return
          const meta = {
            version: '1.0.0',
            locale: ctx.locale.getLocale?.()?.id ?? 'zh-CN',
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
          }
          try {
            const state = await remote.account.getState()
            const url = state?.links?.usageUrl
            if (typeof url === 'string') setUsageUrl(url)
          } catch {
            /* the button falls back to the public usage page */
          }
          try {
            const result = await remote.account.getBalance(meta)
            const wallets = result?.status === 'ready' ? result.value : null
            const wallet = Array.isArray(wallets) ? wallets.find((item) => item.currency === 'CNY') ?? wallets[0] : null
            if (wallet) setBalance({ currency: wallet.currency, value: Number(wallet.balance) })
          } catch {
            /* balance is optional chrome */
          }
        }, [ctx])

        const openCard = useCallback(() => {
          window.clearTimeout(closeTimer.current)
          measure()
          setOpen(true)
          void loadAccount()
          if (Date.now() - dataAt.current > STALE_MS) void load({})
        }, [load, loadAccount, measure])

        const scheduleClose = useCallback(() => {
          window.clearTimeout(closeTimer.current)
          closeTimer.current = window.setTimeout(() => {
            if (!pinned) setOpen(false)
          }, HOVER_CLOSE_MS)
        }, [pinned])

        useEffect(() => {
          if (!pinned) return undefined
          measure()
          const id = window.setInterval(measure, 1_000)
          window.addEventListener('resize', measure)
          return () => {
            window.clearInterval(id)
            window.removeEventListener('resize', measure)
          }
        }, [pinned, measure])

        useEffect(() => () => window.clearTimeout(closeTimer.current), [])

        const translate = ctx.locale.bind(NS)
        const localeId = ctx.locale.getLocale?.()?.id ?? 'zh-CN'
        const windows = data?.windows ?? FALLBACK_WINDOWS
        const offPeak = data?.offPeak ?? FALLBACK_OFF_PEAK
        const peak = isPeak(now, windows)
        const next = nextChange(now, windows)
        const total = data?.total ?? emptyBucket()
        const models = Object.values(data?.byModel ?? {}).sort((a, b) => b.cost - a.cost)
        const unpriced = Object.keys(data?.unpriced ?? {})
        const tokenSum = total.hit + total.miss + total.out
        const hitShare = tokenSum > 0 ? (total.hit / tokenSum) * 100 : 0
        const today = new Date(now)

        const priceTable = (priceList, factor) =>
          h(
            'table',
            { className: 'dsht-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', null, translate('model')),
                h('th', null, translate('hit')),
                h('th', null, translate('miss')),
                h('th', null, translate('out')),
              ),
            ),
            h(
              'tbody',
              null,
              priceList.map((price) =>
                h(
                  'tr',
                  { key: price.key, 'data-idle': peak ? 'no' : 'yes' },
                  h('td', null, price.label),
                  h('td', null, (price.hit * factor).toFixed(2)),
                  h('td', null, (price.miss * factor).toFixed(2)),
                  h('td', null, (price.out * factor).toFixed(2)),
                ),
              ),
            ),
          )

        const detailSection = () =>
          h(
            'div',
            { className: 'dsht-detail' },
            h('div', { className: 'dsht-badge' }, translate('byModel')),
            models.length === 0
              ? h('div', { className: 'dsht-muted' }, translate('empty'))
              : models.map((bucket) =>
                  h(
                    'div',
                    { className: 'dsht-detail-row', key: bucket.label },
                    h(
                      'span',
                      null,
                      bucket.label,
                      h('span', { className: 'dsht-badge' }, ` · ${fmtTokens(bucket.hit + bucket.miss + bucket.out)}`),
                    ),
                    h('span', { className: 'dsht-cost' }, fmtCNY(bucket.cost)),
                  ),
                ),
            h(
              'div',
              { className: 'dsht-detail-row' },
              h('span', { className: 'dsht-badge' }, translate('requests')),
              h('span', null, String(total.requests)),
            ),
            h(
              'div',
              { className: 'dsht-detail-row' },
              h('span', { className: 'dsht-badge' }, translate('hitRate')),
              h('span', null, `${hitShare.toFixed(1)}%`),
            ),
            h(
              'div',
              { className: 'dsht-foot' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsht-btn',
                  onClick: () => window.open(usageUrl ?? USAGE_URL, '_blank', 'noopener,noreferrer'),
                },
                translate('openUsage'),
              ),
            ),
            unpriced.length > 0
              ? h(
                  'div',
                  { className: 'dsht-warn' },
                  translate('unpriced', { models: unpriced.join(', ') }),
                  h('br'),
                  translate('unpricedNote'),
                )
              : null,
            error ? h('div', { className: 'dsht-warn' }, `${translate('failed')}: ${error}`) : null,
            balance ? h('div', { className: 'dsht-badge' }, `${translate('balance')} ¥${balance.value.toFixed(2)}`) : null,
          )

        const card =
          open && position
            ? h(
                'div',
                {
                  className: 'dsht-card',
                  style: { left: `${position.left}px`, bottom: `${position.bottom}px` },
                  onMouseEnter: () => window.clearTimeout(closeTimer.current),
                  onMouseLeave: scheduleClose,
                },
                h(
                  'div',
                  { className: 'dsht-head' },
                  h('span', null, translate('today')),
                  h('span', null, formatDay(today, localeId)),
                ),
                h(
                  'div',
                  { className: 'dsht-title' },
                  h('span', { className: 'dsht-amount' }, fmtCNY(total.cost)),
                  h(
                    'span',
                    { className: 'dsht-chip', 'data-period': peak ? 'peak' : 'off' },
                    h('span', { className: 'dsht-dot', 'data-period': peak ? 'peak' : 'off' }),
                    peak ? translate('peak') : translate('offpeak'),
                    peak ? '' : ` · ${translate('halfPrice')}`,
                  ),
                  h('span', { className: 'dsht-row-note' }, translate('peakEquiv', { value: fmtCNY(total.peakCost) })),
                ),
                h('div', { className: 'dsht-rule' }),
                h(
                  'div',
                  { className: 'dsht-row' },
                  h('span', { className: 'dsht-row-label' }, translate('input')),
                  h('span', { className: 'dsht-row-value' }, fmtTokens(total.hit + total.miss)),
                  h(
                    'span',
                    { className: 'dsht-row-note' },
                    translate('cached', {
                      share: `${hitShare.toFixed(1)}%`,
                      miss: fmtTokens(total.miss),
                    }),
                  ),
                ),
                h(
                  'div',
                  { className: 'dsht-row' },
                  h('span', { className: 'dsht-row-label' }, translate('output')),
                  h('span', { className: 'dsht-row-value' }, fmtTokens(total.out)),
                  h('span', { className: 'dsht-row-note' }, data ? translate('sessions', { n: data.sessions }) : ''),
                ),
                h('div', { className: 'dsht-rule' }),
                h(
                  'div',
                  { className: 'dsht-row' },
                  h('span', { className: 'dsht-row-label' }, translate('nextChange')),
                  h('span', { className: 'dsht-row-value' }, next ? fmtDuration(next.getTime() - now, translate) : '—'),
                  h(
                    'span',
                    { className: 'dsht-row-note' },
                    next
                      ? translate('atTime', {
                          day: weekdayName(next, localeId),
                          clock: fmtClock(next),
                          period: isPeak(next.getTime(), windows) ? translate('peak') : translate('offpeak'),
                          factor: isPeak(next.getTime(), windows) ? '1' : String(offPeak),
                        })
                      : '',
                  ),
                ),
                h('div', { className: 'dsht-rule' }),
                h(
                  'div',
                  { className: 'dsht-head' },
                  h('span', null, translate('priceTitle')),
                  h('span', null, translate('perMillion')),
                ),
                h(
                  'div',
                  { style: { marginTop: '4px' } },
                  priceTable(Object.values(data?.prices ?? {}), peak ? 1 : offPeak),
                ),
                data?.pending > 0 ? h('div', { className: 'dsht-badge' }, translate('pending', { n: data.pending })) : null,
                pinned ? detailSection() : null,
                h(
                  'div',
                  { className: 'dsht-foot' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsht-btn',
                      'data-primary': 'yes',
                      onClick: () => {
                        setPinned((value) => !value)
                        setOpen(true)
                      },
                    },
                    pinned ? translate('hide') : translate('detail'),
                  ),
                ),
                loading ? h('div', { className: 'dsht-badge' }, translate('loading')) : null,
              )
            : null

        const pill = h(
          'button',
          {
            type: 'button',
            className: wide ? 'dsht-pill' : 'dsht-pill dsht-rail',
            'data-pinned': pinned ? 'yes' : 'no',
            'data-error': error ? 'yes' : 'no',
            'aria-label': translate('label'),
            onMouseEnter: openCard,
            onMouseLeave: scheduleClose,
            onFocus: openCard,
            onBlur: scheduleClose,
            onClick: (event) => {
              event.preventDefault()
              if (open && !pinned) {
                setPinned(true)
                return
              }
              if (pinned) {
                setPinned(false)
                setOpen(false)
                return
              }
              openCard()
            },
          },
          h('span', { className: 'dsht-dot', 'data-period': peak ? 'peak' : 'off' }),
          wide
            ? h(
                'span',
                null,
                h('span', { className: 'dsht-name' }, peak ? translate('peak') : translate('offpeak')),
                h('span', { className: 'dsht-sep' }, ' · '),
                h('span', { className: 'dsht-cost' }, data ? fmtCNY(total.cost) : '¥—'),
              )
            : null,
        )

        return h('div', { className: 'dsht-root', ref: anchorRef }, h('style', null, CSS), pill, card)
      }
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.session', 'remote.account'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'token-pill dictionaries')
        const TokenPill = makeTokenPill(ctx)
        ctx.slots.inject(SLOT, () =>
          ctx.slots.register(
            { name: SLOT, id: ENTRY_ID, order: 20, locale: NS, label: () => ctx.locale.bind(NS)('label') },
            TokenPill,
          ),
        )
      },
      /** Pure helpers the offline harness exercises without a Host. */
      __test__: {
        DICTIONARIES,
        isPeak,
        nextChange,
        readUsage,
        mergeDay,
        emptyBucket,
        listRows,
        unwrap,
        fmtTokens,
        fmtCNY,
        fmtDuration,
        dayKey,
      },
    }
  },
})
