// WhatsApp: link the business number by QR code (or use the Cloud API), then send product updates
// and payment reminders and see every message that went out. Invoices are sent from the bill page.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Smartphone, Megaphone, BellRing, ScrollText, QrCode, LogOut, RefreshCw, Send, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { errMsg } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Spinner, Tabs, Textarea, Toggle, act, useDebounced, useFetch } from '../components/ui'
import { money, dateTime, ago } from '../lib/format'

const KIND_LABELS = { INVOICE: 'Invoice', REMINDER: 'Payment reminder', PRODUCT_UPDATE: 'Product update', REPORT: 'Daily report', TEST: 'Test' }
const STATUS_BADGE = { SENT: ['green', 'Sent'], FAILED: ['red', 'Failed'], NOT_CONNECTED: ['amber', 'Not connected'] }

function useStatus() {
  const [s, setS] = useState(null)
  const load = () => api.get('/whatsapp/status').then(({ data }) => setS(data)).catch(() => {})
  // Poll quickly while a QR code is showing so the page flips to "connected" right after the scan.
  const busy = s?.status === 'QR' || s?.status === 'CONNECTING'
  useEffect(() => {
    load()
    const id = setInterval(load, busy ? 2500 : 15000)
    return () => clearInterval(id)
  }, [busy])
  return [s, load, setS]
}

// ───── Connection ─────

