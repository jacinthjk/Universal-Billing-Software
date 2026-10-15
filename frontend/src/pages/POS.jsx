import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Search, Minus, Plus, Trash2, User, X, Printer, Image as ImageIcon, MessageCircle, ScanLine, CheckCircle2, FileText } from 'lucide-react'
import api, { errMsg, openFile } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Button, CustomerStatus, Input, Modal, useDebounced, Badge } from '../components/ui'
import BillPreview from '../components/BillPreview'
import { CategoryIcon, useBusinessIcons } from '../lib/businessIcons'
import { Banknote, QrCode, CreditCard, Wallet, Landmark } from 'lucide-react'

// Recognisable symbols for each payment mode.
const PAY_ICONS = { CASH: Banknote, UPI: QrCode, CARD: CreditCard, BANK: Landmark, WALLET: Wallet, OTHER: Wallet }
import { money, qty as fmtQty } from '../lib/format'

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100

// Client-side estimate only - the server recomputes every price and total.
function estimate(lines, billDiscount, taxInclusive) {
  let subtotal = 0, tax = 0, total = 0, disc = 0
  const gross = lines.map((l) => l.price * l.qty - (l.discount || 0))
  const g = gross.reduce((a, b) => a + b, 0)
  lines.forEach((l, i) => {
    const share = g > 0 ? (gross[i] / g) * billDiscount : 0
    const base = Math.max(gross[i] - share, 0)
    const rate = l.taxRate / 100
    const t = taxInclusive ? base - base / (1 + rate) : base * rate
    subtotal += l.price * l.qty
    disc += (l.discount || 0) + share
    tax += t
    total += taxInclusive ? base : base + t
  })
  return { subtotal: round2(subtotal), discount: round2(disc), tax: round2(tax), total: round2(total) }
}

function CustomerPanel({ customer, setCustomer }) {
  const { t } = useAuth()
  const [phone, setPhone] = useState(customer?.phone || '')
  const [name, setName] = useState('')
  const [result, setResult] = useState(null)
  const debounced = useDebounced(phone, 350)

  useEffect(() => {
    const digits = debounced.replace(/\D/g, '')
    if (digits.length < 10) { setResult(null); return }
    api.get('/customers/recognize', { params: { phone: debounced } }).then((r) => {
      setResult(r.data)
      if (r.data.customer) setCustomer({ ...r.data.customer, preview: r.data.preview })
      else setCustomer({ phone: debounced, name, preview: r.data.preview, isNew: true })
    }).catch(() => {})
  }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (customer?.isNew) setCustomer((c) => ({ ...c, name }))
  }, [name]) // eslint-disable-line react-hooks/exhaustive-deps

  if (customer && !customer.isNew) {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-slate-50 p-3">
        <div className="flex size-9 items-center justify-center rounded-full bg-brand text-brand-fg"><User className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{customer.name}</div>
          <div className="text-xs text-slate-500">{customer.phone} · {customer.code}</div>
          <div className="mt-1"><CustomerStatus status={customer.preview.status} visit={customer.preview.status === 'REPEAT' ? customer.preview.visitNumber : null} /></div>
        </div>
        <button onClick={() => { setCustomer(null); setPhone(''); setResult(null) }} className="rounded p-1 text-slate-400 hover:bg-slate-200" aria-label="Remove customer"><X className="size-4" /></button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <Input placeholder={`${t('customer')} mobile number`} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {result && !result.customer && (
        <>
          <Input placeholder={`New ${t('customer').toLowerCase()} name`} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <CustomerStatus status="NEW" />
        </>
      )}
    </div>
  )
}

