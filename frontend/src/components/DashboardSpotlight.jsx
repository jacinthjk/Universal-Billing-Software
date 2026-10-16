import { Link } from 'react-router-dom'
import {
  Clock, Flame, LayoutGrid, HandCoins, Crown, PackageSearch, CalendarClock, BellRing, ArrowRight, CheckCircle2, AlertOctagon, AlertTriangle, Hourglass,
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

function SpotCard({ icon: Icon, title, link, linkLabel = 'View all', children }) {
  return (
    <section className="card flex min-w-0 flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon className="size-4.5" /></span>
        <h3 className="min-w-0 flex-1 text-[0.9375rem] font-bold leading-tight text-slate-800">{title}</h3>
        {link && <Link to={link} className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-brand">{linkLabel}<ArrowRight className="size-3.5" /></Link>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

const Quiet = ({ icon: Icon = CheckCircle2, children }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-6 text-center text-sm text-slate-600"><Icon className="size-9 text-slate-300" strokeWidth={1.5} />{children}</div>
)

// Horizontal bars: label + value in ink, bar in brand colour; one series so no legend.
function BarList({ rows, currency, sub }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.name} title={`${r.name}: ${money(r.value, currency, { decimals: 0 })}`}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium text-slate-800">{r.name}</span>
            <b className="shrink-0 text-slate-900">{money(r.value, currency, { decimals: 0 })}</b>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.max((r.value / max) * 100, 2)}%` }} />
          </div>
          {sub && <div className="mt-0.5 text-xs text-slate-500">{sub(r)}</div>}
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
  if (!active.length) return <SpotCard icon={Clock} title={title}><Quiet icon={Clock}>Your busiest hours show up here as the day goes on</Quiet></SpotCard>
  const first = Math.min(active[0].hour, 9)
  const last = Math.max(active[active.length - 1].hour, 20)
  const shown = hours.slice(first, last + 1)
  const max = Math.max(...shown.map((h) => h.sales), 1)
  const peak = active.reduce((a, b) => (b.sales > a.sales ? b : a))
  return (
    <SpotCard icon={Clock} title={title}>
      <p className="mb-3 text-sm text-slate-700">Busiest so far: <b className="text-slate-900">{hourLabel(peak.hour)}–{hourLabel((peak.hour + 1) % 24)}</b> · {money(peak.sales, currency, { decimals: 0 })}</p>
      <div className="flex h-32 items-end gap-[2px]" role="img" aria-label={`Sales by hour, busiest ${hourLabel(peak.hour)}`}>
        {shown.map((h) => (
          <div key={h.hour} className="group relative flex h-full min-w-0 flex-1 items-end">
            <div className={`w-full rounded-t-[4px] ${h.hour === peak.hour ? 'bg-brand' : 'bg-brand/45'} ${h.sales ? '' : 'h-[2px] bg-slate-200'}`}
              style={h.sales ? { height: `${Math.max((h.sales / max) * 100, 4)}%` } : undefined} />
            {/* hover / tap target is the whole column, wider than the bar */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow group-hover:block group-active:block">
              {hourLabel(h.hour)} · {money(h.sales, currency, { decimals: 0 })} · {h.bills} {inv}{h.bills === 1 ? '' : 's'}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500"><span>{hourLabel(first)}</span><span>{hourLabel(Math.round((first + last) / 2))}</span><span>{hourLabel(last)}</span></div>
    </SpotCard>
  )
}

function Favourites({ week, currency, title }) {
  return (
    <SpotCard icon={Flame} title={title} link="/reports">
      {week.top.length ? <BarList rows={week.top} currency={currency} sub={(r) => `${qty(r.qty)} ${r.unit || ''} sold`} /> : <Quiet icon={Flame}>Nothing sold in the last 7 days yet</Quiet>}
    </SpotCard>
  )
}

function Categories({ week, currency, title }) {
  const total = week.categories.reduce((s, c) => s + c.value, 0)
  return (
    <SpotCard icon={LayoutGrid} title={title} link="/reports">
      {week.categories.length
        ? <BarList rows={week.categories} currency={currency} sub={(r) => `${total ? Math.round((r.value / total) * 100) : 0}% of the week`} />
        : <Quiet icon={LayoutGrid}>Group your items into categories to see what's selling</Quiet>}
    </SpotCard>
  )
}

function Dues({ dues, currency, title, inv }) {
  return (
    <SpotCard icon={HandCoins} title={title} link="/sales">
      {!dues.count ? <Quiet>Every {inv} is fully paid</Quiet> : (
        <>
          <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
            <div className="text-2xl font-extrabold tracking-tight text-slate-900">{money(dues.amount, currency, { decimals: 0 })}</div>
            <div className="text-sm text-amber-900">pending on {dues.count} {inv}{dues.count === 1 ? '' : 's'}</div>
          </div>
          <ul className="divide-y divide-slate-100">
            {dues.top.map((d) => (
              <li key={d.saleId}>
                <Link to={`/sales/${d.saleId}`} className="flex items-center gap-2 py-2 text-sm hover:text-brand">
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-800">{d.name}</span><span className="block text-xs text-slate-500">{d.number} · {ago(d.createdAt)}</span></span>
                  <b className="shrink-0 text-slate-900">{money(d.due, currency, { decimals: 0 })}</b>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </SpotCard>
  )
}

function Loyal({ customers, currency, title, t }) {
  return (
    <SpotCard icon={Crown} title={title} link="/customers">
      {!customers.length ? <Quiet icon={Crown}>Add {t('customer').toLowerCase()} details on {t('invoice').toLowerCase()}s to see who comes back most</Quiet> : (
        <ol className="space-y-2">
          {customers.map((c, i) => (
            <li key={c.id}>
              <Link to={`/customers/${c.id}`} className="flex items-center gap-2.5 text-sm hover:text-brand">
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${i === 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{i + 1}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-800">{c.name}</span><span className="block text-xs text-slate-500">{c.bills} {t('invoice').toLowerCase()}{c.bills === 1 ? '' : 's'} · {c.visits} visits in all</span></span>
                <b className="shrink-0 text-slate-900">{compactMoney(c.value, currency)}</b>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </SpotCard>
  )
}

function Restock({ stock, currency, title, t }) {
  return (
    <SpotCard icon={PackageSearch} title={title} link="/inventory">
      {stock.value !== undefined && <p className="mb-2 text-sm text-slate-700">Stock on hand worth <b className="text-slate-900">{money(stock.value, currency, { decimals: 0 })}</b> across {stock.skus} {t('products').toLowerCase()}</p>}
      {!stock.alerts.length ? <Quiet>Everything is well stocked</Quiet> : (
        <ul className="divide-y divide-slate-100">
          {stock.alerts.slice(0, 6).map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
              {a.status === 'OUT' ? <AlertOctagon className="size-4.5 shrink-0 text-red-600" /> : <AlertTriangle className="size-4.5 shrink-0 text-amber-600" />}
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{a.name}</span>
              <span className={`shrink-0 font-semibold ${a.status === 'OUT' ? 'text-red-700' : 'text-amber-800'}`}>{a.status === 'OUT' ? 'Out' : `${qty(a.qty)} left`}</span>
            </li>
          ))}
        </ul>
      )}
    </SpotCard>
  )
}

function Expiry({ expiry, title }) {
  const tiles = [
    { n: expiry.expired, label: 'Expired', cls: 'bg-red-50 text-red-800 ring-red-200', Icon: AlertOctagon },
    { n: expiry.within30, label: 'In 30 days', cls: 'bg-amber-50 text-amber-900 ring-amber-200', Icon: AlertTriangle },
    { n: expiry.within90, label: 'In 90 days', cls: 'bg-slate-50 text-slate-700 ring-slate-200', Icon: Hourglass },
  ]
  return (
    <SpotCard icon={CalendarClock} title={title} link="/inventory">
      <div className="mb-3 grid grid-cols-3 gap-2">
        {tiles.map(({ n, label, cls, Icon }) => (
          <div key={label} className={`rounded-xl px-2 py-2 text-center ring-1 ${cls}`}>
            <div className="flex items-center justify-center gap-1 text-xl font-extrabold"><Icon className="size-4" />{n}</div>
            <div className="text-xs font-semibold">{label}</div>
          </div>
        ))}
      </div>
      {!expiry.items.length ? <Quiet>No batches expiring in the next 90 days</Quiet> : (
        <ul className="divide-y divide-slate-100">
          {expiry.items.map((b) => (
            <li key={b.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-800">{b.name}</span><span className="block text-xs text-slate-500">Batch {b.batchNo} · {qty(b.qty)} {b.unit || ''}</span></span>
              <span className={`shrink-0 text-right text-xs font-semibold ${b.days <= 0 ? 'text-red-700' : b.days <= 30 ? 'text-amber-800' : 'text-slate-600'}`}>
                {b.days <= 0 ? 'Expired' : `${b.days} day${b.days === 1 ? '' : 's'}`}<span className="block font-normal text-slate-500">{date(b.expiryDate)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SpotCard>
  )
}

function Followups({ items, title }) {
  return (
    <SpotCard icon={BellRing} title={title} link="/enquiries">
      {!items.length ? <Quiet>No follow-ups due today</Quiet> : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 6).map((e) => {
            const late = e.followUpAt && new Date(e.followUpAt) < new Date()
            return (
              <li key={e.id}>
                <Link to={`/enquiries/${e.id}`} className="flex items-center gap-2 py-2 text-sm hover:text-brand">
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-800">{e.name || e.phone || 'Enquiry'}</span><span className="block truncate text-xs text-slate-500">{e.nextAction || e.itemText || e.summary || e.message || e.source}</span></span>
                  <span className={`shrink-0 text-xs font-semibold ${late ? 'text-red-700' : 'text-slate-600'}`}>{late ? 'Overdue' : 'Today'}</span>
                </Link>
              </li>
            )
          })}
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
