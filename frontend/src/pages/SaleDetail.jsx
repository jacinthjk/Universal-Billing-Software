import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Printer, FileText, Image as ImageIcon, MessageCircle, Undo2, Ban, Wallet, RefreshCw, Pencil, History, Lock, BellRing } from 'lucide-react'
import { useBillActions } from '../components/BillActions'
import api, { errMsg, fetchBlob, openFile } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Button, Card, CustomerStatus, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, useFetch, act } from '../components/ui'
import { money, dateTime, qty } from '../lib/format'

const HISTORY_LABELS = { 'sale.create': 'Bill created', 'sale.edit': 'Bill edited', 'sale.cancel': 'Bill cancelled', 'sale.payment': 'Payment recorded', 'sale.return': 'Items returned', 'passcode.failed': 'Wrong passcode entered', 'invoice.share': 'Shared', 'invoice.whatsapp': 'Sent on WhatsApp' }

export default function SaleDetail() {
  const { id } = useParams()
  const { currency, can, t, business } = useAuth()
  const { data, loading, reload } = useFetch(`/sales/${id}`)
  const [preview, setPreview] = useState(null)
  const [returnOpen, setReturnOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [ret, setRet] = useState({})
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState('CASH')
  const [payment, setPayment] = useState({ method: 'CASH', amount: '' })
  const history = useFetch(`/sales/${id}/history`)
  const [params, setParams] = useSearchParams()
  const actions = useBillActions({ onChanged: () => { reload(); history.reload() } })
  const wa = useFetch('/whatsapp/status')
  const [sendTo, setSendTo] = useState(null) // number prompt when the bill has no mobile number
  const [waBusy, setWaBusy] = useState(false)

  // Opened from the POS 'Edit bill' button: start the edit flow once.
  useEffect(() => {
    if (data && params.get('edit') === '1') {
      setParams({}, { replace: true })
      if (data.sale.status !== 'CANCELLED' && can('sales.edit')) actions.startEdit(data.sale)
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let url
    if (!data) return undefined
    // Clear the old image so an outdated bill is never shown while the updated one renders.
    setPreview(null)
    fetchBlob(`/sales/${id}/invoice.png`).then((b) => { url = URL.createObjectURL(b); setPreview(url) }).catch(() => {})
    return () => url && URL.revokeObjectURL(url)
  }, [data, id])

  if (loading || !data) return <Spinner />
  const { sale, invoice } = data

  const waConnected = !!wa.data?.connected
  // Linked/Cloud WhatsApp: send the invoice PDF from the business number. Otherwise open a wa.me link.
  const share = async () => {
    if (!waConnected) {
      try {
        const { data: s } = await api.get(`/sales/${id}/share`)
        window.open(s.whatsappUrl, '_blank', 'noopener')
      } catch (e) { toast.error(errMsg(e)) }
      return
    }
    if (!invoice.customer?.phone) return setSendTo('')
    await sendInvoice()
  }
  const sendInvoice = async (to) => {
    setWaBusy(true)
    try {
      const { data: r } = await api.post(`/whatsapp/invoice/${id}`, to ? { to } : {})
      if (r.status === 'SENT') { toast.success(`Invoice sent on WhatsApp to ${r.recipient}`); setSendTo(null); history.reload() } else toast.error(r.error)
    } catch (e) { toast.error(errMsg(e)) } finally { setWaBusy(false) }
  }
  const remind = async () => {
    setWaBusy(true)
    try {
      const { data: r } = await api.post(`/whatsapp/reminder/${id}`)
      if (r.status === 'SENT') toast.success(`Payment reminder sent to ${r.recipient}`)
      else toast.error(r.error)
    } catch (e) { toast.error(errMsg(e)) } finally { setWaBusy(false) }
  }
  const doReturn = async () => {
    const items = Object.entries(ret).filter(([, v]) => Number(v) > 0).map(([saleItemId, v]) => ({ saleItemId, qty: Number(v) }))
    if (!items.length) return toast.error('Enter quantities to return')
    await act(() => api.post(`/sales/${id}/return`, { items, reason, refundMethod }), 'Return recorded and stock updated')
    setReturnOpen(false); setRet({}); reload()
  }
  const pay = async () => {
    await act(() => api.post(`/sales/${id}/payments`, { method: payment.method, amount: Number(payment.amount) }), 'Payment recorded')
    setPayOpen(false); reload()
  }

  return (
    <div>
      <PageHeader kind="sale" title={`${invoice.title} ${sale.number}`} subtitle={`${dateTime(sale.createdAt)} · ${sale.channel}${sale.order ? ` · from order ${sale.order.number}` : ''}`}
        actions={<>
          <Button variant="secondary" onClick={() => openFile(`/sales/${id}/invoice.pdf?format=${business.settings.invoice.format}`)}><Printer className="size-4" /> Print</Button>
          <Button variant="secondary" onClick={() => openFile(`/sales/${id}/invoice.pdf?format=A4`, { download: true, filename: `${sale.number}.pdf` })}><FileText className="size-4" /> PDF</Button>
          <Button variant="secondary" onClick={() => openFile(`/sales/${id}/invoice.pdf?format=THERMAL`)}><Printer className="size-4" /> Thermal</Button>
          <Button variant="secondary" onClick={() => openFile(`/sales/${id}/invoice.png`, { download: true, filename: `${sale.number}.png` })}><ImageIcon className="size-4" /> Image</Button>
          <Button variant="success" loading={waBusy} onClick={share} title={waConnected ? 'Send the invoice PDF from your WhatsApp' : 'Open WhatsApp with the bill link'}><MessageCircle className="size-4" /> {waConnected ? 'Send on WhatsApp' : 'WhatsApp'}</Button>
        </>} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {sale.status === 'CANCELLED' && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <div className="flex items-center gap-2 font-semibold"><Ban className="size-4" /> This bill was cancelled</div>
              <div className="mt-1">Reason: {sale.cancelReason || 'Not recorded'}{sale.cancelledAt && ` · ${dateTime(sale.cancelledAt)}`}{sale.cancelledByName && ` · by ${sale.cancelledByName}`}</div>
              <div className="mt-1 text-xs text-red-700">Stock was restored and the customer's visit reversed. The bill stays on record and prints with a CANCELLED banner.</div>
            </div>
          )}
          <Card title="Summary">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={sale.status} /><StatusBadge status={sale.paymentStatus} />
              {sale.customer && <CustomerStatus status={sale.customerStatus} visit={sale.customerStatus === 'REPEAT' ? sale.visitNumber : null} />}
              {sale.editCount > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Edited {sale.editCount}× · last {dateTime(sale.editedAt)}</span>}
            </div>
            {invoice.customer && (
              <div className="mt-3 text-sm">
                {sale.customer ? <Link to={`/customers/${sale.customer.id}`} className="font-medium text-brand">{invoice.customer.summary}</Link> : <span className="font-medium">{invoice.customer.summary}</span>}
                {invoice.customer.phone && <span className="text-slate-500"> · {invoice.customer.phone}</span>}
                {invoice.customer.address && <div className="text-slate-500">{invoice.customer.address}</div>}
              </div>
            )}
            <table className="table-base mt-3">
              <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Disc.</th><th className="text-right">Tax</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {sale.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}{Number(i.returnedQty) > 0 && <div className="text-xs text-amber-600">Returned {qty(i.returnedQty)}</div>}</td>
                    <td className="text-right">{qty(i.qty)} {i.unit}</td>
                    <td className="text-right">{money(i.unitPrice, currency)}</td>
                    <td className="text-right">{Number(i.discount) ? money(i.discount, currency) : '–'}</td>
                    <td className="text-right">{Number(i.taxRate) ? `${Number(i.taxRate)}%` : '–'}</td>
                    <td className="text-right font-medium">{money(i.lineTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ml-auto mt-3 w-full max-w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>{money(invoice.subtotal, currency)}</span></div>
              {invoice.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>-{money(invoice.discount, currency)}</span></div>}
              <div className="flex justify-between"><span>Tax</span><span>{money(invoice.tax, currency)}</span></div>
              <div className="flex justify-between text-base font-bold"><span>Total</span><span>{money(invoice.total, currency)}</span></div>
              {invoice.payments.map((p, i) => <div key={i} className="flex justify-between text-emerald-700"><span>Paid · {p.method}</span><span>{money(p.amount, currency)}</span></div>)}
              {invoice.due > 0 && <div className="flex justify-between font-semibold text-red-600"><span>Balance due</span><span>{money(invoice.due, currency)}</span></div>}
              {invoice.returnsTotal > 0 && <div className="flex justify-between text-amber-700"><span>Refunded</span><span>-{money(invoice.returnsTotal, currency)}</span></div>}
            </div>
          </Card>

          {sale.status !== 'CANCELLED' && (
            <div className="flex flex-wrap gap-2">
              {invoice.due > 0 && can('pos.sell') && <Button onClick={() => { setPayment({ method: 'CASH', amount: invoice.due }); setPayOpen(true) }}><Wallet className="size-4" /> Record payment</Button>}
              {invoice.due > 0 && waConnected && invoice.customer?.phone && can('sales.view') && <Button variant="secondary" loading={waBusy} onClick={remind}><BellRing className="size-4" /> Send payment reminder</Button>}
              {can('sales.refund') && sale.status !== 'RETURNED' && <Button variant="secondary" onClick={() => setReturnOpen(true)}><Undo2 className="size-4" /> Return items</Button>}
              {can('sales.edit') && <Button variant="secondary" onClick={() => actions.startEdit(sale)}>{business.hasBillPasscode ? <Lock className="size-4" /> : <Pencil className="size-4" />} Edit bill</Button>}
              {can('sales.void') && <Button variant="danger" onClick={() => actions.startCancel(sale)}><Ban className="size-4" /> Cancel bill</Button>}
            </div>
          )}

          {history.data?.history.length > 0 && (
            <Card title={<span className="flex items-center gap-1.5"><History className="size-4" /> Bill history</span>} bodyClass="p-0">
              <ul className="divide-y divide-slate-100">
                {history.data.history.map((h) => (
                  <li key={h.id} className="px-4 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${h.action === 'sale.cancel' || h.action === 'passcode.failed' ? 'text-red-600' : ''}`}>{HISTORY_LABELS[h.action] || h.action}</span>
                      <span className="text-xs text-slate-400">{dateTime(h.at)} · {h.by}</span>
                    </div>
                    {h.data?.reason && <div className="text-slate-600">Reason: {h.data.reason}</div>}
                    {h.action === 'sale.edit' && h.data?.before && (
                      <div className="mt-1 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                        <div><b className="text-slate-600">Before</b> · {money(h.data.before.total, currency)} · {h.data.before.customer || 'Walk-in'}<div>{h.data.before.items.join(', ')}</div></div>
                        <div><b className="text-slate-600">After</b> · {money(h.data.after.total, currency)} · {h.data.after.customer || 'Walk-in'}<div>{h.data.after.items.join(', ')}</div></div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {sale.returns.length > 0 && (
            <Card title="Returns">
              {sale.returns.map((r) => <div key={r.id} className="flex justify-between border-b border-slate-50 py-1.5 text-sm last:border-0"><span>{r.number} · {r.reason || 'No reason'} · {dateTime(r.createdAt)}</span><span>{money(r.total, currency)}</span></div>)}
            </Card>
          )}
        </div>

        <Card title="Invoice image" className="lg:col-span-2" actions={<button onClick={() => fetchBlob(`/sales/${id}/invoice.png?regenerate=1`).then((b) => setPreview(URL.createObjectURL(b)))} className="text-slate-400 hover:text-slate-700" aria-label="Regenerate"><RefreshCw className="size-4" /></button>}>
          {preview ? <img src={preview} alt={`Invoice ${sale.number}`} className="w-full rounded-lg border border-slate-100" /> : <Spinner />}
        </Card>
      </div>

      {actions.dialogs}
      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title="Return items" footer={<Button onClick={doReturn}>Confirm return</Button>}>
        <div className="space-y-2">
          {sale.items.map((i) => {
            const max = Number(i.qty) - Number(i.returnedQty)
            return (
              <div key={i.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1">{i.name} <span className="text-slate-400">(max {qty(max)})</span></span>
                <input type="number" min="0" max={max} step="any" className="input w-24" value={ret[i.id] || ''} onChange={(e) => setRet({ ...ret, [i.id]: Math.min(Number(e.target.value), max) })} disabled={max <= 0} />
              </div>
            )
          })}
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Refund via"><Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} options={business.settings.paymentModes} /></Field>
        </div>
      </Modal>
      <Modal open={sendTo !== null} onClose={() => setSendTo(null)} title="Send invoice on WhatsApp" size="sm"
        footer={<Button loading={waBusy} disabled={(sendTo || '').replace(/\D/g, '').length < 8} onClick={() => sendInvoice(sendTo)}><MessageCircle className="size-4" /> Send</Button>}>
        <Field label="Mobile number" hint="This bill has no mobile number. Enter one to send the invoice to."><Input autoFocus inputMode="tel" value={sendTo || ''} onChange={(e) => setSendTo(e.target.value)} /></Field>
      </Modal>
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record payment" size="sm" footer={<Button onClick={pay}>Save payment</Button>}>
        <div className="space-y-3">
          <Field label="Method"><Select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })} options={business.settings.paymentModes} /></Field>
          <Field label="Amount"><Input type="number" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  )
}
