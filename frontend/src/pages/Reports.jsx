import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, RefreshCw, FileText, Image as ImageIcon, Sheet, Send, LayoutGrid, CalendarDays, Bot, HandCoins, AlertTriangle, Users, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { errMsg, fetchBlob, openFile } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Button, Card, Empty, Field, Input, PageHeader, Spinner, Stat, Tabs, Toggle, act, useFetch } from '../components/ui'
import { TrendChart, HBarChart, Donut, SERIES } from '../components/charts'
import { money, daysAgo, today, date, dateTime, titleCase } from '../lib/format'

function Overview() {
  const { currency, can, t } = useAuth()
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(today())
  const [by, setBy] = useState('value')
  const { data, loading } = useFetch(`/reports/summary?from=${from}&to=${to}`)
  const presets = [['Today', 0], ['7 days', 6], ['30 days', 29], ['90 days', 89]]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {presets.map(([l, d]) => <Button key={l} size="sm" variant={from === daysAgo(d) && to === today() ? 'primary' : 'secondary'} onClick={() => { setFrom(daysAgo(d)); setTo(today()) }}>{l}</Button>)}
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-slate-400">→</span>
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="ml-auto flex flex-wrap gap-2">
          <ExportButton label="PDF" icon={FileText} url={`/reports/overview.pdf?from=${from}&to=${to}`} filename={`overview-${from}-to-${to}.pdf`} />
          <ExportButton label="Image" icon={ImageIcon} url={`/reports/overview.png?from=${from}&to=${to}`} filename={`overview-${from}-to-${to}.png`} />
          <ExportButton label="Excel" icon={Sheet} url={`/reports/overview.xlsx?from=${from}&to=${to}`} filename={`overview-${from}-to-${to}.xlsx`} />
          {can('reports.export') && <ExportButton label="Sales CSV" icon={Download} url={`/reports/export/sales.csv?from=${from}&to=${to}`} filename={`sales-${from}-${to}.csv`} />}
        </div>
      </div>
      {loading || !data ? <Spinner /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Net sales" value={money(data.sales.net, currency, { decimals: 0 })} sub={`Gross ${money(data.sales.gross, currency, { decimals: 0 })} · returns ${money(data.sales.returns, currency, { decimals: 0 })}`} />
          <Stat label={`${t('invoice')}s`} value={data.sales.bills} sub={`Avg ${money(data.sales.avgBill, currency, { decimals: 0 })}`} />
          {data.margin && <Stat label="Gross profit" value={money(data.margin.profit, currency, { decimals: 0 })} sub={`${data.margin.pct}% margin`} />}
          <Stat label="Purchases" value={money(data.purchases.value, currency, { decimals: 0 })} sub={`${data.purchases.count} bills`} />
          <Stat label="Online orders" value={data.online.orders} sub={`${money(data.online.revenue, currency, { decimals: 0 })} revenue`} />
        </div>
        <Card title="Sales by day"><TrendChart data={data.trend} currency={currency} height={260} /></Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`Top ${t('products').toLowerCase()}`} actions={<div className="flex gap-1 text-xs">{['value', 'qty'].map((k) => <button key={k} onClick={() => setBy(k)} className={`rounded px-2 py-0.5 ${by === k ? 'bg-brand text-brand-fg' : 'bg-slate-100'}`}>{k === 'value' ? 'By value' : 'By quantity'}</button>)}</div>}>
            {(by === 'value' ? data.topByValue : data.topByQty).length
              ? <HBarChart data={(by === 'value' ? data.topByValue : data.topByQty).map((p) => ({ name: p.name, value: by === 'value' ? p.value : p.qty }))} currency={by === 'value' ? currency : undefined} />
              : <Empty title="No sales in this period" />}
          </Card>
          <Card title="Category performance">
            {data.categories.length ? <HBarChart data={data.categories} currency={currency} color={SERIES[0]} /> : <Empty title="No sales in this period" />}
          </Card>
          <Card title="Payment methods"><Donut data={data.payments.map((p) => ({ name: p.method, value: p.amount }))} currency={currency} height={170} /></Card>
          <Card title={`${t('customers')}: new vs repeat`}>
            <Donut data={[{ name: 'New', value: data.customers.new }, { name: 'Repeat visits', value: data.customers.repeat }].filter((d) => d.value)} height={170} />
            <p className="mt-3 text-sm text-slate-500">{data.customers.visits} counted visits · {data.customers.added} new profiles</p>
          </Card>
          <Card title="Enquiries">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="text-2xl font-bold">{data.enquiries.new}</div><div className="text-xs text-slate-500">Received</div></div>
              <div><div className="text-2xl font-bold">{data.enquiries.converted}</div><div className="text-xs text-slate-500">Converted</div></div>
              <div><div className="text-2xl font-bold">{data.enquiries.pending}</div><div className="text-xs text-slate-500">Open now</div></div>
            </div>
            <ul className="mt-3 space-y-1 text-sm">{data.enquiries.bySource.map((s) => <li key={s.source} className="flex justify-between"><span>{titleCase(s.source)}</span><b>{s.count}</b></li>)}</ul>
          </Card>
          <Card title="Top suppliers">
            {data.purchases.suppliers.length ? <HBarChart data={data.purchases.suppliers} currency={currency} color={SERIES[1]} /> : <Empty title="No purchases in this period" />}
          </Card>
        </div>
      </>}
    </div>
  )
}

