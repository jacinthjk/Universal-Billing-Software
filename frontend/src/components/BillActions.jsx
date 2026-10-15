// Edit and cancel flows for saved bills, shared by the Sales list and the bill detail page.
// When the business has a bill passcode, it is asked for first (and re-checked by the server on save).
import { useEffect, useState } from 'react'
import { Lock, Plus, Trash2, Ban, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { errMsg } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Button, Field, Input, Modal, Select, Spinner, Textarea, useDebounced, useFetch } from './ui'
import { money } from '../lib/format'

export function PasscodePrompt({ open, saleId, action, onCancel, onUnlocked }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setCode(''); setError('') } }, [open])
  const submit = async (e) => {
    e?.preventDefault()
    setBusy(true)
    try {
      await api.post(`/sales/${saleId}/unlock`, { passcode: code, action })
      onUnlocked(code)
    } catch (err) {
      setError(errMsg(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onCancel} title={action === 'edit' ? 'Unlock bill editing' : 'Unlock bill cancellation'} size="sm"
      footer={<><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button loading={busy} disabled={code.length < 4} onClick={submit}>Unlock</Button></>}>
      <form onSubmit={submit} className="space-y-3 text-center">
        <Lock className="mx-auto size-8 text-brand" />
        <p className="text-sm text-slate-600">Saved bills are protected. Enter the bill passcode to continue.</p>
        <input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={code}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError('') }}
          className="input mx-auto w-48 text-center text-2xl tracking-[0.5em]" aria-label="Passcode" />
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      </form>
    </Modal>
  )
}