function Connection({ s, reload, setS }) {
  const { can, refreshBusiness } = useAuth()
  const [busy, setBusy] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [cfg, setCfg] = useState(s.settings)
  const run = async (fn) => {
    setBusy(true)
    try { await fn() } catch { /* toast */ } finally { setBusy(false) }
  }
  const link = () => run(async () => setS({ ...s, ...(await act(() => api.post('/whatsapp/link'))).data }))
  const unlink = () => {
    if (!confirm('Unlink WhatsApp? Messages will stop until you scan a new QR code.')) return
    run(async () => { await act(() => api.post('/whatsapp/unlink'), 'WhatsApp unlinked'); reload() })
  }
  const test = () => run(async () => {
    const { data } = await act(() => api.post('/whatsapp/test', { to: testTo }))
    if (data.status === 'SENT') toast.success(`Test message sent to ${data.recipient}`)
    else toast.error(data.error)
  })
  const saveCfg = (patch) => run(async () => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    await act(() => api.put('/businesses/current', { settings: { whatsapp: next } }), 'WhatsApp settings saved')
    await refreshBusiness()
    reload()
  })

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card title="Your WhatsApp" icon={Smartphone} className="lg:col-span-3">
        {s.provider === 'CLOUD' ? (
          <div className="space-y-2 text-sm">
            {s.connected
              ? <p className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="size-5" /> WhatsApp Business Cloud API is configured on the server.</p>
              : <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{s.error}</p>}
            <p className="text-slate-500">Messages go out from your Meta Business number. Free-form messages (invoices, reminders, product updates) only reach customers who messaged you in the last 24 hours, unless you use approved templates.</p>
          </div>
        ) : s.status === 'CONNECTED' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="size-6" /></span>
              <div>
                <div className="font-semibold">Linked{s.me?.name ? ` · ${s.me.name}` : ''}</div>
                <div className="text-sm text-slate-500">+{s.me?.phone}{s.connectedAt && ` · connected ${ago(s.connectedAt)}`}</div>
              </div>
              {can('whatsapp.manage') && <Button className="ml-auto" variant="secondary" loading={busy} onClick={unlink}><LogOut className="size-4" /> Unlink</Button>}
            </div>
            {can('whatsapp.manage') && (
              <div className="flex items-end gap-2">
                <Field label="Send a test message to" className="flex-1"><Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Mobile number" inputMode="tel" /></Field>
                <Button variant="secondary" disabled={testTo.replace(/\D/g, '').length < 8} loading={busy} onClick={test}><Send className="size-4" /> Send test</Button>
              </div>
            )}
          </div>
        ) : s.status === 'QR' && s.qr ? (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <img src={s.qr} alt="WhatsApp link QR code" className="size-64 rounded-lg border border-slate-200 bg-white p-2" />
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
              <li>Open <b>WhatsApp</b> on your phone</li>
              <li>Tap <b>Settings</b> (iPhone) or <b>⋮ Menu</b> (Android)</li>
              <li>Tap <b>Linked devices</b> → <b>Link a device</b></li>
              <li>Point your phone at this QR code</li>
              <li className="list-none pt-2 text-slate-500">The code refreshes by itself. This page updates as soon as you're linked.</li>
            </ol>
          </div>
        ) : s.status === 'CONNECTING' ? (
          <div className="flex items-center gap-3 py-8 text-sm text-slate-600"><Spinner /> Connecting to WhatsApp…</div>
        ) : (
          <div className="space-y-3 text-sm">
            {s.error && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{s.error}</p>}
            <p className="text-slate-600">Link your business WhatsApp number by scanning a QR code, like WhatsApp Web. Then you can send invoices, payment reminders and product updates straight from here.</p>
            {can('whatsapp.manage')
              ? <Button loading={busy} onClick={link}><QrCode className="size-4" /> {s.error ? 'Reconnect' : 'Link WhatsApp'}</Button>
              : <p className="text-slate-500">Ask the owner to link WhatsApp.</p>}
          </div>
        )}
      </Card>

      <div className="space-y-4 lg:col-span-2">
        {s.provider === 'LINKED' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> Use with care</div>
            <p className="mt-1">Linking by QR uses an unofficial connection. WhatsApp can ban numbers that send bulk or unwanted messages. A separate business number is safest.</p>
            <p className="mt-1">To lower the risk, bulk sends wait 6–14 seconds between messages, and product updates only go to customers who agreed to marketing.</p>
          </div>
        )}
        {can('settings.manage') && (
          <Card title="Settings">
            <div className="space-y-3">
              <Field label="Send WhatsApp messages using">
                <Select value={cfg.provider} onChange={(e) => saveCfg({ provider: e.target.value })} options={[{ value: 'LINKED', label: 'My WhatsApp number (scan QR)' }, { value: 'CLOUD', label: 'WhatsApp Business Cloud API (Meta)' }]} />
              </Field>
              <Field label="Default country code" hint="Added to 10-digit mobile numbers">
                <Input value={cfg.countryCode} onChange={(e) => setCfg({ ...cfg, countryCode: e.target.value.replace(/\D/g, '') })} onBlur={() => cfg.countryCode !== s.settings.countryCode && saveCfg({})} className="w-24" />
              </Field>
              <Toggle checked={!!cfg.autoSendInvoice} onChange={(v) => saveCfg({ autoSendInvoice: v })} label="Send the invoice on WhatsApp automatically" description="When a bill with a mobile number is saved at the POS" />
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// ───── Bulk progress ─────

function BatchProgress({ batch, onClose }) {
  const [data, setData] = useState(null)
  const done = data ? Object.values(data.counts || {}).reduce((a, b) => a + b, 0) : 0
  const finished = done >= batch.total
  useEffect(() => {
    if (finished) return undefined
    const load = () => api.get(`/whatsapp/messages?batchId=${batch.batchId}&limit=5`).then(({ data: d }) => setData(d)).catch(() => {})
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [batch.batchId, finished])
  const c = data?.counts || {}
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        {finished ? <CheckCircle2 className="size-4 text-emerald-600" /> : <RefreshCw className="size-4 animate-spin text-brand" />}
        {finished ? 'Finished' : 'Sending…'} {done} of {batch.total}
        {finished && <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Close"><X className="size-4" /></button>}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-brand transition-all" style={{ width: `${(done / batch.total) * 100}%` }} /></div>
      <div className="mt-2 text-slate-600">{c.SENT || 0} sent{c.FAILED ? ` · ${c.FAILED} failed` : ''}{c.NOT_CONNECTED ? ` · ${c.NOT_CONNECTED} not sent (disconnected)` : ''}</div>
      {!finished && <p className="mt-1 text-xs text-slate-500">Messages go out a few seconds apart. You can leave this page; sending continues on the server.</p>}
    </div>
  )
}

// ───── Product updates ─────

function ProductPicker({ selected, onChange }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const { data } = useFetch(dq ? `/catalog/products?q=${encodeURIComponent(dq)}&limit=8` : null)
  const { currency } = useAuth()
  const add = (p) => { if (!selected.some((x) => x.id === p.id)) onChange([...selected, p]); setQ('') }
  return (
    <div className="space-y-2">
      <div className="relative">
        <Input placeholder="Search products to feature" value={q} onChange={(e) => setQ(e.target.value)} />
        {dq && data?.products?.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
            {data.products.map((p) => (
              <li key={p.id}><button type="button" className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => add(p)}>
                <span>{p.name} {p.variant && <span className="text-slate-400">{p.variant}</span>}</span><span>{money(p.sellingPrice, currency)}</span>
              </button></li>
            ))}
          </ul>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
              {p.name}<button type="button" onClick={() => onChange(selected.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ProductUpdates({ s }) {
  const [products, setProducts] = useState([])
  const [message, setMessage] = useState(s.defaultUpdate)
  const [tags, setTags] = useState([])
  const [includeImage, setIncludeImage] = useState(true)
  const [audience, setAudience] = useState(null)
  const [previewed, setPreviewed] = useState(null) // { key, data }
  const [batch, setBatch] = useState(null)
  const [busy, setBusy] = useState(false)
  const body = { productIds: products.map((p) => p.id), message, tags, includeImage }
  // A preview only counts for exactly what it was made from; any edit means preview again before sending.
  const key = JSON.stringify(body)
  const preview = previewed?.key === key ? previewed.data : null

  useEffect(() => { api.post('/whatsapp/audience', { tags }).then(({ data }) => setAudience(data)).catch(() => {}) }, [tags])

  const doPreview = async () => {
    try { setPreviewed({ key, data: (await api.post('/whatsapp/broadcast/preview', body)).data }) } catch (e) { toast.error(errMsg(e)) }
  }
  const send = async () => {
    if (!confirm(`Send this product update to ${preview.count} customer${preview.count === 1 ? '' : 's'} on WhatsApp?`)) return
    setBusy(true)
    try { setBatch((await act(() => api.post('/whatsapp/broadcast', body))).data) } catch { /* toast */ } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card title="New product update" icon={Megaphone} className="lg:col-span-3">
        <div className="space-y-3">
          <Field label="Products"><ProductPicker selected={products} onChange={setProducts} /></Field>
          <Field label="Message" hint="{name} = customer's first name · {products} = the list above with prices · {business} · {link} = your online store">
            <Textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <Toggle checked={includeImage} onChange={setIncludeImage} label="Attach the first product's photo" />
          {audience?.tags.length > 0 && (
            <div><span className="label">Only customers tagged <span className="font-normal text-slate-400">(none selected = everyone who agreed)</span></span>
              <div className="flex flex-wrap gap-1.5">{audience.tags.map((t) => (
                <button key={t} type="button" onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}
                  className={`rounded-full border px-2.5 py-1 text-xs ${tags.includes(t) ? 'border-brand bg-brand text-brand-fg' : 'border-slate-200 hover:bg-slate-50'}`}>{t}</button>
              ))}</div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="mr-auto text-sm text-slate-600">{audience ? <><b>{audience.count}</b> customer{audience.count === 1 ? '' : 's'} will receive this</> : '…'}</span>
            <Button variant="secondary" onClick={doPreview}>Preview</Button>
            <Button loading={busy} disabled={!preview || !preview.count || !s.connected || !!batch} onClick={send}><Send className="size-4" /> Send update</Button>
          </div>
          {!s.connected && <p className="text-sm text-amber-700">Connect WhatsApp first (Connection tab).</p>}
          {batch && <BatchProgress batch={batch} onClose={() => setBatch(null)} />}
        </div>
      </Card>
      <div className="space-y-4 lg:col-span-2">
        <Card title="Preview">
          {preview ? (
            preview.sample ? (
              <div className="rounded-xl bg-[#e7ffdb] p-3 text-sm text-slate-800 shadow-sm">
                {preview.hasImage && <div className="mb-2 rounded-lg bg-black/5 px-2 py-6 text-center text-xs text-slate-500">📷 product photo</div>}
                <div className="whitespace-pre-wrap">{preview.sample}</div>
              </div>
            ) : <p className="text-sm text-slate-500">No customers match. Only customers who agreed to marketing messages and have a mobile number are included.</p>
          ) : <p className="text-sm text-slate-500">Click Preview to see the message as the first customer will get it.</p>}
        </Card>
        <p className="px-1 text-xs text-slate-500">Only customers marked <b>Consents to marketing messages</b> receive product updates. Change it on each customer's profile. At most {s.maxBulk} customers per send.</p>
      </div>
    </div>
  )
}

// ───── Payment reminders ─────

function Reminders({ s }) {
  const { currency, can } = useAuth()
  const { data, loading, reload } = useFetch('/whatsapp/dues')
  const [picked, setPicked] = useState([])
  const [sending, setSending] = useState(null)
  const [batch, setBatch] = useState(null)
  if (loading || !data) return <Spinner />
  const bills = data.bills
  const withPhone = bills.filter((b) => b.phone)
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])

  const sendOne = async (b) => {
    setSending(b.id)
    try {
      const { data: r } = await api.post(`/whatsapp/reminder/${b.id}`)
      if (r.status === 'SENT') toast.success(`Reminder sent for ${b.number}`)
      else toast.error(r.error)
      reload()
    } catch (e) { toast.error(errMsg(e)) } finally { setSending(null) }
  }
  const sendPicked = async () => {
    if (!confirm(`Send payment reminders for ${picked.length} bill${picked.length === 1 ? '' : 's'}?`)) return
    try { setBatch((await act(() => api.post('/whatsapp/reminders', { saleIds: picked }))).data); setPicked([]) } catch { /* toast */ }
  }

  return (
    <div className="space-y-4">
      {batch && <BatchProgress batch={batch} onClose={() => { setBatch(null); reload() }} />}
      <Card title="Bills with a balance due" icon={BellRing} bodyClass="p-0 overflow-x-auto"
        actions={can('whatsapp.manage') && withPhone.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPicked(picked.length === withPhone.length ? [] : withPhone.map((b) => b.id))}>{picked.length === withPhone.length ? 'Clear' : 'Select all'}</Button>
            <Button size="sm" disabled={!picked.length || !s.connected} onClick={sendPicked}><Send className="size-3.5" /> Remind {picked.length || ''}</Button>
          </div>
        )}>
        {!bills.length ? <Empty title="No unpaid bills">Every bill is fully paid.</Empty> : (
          <table className="table-base">
            <thead><tr>{can('whatsapp.manage') && <th />}<th>Bill</th><th>Customer</th><th className="text-right">Due</th><th>Billed</th><th>Last reminder</th><th /></tr></thead>
            <tbody>{bills.map((b) => (
              <tr key={b.id}>
                {can('whatsapp.manage') && <td><input type="checkbox" disabled={!b.phone} checked={picked.includes(b.id)} onChange={() => toggle(b.id)} aria-label={`Select ${b.number}`} /></td>}
                <td><Link to={`/sales/${b.id}`} className="font-medium text-brand">{b.number}</Link></td>
                <td>{b.name || 'Walk-in'}<div className="text-xs text-slate-400">{b.phone || 'No mobile number'}</div></td>
                <td className="text-right font-semibold text-red-600">{money(b.due, currency)}</td>
                <td className="whitespace-nowrap text-slate-500">{ago(b.createdAt)}</td>
                <td className="whitespace-nowrap text-slate-500">{b.lastRemindedAt ? ago(b.lastRemindedAt) : '–'}</td>
                <td className="text-right"><Button size="sm" variant="secondary" disabled={!b.phone || !s.connected} loading={sending === b.id} onClick={() => sendOne(b)}>Remind</Button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {!s.connected && <p className="text-sm text-amber-700">Connect WhatsApp first (Connection tab).</p>}
    </div>
  )
}

// ───── Log ─────

function MessageLog() {
  const [kind, setKind] = useState('')
  const { data, loading, reload } = useFetch(`/whatsapp/messages?limit=200${kind ? `&kind=${kind}` : ''}`, [kind])
  return (
    <Card title="Sent messages (latest 200)" icon={ScrollText} bodyClass="p-0 overflow-x-auto"
      actions={<div className="flex gap-2">
        <Select className="w-44 py-1" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: 'All messages' }, ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))]} />
        <Button size="sm" variant="ghost" onClick={reload} aria-label="Refresh"><RefreshCw className="size-4" /></Button>
      </div>}>
      {loading || !data ? <Spinner /> : !data.messages.length ? <Empty title="No messages yet" /> : (
        <table className="table-base">
          <thead><tr><th>When</th><th>Type</th><th>To</th><th>Status</th></tr></thead>
          <tbody>{data.messages.map((m) => {
            const [color, label] = STATUS_BADGE[m.status] || ['gray', m.status]
            return (
              <tr key={m.id}>
                <td className="whitespace-nowrap text-slate-500">{dateTime(m.createdAt)}</td>
                <td>{KIND_LABELS[m.kind] || m.kind}{m.kind === 'INVOICE' || m.kind === 'REMINDER' ? <> · <Link to={`/sales/${m.refId}`} className="text-brand">bill</Link></> : null}</td>
                <td>{m.name && <span className="mr-1">{m.name}</span>}<span className="text-slate-400">{m.recipient}</span></td>
                <td><Badge color={color}>{label}</Badge>{m.error && <div className="mt-0.5 max-w-xs text-xs text-red-600">{m.error}</div>}</td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
    </Card>
  )
}

export default function WhatsApp() {
  const { can } = useAuth()
  const [s, reload, setS] = useStatus()
  const [tab, setTab] = useState('connection')
  if (!s) return <Spinner />
  const tabs = [
    { value: 'connection', label: 'Connection', icon: Smartphone },
    ...(can('whatsapp.manage') ? [{ value: 'updates', label: 'Product updates', icon: Megaphone }] : []),
    ...(can('sales.view') ? [{ value: 'reminders', label: 'Payment reminders', icon: BellRing }] : []),
    { value: 'log', label: 'Message log', icon: ScrollText },
  ]
  return (
    <div>
      <PageHeader title="WhatsApp" subtitle="Send invoices, payment reminders and product updates to your customers"
        actions={<Badge color={s.connected ? 'green' : 'amber'}>{s.connected ? 'Connected' : s.status === 'QR' ? 'Waiting for scan' : 'Not connected'}</Badge>} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'connection' && <Connection s={s} reload={reload} setS={setS} />}
      {tab === 'updates' && <ProductUpdates s={s} />}
      {tab === 'reminders' && <Reminders s={s} />}
      {tab === 'log' && <MessageLog />}
    </div>
  )
}
