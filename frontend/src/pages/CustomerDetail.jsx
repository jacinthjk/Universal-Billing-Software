import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Pencil, MessageCircle, Phone, Mail, ReceiptText, ShoppingBag, MessageSquare } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, CustomerStatus, PageHeader, Spinner, Stat, StatusBadge, Tabs, useFetch } from '../components/ui'
import { CustomerForm } from './Customers'
import { money, date, dateTime } from '../lib/format'

export default function CustomerDetail() {
  const { id } = useParams()
  const { currency, can, t } = useAuth()
  const { data, loading, reload } = useFetch(`/customers/${id}`)
  const [tab, setTab] = useState('sales')
  const [edit, setEdit] = useState(false)
  if (loading || !data) return <Spinner />
  const c = data.customer
  const wa = c.phone ? `https://wa.me/${c.phone.length === 10 ? `91${c.phone}` : c.phone}` : null

  return (
    <div>
      <PageHeader kind="customers" title={c.name} subtitle={`${c.code} · ${t('customer')} since ${date(c.createdAt)}`}
        actions={<>
          {wa && <a href={wa} target="_blank" rel="noreferrer"><Button variant="success"><MessageCircle className="size-4" /> WhatsApp</Button></a>}
          {can('customers.manage') && <Button variant="secondary" onClick={() => setEdit(true)}><Pencil className="size-4" /> Edit</Button>}
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <CustomerStatus status={data.preview.status} visit={data.preview.status === 'REPEAT' ? c.visitCount : null} />
        <span className="text-xs text-slate-500">Next visit will be #{data.preview.visitNumber}</span>
        {c.phone && <span className="flex items-center gap-1"><Phone className="size-3.5" />{c.phone}</span>}
        {c.email && <span className="flex items-center gap-1"><Mail className="size-3.5" />{c.email}</span>}
        {c.isLead && <Badge color="amber">Lead</Badge>}
        {c.tags.map((tg) => <Badge key={tg}>{tg}</Badge>)}
        {c.marketingConsent && <Badge color="green">Marketing consent</Badge>}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Completed visits" value={c.visitCount} />
        <Stat label="Total spent" value={money(c.totalSpent, currency, { decimals: 0 })} />
        <Stat label="Average order" value={money(c.avgOrderValue, currency, { decimals: 0 })} />
        <Stat label="First / last purchase" value={<span className="text-base">{date(c.firstPurchaseAt)}</span>} sub={`Last: ${date(c.lastPurchaseAt)}`} />
        <Stat label="Outstanding" value={<span className={data.due > 0 ? 'text-red-600' : ''}>{money(data.due, currency, { decimals: 0 })}</span>} />
      </div>
      {c.notes && <Card className="mb-4"><p className="whitespace-pre-wrap text-sm text-slate-600">{c.notes}</p></Card>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'sales', label: 'Purchase history', icon: ReceiptText, count: data.sales.length }, { value: 'orders', label: 'Orders & quotes', icon: ShoppingBag, count: data.orders.length }, { value: 'enquiries', label: 'Enquiries', icon: MessageSquare, count: data.enquiries.length }]} />
      <Card bodyClass="p-0 overflow-x-auto">
        {tab === 'sales' && (
          <table className="table-base">
            <thead><tr><th>{t('invoice')}</th><th>Date</th><th>Visit</th><th>Channel</th><th>Status</th><th className="text-right">Total</th></tr></thead>
            <tbody>{data.sales.map((s) => (
              <tr key={s.id}><td><Link to={`/sales/${s.id}`} className="font-medium text-brand">{s.number}</Link></td><td>{dateTime(s.createdAt)}</td>
                <td>{s.visitNumber ? `#${s.visitNumber}` : '—'}</td><td className="text-xs">{s.channel}</td><td><StatusBadge status={s.status} /> <StatusBadge status={s.paymentStatus} /></td><td className="text-right font-medium">{money(s.total, currency)}</td></tr>
            ))}</tbody>
          </table>
        )}
        {tab === 'orders' && (
          <table className="table-base">
            <thead><tr><th>Number</th><th>Type</th><th>Date</th><th>Channel</th><th>Status</th><th className="text-right">Total</th></tr></thead>
            <tbody>{data.orders.map((o) => (
              <tr key={o.id}><td><Link to={`/orders/${o.id}`} className="font-medium text-brand">{o.number}</Link></td><td className="text-xs">{o.kind}</td><td>{date(o.createdAt)}</td><td className="text-xs">{o.channel}</td><td><StatusBadge status={o.status} /></td><td className="text-right">{money(o.total, currency)}</td></tr>
            ))}</tbody>
          </table>
        )}
        {tab === 'enquiries' && (
          <ul className="divide-y divide-slate-100">{data.enquiries.map((e) => (
            <li key={e.id} className="p-3"><Link to={`/enquiries/${e.id}`} className="flex items-center gap-2 font-medium text-brand">{e.itemText || e.intent || 'Enquiry'} <StatusBadge status={e.status} /></Link>
              <div className="text-sm text-slate-600">{e.summary || e.message}</div><div className="text-xs text-slate-400">{e.source} · {dateTime(e.createdAt)}</div></li>
          ))}</ul>
        )}
      </Card>
      {edit && <CustomerForm customer={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload() }} />}
    </div>
  )
}