function SuccessPanel({ sale, invoice, onNew }) {
  const { currency, business, can } = useAuth()
  const share = async () => {
    try {
      const { data } = await api.get(`/sales/${sale.id}/share`)
      window.open(data.whatsappUrl, '_blank', 'noopener')
    } catch (e) { toast.error(errMsg(e)) }
  }
  const shareImage = async () => {
    try {
      const res = await api.get(`/sales/${sale.id}/invoice.png`, { responseType: 'blob' })
      const file = new File([res.data], `${sale.number}.png`, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: sale.number })
      else await openFile(`/sales/${sale.id}/invoice.png`, { download: true, filename: `${sale.number}.png` })
    } catch (e) { if (e.name !== 'AbortError') toast.error(errMsg(e)) }
  }
  return (
    <div className="space-y-4 text-center">
      <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
      <div>
        <div className="text-lg font-bold">{invoice.title} {invoice.number}</div>
        <div className="text-3xl font-black">{money(invoice.total, currency)}</div>
        {invoice.customer && <div className="mt-2 text-sm text-slate-600">{invoice.customer.summary}</div>}
        {invoice.due > 0 && <div className="mt-1 text-sm font-medium text-red-600">Balance due {money(invoice.due, currency)}</div>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => openFile(`/sales/${sale.id}/invoice.pdf?format=${business.settings.invoice.format}`)}><Printer className="size-4" /> Print</Button>
        <Button variant="secondary" onClick={() => openFile(`/sales/${sale.id}/invoice.pdf?format=A4`, { download: true, filename: `${sale.number}.pdf` })}><FileText className="size-4" /> PDF</Button>
        <Button variant="secondary" onClick={shareImage}><ImageIcon className="size-4" /> Image</Button>
        <Button variant="success" onClick={share}><MessageCircle className="size-4" /> WhatsApp</Button>
      </div>
      {can('sales.edit') && <Link to={`/sales/${sale.id}?edit=1`} className="block text-sm font-medium text-brand">Need a correction? Edit this bill</Link>}
      <Button size="lg" className="w-full" onClick={onNew} autoFocus>New sale (Enter)</Button>
    </div>
  )
}

