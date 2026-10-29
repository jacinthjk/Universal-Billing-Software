import { Link } from 'react-router-dom'
import {
  Clock, Flame, LayoutGrid, HandCoins, Crown, PackageSearch, CalendarClock, BellRing, ArrowRight, CheckCircle2, AlertOctagon, AlertTriangle,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { money, compactMoney, qty, date, ago } from '../lib/format'

// ─────────────── Business-type profiles ───────────────
// Each business type gets its own set of home-screen cards, in the order that matters most to it,
// with names in its own language. Cards the person can't see (module off / no permission) are
// skipped and the next most useful card fills the gap, so the row is always full.

const PROFILES = {
  RETAIL: { title: 'Your shop this week', cards: ['hours', 'favourites', 'dues'] },
  GROCERY: { title: 'Fresh stock watch', cards: ['expiry', 'restock', 'hours'] },
  PHARMACY: { title: 'Medicine safety & stock', cards: ['expiry', 'restock', 'dues'] },
  ELECTRONICS: { title: 'Showroom insights', cards: ['categories', 'restock', 'dues'] },
  FASHION: { title: 'Style trends this week', cards: ['categories', 'favourites', 'loyal'] },
  BEAUTY: { title: 'Client care & shelf life', cards: ['loyal', 'favourites', 'expiry'] },
  RESTAURANT: { title: 'Kitchen & floor', cards: ['hours', 'favourites', 'categories'] },
  SERVICE: { title: 'Clients & collections', cards: ['dues', 'loyal', 'followups'] },
  DENTAL: { title: 'Patients & recalls', cards: ['followups', 'dues', 'favourites'] },
  WHOLESALE: { title: 'Trade desk', cards: ['dues', 'loyal', 'restock'] },
}
const FALLBACK = ['hours', 'favourites', 'categories', 'dues', 'loyal', 'restock']
export const profileFor = (type) => PROFILES[type] || PROFILES.RETAIL

// Card titles in each business's own words; `default` covers every other type.
function titles(type, t) {
  const pick = (map) => map[type] || map.default
  return {
    hours: pick({ RESTAURANT: 'Rush hours today', default: 'Busy hours today' }),
    favourites: pick({ RESTAURANT: 'Most ordered this week', DENTAL: 'Most-done treatments this week', SERVICE: 'Most booked this week', default: `Best-selling ${t('products').toLowerCase()} this week` }),
    categories: pick({ RESTAURANT: 'Menu sections this week', FASHION: 'Category mix this week', default: 'Sales by category this week' }),
    dues: pick({ WHOLESALE: 'Buyer credit outstanding', DENTAL: 'Treatment payments due', SERVICE: 'Payments to collect', default: 'Money to collect' }),
    loyal: pick({ BEAUTY: 'Loyal clients this month', WHOLESALE: 'Top buyers this month', default: `Top ${t('customers').toLowerCase()} this month` }),
    restock: pick({ PHARMACY: 'Medicines to reorder', GROCERY: 'Shelves to refill', default: 'Restock list' }),
    expiry: pick({ PHARMACY: 'Expiry alerts', GROCERY: 'Sell these first', BEAUTY: 'Shelf life watch', default: 'Expiring soon' }),
    followups: pick({ DENTAL: 'Recalls & follow-ups', default: 'Follow-ups due' }),
  }
}

// ─────────────── Shared pieces ───────────────

// Every card has the same shape: title, one headline figure, up to 4 short rows, then "View all".
function SpotCard({ icon: Icon, title, headline, sub, link, children }) {
  return (
    <section className="card flex min-w-0 flex-col">
      <div className="flex items-start gap-3 px-4 pt-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Icon className="size-4.5" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-600">{title}</h3>
          {headline !== undefined && <div className="text-xl font-extrabold leading-tight tracking-tight text-slate-900">{headline}</div>}
          {sub && <div className="text-xs text-slate-500">{sub}</div>}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-3">{children}</div>
      {link && <Link to={link} className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-sm font-semibold text-brand hover:bg-slate-50">View all<ArrowRight className="size-4" /></Link>}
    </section>
  )
}

const Quiet = ({ icon: Icon = CheckCircle2, children }) => (
  <div className="flex flex-1 items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600"><Icon className="size-5 shrink-0 text-emerald-600" strokeWidth={1.75} />{children}</div>
)

// A tidy list row: name (+ small note) on the left, value on the right.
function Row({ to, lead, name, note, value, valueClass = 'text-slate-900' }) {
  const body = (
    <>
      {lead}
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{name}</span>{note && <span className="block truncate text-xs text-slate-500">{note}</span>}</span>
      <span className={`shrink-0 text-sm font-semibold ${valueClass}`}>{value}</span>
    </>
  )
  return <li>{to ? <Link to={to} className="flex items-center gap-2.5 py-1.5 hover:text-brand">{body}</Link> : <div className="flex items-center gap-2.5 py-1.5">{body}</div>}</li>
}

// Horizontal bars: label + value in ink, bar in brand colour; one series so no legend.
function BarList({ rows, currency, note }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="space-y-2">
      {rows.slice(0, 4).map((r) => (
        <li key={r.name} title={`${r.name}: ${money(r.value, currency, { decimals: 0 })}${note ? ` · ${note(r)}` : ''}`}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium text-slate-800">{r.name}</span>
            <span className="shrink-0"><span className="mr-1.5 text-xs text-slate-500">{note?.(r)}</span><b className="text-slate-900">{money(r.value, currency, { decimals: 0 })}</b></span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.max((r.value / max) * 100, 2)}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}

const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`

// ─────────────── Cards ───────────────

// Columns per hour of the day, trimmed to the hours the business is actually busy.
function BusyHours({ hours, currency, title, inv }) {
  const active = hours.filter((h) => h.bills)
  if (!active.length) return <SpotCard icon={Clock} title={title} headline="—" sub="No sales yet today"><Quiet icon={Clock}>Your busiest hours show up here as the day goes on.</Quiet></SpotCard>
  const first = Math.min(active[0].hour, 9)
  const last = Math.max(active[active.length - 1].hour, 20)
  const shown = hours.slice(first, last + 1)
  const max = Math.max(...shown.map((h) => h.sales), 1)
  const peak = active.reduce((a, b) => (b.sales > a.sales ? b : a))
  return (
    <SpotCard icon={Clock} title={title} headline={`${hourLabel(peak.hour)} – ${hourLabel((peak.hour + 1) % 24)}`} sub={`Busiest so far · ${money(peak.sales, currency, { decimals: 0 })}`}>
      <div className="flex h-24 items-end gap-[2px]" role="img" aria-label={`Sales by hour, busiest ${hourLabel(peak.hour)}`}>
        {shown.map((h) => (
          <div key={h.hour} className="group relative flex h-full min-w-0 flex-1 items-end">
            <div className={`w-full rounded-t-[4px] ${h.sales ? (h.hour === peak.hour ? 'bg-brand' : 'bg-brand/40') : 'h-[2px] bg-slate-200'}`}
              style={h.sales ? { height: `${Math.max((h.sales / max) * 100, 4)}%` } : undefined} />
            {/* hover / tap target is the whole column, wider than the bar */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow group-hover:block group-active:block">
              {hourLabel(h.hour)} · {money(h.sales, currency, { decimals: 0 })} · {h.bills} {inv}{h.bills === 1 ? '' : 's'}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500"><span>{hourLabel(first)}</span><span>{hourLabel(last)}</span></div>
    </SpotCard>
  )
}

function Favourites({ week, currency, title }) {
  return (
    <SpotCard icon={Flame} title={title} headline={week.top[0]?.name || '—'} sub={week.top[0] ? `Leads the last 7 days` : 'Last 7 days'} link="/reports">
      {week.top.length ? <BarList rows={week.top} currency={currency} note={(r) => `${qty(r.qty)} ${r.unit || ''}`} /> : <Quiet icon={Flame}>Nothing sold in the last 7 days yet.</Quiet>}
    </SpotCard>
  )
}

function Categories({ week, currency, title }) {
  const total = week.categories.reduce((s, c) => s + c.value, 0)
  return (
    <SpotCard icon={LayoutGrid} title={title} headline={money(total, currency, { decimals: 0 })} sub="Last 7 days" link="/reports">
      {week.categories.length
        ? <BarList rows={week.categories} currency={currency} note={(r) => `${total ? Math.round((r.value / total) * 100) : 0}%`} />
        : <Quiet icon={LayoutGrid}>Group your items into categories to see what's selling.</Quiet>}
    </SpotCard>
  )
}

function Dues({ dues, currency, title, inv }) {
  return (
    <SpotCard icon={HandCoins} title={title} headline={money(dues.amount, currency, { decimals: 0 })} sub={dues.count ? `on ${dues.count} unpaid ${inv}${dues.count === 1 ? '' : 's'}` : 'Nothing pending'} link="/reports?tab=outstanding">
      {!dues.count ? <Quiet>Every {inv} is fully paid.</Quiet> : (
        <ul className="divide-y divide-slate-100">
          {dues.top.slice(0, 4).map((d) => <Row key={d.saleId} to={`/sales/${d.saleId}`} name={d.name} note={`${d.number} · ${ago(d.createdAt)}`} value={money(d.due, currency, { decimals: 0 })} />)}
        </ul>
      )}
    </SpotCard>
  )
}

function Loyal({ customers, currency, title, t }) {
  return (
    <SpotCard icon={Crown} title={title} headline={customers[0]?.name || '—'} sub={customers[0] ? `Top ${t('customer').toLowerCase()} · last 30 days` : 'Last 30 days'} link="/customers">
      {!customers.length ? <Quiet icon={Crown}>Add {t('customer').toLowerCase()} details on {t('invoice').toLowerCase()}s to see who comes back most.</Quiet> : (
        <ul className="divide-y divide-slate-100">
          {customers.slice(0, 4).map((c, i) => (
            <Row key={c.id} to={`/customers/${c.id}`}
              lead={<span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{i + 1}</span>}
              name={c.name} note={`${c.bills} ${t('invoice').toLowerCase()}${c.bills === 1 ? '' : 's'}`} value={compactMoney(c.value, currency)} />
          ))}
        </ul>
      )}
    </SpotCard>
  )
}

function Restock({ stock, currency, title, t }) {
  const n = stock.alerts.length
  return (
    <SpotCard icon={PackageSearch} title={title} headline={n ? `${n} item${n === 1 ? '' : 's'}` : 'All good'}
      sub={stock.value !== undefined ? `Stock worth ${money(stock.value, currency, { decimals: 0 })} · ${stock.skus} ${t('products').toLowerCase()}` : `${stock.out} out · ${stock.low} low`} link="/inventory">
      {!n ? <Quiet>Everything is well stocked.</Quiet> : (
        <ul className="divide-y divide-slate-100">
          {stock.alerts.slice(0, 4).map((a) => (
            <Row key={a.id} name={a.name}
              lead={a.status === 'OUT' ? <AlertOctagon className="size-4 shrink-0 text-red-600" /> : <AlertTriangle className="size-4 shrink-0 text-amber-600" />}
              value={a.status === 'OUT' ? 'Out of stock' : `${qty(a.qty)} left`} valueClass={a.status === 'OUT' ? 'text-red-700' : 'text-amber-800'} />
          ))}
        </ul>
      )}
    </SpotCard>
  )
}

function Expiry({ expiry, title }) {
  const soon = expiry.expired + expiry.within30
  const chips = [
    [expiry.expired, 'expired', 'bg-red-50 text-red-800 ring-red-200'],
    [expiry.within30, 'in 30 days', 'bg-amber-50 text-amber-900 ring-amber-200'],
    [expiry.within90, 'in 90 days', 'bg-slate-50 text-slate-700 ring-slate-200'],
  ]
  return (
    <SpotCard icon={CalendarClock} title={title} headline={soon ? `${soon} batch${soon === 1 ? '' : 'es'}` : 'Nothing urgent'} sub="Expired or expiring within 30 days" link="/inventory">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {chips.map(([n, label, cls]) => <span key={label} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${cls}`}>{n} {label}</span>)}
      </div>
      {!expiry.items.length ? <Quiet>No batches expiring in the next 90 days.</Quiet> : (
        <ul className="divide-y divide-slate-100">
          {expiry.items.slice(0, 4).map((b) => (
            <Row key={b.id} name={b.name} note={`Batch ${b.batchNo} · ${qty(b.qty)} ${b.unit || ''} · ${date(b.expiryDate)}`}
              value={b.days <= 0 ? 'Expired' : `${b.days} day${b.days === 1 ? '' : 's'}`}
              valueClass={b.days <= 0 ? 'text-red-700' : b.days <= 30 ? 'text-amber-800' : 'text-slate-600'} />
          ))}
        </ul>
      )}
    </SpotCard>
  )
}

