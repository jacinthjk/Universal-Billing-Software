import { useState } from 'react'
import { Plus, Trash2, PackageCheck, Undo2, Wallet, Truck, Factory } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Button, Card, Empty, Field, Input, Modal, PageHeader, Pager, Select, Spinner, StatusBadge, Tabs, Textarea, act, useDebounced, useFetch } from '../components/ui'
import { money, date, qty, today } from '../lib/format'

function ProductPicker({ onPick }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const { data } = useFetch(dq ? `/catalog/products?q=${encodeURIComponent(dq)}&kind=PRODUCT&limit=8` : null)
  return (
    <div className="relative">
      <Input placeholder="Search product to add…" value={q} onChange={(e) => setQ(e.target.value)} />
      {dq && data?.products?.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {data.products.map((p) => (
            <li key={p.id}><button className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onPick(p); setQ('') }}>
              <span>{p.name} {p.variant && <span className="text-slate-400">{p.variant}</span>}</span><span className="text-slate-400">{qty(p.stockQty)} {p.unit}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NewPurchase({ suppliers, onClose, onSaved }) {
  const { currency, business } = useAuth()
  const [f, setF] = useState({ supplierId: '', supplierRef: '', status: 'RECEIVED', date: today(), notes: '', paidAmount: '', paymentMethod: 'CASH' })
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const batch = (business.settings.fields || []).some((x) => x === 'batch' || x === 'expiry')
  const add = (p) => setItems((it) => [...it, { productId: p.id, name: p.name, unit: p.unit, qty: 1, unitCost: Number(p.costPrice || 0), taxRate: Number(p.taxRate), discount: 0, batchNo: '', expiryDate: '', batchTracking: p.batchTracking }])
  const upd = (i, k, v) => setItems((it) => it.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const line = (x) => { const base = x.qty * x.unitCost - (x.discount || 0); return base + base * (x.taxRate / 100) }
  const total = items.reduce((s, x) => s + line(x), 0)

  const save = async () => {
    setBusy(true)
    try {
      await act(() => api.post('/purchases', {
        ...f, supplierId: f.supplierId || null, paidAmount: Number(f.paidAmount) || 0,
        items: items.map((x) => ({ productId: x.productId, qty: Number(x.qty), unitCost: Number(x.unitCost), taxRate: Number(x.taxRate), discount: Number(x.discount) || 0, batchNo: x.batchNo || undefined, expiryDate: x.expiryDate || undefined })),
      }), f.status === 'RECEIVED' ? 'Purchase saved - stock updated' : 'Purchase order created')
      onSaved()
    } catch { /* toast */ } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="New purchase" size="xl" footer={<><span className="mr-auto self-center font-semibold">Total {money(total, currency)}</span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!items.length} onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Supplier"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} options={[{ value: '', label: 'Direct / no supplier' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        <Field label="Supplier invoice #"><Input value={f.supplierRef} onChange={(e) => setF({ ...f, supplierRef: e.target.value })} /></Field>
        <Field label="Type"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'RECEIVED', label: 'Goods received (update stock)' }, { value: 'ORDERED', label: 'Purchase order (receive later)' }]} /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <div className="mt-4"><ProductPicker onPick={add} /></div>
      <div className="mt-3 overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>Item</th><th>Qty</th><th>Unit cost</th><th>Disc.</th><th>Tax %</th>{batch && <><th>Batch</th><th>Expiry</th></>}<th className="text-right">Amount</th><th /></tr></thead>
          <tbody>
            {items.map((x, i) => (
              <tr key={i}>
                <td className="min-w-40">{x.name}</td>
                <td><input className="input w-20" type="number" step="any" value={x.qty} onChange={(e) => upd(i, 'qty', e.target.value)} /></td>
                <td><input className="input w-24" type="number" step="0.01" value={x.unitCost} onChange={(e) => upd(i, 'unitCost', e.target.value)} /></td>
                <td><input className="input w-20" type="number" value={x.discount} onChange={(e) => upd(i, 'discount', e.target.value)} /></td>
                <td><input className="input w-16" type="number" value={x.taxRate} onChange={(e) => upd(i, 'taxRate', e.target.value)} /></td>
                {batch && <><td><input className="input w-24" value={x.batchNo} onChange={(e) => upd(i, 'batchNo', e.target.value)} /></td><td><input className="input w-36" type="date" value={x.expiryDate} onChange={(e) => upd(i, 'expiryDate', e.target.value)} /></td></>}
                <td className="text-right font-medium">{money(line(x), currency)}</td>
                <td><button onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label="Remove"><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <p className="py-6 text-center text-sm text-slate-400">Search above to add items</p>}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Amount paid now"><Input type="number" value={f.paidAmount} onChange={(e) => setF({ ...f, paidAmount: e.target.value })} disabled={!f.supplierId} /></Field>
        <Field label="Paid via"><Select value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })} options={['CASH', 'UPI', 'BANK', 'CHEQUE']} /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

function PurchaseDetail({ id, onClose, onChanged }) {
  const { currency, can } = useAuth()
  const { data, reload } = useFetch(`/purchases/${id}`)
  const [ret, setRet] = useState({})
  const p = data?.purchase
  const receive = async () => { await act(() => api.post(`/purchases/${id}/receive`), 'Received - stock updated'); reload(); onChanged() }
  const doReturn = async () => {
    const items = Object.entries(ret).filter(([, v]) => Number(v) > 0).map(([itemId, v]) => ({ itemId, qty: Number(v) }))
    await act(() => api.post(`/purchases/${id}/return`, { items, reason: 'Returned to supplier' }), 'Purchase return recorded')
    setRet({}); reload(); onChanged()
  }
  return (
    <Modal open onClose={onClose} title={p ? `Purchase ${p.number}` : 'Purchase'} size="lg"
      footer={p && can('purchases.manage') && <>
        {p.status === 'ORDERED' && <Button onClick={receive}><PackageCheck className="size-4" /> Mark received</Button>}
        {p.status === 'RECEIVED' && Object.values(ret).some((v) => Number(v) > 0) && <Button variant="danger" onClick={doReturn}><Undo2 className="size-4" /> Return selected</Button>}
      </>}>
      {!p ? <Spinner /> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-4"><StatusBadge status={p.status} /><span>{p.supplier?.name || 'Direct'}</span><span>Ref: {p.supplierRef || '—'}</span><span>{date(p.date)}</span></div>
          <table className="table-base">
            <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Cost</th><th>Batch</th><th className="text-right">Amount</th>{p.status === 'RECEIVED' && <th>Return</th>}</tr></thead>
            <tbody>{p.items.map((i) => {
              const max = Number(i.qty) - Number(i.returnedQty)
              return (
                <tr key={i.id}>
                  <td>{i.name}{Number(i.returnedQty) > 0 && <div className="text-xs text-amber-600">Returned {qty(i.returnedQty)}</div>}</td>
                  <td className="text-right">{qty(i.qty)}</td><td className="text-right">{money(i.unitCost, currency)}</td>
                  <td className="text-xs">{i.batchNo || '—'}{i.expiryDate && <div>exp {date(i.expiryDate)}</div>}</td>
                  <td className="text-right">{money(i.lineTotal, currency)}</td>
                  {p.status === 'RECEIVED' && <td><input type="number" min="0" max={max} className="input w-20" disabled={max <= 0} value={ret[i.id] || ''} onChange={(e) => setRet({ ...ret, [i.id]: Math.min(Number(e.target.value), max) })} /></td>}
                </tr>
              )
            })}</tbody>
          </table>
          <div className="text-right"><div>Tax {money(p.tax, currency)}</div><div className="text-base font-bold">Total {money(p.total, currency)}</div><div className="text-slate-500">Paid {money(p.paidAmount, currency)}</div></div>
        </div>
      )}
    </Modal>
  )
}

function SupplierForm({ supplier, onClose, onSaved }) {
  const [f, setF] = useState(supplier || { name: '', phone: '', email: '', address: '', taxId: '', notes: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    const body = { name: f.name, phone: f.phone || null, email: f.email || null, address: f.address || null, taxId: f.taxId || null, notes: f.notes || null }
    await act(() => (supplier ? api.put(`/suppliers/${supplier.id}`, body) : api.post('/suppliers', body)), 'Supplier saved')
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title={supplier ? 'Edit supplier' : 'New supplier'} footer={<Button onClick={save} disabled={!f.name}>Save</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Phone"><Input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><Input value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Tax ID"><Input value={f.taxId || ''} onChange={set('taxId')} /></Field>
        <Field label="Address"><Input value={f.address || ''} onChange={set('address')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  )
}

export default function Purchases() {
  const { currency, can } = useAuth()
  const [tab, setTab] = useState('purchases')
  const [page, setPage] = useState(1)
  // ?new=1 (from the Home shortcuts) opens the form straight away.
  const [newOpen, setNewOpen] = useState(() => new URLSearchParams(window.location.search).get('new') === '1')
  const [detail, setDetail] = useState(null)
  const [supForm, setSupForm] = useState(null)
  const [payFor, setPayFor] = useState(null)
  const [pay, setPay] = useState({ amount: '', method: 'CASH', reference: '' })
  const purchases = useFetch(tab === 'purchases' ? `/purchases?page=${page}` : null)
  const suppliers = useFetch('/suppliers')

  const savePay = async () => {
    await act(() => api.post(`/suppliers/${payFor.id}/payments`, { ...pay, amount: Number(pay.amount) }), 'Payment recorded')
    setPayFor(null); suppliers.reload()
  }

  return (
    <div>
      <PageHeader kind="purchases" title="Purchases" subtitle="Suppliers, purchase orders, goods receipts and supplier payments"
        actions={<>
          {can('suppliers.manage', 'purchases.manage') && <Button variant="secondary" onClick={() => setSupForm('new')}><Plus className="size-4" /> Supplier</Button>}
          {can('purchases.manage') && <Button onClick={() => setNewOpen(true)}><Plus className="size-4" /> New purchase</Button>}
        </>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'purchases', label: 'Purchases', icon: Truck }, { value: 'suppliers', label: 'Suppliers', icon: Factory, count: suppliers.data?.suppliers.length }]} />

      {tab === 'purchases' && (
        <Card bodyClass="p-0 overflow-x-auto">
          {purchases.loading ? <Spinner /> : !purchases.data?.purchases.length ? <Empty title="No purchases recorded" /> : (
            <table className="table-base">
              <thead><tr><th>Number</th><th>Date</th><th>Supplier</th><th>Items</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Paid</th></tr></thead>
              <tbody>{purchases.data.purchases.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => setDetail(p.id)}>
                  <td className="font-medium text-brand">{p.number}</td><td>{date(p.date)}</td><td>{p.supplier?.name || 'Direct'}</td><td>{p._count.items}</td>
                  <td><StatusBadge status={p.status} /></td><td className="text-right font-medium">{money(p.total, currency)}</td><td className="text-right text-slate-500">{money(p.paidAmount, currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {purchases.data && <Pager page={page} total={purchases.data.total} onPage={setPage} />}
        </Card>
      )}

      {tab === 'suppliers' && (
        <Card bodyClass="p-0 overflow-x-auto">
          {!suppliers.data?.suppliers.length ? <Empty title="No suppliers yet" /> : (
            <table className="table-base">
              <thead><tr><th>Supplier</th><th>Contact</th><th className="text-right">Purchased</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th /></tr></thead>
              <tbody>{suppliers.data.suppliers.map((s) => (
                <tr key={s.id}>
                  <td><button className="font-medium text-brand" onClick={() => setSupForm(s)}>{s.name}</button><div className="text-xs text-slate-500">{s.address}</div></td>
                  <td className="text-slate-600">{s.phone}<div className="text-xs">{s.email}</div></td>
                  <td className="text-right">{money(s.purchased, currency)}</td><td className="text-right">{money(s.paid, currency)}</td>
                  <td className={`text-right font-semibold ${s.balance > 0 ? 'text-red-600' : ''}`}>{money(s.balance, currency)}</td>
                  <td>{can('suppliers.manage') && <Button size="sm" variant="secondary" onClick={() => { setPayFor(s); setPay({ amount: s.balance > 0 ? s.balance : '', method: 'CASH', reference: '' }) }}><Wallet className="size-3.5" /> Pay</Button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      )}

      {newOpen && <NewPurchase suppliers={suppliers.data?.suppliers || []} onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); purchases.reload(); suppliers.reload() }} />}
      {detail && <PurchaseDetail id={detail} onClose={() => setDetail(null)} onChanged={() => purchases.reload()} />}
      {supForm && <SupplierForm supplier={supForm === 'new' ? null : supForm} onClose={() => setSupForm(null)} onSaved={() => { setSupForm(null); suppliers.reload() }} />}
      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={`Pay ${payFor?.name}`} size="sm" footer={<Button onClick={savePay} disabled={!(Number(pay.amount) > 0)}>Save payment</Button>}>
        <div className="space-y-3">
          <Field label="Amount"><Input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
          <Field label="Method"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} options={['CASH', 'UPI', 'BANK', 'CHEQUE']} /></Field>
          <Field label="Reference"><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  )
}
