import { Link } from 'react-router-dom'
import {
  Search, UserPlus, PackagePlus, ShoppingBag, BarChart3, Banknote, QrCode, CreditCard, Wallet, Landmark, User, Users, Trophy, Crown,
  BellRing, PackageX, AlertTriangle, CheckCircle2, ArrowRight, TrendingUp, TrendingDown, Gauge, PiggyBank, HandCoins, CalendarClock,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useBusinessIcons, CategoryIcon } from '../lib/businessIcons'
import { Spinner, useFetch } from '../components/ui'
import DashboardSpotlight from '../components/DashboardSpotlight'
import { money } from '../lib/format'

// ─────────────── Greeting ───────────────

const SCATTER = [
  { right: '5%', top: '18%', size: 'size-12', rotate: '-12deg', o: 'opacity-25' },
  { right: '17%', top: '55%', size: 'size-9', rotate: '10deg', o: 'opacity-20' },
  { right: '29%', top: '14%', size: 'size-7', rotate: '18deg', o: 'opacity-15' },
  { right: '40%', top: '58%', size: 'size-6', rotate: '-8deg', o: 'opacity-15' },
  { right: '1%', top: '62%', size: 'size-8', rotate: '22deg', o: 'opacity-20' },
]

function Greeting({ name }) {
  const { business } = useAuth()
  const bi = useBusinessIcons()
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <section className="relative overflow-hidden rounded-2xl bg-brand px-5 py-4 text-brand-fg">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden sm:block">
        {SCATTER.map((pos, i) => {
          const Icon = bi.hero[i % bi.hero.length]
          return <Icon key={i} className={`absolute ${pos.size} ${pos.o}`} style={{ right: pos.right, top: pos.top, transform: `rotate(${pos.rotate})` }} strokeWidth={1.5} />
        })}
      </div>
      <div className="relative flex items-center gap-3.5">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25"><bi.brand className="size-7" strokeWidth={1.75} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">{hello}, {name}</h1>
          <p className="text-sm opacity-85">{business.name} · {today}</p>
        </div>
      </div>
    </section>
  )
}

// ─────────────── Today at a glance (four picture cards) ───────────────
// One headline sentence, then four equal cards - each tells one thing with one picture:
// a speedometer (how the day is going), a money jar (how people paid), a crowd (who came), a podium (what sold).

function GlanceCard({ icon: Icon, title, tint, children, value, caption }) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 transition hover:shadow-md">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg" style={{ background: `${tint}1f`, color: tint }}><Icon className="size-4.5" /></span>
        <h3 className="text-[0.9375rem] font-bold text-slate-800">{title}</h3>
      </div>
      <div className="flex h-28 items-center justify-center py-2 sm:h-36">{children}</div>
      <div className="mt-auto border-t border-slate-100 pt-2.5 text-center">
        <div className="text-xl font-extrabold tracking-tight text-slate-900">{value}</div>
        <div className="text-sm text-slate-600">{caption}</div>
      </div>
    </div>
  )
}

// Speedometer: needle shows today against a usual day (100% mark), scale runs to 150%.
function Speedometer({ pct }) {
  const f = Math.min(pct / 1.5, 1)
  const point = (fr, r) => { const a = Math.PI * (1 - fr); return [100 + r * Math.cos(a), 100 - r * Math.sin(a)] }
  const [ix, iy] = point(2 / 3, 70)
  const [tx, ty] = point(2 / 3, 98)
  const arc = 'M20 100 A80 80 0 0 1 180 100'
  return (
    <svg viewBox="0 0 200 118" className="h-full w-full max-w-56" role="img" aria-label={`${Math.round(pct * 100)}% of a usual day`}>
      <path d={arc} fill="none" stroke="#e2e8f0" strokeWidth="16" strokeLinecap="round" />
      {f > 0 && (
        <path d={arc} fill="none" stroke="var(--brand)" strokeWidth="16" strokeLinecap="round" pathLength="100"
          strokeDasharray={`${f * 100} 100`} className="transition-[stroke-dasharray] duration-700" />
      )}
      <line x1={ix} y1={iy} x2={tx} y2={ty} stroke="#0f172a" strokeWidth="3" strokeLinecap="round" />
      <text x={tx + 4} y={ty - 2} fontSize="11" fontWeight="700" fill="#334155">usual</text>
      <g style={{ transform: `rotate(${f * 180 - 90}deg)`, transformOrigin: '100px 100px' }} className="transition-transform duration-700">
        <path d="M100 34 L105 100 L95 100 Z" fill="#0f172a" />
      </g>
      <circle cx="100" cy="100" r="9" fill="#0f172a" />
      <circle cx="100" cy="100" r="3.5" fill="white" />
    </svg>
  )
}

