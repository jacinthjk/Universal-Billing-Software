import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bot, FileText, ShoppingBag, Trash2, Send, User } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Textarea, act, useDebounced, useFetch } from '../components/ui'
import { ENQ_STATUSES } from './Enquiries'
import { money, dateTime, titleCase } from '../lib/format'

const toLocal = (d) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

function Convert({ enquiry, product, onClose }) {
  const { currency } = useAuth()
  const [kind, setKind] = useState('QUOTATION')
  const [items, setItems] = useState(product ? [{ productId: product.id, name: product.name, price: Number(product.sellingPrice), qty: parseFloat(enquiry.quantity) || 1 }] : [])
  const [fulfilment, setFulfilment] = useState('PICKUP')
  const [address, setAddress] = useState(enquiry.location || '')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const { data } = useFetch(dq ? `/catalog/products?q=${encodeURIComponent(dq)}&limit=6` : null)
  const navigate = useNavigate()
  const save = async () => {
    const { data: r } = await act(() => api.post(`/enquiries/${enquiry.id}/convert`, { kind, items: items.map((i) => ({ productId: i.productId, qty: Number(i.qty) })), fulfilment, address: address || undefined }), `${kind === 'ORDER' ? 'Order' : 'Quotation'} created`)
    navigate(`/orders/${r.order.id}`)
  }
  return (
    <Modal open onClose={onClose} title="Convert enquiry" size="lg" footer={<Button onClick={save} disabled={!items.length}>Create {kind.toLowerCase()}</Button>}>
      <p className="mb-3 text-sm text-slate-500">Customer details are reused from the enquiry - nothing to retype. Prices come from the catalogue.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Create"><Select value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: 'QUOTATION', label: 'Quotation' }, { value: 'ORDER', label: 'Order (reserves stock)' }]} /></Field>
        <Field label="Fulfilment"><Select value={fulfilment} onChange={(e) => setFulfilment(e.target.value)} options={['PICKUP', 'DELIVERY']} /></Field>
        {fulfilment === 'DELIVERY' && <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>}
      </div>
      <div className="relative mt-3">
        <Input placeholder="Add item…" value={q} onChange={(e) => setQ(e.target.value)} />
        {dq && data?.products?.length > 0 && <ul className="absolute z-10 mt-1 w-full rounded-lg border bg-white shadow">{data.products.map((p) => (
          <li key={p.id}><button className="flex w-full justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { setItems([...items, { productId: p.id, name: `${p.name} ${p.variant || ''}`, price: Number(p.sellingPrice), qty: 1 }]); setQ('') }}><span>{p.name} {p.variant}</span><span>{money(p.sellingPrice, currency)}</span></button></li>
        ))}</ul>}
      </div>
      <table className="table-base mt-3"><tbody>{items.map((i, idx) => (
        <tr key={idx}><td>{i.name}</td><td><input className="input w-20" type="number" min="0" step="any" value={i.qty} onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, qty: e.target.value } : x)))} /></td>
          <td className="text-right">{money(i.price * i.qty, currency)}</td><td><button onClick={() => setItems(items.filter((_, j) => j !== idx))} aria-label="Remove"><Trash2 className="size-4 text-slate-400" /></button></td></tr>
      ))}</tbody></table>
    </Modal>
  )
}

