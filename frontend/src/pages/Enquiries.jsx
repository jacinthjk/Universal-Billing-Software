import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Bot, AlarmClock } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Pager, Select, Spinner, StatusBadge, Tabs, Textarea, act, useDebounced, useFetch } from '../components/ui'
import { ago, titleCase } from '../lib/format'

export const ENQ_STATUSES = ['NEW', 'CONTACTED', 'ENGAGED', 'INTERESTED', 'QUALIFIED', 'HIGH_INTENT', 'QUOTATION', 'CONVERTED', 'CLOSED']
export const SOURCES = ['WALK_IN', 'WEBSITE', 'WEBSITE_AI', 'WHATSAPP', 'INSTAGRAM', 'PHONE', 'REFERRAL', 'OTHER']

function NewEnquiry({ onClose, onSaved }) {
  const { t } = useAuth()
  const [f, setF] = useState({ name: '', phone: '', email: '', source: 'WALK_IN', productId: '', itemText: '', quantity: '', message: '', followUpAt: '' })
  const [pq, setPq] = useState('')
  const dpq = useDebounced(pq)
  const products = useFetch(dpq ? `/catalog/products?q=${encodeURIComponent(dpq)}&limit=6` : null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]))
    body.source = f.source
    if (body.followUpAt) body.followUpAt = new Date(body.followUpAt).toISOString()
    const { data } = await act(() => api.post('/enquiries', body), 'Enquiry captured')
    onSaved(data.enquiry)
  }
  return (
    <Modal open onClose={onClose} title="New enquiry" footer={<Button onClick={save} disabled={!f.name && !f.phone}>Save enquiry</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`${t('customer')} name`}><Input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Mobile" hint="Matches an existing customer automatically"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Source"><Select value={f.source} onChange={set('source')} options={SOURCES.map((s) => ({ value: s, label: titleCase(s) }))} /></Field>
        <Field label="Follow-up"><Input type="datetime-local" value={f.followUpAt} onChange={set('followUpAt')} /></Field>
        <Field label={`Interested ${t('product').toLowerCase()}`} className="sm:col-span-2">
          {f.productId ? (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">{f.itemText}<button className="text-brand" onClick={() => setF({ ...f, productId: '', itemText: '' })}>change</button></div>
          ) : (
            <div className="relative">
              <Input placeholder="Search catalogue or type a requirement" value={pq || f.itemText} onChange={(e) => { setPq(e.target.value); setF({ ...f, itemText: e.target.value }) }} />
              {dpq && products.data?.products.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border bg-white shadow">{products.data.products.map((p) => (
                  <li key={p.id}><button className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { setF({ ...f, productId: p.id, itemText: `${p.name} ${p.variant || ''}`.trim() }); setPq('') }}>{p.name} {p.variant}</button></li>
                ))}</ul>
              )}
            </div>
          )}
        </Field>
        <Field label="Quantity / requirement"><Input value={f.quantity} onChange={set('quantity')} /></Field>
        <Field label="Email"><Input value={f.email} onChange={set('email')} /></Field>
        <Field label="Message / notes" className="sm:col-span-2"><Textarea value={f.message} onChange={set('message')} /></Field>
      </div>
    </Modal>
  )
}

export default function Enquiries() {
  const [status, setStatus] = useState('OPEN')
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)
  // ?new=1 (from the Home shortcuts) opens the form straight away.
  const [newOpen, setNewOpen] = useState(() => new URLSearchParams(window.location.search).get('new') === '1')
  const { can } = useAuth()
  const navigate = useNavigate()
  const dq = useDebounced(q)
  const statusParam = status === 'OPEN' ? ENQ_STATUSES.filter((s) => !['CONVERTED', 'CLOSED'].includes(s)).join(',') : status === 'DUE' ? '' : status
  const params = new URLSearchParams({ page, ...(statusParam ? { status: statusParam } : {}), ...(status === 'DUE' ? { due: '1', status: ENQ_STATUSES.slice(0, 7).join(',') } : {}), ...(dq ? { q: dq } : {}), ...(source ? { source } : {}), ...(mine ? { assignedToId: 'me' } : {}) })
  const { data, loading } = useFetch(`/enquiries?${params}`)
  const counts = data?.counts || {}
  const open = ENQ_STATUSES.slice(0, 7).reduce((s, k) => s + (counts[k] || 0), 0)

  return (
    <div>
      <PageHeader kind="enquiries" title="Enquiries & leads" subtitle="Capture, follow up and convert - including leads captured by the AI assistant"
        actions={can('enquiries.manage') && <Button onClick={() => setNewOpen(true)}><Plus className="size-4" /> New enquiry</Button>} />
      <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1) }} tabs={[
        { value: 'OPEN', label: 'Open', count: open }, { value: 'DUE', label: 'Follow-up due' }, { value: 'NEW', label: 'New', count: counts.NEW || 0 },
        { value: 'QUALIFIED', label: 'Qualified', count: counts.QUALIFIED || 0 }, { value: 'QUOTATION', label: 'Quoted', count: counts.QUOTATION || 0 },
        { value: 'CONVERTED', label: 'Converted', count: counts.CONVERTED || 0 }, { value: 'CLOSED', label: 'Closed', count: counts.CLOSED || 0 },
      ]} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-48" value={source} onChange={(e) => setSource(e.target.value)} options={[{ value: '', label: 'All sources' }, ...SOURCES.map((s) => ({ value: s, label: titleCase(s) }))]} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
      </div>
      <Card bodyClass="p-0 overflow-x-auto">
        {loading ? <Spinner /> : !data?.enquiries.length ? <Empty title="No enquiries here" /> : (
          <table className="table-base">
            <thead><tr><th>Lead</th><th>Interest</th><th>Source</th><th>Status</th><th>Score</th><th>Follow-up</th></tr></thead>
            <tbody>{data.enquiries.map((e) => (
              <tr key={e.id} className="cursor-pointer" onClick={() => navigate(`/enquiries/${e.id}`)}>
                <td><Link to={`/enquiries/${e.id}`} className="font-medium text-brand">{e.name || e.customer?.name || 'Unknown'}</Link>
                  <div className="text-xs text-slate-500">{e.phone || e.customer?.phone}</div></td>
                <td className="max-w-72"><div className="truncate">{e.productName || e.itemText || '—'}{e.quantity && <span className="text-slate-400"> · {e.quantity}</span>}</div><div className="truncate text-xs text-slate-500">{e.summary || e.message}</div></td>
                <td><span className="text-xs">{titleCase(e.source)}</span> {e.createdByAi && <Badge color="brand"><Bot className="size-3" /> AI</Badge>}</td>
                <td><StatusBadge status={e.status} />{e.priority === 'HIGH' && <Badge color="red" className="ml-1">High</Badge>}</td>
                <td>{e.leadScore > 0 ? <span className="font-medium">{e.leadScore}</span> : '—'}</td>
                <td className={`whitespace-nowrap text-xs ${e.followUpAt && new Date(e.followUpAt) < new Date() && !['CONVERTED', 'CLOSED'].includes(e.status) ? 'font-medium text-red-600' : 'text-slate-500'}`}>
                  {e.followUpAt ? (
                    <span className="flex items-center gap-1"><AlarmClock className="size-3.5" />
                      {new Date(e.followUpAt) < new Date() ? `due ${ago(e.followUpAt)}` : new Date(e.followUpAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {data && <Pager page={page} total={data.total} onPage={setPage} />}
      </Card>
      {newOpen && <NewEnquiry onClose={() => setNewOpen(false)} onSaved={(e) => navigate(`/enquiries/${e.id}`)} />}
    </div>
  )
}
