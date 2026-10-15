import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Copy, Receipt, CheckCircle2, XCircle, Link2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, act, useFetch } from '../components/ui'
import { money, dateTime, qty, titleCase } from '../lib/format'

const STEPS = ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY', 'COMPLETED']

export default function OrderDetail() {
  const { id } = useParams()
  const { currency, can, business, t } = useAuth()
  const { data, loading, reload } = useFetch(`/orders/${id}`)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [payment, setPayment] = useState({ method: 'CASH', amount: '' })
  const navigate = useNavigate()
  if (loading || !data) return <Spinner />
  const o = data.order
  const manage = can('orders.manage')
  const move = (status) => act(() => api.post(`/orders/${id}/status`, { status }), `Order ${status.toLowerCase()}`).then(reload)

  const createInvoice = async () => {
    const pays = o.paymentStatus === 'PAID' ? undefined : Number(payment.amount) > 0 ? [{ method: payment.method, amount: Number(payment.amount) }] : []
    const { data: r } = await act(() => api.post(`/orders/${id}/invoice`, { payments: pays }), `${t('invoice')} created - stock updated`)
    navigate(`/sales/${r.sale.id}`)
  }

  return (
    <div>
      <PageHeader kind="orders" title={`${o.kind === 'QUOTATION' ? 'Quotation' : 'Order'} ${o.number}`} subtitle={`${o.channel}${o.createdByAi ? ' · placed via AI assistant' : ''} · ${dateTime(o.createdAt)}`}
        actions={<Button variant="secondary" onClick={() => { navigator.clipboard.writeText(data.trackingUrl); toast.success('Tracking link copied') }}><Link2 className="size-4" /> Tracking link</Button>} />

      {o.kind === 'ORDER' && o.status !== 'CANCELLED' && (
        <ol className="mb-4 flex overflow-x-auto rounded-xl border border-slate-200 bg-white text-xs font-medium">
          {STEPS.map((s, i) => {
            const reached = STEPS.indexOf(o.status) >= i
            return <li key={s} className={`flex-1 whitespace-nowrap px-3 py-2.5 text-center ${reached ? 'bg-brand text-brand-fg' : 'text-slate-400'} ${i ? 'border-l border-white/30' : ''}`}>{titleCase(s)}</li>
          })}
        </ol>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Items" className="lg:col-span-2" bodyClass="p-0">
          <table className="table-base">
            <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{o.items.map((i) => <tr key={i.id}><td>{i.name}</td><td className="text-right">{qty(i.qty)}</td><td className="text-right">{money(i.unitPrice, currency)}</td><td className="text-right">{money(i.lineTotal, currency)}</td></tr>)}</tbody>
          </table>
          <div className="space-y-1 border-t border-slate-100 p-4 text-right text-sm">
            <div>Tax {money(o.tax, currency)}</div>
            <div className="text-lg font-bold">Total {money(o.total, currency)}</div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Status">
            <div className="mb-3 flex flex-wrap gap-2"><StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} />{o.kind === 'QUOTATION' && <Badge color="blue">Quotation</Badge>}</div>
            {o.sale && <Link to={`/sales/${o.sale.id}`} className="mb-3 flex items-center gap-1.5 text-sm font-medium text-brand"><Receipt className="size-4" /> {t('invoice')} {o.sale.number}</Link>}
            {manage && (
              <div className="flex flex-wrap gap-2">
                {o.kind === 'QUOTATION' && !['CANCELLED', 'COMPLETED'].includes(o.status) && <Button onClick={() => act(() => api.post(`/orders/${id}/accept-quotation`), 'Order created from quotation').then((r) => navigate(`/orders/${r.data.order.id}`))}><CheckCircle2 className="size-4" /> Accept → order</Button>}
                {o.kind === 'ORDER' && data.nextStatuses.filter((s) => !['COMPLETED', 'CANCELLED'].includes(s)).map((s) => <Button key={s} variant="secondary" onClick={() => move(s)}>Mark {s.toLowerCase()}</Button>)}
                {o.kind === 'ORDER' && !o.sale && data.nextStatuses.includes('COMPLETED') && <Button onClick={() => { setPayment({ method: o.paymentMethod === 'ONLINE' ? 'ONLINE' : 'CASH', amount: o.paymentStatus === 'PAID' ? '' : Number(o.total) }); setInvoiceOpen(true) }}><Receipt className="size-4" /> Complete & invoice</Button>}
                {o.paymentStatus !== 'PAID' && !o.sale && o.status !== 'CANCELLED' && <Button variant="secondary" onClick={() => act(() => api.post(`/orders/${id}/mark-paid`, {}), 'Marked paid').then(reload)}>Mark paid</Button>}
                {data.nextStatuses.includes('CANCELLED') && <Button variant="danger" onClick={() => confirm('Cancel this order? Reserved stock will be released.') && move('CANCELLED')}><XCircle className="size-4" /> Cancel</Button>}
              </div>
            )}
          </Card>
          <Card title={t('customer')}>
            <div className="space-y-1 text-sm">
              {o.customer ? <Link to={`/customers/${o.customer.id}`} className="font-medium text-brand">{o.contactName}</Link> : <div className="font-medium">{o.contactName}</div>}
              <div>{o.contactPhone} {o.contactEmail && `· ${o.contactEmail}`}</div>
              {o.customer && <div className="text-xs text-slate-500">{o.customer.visitCount} previous visits</div>}
              <div className="pt-2"><span className="label">Fulfilment</span>{titleCase(o.fulfilment)}{o.address && <div className="text-slate-600">{o.address}</div>}</div>
              <div><span className="label">Payment</span>{titleCase(o.paymentMethod)}{o.paymentRef && <span className="text-xs text-slate-400"> · {o.paymentRef}</span>}</div>
              {o.notes && <div><span className="label">Notes</span>{o.notes}</div>}
              {o.enquiry && <Link to={`/enquiries/${o.enquiry.id}`} className="block pt-1 text-xs text-brand">View originating enquiry</Link>}
              <button className="flex items-center gap-1 pt-1 text-xs text-slate-500" onClick={() => { navigator.clipboard.writeText(data.trackingUrl); toast.success('Copied') }}><Copy className="size-3" /> Copy customer tracking link</button>
            </div>
          </Card>
        </div>
      </div>

      <Modal open={invoiceOpen} onClose={() => setInvoiceOpen(false)} title="Complete order & create invoice" size="sm" footer={<Button onClick={createInvoice}>Create {t('invoice').toLowerCase()}</Button>}>
        {o.paymentStatus === 'PAID' ? <p className="text-sm">Paid online ({o.paymentRef}). The invoice will record the online payment.</p> : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Record what the customer paid now. Leave 0 to invoice on credit.</p>
            <Field label="Method"><Select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })} options={[...business.settings.paymentModes, 'ONLINE']} /></Field>
            <Field label="Amount"><Input type="number" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