const PAY = { CASH: [Banknote, '#1baf7a', 'Cash'], UPI: [QrCode, '#2a78d6', 'UPI'], CARD: [CreditCard, '#eb6834', 'Card'], BANK: [Landmark, '#4a3aa7', 'Bank'], ONLINE: [Wallet, '#e87ba4', 'Online'] }
const payMeta = (m) => PAY[m] || [Wallet, '#94a3b8', m]

// Money jar: filled in layers, one colour per way of paying; legend beside it.
function MoneyJar({ payments, currency }) {
  const total = payments.reduce((s, p) => s + p.amount, 0)
  const body = 'M30 34 h60 q12 0 12 12 v72 q0 14 -14 14 h-56 q-14 0 -14 -14 v-72 q0 -12 12 -12 z'
  const fillH = total ? 86 : 0
  // stack layers from the jar's bottom (y=132) upwards
  const layers = payments.reduce((acc, p) => {
    const h = (p.amount / total) * fillH
    const top = (acc.length ? acc[acc.length - 1].y : 132) - h
    return [...acc, { method: p.method, y: top, h }]
  }, [])
  return (
    <div className="flex h-full items-center gap-3">
      <svg viewBox="0 0 120 140" className="h-full shrink-0" role="img" aria-label="Money received by payment type">
        <defs><clipPath id="jar-clip"><path d={body} /></clipPath></defs>
        <rect x="32" y="16" width="56" height="14" rx="4" fill="var(--brand-2)" />
        <rect x="36" y="28" width="48" height="7" rx="2" fill="#cbd5e1" />
        <g clipPath="url(#jar-clip)">
          <rect x="0" y="0" width="120" height="140" fill="#f8fafc" />
          {layers.map((l) => <rect key={l.method} x="0" y={l.y} width="120" height={l.h + 0.5} fill={payMeta(l.method)[1]} />)}
        </g>
        <path d={body} fill="none" stroke="#94a3b8" strokeWidth="3" />
        <rect x="26" y="48" width="6" height="56" rx="3" fill="white" opacity="0.45" />
      </svg>
      {total ? (
        <ul className="space-y-1.5">
          {payments.map((p) => {
            const [Icon, color, label] = payMeta(p.method)
            return (
              <li key={p.method} className="flex items-center gap-1.5 text-sm">
                <Icon className="size-4 shrink-0" style={{ color }} />
                <span className="text-slate-600">{label}</span>
                <b className="text-slate-900">{money(p.amount, currency, { decimals: 0 })}</b>
              </li>
            )
          })}
        </ul>
      ) : <p className="max-w-32 text-sm text-slate-600">Fills up as payments come in</p>}
    </div>
  )
}

// Crowd: a little figure for each visit - green for new faces, purple for returning ones.
function Crowd({ customers }) {
  const MAX = 15
  const figures = [...Array(customers.new).fill('new'), ...Array(customers.repeat).fill('repeat')]
  if (!figures.length) return <div className="flex flex-col items-center gap-1 text-sm text-slate-600"><Users className="size-12 text-slate-300" />No visits yet</div>
  return (
    <div className="flex max-w-56 flex-wrap items-end justify-center gap-0.5" role="img" aria-label={`${customers.new} new and ${customers.repeat} returning`}>
      {figures.slice(0, MAX).map((kind, i) => (
        <User key={i} className={`size-8 ${kind === 'new' ? 'fill-emerald-200 text-emerald-600' : 'fill-violet-200 text-violet-600'}`} strokeWidth={2} />
      ))}
      {figures.length > MAX && <span className="ml-1 self-center rounded-full bg-slate-100 px-2 py-0.5 text-sm font-bold text-slate-700">+{figures.length - MAX}</span>}
    </div>
  )
}