function Followups({ items, title }) {
  const late = (e) => e.followUpAt && new Date(e.followUpAt) < new Date()
  const overdue = items.filter(late).length
  return (
    <SpotCard icon={BellRing} title={title} headline={items.length ? `${items.length} to do` : 'All done'} sub={overdue ? `${overdue} overdue` : 'Due today'} link="/enquiries">
      {!items.length ? <Quiet>No follow-ups due today.</Quiet> : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 4).map((e) => (
            <Row key={e.id} to={`/enquiries/${e.id}`} name={e.name || e.phone || 'Enquiry'} note={e.nextAction || e.itemText || e.summary || e.message || e.source}
              value={late(e) ? 'Overdue' : 'Today'} valueClass={late(e) ? 'text-red-700' : 'text-slate-600'} />
          ))}
        </ul>
      )}
    </SpotCard>
  )
}

// ─────────────── Section ───────────────

export default function DashboardSpotlight({ data }) {
  const { business, currency, can, hasModule, t } = useAuth()
  const { extras, metrics: m, followupsDue } = data
  if (!extras) return null
  const profile = profileFor(business.type)
  const names = titles(business.type, t)
  const inv = t('invoice').toLowerCase()
  const stockOn = hasModule('inventory') && can('inventory.view')
  const available = {
    hours: true,
    favourites: true,
    categories: true,
    dues: !!extras.dues,
    loyal: !!extras.topCustomers && hasModule('customers'),
    restock: stockOn,
    expiry: stockOn && (extras.expiry.items.length > 0 || ['PHARMACY', 'GROCERY', 'BEAUTY'].includes(business.type)),
    followups: hasModule('enquiries') && can('enquiries.view'),
  }
  const cards = [...new Set([...profile.cards, ...FALLBACK])].filter((k) => available[k]).slice(0, 3)
  const render = {
    hours: () => <BusyHours hours={extras.hourly} currency={currency} title={names.hours} inv={inv} />,
    favourites: () => <Favourites week={extras.week} currency={currency} title={names.favourites} />,
    categories: () => <Categories week={extras.week} currency={currency} title={names.categories} />,
    dues: () => <Dues dues={extras.dues} currency={currency} title={names.dues} inv={inv} />,
    loyal: () => <Loyal customers={extras.topCustomers} currency={currency} title={names.loyal} t={t} />,
    restock: () => <Restock stock={m.stock} currency={currency} title={names.restock} t={t} />,
    expiry: () => <Expiry expiry={extras.expiry} title={names.expiry} />,
    followups: () => <Followups items={followupsDue} title={names.followups} />,
  }
  return (
    <section aria-labelledby="spotlight-title">
      <h2 id="spotlight-title" className="mb-3 text-lg font-bold text-slate-800">{profile.title}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((k) => <div key={k} className="flex min-w-0 [&>section]:flex-1">{render[k]()}</div>)}
      </div>
    </section>
  )
}