function ProductAdder({ onAdd }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const { data } = useFetch(dq ? `/catalog/products?q=${encodeURIComponent(dq)}&limit=6` : null)
  const { currency } = useAuth()
  return (
    <div className="relative">
      <Input placeholder="Add item - search product" value={q} onChange={(e) => setQ(e.target.value)} />
      {dq && data?.products?.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          {data.products.map((p) => (
            <li key={p.id}><button type="button" className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onAdd(p); setQ('') }}>
              <span>{p.name} {p.variant && <span className="text-slate-400">{p.variant}</span>}</span><span>{money(p.sellingPrice, currency)}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  )
}

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100

export function EditBill({ open, saleId, passcode, onClose, onSaved }) {
  const { currency, can, business, t } = useAuth()
  const [data, setData] = useState(null)
  const [billing, setBilling] = useState({})
  const [lines, setLines] = useState([])
  const [payments, setPayments] = useState([])
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setData(null)
    api.get(`/sales/${saleId}`).then(({ data: d }) => {
      setData(d)
      const s = d.sale
      const c = d.invoice.customer
      setBilling({ name: c?.name?.startsWith('Walk-in') ? '' : c?.name || '', phone: c?.phone || '', email: c?.email || '', address: c?.address || '', taxId: c?.taxId || '' })
      setLines(s.items.map((i) => ({ productId: i.productId, name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.unitPrice), originalPrice: Number(i.unitPrice), discount: Number(i.discount), taxRate: Number(i.taxRate) })))
      setPayments(s.payments.length ? s.payments.map((p) => ({ method: p.method, amount: Number(p.amount) })) : [{ method: 'CASH', amount: 0 }])
      setNotes(s.notes || '')
      setReason('')
    }).catch((e) => { toast.error(errMsg(e)); onClose() })
  }, [open, saleId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null
  const itemsLocked = data?.sale.returns.length > 0
  const taxInclusive = business.settings.taxInclusive
  const est = lines.reduce((s, l) => {
    const base = Math.max(l.price * l.qty - (l.discount || 0), 0)
    return s + (taxInclusive ? base : base * (1 + l.taxRate / 100))
  }, 0)
  const total = round2(est)
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const upd = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const set = (k) => (e) => setBilling((b) => ({ ...b, [k]: e.target.value }))

  const save = async () => {
    if (reason.trim().length < 3) return toast.error('Enter a reason for the change')
    if (!lines.length) return toast.error('A bill needs at least one item - cancel the bill instead')
    setBusy(true)
    try {
      const body = {
        passcode, reason, billing, notes,
        payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) })),
        // The bill's original prices are always accepted; other prices need price-change permission (checked server-side).
        ...(itemsLocked ? {} : { items: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), discount: Number(l.discount) || 0, unitPrice: l.price })) }),
      }
      const { data: r } = await api.put(`/sales/${saleId}`, body)
      toast.success(`${r.invoice.number} updated`)
      onSaved(r)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={data ? `Edit bill ${data.sale.number}` : 'Edit bill'} size="xl"
      footer={<>
        <span className="mr-auto self-center text-sm">New total <b>{money(total, currency)}</b> · paid <b>{money(Math.min(paid, total), currency)}</b>{paid < total - 0.005 && <span className="text-red-600"> · balance {money(total - paid, currency)}</span>}</span>
        <Button variant="secondary" onClick={onClose}>Discard</Button>
        <Button loading={busy} onClick={save}><Pencil className="size-4" /> Save changes</Button>
      </>}>
      {!data ? <Spinner /> : (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-2">
            <h4 className="text-sm font-semibold text-slate-700">Bill to</h4>
            <Field label={`${t('customer')} name`}><Input value={billing.name} onChange={set('name')} placeholder={`Walk-in ${t('customer').toLowerCase()}`} /></Field>
            <Field label="Mobile number" hint="Changing it moves the bill (and its visit) to that customer"><Input value={billing.phone} onChange={set('phone')} inputMode="tel" /></Field>
            <Field label="Address"><Textarea rows={3} value={billing.address} onChange={set('address')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email"><Input value={billing.email} onChange={set('email')} /></Field>
              <Field label="GSTIN"><Input value={billing.taxId} onChange={set('taxId')} /></Field>
            </div>
            <Field label="Notes on bill"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Field label="Reason for change (required, kept in history)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong quantity entered" /></Field>
          </div>
          <div className="space-y-3 lg:col-span-3">
            <h4 className="text-sm font-semibold text-slate-700">Items</h4>
            {itemsLocked && <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-800">This bill has a return recorded, so items can't be changed. You can still edit customer details, payments and notes.</p>}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="table-base">
                <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Disc.</th><th className="text-right">Amount</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={`${l.productId}-${i}`}>
                      <td className="min-w-36">{l.name}<div className="text-[11px] text-slate-400">{l.taxRate ? `${l.taxRate}% tax` : ''}</div></td>
                      <td><input className="input w-20" type="number" min="0" step="any" disabled={itemsLocked} value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} /></td>
                      <td><input className="input w-24" type="number" min="0" step="0.01" disabled={itemsLocked || !can('sales.change_price')} value={l.price} onChange={(e) => upd(i, { price: Number(e.target.value) })} title={can('sales.change_price') ? '' : 'You need price-change permission'} /></td>
                      <td><input className="input w-20" type="number" min="0" disabled={itemsLocked || !can('sales.discount')} value={l.discount || ''} onChange={(e) => upd(i, { discount: Number(e.target.value) })} /></td>
                      <td className="text-right">{money(l.price * l.qty - (l.discount || 0), currency)}</td>
                      <td>{!itemsLocked && <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label="Remove item"><Trash2 className="size-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!itemsLocked && <ProductAdder onAdd={(p) => setLines((ls) => [...ls, { productId: p.id, name: p.variant ? `${p.name} (${p.variant})` : p.name, unit: p.unit, qty: 1, price: Number(p.sellingPrice), originalPrice: Number(p.sellingPrice), discount: 0, taxRate: Number(p.taxRate) }])} />}

            <h4 className="pt-2 text-sm font-semibold text-slate-700">Payments received</h4>
            {payments.map((p, i) => (
              <div key={i} className="flex gap-2">
                <Select className="w-36" value={p.method} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))} options={[...new Set([...business.settings.paymentModes, 'ONLINE', p.method])]} />
                <Input type="number" min="0" value={p.amount} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <Button variant="ghost" onClick={() => setPayments(payments.filter((_, j) => j !== i))} aria-label="Remove payment"><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPayments([...payments, { method: business.settings.paymentModes[0] || 'CASH', amount: 0 }])}><Plus className="size-3.5" /> Add payment</Button>
              <Button size="sm" variant="secondary" onClick={() => setPayments([{ method: payments[0]?.method || 'CASH', amount: total }])}>Paid in full ({money(total, currency)})</Button>
            </div>
            <p className="text-xs text-slate-500">Totals here are an estimate; the server recalculates prices, tax and stock when you save.</p>
          </div>
        </div>
      )}
    </Modal>
  )
}