// Podium: today's top three by value, gold in the middle.
const PODIUM = [
  { rank: 2, h: 'h-12', block: 'bg-slate-300', ring: 'ring-slate-300' },
  { rank: 1, h: 'h-18', block: 'bg-amber-400', ring: 'ring-amber-400' },
  { rank: 3, h: 'h-8', block: 'bg-orange-300', ring: 'ring-orange-300' },
]
function Podium({ top }) {
  if (!top.length) return <div className="flex flex-col items-center gap-1 text-sm text-slate-600"><Trophy className="size-12 text-slate-300" />No sales yet</div>
  return (
    <div className="flex w-full max-w-60 items-end justify-center gap-1.5">
      {PODIUM.map(({ rank, h, block, ring }) => {
        const p = top[rank - 1]
        return (
          <div key={rank} className="flex min-w-0 flex-1 flex-col items-center">
            {p && (
              <>
                <span className={`flex size-9 items-center justify-center rounded-full bg-white text-slate-700 ring-2 ${ring}`} title={p.name}>
                  {rank === 1 ? <Crown className="size-5 text-amber-500" /> : <CategoryIcon name={p.category} className="size-4.5" />}
                </span>
                <span className="mt-1 w-full truncate text-center text-xs font-semibold text-slate-700" title={p.name}>{p.name}</span>
              </>
            )}
            <div className={`mt-1 flex w-full items-start justify-center rounded-t-lg pt-0.5 text-lg font-extrabold text-white ${h} ${p ? block : 'bg-slate-100'}`}>{rank}</div>
          </div>
        )
      })}
    </div>
  )
}

