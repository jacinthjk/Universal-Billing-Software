// Shared chart pieces (Recharts). Single-series charts use the business brand colour; multi-series
// use the validated categorical palette in fixed order. Text always uses ink tokens, not series colours.
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'
import { compactMoney, money } from '../lib/format'

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const AXIS = { fontSize: 11, fill: '#64748b' }

function TipBox({ active, payload, label, currency, labelFmt }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      {label !== undefined && <div className="mb-1 font-medium text-slate-700">{labelFmt ? labelFmt(label) : label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="flex items-center gap-2 text-slate-600">
          <span className="size-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span>{p.name}</span>
          <span className="ml-auto font-semibold text-slate-900">{currency ? money(p.value, currency) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

const shortDate = (d) => `${d.slice(8)}/${d.slice(5, 7)}`

export function TrendChart({ data, currency, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis tickFormatter={(v) => compactMoney(v, currency)} tick={AXIS} axisLine={false} tickLine={false} width={56} />
        <Tooltip content={<TipBox currency={currency} labelFmt={(d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} />} cursor={{ stroke: '#94a3b8', strokeDasharray: 3 }} />
        <Area type="monotone" dataKey="sales" name="Sales" stroke="var(--brand)" strokeWidth={2} fill="url(#trendFill)" activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function HBarChart({ data, dataKey = 'value', nameKey = 'name', currency, color = 'var(--brand)', height }) {
  const h = height || Math.max(data.length * 34 + 10, 80)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey={nameKey} tick={{ ...AXIS, fill: '#334155' }} width={130} axisLine={false} tickLine={false} />
        <Tooltip content={<TipBox currency={currency} />} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey={dataKey} name={currency ? 'Value' : 'Qty'} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function Donut({ data, currency, height = 200 }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative" style={{ width: height, height }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={data.length > 1 ? 2 : 0} stroke="#fff" strokeWidth={2}>
              {data.map((d, i) => <Cell key={d.name} fill={SERIES[i % SERIES.length]} />)}
            </Pie>
            <Tooltip content={<TipBox currency={currency} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold">{currency ? compactMoney(total, currency) : total}</span>
          <span className="text-[11px] text-slate-500">total</span>
        </div>
      </div>
      <ul className="min-w-36 flex-1 space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="text-slate-700">{d.name}</span>
            <span className="ml-auto font-medium">{currency ? money(d.value, currency) : d.value}</span>
          </li>
        ))}
        {!data.length && <li className="text-slate-400">No data</li>}
      </ul>
    </div>
  )
}

// Money in vs money out per month: two series, so a legend sits above; hover shows both values.
export function InOutChart({ data, currency, height = 220 }) {
  const label = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
  return (
    <div>
      <div className="mb-2 flex gap-4 text-sm text-slate-700">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: SERIES[0] }} />Money in</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: SERIES[1] }} />Money out</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke="#eef2f6" vertical={false} />
          <XAxis dataKey="month" tickFormatter={label} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => compactMoney(v, currency)} tick={AXIS} axisLine={false} tickLine={false} width={56} />
          <Tooltip content={<TipBox currency={currency} labelFmt={label} />} cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="credits" name="Money in" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="debits" name="Money out" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