const CANCEL_REASONS = ['Customer changed mind', 'Wrong items billed', 'Duplicate bill', 'Payment failed', 'Billing error']

export function CancelBill({ open, sale, needPasscode, onClose, onCancelled }) {
  const [reason, setReason] = useState('')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setReason(''); setPasscode(''); setError('') } }, [open])
  if (!open) return null
  const submit = async () => {
    setBusy(true)
    try {
      const { data } = await api.post(`/sales/${sale.id}/cancel`, { reason, passcode: passcode || undefined })
      toast.success(`${sale.number} cancelled - stock restored`)
      onCancelled(data.sale)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={`Cancel bill ${sale.number}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Keep bill</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3 || (needPasscode && passcode.length < 4)} onClick={submit}><Ban className="size-4" /> Cancel bill</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">The bill stays on record marked <b>CANCELLED</b>. Items go back into stock and the customer's visit is reversed. This can't be undone.</p>
        <div className="flex flex-wrap gap-1.5">
          {CANCEL_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={`rounded-full border px-2.5 py-1 text-xs ${reason === r ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 hover:bg-slate-50'}`}>{r}</button>)}
        </div>
        <Field label="Reason (printed on the cancelled bill)"><Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        {needPasscode && (
          <Field label="Bill passcode"><input type="password" inputMode="numeric" maxLength={8} autoComplete="off" value={passcode} onChange={(e) => { setPasscode(e.target.value.replace(/\D/g, '')); setError('') }} className="input tracking-[0.4em]" /></Field>
        )}
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

/**
 * Hook wiring the passcode prompt, editor and cancel dialog together.
 * Returns { startEdit(sale), startCancel(sale), dialogs } - render `dialogs` once in the page.
 */
export function useBillActions({ onChanged }) {
  const { business } = useAuth()
  const [unlock, setUnlock] = useState(null) // sale awaiting passcode for edit
  const [editing, setEditing] = useState(null) // { id, passcode }
  const [cancelling, setCancelling] = useState(null) // sale
  const startEdit = (sale) => (business.hasBillPasscode ? setUnlock(sale) : setEditing({ id: sale.id, passcode: undefined }))
  const startCancel = (sale) => setCancelling(sale)
  const dialogs = (
    <>
      <PasscodePrompt open={!!unlock} saleId={unlock?.id} action="edit" onCancel={() => setUnlock(null)} onUnlocked={(code) => { setEditing({ id: unlock.id, passcode: code }); setUnlock(null) }} />
      <EditBill open={!!editing} saleId={editing?.id} passcode={editing?.passcode} onClose={() => setEditing(null)} onSaved={(r) => { setEditing(null); onChanged?.(r.sale) }} />
      <CancelBill open={!!cancelling} sale={cancelling} needPasscode={business.hasBillPasscode} onClose={() => setCancelling(null)} onCancelled={(s) => { setCancelling(null); onChanged?.(s) }} />
    </>
  )
  return { startEdit, startCancel, dialogs }
}