function TodayAtAGlance({ m }) {
  const { currency, t } = useAuth()
  const past = m.trend.slice(-8, -1)
  const usual = past.length ? past.reduce((s, d) => s + d.sales, 0) / past.length : 0
  const pct = usual > 0 ? m.sales.net / usual : m.sales.net > 0 ? 1 : 0
  const up = pct >= 1
  const inv = t('invoice').toLowerCase()
  const visits = m.customers.new + m.customers.repeat
  const paidTotal = m.payments.reduce((s, p) => s + p.amount, 0)
  const top = m.topByValue.slice(0, 3)
  const mood = usual <= 0 ? (m.sales.net > 0 ? 'Off to a good start' : 'Waiting for the first sale')
    : up ? 'Busier than a usual day' : pct >= 0.6 ? 'Getting close to a usual day' : 'Quieter than usual so far'
  return (
    <section aria-labelledby="glance-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="glance-title" className="text-lg font-bold text-slate-800">Today at a glance</h2>
        <Link to="/reports" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">Full reports <ArrowRight className="size-4" /></Link>
      </div>
      <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-slate-700">
        So far you have taken <b className="text-xl text-slate-900">{money(m.sales.net, currency, { decimals: 0 })}</b>
        from <b className="text-slate-900">{m.sales.bills}</b> {inv}{m.sales.bills === 1 ? '' : 's'}.
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold ${up ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
          {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}{mood}
        </span>
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <GlanceCard icon={Gauge} title="Today's pace" tint="#2a78d6"
          value={usual > 0 ? `${Math.round(pct * 100)}%` : '-'} caption={usual > 0 ? `of a usual day (${money(usual, currency, { decimals: 0 })})` : 'Not enough history yet'}>
          <Speedometer pct={pct} />
        </GlanceCard>
        <GlanceCard icon={PiggyBank} title="Money received" tint="#1baf7a"
          value={money(paidTotal, currency, { decimals: 0 })} caption={`avg ${money(m.sales.avgBill, currency, { decimals: 0 })} per ${inv}`}>
          <MoneyJar payments={m.payments} currency={currency} />
        </GlanceCard>
        <GlanceCard icon={Users} title={`${t('customers')} today`} tint="#7c3aed"
          value={visits} caption={<><span className="text-emerald-700">● {m.customers.new} new</span> · <span className="text-violet-700">● {m.customers.repeat} returning</span></>}>
          <Crowd customers={m.customers} />
        </GlanceCard>
        <GlanceCard icon={Trophy} title="Top sellers" tint="#d97706"
          value={top[0] ? money(top[0].value, currency, { decimals: 0 }) : '-'} caption={top[0] ? `${top[0].name} leads today` : `Your top ${t('products').toLowerCase()} appear here`}>
          <Podium top={top} />
        </GlanceCard>
      </div>
    </section>
  )
}

// ─────────────── Needs your attention ───────────────

// Businesses that sell on credit or bill after the work see unpaid bills here; those with shelf-life stock see expiry.
const CREDIT_TYPES = ['SERVICE', 'DENTAL', 'WHOLESALE']
const EXPIRY_TYPES = ['PHARMACY', 'GROCERY', 'BEAUTY']

function Attention({ m, followups, extras }) {
  const { business, can, hasModule, t } = useAuth()
  const stockOn = hasModule('inventory') && can('inventory.view')
  const items = [
    { to: '/orders', icon: ShoppingBag, n: m.online.pending, label: 'Online orders waiting', color: 'rose', show: hasModule('orders') && can('orders.view') },
    { to: '/enquiries', icon: BellRing, n: followups, label: business.type === 'DENTAL' ? 'Recalls to make' : 'Follow-ups to do', color: 'amber', show: hasModule('enquiries') && can('enquiries.view') },
    { to: '/sales', icon: HandCoins, n: extras?.dues?.count || 0, label: `Unpaid ${t('invoice').toLowerCase()}s`, color: 'amber', show: !!extras?.dues && CREDIT_TYPES.includes(business.type) },
    { to: '/inventory', icon: CalendarClock, n: (extras?.expiry.expired || 0) + (extras?.expiry.within30 || 0), label: 'Expiring within 30 days', color: 'red', show: stockOn && !!extras && EXPIRY_TYPES.includes(business.type) },
    { to: '/inventory', icon: AlertTriangle, n: m.stock.low, label: 'Running low', color: 'orange', show: stockOn },
    { to: '/inventory', icon: PackageX, n: m.stock.out, label: 'Out of stock', color: 'red', show: stockOn },
  ].filter((x) => x.show)
  const pending = items.filter((x) => x.n > 0)
  const tone = { rose: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-700', orange: 'bg-orange-100 text-orange-700', red: 'bg-red-100 text-red-700' }
  return (
    <section aria-labelledby="attention-title">
      <h2 id="attention-title" className="mb-3 text-lg font-bold text-slate-800">Needs your attention</h2>
      {!pending.length ? (
        <div className="card flex items-center gap-3 p-4 text-emerald-800"><CheckCircle2 className="size-7 text-emerald-600" /><span className="text-base font-semibold">All caught up - nothing needs you right now.</span></div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {pending.map(({ to, icon: Icon, n, label, color }) => (
            <Link key={label} to={to} className="card flex items-center gap-3 p-3.5 transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md">
              <span className={`relative flex size-12 shrink-0 items-center justify-center rounded-2xl ${tone[color]}`}>
                <Icon className="size-6" />
                <span className="absolute -right-1.5 -top-1.5 flex min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white ring-2 ring-white">{n}</span>
              </span>
              <span className="text-sm font-semibold leading-tight text-slate-800 sm:text-base">{label}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

// ─────────────── Quick start (6 shortcuts) ───────────────

const TILE_COLORS = {
  brand: 'bg-brand text-brand-fg', blue: 'bg-blue-100 text-blue-700', green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700', rose: 'bg-rose-100 text-rose-700', orange: 'bg-orange-100 text-orange-700',
}

function Shortcuts() {
  const { can, hasModule, t } = useAuth()
  const bi = useBusinessIcons()
  const inv = t('invoice').toLowerCase()
  const tiles = [
    { to: '/pos', icon: bi.pos, color: 'brand', title: `New ${inv}`, show: hasModule('pos') && can('pos.sell') },
    { to: '/sales', icon: Search, color: 'blue', title: `Find ${/^[aeiou]/i.test(inv) ? 'an' : 'a'} ${inv}`, show: can('sales.view') },
    { to: '/customers?new=1', icon: UserPlus, color: 'green', title: `Add ${t('customer').toLowerCase()}`, show: hasModule('customers') && can('customers.manage') },
    { to: '/products?new=1', icon: PackagePlus, color: 'amber', title: `Add ${t('product').toLowerCase()}`, show: hasModule('products') && can('products.manage') },
    { to: '/orders', icon: ShoppingBag, color: 'rose', title: 'Online orders', show: hasModule('orders') && can('orders.view') },
    { to: '/reports?tab=daily', icon: BarChart3, color: 'orange', title: "Today's report", show: hasModule('reports') && can('reports.view') },
  ].filter((x) => x.show)
  return (
    <section aria-labelledby="quick-title">
      <h2 id="quick-title" className="mb-3 text-lg font-bold text-slate-800">Quick start</h2>
      <div className="grid grid-cols-3 gap-2 sm:gap-3 xl:grid-cols-6">
        {tiles.map(({ to, icon: Icon, color, title }) => (
          <Link key={to} to={to} className="card flex flex-col items-center gap-2 px-1.5 py-3 text-center sm:px-2 sm:py-4 transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md focus-visible:ring-4 focus-visible:ring-brand/30">
            <span className={`flex size-11 items-center justify-center rounded-2xl sm:size-14 ${TILE_COLORS[color]}`}><Icon className="size-6 sm:size-7" /></span>
            <span className="text-sm font-bold leading-tight text-slate-900 sm:text-base">{title}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const { data, loading } = useFetch('/reports/dashboard')
  if (loading || !data) return <Spinner />
  return (
    <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <Greeting name={user.name.split(' ')[0]} />
      <TodayAtAGlance m={data.metrics} />
      <Attention m={data.metrics} followups={data.followupsDue.length} extras={data.extras} />
      <DashboardSpotlight data={data} />
      <Shortcuts />
    </div>
  )
}