export default function POS() {
  const { currency, business, can, t } = useAuth()
  const bi = useBusinessIcons()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [lines, setLines] = useState([])
  const [customer, setCustomer] = useState(null)
  const [billDiscount, setBillDiscount] = useState(0)
  const [payments, setPayments] = useState([{ method: 'CASH', amount: '' }])
  const [done, setDone] = useState(null)
  const [previewing, setPreviewing] = useState(null) // { payload, billing } while the bill preview is open
  const [mobileCart, setMobileCart] = useState(false)
  const searchRef = useRef()
  const dq = useDebounced(q, 200)
  const modes = business.settings.paymentModes

  useEffect(() => { api.get('/catalog/categories').then((r) => setCategories(r.data.categories)) }, [])
  useEffect(() => {
    api.get('/catalog/products', { params: { q: dq || undefined, categoryId: category || undefined, limit: 60 } }).then((r) => setProducts(r.data.products))
  }, [dq, category])

  const totals = useMemo(() => estimate(lines, Number(billDiscount) || 0, business.settings.taxInclusive), [lines, billDiscount, business.settings.taxInclusive])
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const change = round2(paid - totals.total)

  const add = (p) => {
    if (p.stockStatus === 'OUT' && !business.settings.allowNegativeStock) {
      toast.error(`${p.name} is out of stock`)
      return
    }
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { productId: p.id, name: p.variant ? `${p.name} (${p.variant})` : p.name, unit: p.unit, price: Number(p.sellingPrice), basePrice: Number(p.sellingPrice), taxRate: Number(p.taxRate), qty: 1, discount: 0, available: p.available }]
    })
  }
  const update = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const remove = (i) => setLines((ls) => ls.filter((_, j) => j !== i))

  const onSearchEnter = async () => {
    const code = q.trim()
    if (!code) return
    try {
      const { data } = await api.get(`/catalog/products/lookup/${encodeURIComponent(code)}`)
      add(data.product)
      setQ('')
    } catch {
      if (products[0]) { add(products[0]); setQ('') }
    }
  }

  const reset = () => {
    setLines([]); setCustomer(null); setBillDiscount(0); setPayments([{ method: 'CASH', amount: '' }]); setDone(null); setMobileCart(false)
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  // Opens the bill preview; the sale is only saved when the cashier confirms there.
  const checkout = () => {
    if (!lines.length) return toast.error('Cart is empty')
    const pays = payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) }))
    // A blank amount on a single payment row means "paid in full" (the server caps tendered cash at the bill total).
    const finalPays = pays.length ? pays : [{ method: payments[0].method, amount: 1e9 }]
    setPreviewing({
      payload: {
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty, discount: l.discount || 0, ...(l.price !== l.basePrice ? { unitPrice: l.price } : {}) })),
        billDiscount: Number(billDiscount) || 0,
        payments: finalPays,
      },
      billing: { name: customer?.name || '', phone: customer?.phone || '', email: customer?.email || '', address: customer?.address || '', taxId: customer?.taxId || '' },
    })
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F9' && !previewing) { e.preventDefault(); if (!done) checkout() }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === 'Enter' && done) { e.preventDefault(); reset() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const cart = (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 p-3"><CustomerPanel customer={customer} setCustomer={setCustomer} /></div>
      <div className="flex-1 overflow-y-auto">
        {lines.length === 0 && (
          <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-slate-400">
            <span className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-brand"><bi.products className="size-8" strokeWidth={1.5} /></span>
            Scan a barcode or tap a {t('product').toLowerCase()} to add it
          </div>
        )}
        {lines.map((l, i) => (
          <div key={l.productId} className="border-b border-slate-50 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{l.name}</div>
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  {can('sales.change_price')
                    ? <input type="number" step="0.01" className="w-20 rounded border border-slate-200 px-1 py-0.5" value={l.price} onChange={(e) => update(i, { price: Number(e.target.value) })} aria-label="Unit price" />
                    : money(l.price, currency)}
                  <span>/{l.unit}{l.taxRate ? ` · ${l.taxRate}% tax` : ''}</span>
                </div>
              </div>
              <div className="text-right text-sm font-semibold">{money(l.price * l.qty - (l.discount || 0), currency)}</div>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex items-center rounded-lg border border-slate-200">
                <button className="p-1.5 hover:bg-slate-100" onClick={() => (l.qty > 1 ? update(i, { qty: round2(l.qty - 1) }) : remove(i))} aria-label="Decrease"><Minus className="size-3.5" /></button>
                <input className="w-14 border-x border-slate-200 py-1 text-center text-sm" type="number" step="any" min="0" value={l.qty} onChange={(e) => update(i, { qty: Math.max(Number(e.target.value), 0) })} aria-label="Quantity" />
                <button className="p-1.5 hover:bg-slate-100" onClick={() => update(i, { qty: round2(l.qty + 1) })} aria-label="Increase"><Plus className="size-3.5" /></button>
              </div>
              {can('sales.discount') && <input type="number" min="0" placeholder="Disc." className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm" value={l.discount || ''} onChange={(e) => update(i, { discount: Number(e.target.value) })} aria-label="Line discount" />}
              {l.available !== null && l.qty > l.available && <Badge color="red">Only {fmtQty(l.available)}</Badge>}
              <button className="ml-auto rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(i)} aria-label="Remove"><Trash2 className="size-4" /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{money(totals.subtotal, currency)}</span></div>
        {can('sales.discount') && (
          <div className="flex items-center justify-between"><span className="text-slate-500">Bill discount</span>
            <input type="number" min="0" className="w-24 rounded border border-slate-200 px-2 py-1 text-right" value={billDiscount || ''} onChange={(e) => setBillDiscount(e.target.value)} placeholder="0" />
          </div>
        )}
        {totals.discount > 0 && <div className="flex justify-between text-emerald-700"><span>Discount</span><span>-{money(totals.discount, currency)}</span></div>}
        <div className="flex justify-between"><span className="text-slate-500">Tax {business.settings.taxInclusive ? '(incl.)' : ''}</span><span>{money(totals.tax, currency)}</span></div>
        <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{money(totals.total, currency)}</span></div>
        <div className="space-y-1.5">
          {payments.map((p, i) => (
            <div key={i} className="flex gap-1.5">
              <div className="flex flex-1 gap-1">
                {modes.map((m) => (
                  <button key={m} onClick={() => setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, method: m } : x)))}
                    className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-xs font-bold ${p.method === m ? 'border-brand bg-brand text-brand-fg' : 'border-slate-300 bg-white text-slate-700 hover:border-brand'}`}>
                    {(() => { const Icon = PAY_ICONS[m] || Wallet; return <Icon className="size-4.5" /> })()}{m}
                  </button>
                ))}
              </div>
              <input type="number" min="0" placeholder={i === 0 ? 'Full' : 'Amount'} className="w-20 rounded-md border border-slate-200 px-2 text-right" value={p.amount} onChange={(e) => setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} aria-label="Amount tendered" />
              {i > 0 && <button onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))} className="text-slate-400" aria-label="Remove payment"><X className="size-4" /></button>}
            </div>
          ))}
          <div className="flex justify-between text-xs">
            <button className="text-brand" onClick={() => setPayments((ps) => [...ps, { method: modes[1] || 'UPI', amount: '' }])}>+ Split payment</button>
            {paid > 0 && <span className={change >= 0 ? 'text-emerald-700' : 'text-red-600'}>{change >= 0 ? `Change ${money(change, currency)}` : `Credit ${money(-change, currency)}`}</span>}
          </div>
        </div>
        <Button size="lg" className="w-full" onClick={checkout} disabled={!lines.length}>Preview bill · {money(totals.total, currency)} <kbd className="ml-1 rounded bg-black/15 px-1 text-[10px]">F9</kbd></Button>
      </div>
    </div>
  )

  return (
    <div className="-m-4 flex h-[calc(100%+2rem)] sm:-m-6 sm:h-[calc(100%+3rem)]">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-2 border-b border-slate-200 bg-white p-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
            <input ref={searchRef} autoFocus className="input pl-9 pr-9" placeholder={`Search ${t('products').toLowerCase()} or scan barcode  ( / )`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()} />
            <ScanLine className="absolute right-3 top-2.5 size-4 text-slate-400" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button onClick={() => setCategory('')} className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${!category ? 'bg-brand text-brand-fg' : 'bg-slate-100 text-slate-600'}`}>All</button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCategory(c.id)} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${category === c.id ? 'bg-brand text-brand-fg' : 'bg-slate-100 text-slate-600'}`}><CategoryIcon name={c.name} className="size-3.5" />{c.name}</button>
            ))}
          </div>
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <button key={p.id} onClick={() => add(p)} className={`card flex flex-col p-2.5 text-left transition hover:border-brand active:scale-[0.98] ${p.stockStatus === 'OUT' ? 'opacity-50' : ''}`}>
              {p.imageUrl ? <img src={p.imageUrl} alt="" className="mb-2 h-20 w-full rounded-md object-cover" /> : <div className="mb-2 flex h-20 items-center justify-center rounded-md bg-brand-soft text-brand/50"><CategoryIcon name={p.category?.name} className="size-8" strokeWidth={1.5} /></div>}
              <div className="line-clamp-2 text-sm font-medium leading-tight">{p.name}</div>
              {p.variant && <div className="text-xs text-slate-500">{p.variant}</div>}
              <div className="mt-auto flex items-end justify-between pt-1">
                <span className="font-bold">{money(p.sellingPrice, currency)}</span>
                {p.stockStatus !== 'NA' && <span className={`text-[11px] ${p.stockStatus === 'OUT' ? 'text-red-600' : p.stockStatus === 'LOW' ? 'text-amber-600' : 'text-slate-400'}`}>{fmtQty(p.available)} {p.unit}</span>}
              </div>
            </button>
          ))}
        </div>
        <button className="m-3 rounded-xl bg-brand p-3 font-semibold text-brand-fg lg:hidden" onClick={() => setMobileCart(true)}>
          View cart · {lines.length} items · {money(totals.total, currency)}
        </button>
      </div>
      <div className="hidden w-96 shrink-0 border-l border-slate-200 bg-white lg:block">{cart}</div>
      {mobileCart && (
        <div className="fixed inset-0 z-40 flex flex-col bg-white lg:hidden">
          <div className="flex items-center justify-between border-b p-3"><b>Cart</b><button onClick={() => setMobileCart(false)} aria-label="Close cart"><X className="size-5" /></button></div>
          <div className="min-h-0 flex-1">{cart}</div>
        </div>
      )}
      <BillPreview open={!!previewing} payload={previewing?.payload} initialBilling={previewing?.billing || {}}
        onBack={() => setPreviewing(null)} onConfirmed={(data) => { setPreviewing(null); setDone(data) }} />
      <Modal open={!!done} onClose={reset} title={`${t('sale')} complete`} size="sm">
        {done && <SuccessPanel sale={done.sale} invoice={done.invoice} onNew={reset} />}
      </Modal>
    </div>
  )
}