export default function EnquiryDetail() {
  const { id } = useParams()
  const { can, currency } = useAuth()
  const { data, loading, reload } = useFetch(`/enquiries/${id}`)
  const staff = useFetch('/enquiries/meta/staff')
  const [note, setNote] = useState('')
  const [next, setNext] = useState('')
  const [convert, setConvert] = useState(false)
  if (loading || !data) return <Spinner />
  const e = data.enquiry
  const manage = can('enquiries.manage')
  const update = (patch, msg = 'Updated') => act(() => api.put(`/enquiries/${id}`, patch), msg).then(reload)
  const addNote = async () => {
    await act(() => api.post(`/enquiries/${id}/followups`, { note, nextFollowUpAt: next ? new Date(next).toISOString() : undefined }), 'Follow-up logged')
    setNote(''); setNext(''); reload()
  }

  return (
    <div>
      <PageHeader kind="enquiries" title={e.name || e.customer?.name || 'Enquiry'} subtitle={`${titleCase(e.source)} · ${dateTime(e.createdAt)}${e.createdByAi ? ' · captured by AI assistant' : ''}`}
        actions={manage && !['CONVERTED', 'CLOSED'].includes(e.status) && <>
          <Button variant="secondary" onClick={() => update({ status: 'CLOSED' }, 'Enquiry closed')}>Close</Button>
          <Button onClick={() => setConvert(true)}><FileText className="size-4" /> Convert to quote / order</Button>
        </>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Lead details">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="label">Customer</dt><dd>{e.customer ? <Link to={`/customers/${e.customer.id}`} className="text-brand">{e.customer.name} · {e.customer.visitCount} visits</Link> : 'Not linked'}</dd></div>
              <div><dt className="label">Contact</dt><dd>{e.phone || e.customer?.phone || '—'} {e.email && `· ${e.email}`}</dd></div>
              <div><dt className="label">Interested in</dt><dd>{data.product ? `${data.product.name} (${money(data.product.sellingPrice, currency)}/${data.product.unit})` : e.itemText || '—'}</dd></div>
              <div><dt className="label">Quantity</dt><dd>{e.quantity || '—'}</dd></div>
              <div><dt className="label">Intent / urgency</dt><dd>{titleCase(e.intent) || '—'} · {titleCase(e.urgency) || '—'}</dd></div>
              <div><dt className="label">Location / budget</dt><dd>{e.location || '—'} · {e.budget || '—'}</dd></div>
              {e.summary && <div className="sm:col-span-2"><dt className="label">Summary</dt><dd className="text-slate-700">{e.summary}</dd></div>}
              {e.nextAction && <div className="sm:col-span-2"><dt className="label">Suggested next action</dt><dd className="font-medium">{e.nextAction}</dd></div>}
              {e.message && <div className="sm:col-span-2"><dt className="label">Message</dt><dd className="whitespace-pre-wrap">{e.message}</dd></div>}
            </dl>
          </Card>

          <Card title="Follow-ups & notes">
            {manage && (
              <div className="mb-4 space-y-2">
                <Textarea placeholder="What happened? e.g. Called, shared price list…" value={note} onChange={(ev) => setNote(ev.target.value)} />
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Next follow-up"><Input type="datetime-local" value={next} onChange={(ev) => setNext(ev.target.value)} /></Field>
                  <Button onClick={addNote} disabled={!note.trim()}>Log follow-up</Button>
                </div>
              </div>
            )}
            <ol className="space-y-3 border-l-2 border-slate-100 pl-4">
              {e.followups.map((f) => (
                <li key={f.id} className="text-sm">
                  <div className="flex items-center gap-2 text-xs text-slate-400">{f.byAi ? <Bot className="size-3.5" /> : <User className="size-3.5" />}{f.byName || 'System'} · {dateTime(f.createdAt)}</div>
                  <div className="whitespace-pre-wrap text-slate-700">{f.note}</div>
                </li>
              ))}
              {!e.followups.length && <li className="text-sm text-slate-400">No follow-ups yet</li>}
            </ol>
          </Card>

          {data.conversation && (
            <Card title="AI conversation" actions={<Link to={`/ai?conversation=${data.conversation.id}`} className="text-xs text-brand">Open in AI inbox</Link>}>
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {data.conversation.transcript.map((m, i) => (
                  <div key={i} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-slate-100' : m.role === 'staff' ? 'ml-auto bg-violet-100' : 'ml-auto bg-brand-soft'}`}>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Status">
            <div className="space-y-3">
              <div className="flex items-center gap-2"><StatusBadge status={e.status} />{e.priority === 'HIGH' && <Badge color="red">High priority</Badge>}<span className="ml-auto text-sm text-slate-500">Score {e.leadScore}</span></div>
              {manage && <>
                <Field label="Status"><Select value={e.status} onChange={(ev) => update({ status: ev.target.value })} options={ENQ_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} /></Field>
                <Field label="Priority"><Select value={e.priority} onChange={(ev) => update({ priority: ev.target.value })} options={['LOW', 'NORMAL', 'HIGH']} /></Field>
                <Field label="Assigned to"><Select value={e.assignedToId || ''} onChange={(ev) => update({ assignedToId: ev.target.value || null }, 'Assigned')} options={[{ value: '', label: 'Unassigned' }, ...(staff.data?.staff || []).map((s) => ({ value: s.id, label: `${s.name} (${s.role})` }))]} /></Field>
                <Field label="Follow-up at"><Input type="datetime-local" defaultValue={toLocal(e.followUpAt)} onBlur={(ev) => ev.target.value !== toLocal(e.followUpAt) && update({ followUpAt: ev.target.value ? new Date(ev.target.value).toISOString() : null }, 'Follow-up scheduled')} /></Field>
              </>}
            </div>
          </Card>
          {e.orders.length > 0 && (
            <Card title="Linked quotes / orders">
              {e.orders.map((o) => <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center justify-between py-1 text-sm"><span className="flex items-center gap-1.5 text-brand"><ShoppingBag className="size-4" />{o.number}</span><StatusBadge status={o.status} /></Link>)}
            </Card>
          )}
          {(e.phone || e.customer?.phone) && (
            <a href={`https://wa.me/${(e.phone || e.customer.phone).length === 10 ? `91${e.phone || e.customer.phone}` : e.phone || e.customer.phone}`} target="_blank" rel="noreferrer">
              <Button variant="success" className="w-full"><Send className="size-4" /> Message on WhatsApp</Button>
            </a>
          )}
        </div>
      </div>
      {convert && <Convert enquiry={e} product={data.product} onClose={() => setConvert(false)} />}
    </div>
  )
}