// Unpaid bills with the number of days each has been outstanding; over 30 days is highlighted.
function Outstanding() {
  const { currency, t } = useAuth()
  const { data, loading } = useFetch('/reports/outstanding')
  const [view, setView] = useState('bills')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const inv = t('invoice').toLowerCase()
  if (loading || !data) return <Spinner />
  const bills = onlyOverdue ? data.bills.filter((b) => b.overdue) : data.bills
  const customers = onlyOverdue ? data.customers.filter((c) => c.oldestDays > data.overdueAfter) : data.customers
  const maxBucket = Math.max(...data.buckets.map((b) => b.amount), 1)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">As of {date(data.asOf)}</span>
        <div className="ml-auto"><ExportButton label="Excel" icon={Sheet} url="/reports/outstanding.xlsx" filename={`outstanding-${data.asOf}.xlsx`} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total outstanding" value={money(data.totals.due, currency, { decimals: 0 })} sub={`${data.totals.count} unpaid ${inv}s`} icon={HandCoins} color="amber" />
        <Stat label={`Over ${data.overdueAfter} days`} value={money(data.totals.overdueDue, currency, { decimals: 0 })} sub={`${data.totals.overdueCount} ${inv}s need follow-up`} icon={AlertTriangle} color="rose" />
        <Stat label={`${t('customers')} owing`} value={data.customers.length} sub={data.customers[0] ? `Most: ${data.customers[0].name}` : '—'} icon={Users} color="violet" />
        <Stat label="Oldest bill" value={data.bills[0] ? `${data.bills[0].days} days` : '—'} sub={data.bills[0] ? `${data.bills[0].number} · ${data.bills[0].name}` : 'Nothing pending'} icon={Clock} color="blue" />
      </div>
      <Card title="Age of unpaid amounts">
        <ul className="space-y-2.5">
          {data.buckets.map((b, i) => (
            <li key={b.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm" title={`${b.label}: ${money(b.amount, currency)} on ${b.count} ${inv}s`}>
              <span className={`font-semibold ${i ? 'text-red-800' : 'text-slate-700'}`}>{b.label}</span>
              <span className="h-3 rounded-full bg-slate-100"><span className={`block h-3 rounded-full ${i ? 'bg-red-500' : 'bg-brand'}`} style={{ width: `${b.amount ? Math.max((b.amount / maxBucket) * 100, 2) : 0}%` }} /></span>
              <span className="text-right"><b>{money(b.amount, currency, { decimals: 0 })}</b> <span className="text-slate-500">({b.count})</span></span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">{[['bills', `By ${inv}`], ['customers', `By ${t('customer').toLowerCase()}`]].map(([k, l]) => <Button key={k} size="sm" variant={view === k ? 'primary' : 'secondary'} onClick={() => setView(k)}>{l}</Button>)}</div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> Only over {data.overdueAfter} days</label>
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-600"><span className="size-3 rounded-sm bg-red-100 ring-1 ring-red-300" /> outstanding more than {data.overdueAfter} days</span>
      </div>
      <Card bodyClass="p-0 overflow-x-auto">
        {view === 'bills' ? (!bills.length ? <Empty title="Nothing outstanding" /> : (
          <table className="table-base">
            <thead><tr><th>{t('invoice')}</th><th>Date</th><th>{t('customer')}</th><th className="text-right">Total</th><th className="text-right">Paid</th><th className="text-right">Balance due</th><th className="text-right">Outstanding days</th></tr></thead>
            <tbody>{bills.map((b) => (
              <tr key={b.saleId} className={b.overdue ? 'bg-red-50 hover:!bg-red-100' : ''}>
                <td><Link to={`/sales/${b.saleId}`} className="font-medium text-brand">{b.number}</Link></td>
                <td>{date(b.date)}</td>
                <td>{b.customerId ? <Link to={`/customers/${b.customerId}`} className="hover:text-brand">{b.name}</Link> : b.name}<div className="text-xs text-slate-500">{b.phone}</div></td>
                <td className="text-right">{money(b.total, currency)}</td>
                <td className="text-right text-slate-600">{money(b.paid, currency)}</td>
                <td className="text-right font-semibold">{money(b.due, currency)}</td>
                <td className="text-right">{b.overdue
                  ? <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-0.5 text-sm font-bold text-white"><AlertTriangle className="size-3.5" />{b.days} days</span>
                  : <span className="font-medium">{b.days} {b.days === 1 ? 'day' : 'days'}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )) : (!customers.length ? <Empty title="Nothing outstanding" /> : (
          <table className="table-base">
            <thead><tr><th>{t('customer')}</th><th className="text-right">Unpaid {inv}s</th><th className="text-right">Balance due</th><th className="text-right">Oldest (days)</th></tr></thead>
            <tbody>{customers.map((c) => {
              const late = c.oldestDays > data.overdueAfter
              return (
                <tr key={`${c.customerId}-${c.name}-${c.phone}`} className={late ? 'bg-red-50 hover:!bg-red-100' : ''}>
                  <td>{c.customerId ? <Link to={`/customers/${c.customerId}`} className="font-medium text-brand">{c.name}</Link> : c.name}<div className="text-xs text-slate-500">{c.phone}</div></td>
                  <td className="text-right">{c.bills}</td>
                  <td className="text-right font-semibold">{money(c.due, currency)}</td>
                  <td className={`text-right ${late ? 'font-bold text-red-700' : ''}`}>{late && <AlertTriangle className="mr-1 inline size-3.5" />}{c.oldestDays}</td>
                </tr>
              )
            })}</tbody>
          </table>
        ))}
      </Card>
    </div>
  )
}

// Download button with its own loading state (reports take a few seconds to build).
function ExportButton({ label, icon: Icon, url, filename }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try { await openFile(url, { download: true, filename }) } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }
  return <Button size="sm" variant="secondary" loading={busy} onClick={run}>{!busy && <Icon className="size-3.5" />} {label}</Button>
}

const DELIVERY_STATUS = {
  SENT: { label: 'Sent', cls: 'bg-emerald-50 text-emerald-700' },
  FAILED: { label: 'Failed', cls: 'bg-red-50 text-red-700' },
  NOT_CONFIGURED: { label: 'Not sent - WhatsApp not set up', cls: 'bg-amber-50 text-amber-800' },
}

// Automatic delivery settings: time, recipients and formats, plus WhatsApp status and the delivery log.
function DeliveryCard({ info, selected, onSaved }) {
  const { can, refreshBusiness } = useAuth()
  const d = info.settings.delivery || {}
  const [enabled, setEnabled] = useState(!!d.enabled)
  const [reportOn, setReportOn] = useState(!!info.settings.enabled)
  const [time, setTime] = useState(info.settings.time)
  const [recipients, setRecipients] = useState((d.recipients || []).join(', '))
  const [formats, setFormats] = useState(d.formats || ['image', 'excel'])
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const log = useFetch('/reports/deliveries')
  const manage = can('settings.manage')

  const save = async () => {
    const list = recipients.split(/[,\n]/).map((r) => r.replace(/[^\d+]/g, '')).filter(Boolean)
    if (enabled && !list.length) return toast.error('Add at least one mobile number')
    if (list.some((r) => r.replace(/\D/g, '').length < 10)) return toast.error('Enter full 10-digit mobile numbers')
    setBusy(true)
    try {
      await act(() => api.put('/businesses/current', { settings: { reportEnabled: reportOn, reportTime: time, reportDelivery: { ...d, enabled, recipients: list, formats } } }), 'Delivery settings saved')
      await refreshBusiness()
      onSaved()
    } catch { /* toast */ } finally { setBusy(false) }
  }
  const sendNow = async () => {
    setSending(true)
    try {
      const { data } = await api.post(`/reports/daily/${selected.id}/send`)
      const sent = data.results.filter((r) => r.status === 'SENT').length
      if (sent === data.results.length) toast.success(`Sent to ${sent} number${sent === 1 ? '' : 's'}`)
      else toast.error(data.results.find((r) => r.status !== 'SENT')?.error || 'Not delivered')
      log.reload()
    } catch (e) { toast.error(errMsg(e)) } finally { setSending(false) }
  }
  const toggleFormat = (f) => setFormats((x) => (x.includes(f) ? x.filter((y) => y !== f) : [...x, f]))

  return (
    <Card title={<span className="flex items-center gap-1.5"><Send className="size-4" /> Automatic delivery</span>}>
      <div className="space-y-3 text-sm">
        {!info.whatsapp.configured ? (
          <div className="rounded-lg bg-amber-50 p-3 text-amber-900">
            <b>WhatsApp sending isn't set up yet.</b> Reports are still generated every day and logged below, but they can't be sent until {info.whatsapp.provider === 'CLOUD' ? 'the WhatsApp Business API keys are added on the server (see README → WhatsApp delivery)' : 'you link WhatsApp'}. <Link to="/whatsapp" className="font-medium underline">Open WhatsApp settings</Link>
          </div>
        ) : info.whatsapp.provider === 'CLOUD' ? (
          <div className="rounded-lg bg-emerald-50 p-3 text-emerald-900">WhatsApp Business API connected{info.whatsapp.templates ? ' (using approved templates)' : ' - without templates, messages only reach numbers that messaged your business in the last 24 hours'}.</div>
        ) : (
          <div className="rounded-lg bg-emerald-50 p-3 text-emerald-900">Sending from your linked WhatsApp number.</div>
        )}
        <Toggle checked={reportOn} onChange={setReportOn} label="Generate the report every day" />
        <Field label="Time (business timezone)"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!manage} /></Field>
        <Toggle checked={enabled} onChange={setEnabled} label="Send it on WhatsApp" />
        <Field label="Mobile numbers" hint="Separate several numbers with commas"><Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="9025296615" disabled={!manage} /></Field>
        <div><span className="label">Send as</span>
          {[['image', 'Image (PNG)'], ['excel', 'Excel (XLSX)']].map(([k, l]) => (
            <label key={k} className="mr-4 inline-flex items-center gap-1.5"><input type="checkbox" checked={formats.includes(k)} onChange={() => toggleFormat(k)} disabled={!manage} />{l}</label>
          ))}
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={save}>Save</Button>
            {selected && <Button size="sm" variant="secondary" loading={sending} onClick={sendNow}><Send className="size-3.5" /> Send {date(selected.date)} now</Button>}
          </div>
        )}
        <div>
          <div className="label mt-2">Recent deliveries</div>
          {!log.data?.deliveries.length ? <p className="text-slate-400">Nothing sent yet</p> : (
            <ul className="divide-y divide-slate-100">
              {log.data.deliveries.slice(0, 8).map((x) => (
                <li key={x.id} className="py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span>{date(x.date)} → {x.recipient} <span className="text-xs text-slate-400">({x.formats.join(' + ')}, {x.trigger === 'MANUAL' ? 'manual' : 'scheduled'})</span></span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DELIVERY_STATUS[x.status]?.cls || ''}`}>{DELIVERY_STATUS[x.status]?.label || x.status}</span>
                  </div>
                  {x.status === 'FAILED' && x.error && <div className="text-xs text-red-600">{x.error}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}

function DailyReports() {
  const { data, loading, reload } = useFetch('/reports/daily')
  const [selected, setSelected] = useState(null)
  const [img, setImg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [day, setDay] = useState(today())
  useEffect(() => {
    if (!selected) return undefined
    let url
    setImg(null)
    fetchBlob(`/reports/daily/${selected.id}/png`).then((b) => { url = URL.createObjectURL(b); setImg(url) }).catch(() => {})
    return () => url && URL.revokeObjectURL(url)
  }, [selected])
  useEffect(() => { if (data?.reports.length && !selected) setSelected(data.reports[0]) }, [data, selected])

  const generate = async () => {
    setBusy(true)
    try {
      const { data: r } = await act(() => api.post('/reports/daily/generate', { date: day }), 'Report generated')
      await reload()
      setSelected({ ...r.report })
    } finally { setBusy(false) }
  }
  if (loading || !data) return <Spinner />
  const base = selected && `/reports/daily/${selected.id}`
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3">
        <Card title="Generate now">
          <p className="mb-3 text-sm text-slate-500">Generated automatically every day at <b>{data.settings.time}</b>{data.settings.enabled ? '' : ' (currently off)'} as an image, PDF and Excel file.</p>
          <div className="flex gap-2"><Input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} /><Button loading={busy} onClick={generate}><RefreshCw className="size-4" /> Generate</Button></div>
        </Card>
        <DeliveryCard info={data} selected={selected} onSaved={reload} />
        <Card title="History" bodyClass="p-0">
          {!data.reports.length ? <Empty title="No reports yet" /> : (
            <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
              {data.reports.map((r) => (
                <li key={r.id}><button onClick={() => setSelected(r)} className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${selected?.id === r.id ? 'bg-brand-soft font-medium' : ''}`}>
                  <span>{date(r.date)}</span><span className="text-xs text-slate-400">{dateTime(r.createdAt)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title={selected ? `Daily report · ${date(selected.date)}` : 'Daily report'} className="lg:col-span-2"
        actions={selected && <div className="flex flex-wrap gap-2">
          <ExportButton label="PDF" icon={FileText} url={`${base}/pdf`} filename={`daily-report-${selected.date}.pdf`} />
          <ExportButton label="Image" icon={ImageIcon} url={`${base}/png`} filename={`daily-report-${selected.date}.png`} />
          <ExportButton label="Excel" icon={Sheet} url={`${base}/xlsx`} filename={`daily-report-${selected.date}.xlsx`} />
        </div>}>
        {!selected ? <Empty title="Generate your first report" /> : img ? <img src={img} alt="Daily report" className="mx-auto max-h-[80vh] rounded-lg border border-slate-100" /> : <Spinner />}
      </Card>
    </div>
  )
}

function AIReport() {
  const [from, setFrom] = useState(daysAgo(29))
  const { data, loading } = useFetch(`/reports/ai?from=${from}&to=${today()}`)
  if (loading || !data) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="flex gap-2">{[['7 days', 6], ['30 days', 29], ['90 days', 89]].map(([l, d]) => <Button key={l} size="sm" variant={from === daysAgo(d) ? 'primary' : 'secondary'} onClick={() => setFrom(daysAgo(d))}>{l}</Button>)}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="AI conversations" value={data.conversations} />
        <Stat label="Leads captured" value={data.leads} />
        <Stat label="Qualified" value={data.qualified} />
        <Stat label="Converted" value={data.converted} sub={`${data.conversionRate}% conversion`} />
        <Stat label="Human handoffs" value={data.handoffs} />
        <Stat label="Uncertain answers" value={data.uncertain} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Lead source performance" bodyClass="p-0">
          <table className="table-base"><thead><tr><th>Source</th><th className="text-right">Leads</th><th className="text-right">Converted</th><th className="text-right">Rate</th></tr></thead>
            <tbody>{data.sources.map((s) => <tr key={s.source}><td>{titleCase(s.source)}</td><td className="text-right">{s.leads}</td><td className="text-right">{s.converted}</td><td className="text-right">{s.leads ? Math.round((s.converted / s.leads) * 100) : 0}%</td></tr>)}</tbody></table>
          {!data.sources.length && <Empty title="No leads in this period" />}
        </Card>
        <Card title="Most asked about">
          {data.topAsked.length ? <HBarChart data={data.topAsked.map((q) => ({ name: q.query, value: q.count }))} /> : <Empty title="No product questions yet" />}
          <p className="mt-2 text-xs text-slate-500">AI-assisted orders: {data.orders} · revenue {data.revenue}</p>
        </Card>
      </div>
    </div>
  )
}

export default function Reports() {
  const [params, setParams] = useSearchParams()
  const { hasModule, can } = useAuth()
  // Staff who can see bills but not reports still get the outstanding list.
  const full = can('reports.view')
  const tab = params.get('tab') || (full ? 'overview' : 'outstanding')
  const tabs = [
    ...(full ? [{ value: 'overview', label: 'Overview', icon: LayoutGrid }] : []),
    { value: 'outstanding', label: 'Outstanding', icon: HandCoins },
    ...(full ? [{ value: 'daily', label: 'Daily visual report', icon: CalendarDays }] : []),
    ...(full && hasModule('ai') ? [{ value: 'ai', label: 'AI & leads', icon: Bot }] : []),
  ]
  return (
    <div>
      <PageHeader kind="reports" title="Reports" subtitle="Sales, outstanding bills, stock, customers - and the automated daily visual report" />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v })} tabs={tabs} />
      {full && tab === 'overview' && <Overview />}
      {tab === 'outstanding' && <Outstanding />}
      {full && tab === 'daily' && <DailyReports />}
      {full && tab === 'ai' && <AIReport />}
    </div>
  )
}
