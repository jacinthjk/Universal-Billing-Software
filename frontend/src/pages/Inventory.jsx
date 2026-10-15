import { useState } from 'react'
import { SlidersHorizontal, Boxes, History, CalendarClock } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Pager, Select, Spinner, Stat, StatusBadge, Tabs, act, useDebounced, useFetch } from '../components/ui'
import { money, qty, dateTime, date } from '../lib/format'

const TYPE_COLORS = { PURCHASE_IN: 'green', OPENING: 'blue', SALE_OUT: 'violet', RETURN_IN: 'amber', PURCHASE_RETURN_OUT: 'red', ADJUSTMENT: 'gray', CANCEL_IN: 'amber', EDIT_IN: 'blue', EDIT_OUT: 'violet' }

function Adjust({ onClose, onDone }) {
  const [q, setQ] = useState('')
  const [product, setProduct] = useState(null)
  const [form, setForm] = useState({ mode: 'DELTA', qty: '', reason: 'Stock count correction' })
  const dq = useDebounced(q)
  const { data } = useFetch(dq ? `/catalog/products?q=${encodeURIComponent(dq)}&limit=8` : null)
  const save = async () => {
    await act(() => api.post('/inventory/adjust', { productId: product.id, mode: form.mode, qty: Number(form.qty), reason: form.reason }), 'Stock adjusted')
    onDone()
  }
  return (
    <Modal open onClose={onClose} title="Adjust stock" footer={<Button onClick={save} disabled={!product || form.qty === '' || form.reason.length < 2}>Save adjustment</Button>}>
      {!product ? (
        <div>
          <Input autoFocus placeholder="Search product" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-2 divide-y divide-slate-100">
            {data?.products.filter((p) => p.trackStock).map((p) => (
              <li key={p.id}><button className="flex w-full justify-between py-2 text-left text-sm hover:bg-slate-50" onClick={() => setProduct(p)}><span>{p.name} {p.variant}</span><span className="text-slate-500">{qty(p.stockQty)} {p.unit}</span></button></li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{product.name}</b> · on hand {qty(product.stockQty)} {product.unit} <button className="ml-2 text-brand" onClick={() => setProduct(null)}>change</button></div>
          <Field label="Adjustment type"><Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} options={[{ value: 'DELTA', label: 'Add / remove quantity (+/-)' }, { value: 'SET', label: 'Set counted quantity' }]} /></Field>
          <Field label={form.mode === 'SET' ? 'Counted quantity' : 'Quantity change (negative to remove)'}><Input type="number" step="any" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
          <Field label="Reason"><Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} options={['Stock count correction', 'Damaged', 'Expired', 'Wastage', 'Free sample', 'Internal use', 'Found stock']} /></Field>
        </div>
      )}
    </Modal>
  )
}

export default function Inventory() {
  const { currency, can } = useAuth()
  const [tab, setTab] = useState('stock')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [type, setType] = useState('')
  const [adjust, setAdjust] = useState(false)
  const dq = useDebounced(q)
  const summary = useFetch('/inventory/summary')
  const stock = useFetch(tab === 'stock' ? `/catalog/products?${new URLSearchParams({ page, kind: 'PRODUCT', ...(dq ? { q: dq } : {}), ...(status ? { status } : {}) })}` : null)
  const ledger = useFetch(tab === 'ledger' ? `/inventory/ledger?${new URLSearchParams({ page, ...(type ? { type } : {}) })}` : null)
  const s = summary.data

  return (
    <div>
      <PageHeader kind="inventory" title="Inventory" subtitle="Central stock ledger - every movement is recorded and auditable"
        actions={can('inventory.adjust') && <Button onClick={() => setAdjust(true)}><SlidersHorizontal className="size-4" /> Adjust stock</Button>} />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Tracked SKUs" value={s.skus} />
          {s.value !== undefined && <Stat label="Stock value (cost)" value={money(s.value, currency, { decimals: 0 })} />}
          <Stat label="Low stock" value={s.low} sub="At or below reorder level" />
          <Stat label="Out of stock" value={s.out} sub={`${s.expiring.length} batches expiring in 30 days`} />
        </div>
      )}
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1) }} tabs={[{ value: 'stock', label: 'Stock levels', icon: Boxes }, { value: 'ledger', label: 'Stock ledger', icon: History }, { value: 'expiry', label: 'Expiring batches', icon: CalendarClock, count: s?.expiring.length }]} />

      {tab === 'stock' && (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <Input className="sm:col-span-2" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, { value: 'LOW', label: 'Low' }, { value: 'OUT', label: 'Out' }, { value: 'OK', label: 'OK' }]} />
          </div>
          <Card bodyClass="p-0 overflow-x-auto">
            {stock.loading ? <Spinner /> : (
              <table className="table-base">
                <thead><tr><th>Product</th><th className="text-right">On hand</th><th className="text-right">Reserved</th><th className="text-right">Available</th><th className="text-right">Reorder at</th><th>Status</th></tr></thead>
                <tbody>
                  {stock.data?.products.filter((p) => p.trackStock).map((p) => (
                    <tr key={p.id}>
                      <td><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{p.variant} {p.sku}</div></td>
                      <td className="text-right">{qty(p.stockQty)} {p.unit}</td>
                      <td className="text-right text-slate-500">{qty(p.reserved)}</td>
                      <td className="text-right font-medium">{qty(p.available)}</td>
                      <td className="text-right text-slate-500">{p.reorderLevel ?? '—'}</td>
                      <td><StatusBadge status={p.stockStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {stock.data && <Pager page={page} total={stock.data.total} onPage={setPage} />}
          </Card>
        </>
      )}

      {tab === 'ledger' && (
        <>
          <div className="mb-3 w-60"><Select value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All movements' }, ...Object.keys(TYPE_COLORS)]} /></div>
          <Card bodyClass="p-0 overflow-x-auto">
            {ledger.loading ? <Spinner /> : !ledger.data?.entries.length ? <Empty title="No stock movements yet" /> : (
              <table className="table-base">
                <thead><tr><th>Date</th><th>Product</th><th>Type</th><th className="text-right">Qty</th><th className="text-right">Balance</th><th>Reference / note</th><th>By</th></tr></thead>
                <tbody>
                  {ledger.data.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap text-slate-500">{dateTime(e.createdAt)}</td>
                      <td>{e.product?.name}</td>
                      <td><Badge color={TYPE_COLORS[e.type]}>{e.type.replace(/_/g, ' ').toLowerCase()}</Badge></td>
                      <td className={`text-right font-medium ${Number(e.qty) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{Number(e.qty) > 0 ? '+' : ''}{qty(e.qty)}</td>
                      <td className="text-right">{qty(e.balanceAfter)}</td>
                      <td className="text-xs text-slate-500">{[e.refType, e.batchNo && `batch ${e.batchNo}`, e.note].filter(Boolean).join(' · ')}</td>
                      <td className="text-xs text-slate-500">{e.userName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {ledger.data && <Pager page={page} total={ledger.data.total} onPage={setPage} />}
          </Card>
        </>
      )}

      {tab === 'expiry' && (
        <Card bodyClass="p-0">
          {!s?.expiring.length ? <Empty title="No batches expiring in the next 30 days" /> : (
            <table className="table-base">
              <thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th className="text-right">Qty</th></tr></thead>
              <tbody>{s.expiring.map((b) => (
                <tr key={b.id}><td>{b.product.name}</td><td>{b.batchNo}</td><td className={new Date(b.expiryDate) < new Date() ? 'font-medium text-red-600' : ''}>{date(b.expiryDate)}</td><td className="text-right">{qty(b.qty)} {b.product.unit}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      )}
      {adjust && <Adjust onClose={() => setAdjust(false)} onDone={() => { setAdjust(false); summary.reload(); stock.reload(); ledger.reload() }} />}
    </div>
  )
}
