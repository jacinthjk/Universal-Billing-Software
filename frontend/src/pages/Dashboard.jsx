import { Link } from 'react-router-dom'
import {
  Search, UserPlus, PackagePlus, ShoppingBag, BarChart3, Banknote, QrCode, CreditCard, Wallet, Landmark, Users, Trophy,
  BellRing, PackageX, AlertTriangle, CheckCircle2, ArrowRight, TrendingUp, TrendingDown, Gauge, PiggyBank, HandCoins, CalendarClock,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useBusinessIcons } from '../lib/businessIcons'
import { Spinner, useFetch } from '../components/ui'
import DashboardSpotlight from '../components/DashboardSpotlight'
import { MyAttendance } from './Staff'
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

// ─────────────── Today at a glance (one summary panel) ───────────────
// Four columns in one card: sales against a usual day, money by payment type, customers, top sellers.

// Payment types keep a fixed colour (validated categorical palette), never by rank.
const PAY = { CASH: [Banknote, '#1baf7a', 'Cash'], UPI: [QrCode, '#2a78d6', 'UPI'], CARD: [CreditCard, '#eb6834', 'Card'], BANK: [Landmark, '#4a3aa7', 'Bank'], ONLINE: [Wallet, '#e87ba4', 'Online'] }
const payMeta = (m) => PAY[m] || [Wallet, '#94a3b8', m]

function Cell({ icon: Icon, label, children, className = '' }) {
  return (
    <div className={`min-w-0 p-4 sm:p-5 ${className}`}>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-600"><Icon className="size-4 text-slate-400" />{label}</div>
      {children}
    </div>
  )
}

// Segmented bar: one segment per part, 2px surface gap between them, legend underneath.
function SplitBar({ parts, empty }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  if (!total) return <div className="h-2.5 rounded-full bg-slate-100" title={empty} />
  return (
    <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
      {parts.filter((p) => p.value > 0).map((p) => <span key={p.key} className="h-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.text}`} />)}
    </div>
  )
}

function TodayAtAGlance({ m }) {
  const { currency, t } = useAuth()
  const inv = t('invoice').toLowerCase()
  const past = m.trend.slice(-8, -1)
  const usual = past.length ? past.reduce((s, d) => s + d.sales, 0) / past.length : 0
  const pct = usual > 0 ? m.sales.net / usual : 0
  const up = usual > 0 && pct >= 1
  const mood = usual <= 0 ? (m.sales.net > 0 ? 'Off to a good start' : 'Waiting for the first sale')
    : up ? 'Busier than a usual day' : pct >= 0.6 ? 'Close to a usual day' : 'Quieter than usual so far'
  const paid = m.payments.reduce((s, p) => s + p.amount, 0)
  const pays = m.payments.map((p) => { const [, color, label] = payMeta(p.method); return { key: p.method, label, color, value: p.amount, text: money(p.amount, currency, { decimals: 0 }) } })
  const visits = m.customers.new + m.customers.repeat
  const top = m.topByValue.slice(0, 3)
  return (
    <section aria-labelledby="glance-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="glance-title" className="text-lg font-bold text-slate-800">Today at a glance</h2>
        <Link to="/reports" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">Full reports <ArrowRight className="size-4" /></Link>
      </div>
      <div className="card grid grid-cols-2 divide-slate-100 lg:grid-cols-[1.35fr_1fr_1fr_1.15fr] lg:divide-x [&>*]:border-slate-100">
        <Cell icon={Gauge} label="Sales so far" className="col-span-2 border-b lg:col-span-1 lg:border-b-0">
          <div className="text-[2rem] font-extrabold leading-none tracking-tight text-slate-900">{money(m.sales.net, currency, { decimals: 0 })}</div>
          <div className="mt-1.5 text-sm text-slate-600">{m.sales.bills} {inv}{m.sales.bills === 1 ? '' : 's'} · avg {money(m.sales.avgBill, currency, { decimals: 0 })}</div>
          <div className="mt-3">
            <div className="relative h-2 rounded-full bg-slate-100" role="img" aria-label={usual > 0 ? `${Math.round(pct * 100)}% of a usual day` : 'No usual day yet'}>
              <div className={`h-2 rounded-full transition-[width] duration-700 ${up ? 'bg-emerald-500' : 'bg-brand'}`} style={{ width: `${Math.min(pct / 1.5, 1) * 100}%` }} />
              {usual > 0 && <span className="absolute -top-1 h-4 w-0.5 rounded bg-slate-500" style={{ left: `${(1 / 1.5) * 100}%` }} title={`Usual day: ${money(usual, currency, { decimals: 0 })}`} />}
            </div>
            <div className={`mt-1.5 flex items-center gap-1 text-sm font-semibold ${up ? 'text-emerald-700' : 'text-slate-600'}`}>
              {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}{mood}
              {usual > 0 && <span className="font-normal text-slate-500">· {Math.round(pct * 100)}% of usual</span>}
            </div>
          </div>
        </Cell>
        <Cell icon={PiggyBank} label="Money received" className="border-r">
          <div className="text-xl font-extrabold text-slate-900">{money(paid, currency, { decimals: 0 })}</div>
          <div className="mt-2.5"><SplitBar parts={pays} empty="No payments yet" /></div>
          <ul className="mt-2 space-y-0.5 text-sm">
            {pays.length ? pays.slice(0, 3).map((p) => <li key={p.key} className="flex items-center gap-1.5"><span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} /><span className="text-slate-600">{p.label}</span><b className="ml-auto text-slate-800">{p.text}</b></li>)
              : <li className="text-slate-500">No payments yet</li>}
          </ul>
        </Cell>
        <Cell icon={Users} label={`${t('customers')} today`}>
          <div className="text-xl font-extrabold text-slate-900">{visits}</div>
          <div className="mt-2.5"><SplitBar parts={[{ key: 'new', label: 'New', color: '#1baf7a', value: m.customers.new, text: String(m.customers.new) }, { key: 'repeat', label: 'Returning', color: '#7c3aed', value: m.customers.repeat, text: String(m.customers.repeat) }]} empty="No visits yet" /></div>
          <ul className="mt-2 space-y-0.5 text-sm">
            <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#1baf7a]" /><span className="text-slate-600">New</span><b className="ml-auto text-slate-800">{m.customers.new}</b></li>
            <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#7c3aed]" /><span className="text-slate-600">Returning</span><b className="ml-auto text-slate-800">{m.customers.repeat}</b></li>
          </ul>
        </Cell>
        <Cell icon={Trophy} label="Top sellers" className="col-span-2 border-t lg:col-span-1 lg:border-t-0">
          {top.length ? (
            <ol className="space-y-1.5">
              {top.map((p, i) => (
                <li key={p.productId || p.name} className="flex items-center gap-2 text-sm">
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={p.name}>{p.name}</span>
                  <b className="shrink-0 text-slate-900">{money(p.value, currency, { decimals: 0 })}</b>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-slate-500">Your best-selling {t('products').toLowerCase()} appear here.</p>}
        </Cell>
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
      <MyAttendance compact />
      <TodayAtAGlance m={data.metrics} />
      <Attention m={data.metrics} followups={data.followupsDue.length} extras={data.extras} />
      <DashboardSpotlight data={data} />
      <Shortcuts />
    </div>
  )
}
