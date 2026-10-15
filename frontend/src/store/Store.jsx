import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ShoppingCart, Search, Minus, Plus, Trash2, MapPin, Phone, Clock, CheckCircle2, Package, Truck, Store as StoreIcon, AtSign, Globe, MessageCircle, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import { publicApi, errMsg } from '../lib/api'
import { applyTheme, setFavicon } from '../lib/theme'
import { money, dateTime, titleCase } from '../lib/format'
import { Spinner } from '../components/ui'
import { BusinessMark, ThemeIcon } from '../lib/icons'
import { StoreCategoryIcon } from '../lib/businessIcons'

// Shown when a product has no photo: the business's icon on a soft brand background.
const ProductPlaceholder = ({ category, icon, className }) => (
  <div className="flex size-full items-center justify-center text-brand/40"><StoreCategoryIcon name={category} fallback={icon} className={className} strokeWidth={1.5} /></div>
)
import { useCart } from './cart'
import ChatWidget from './ChatWidget'

const StoreCtx = createContext(null)
const useStore = () => useContext(StoreCtx)

// Surface tokens for the store's light/dark theme mode.
const SURFACES = {
  light: { page: 'bg-stone-50 text-slate-900', card: 'bg-white border-slate-200', muted: 'text-slate-500', input: 'bg-white border-slate-300 text-slate-900', header: 'bg-white/90 border-slate-200' },
  dark: { page: 'bg-slate-950 text-slate-100 store-dark', card: 'bg-slate-900 border-slate-800', muted: 'text-slate-400', input: 'bg-slate-900 border-slate-700 text-slate-100', header: 'bg-slate-950/90 border-slate-800' },
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const el = document.createElement('script')
    el.src = src
    el.onload = resolve
    el.onerror = reject
    document.body.appendChild(el)
  })
}

function Price({ value }) {
  const { business } = useStore()
  if (value === null || value === undefined) return null
  return <>{money(value, business.currency)}</>
}

function ProductCard({ p }) {
  const { slug, s, business } = useStore()
  const { add } = useCart(slug)
  return (
    <div className={`group flex flex-col overflow-hidden rounded-[var(--radius)] border ${s.card}`}>
      <Link to={`/s/${slug}/p/${p.id}`} className="block aspect-square overflow-hidden bg-brand-soft">
        {p.imageUrl ? <img src={p.imageUrl} alt={p.name} loading="lazy" className="size-full object-cover transition group-hover:scale-105" /> : <ProductPlaceholder category={p.category?.name} icon={business.theme.icon} className="size-14" />}
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <Link to={`/s/${slug}/p/${p.id}`} className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</Link>
        {p.variant && <div className={`text-xs ${s.muted}`}>{p.variant}</div>}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <div className="font-bold"><Price value={p.price} /></div>
            {p.mrp && p.mrp > p.price && <div className={`text-xs line-through ${s.muted}`}><Price value={p.mrp} /></div>}
          </div>
          {p.inStock
            ? <button onClick={() => { add(p.id); toast.success('Added to cart') }} className="rounded-[var(--radius)] bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:brightness-110">Add</button>
            : <span className="text-xs font-medium text-red-500">Out of stock</span>}
        </div>
      </div>
    </div>
  )
}

function Home() {
  const { slug, business, categories, s } = useStore()
  const [params, setParams] = useSearchParams()
  const category = params.get('category') || ''
  const [q, setQ] = useState(params.get('q') || '')
  const [sort, setSort] = useState('')
  const [data, setData] = useState(null)
  useEffect(() => {
    const t = setTimeout(() => {
      publicApi.get(`/${slug}/products`, { params: { category: category || undefined, q: q || undefined, sort: sort || undefined, limit: 48 } }).then((r) => setData(r.data))
    }, 250)
    return () => clearTimeout(t)
  }, [slug, category, q, sort])
  const w = business.website
  return (
    <>
      <section className="relative overflow-hidden bg-brand text-brand-fg">
        {w.bannerUrl && <img src={w.bannerUrl} alt="" className="absolute inset-0 size-full object-cover opacity-30" />}
        {/* Large faded business icon as a decorative backdrop */}
        <ThemeIcon name={business.theme.icon} aria-hidden="true" strokeWidth={1.25} className="pointer-events-none absolute -right-8 top-1/2 hidden size-80 -translate-y-1/2 opacity-15 md:block" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <h1 className="max-w-2xl text-3xl font-black tracking-tight sm:text-5xl">{w.heroTitle || business.name}</h1>
          <p className="mt-3 max-w-xl text-base opacity-90 sm:text-lg">{w.heroSubtitle || w.tagline}</p>
          <div className="mt-6 flex max-w-md items-center gap-2 rounded-full bg-white p-1.5 pl-4 text-slate-900 shadow-lg">
            <Search className="size-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${business.terminology.products.toLowerCase()}`} className="flex-1 bg-transparent py-1.5 text-sm outline-none" />
          </div>
          {w.deliveryNote && <p className="mt-4 text-sm opacity-90">🚚 {w.deliveryNote}</p>}
        </div>
      </section>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button onClick={() => setParams({})} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${!category ? 'bg-brand text-brand-fg' : `border ${s.card}`}`}>All</button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => setParams({ category: c.slug })} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium ${category === c.slug ? 'bg-brand text-brand-fg' : `border ${s.card}`}`}><StoreCategoryIcon name={c.name} fallback={business.theme.icon} className="size-4" />{c.name}</button>
          ))}
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={`ml-auto rounded-full border px-3 py-1.5 text-sm ${s.input}`} aria-label="Sort">
            <option value="">Sort: Name</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="new">Newest</option>
          </select>
        </div>
        {!data ? <Spinner /> : !data.products.length ? <p className={`py-16 text-center ${s.muted}`}>No {business.terminology.products.toLowerCase()} found.</p> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{data.products.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        )}
      </div>
    </>
  )
}

function EnquiryForm({ productId }) {
  const { slug, s } = useStore()
  const [f, setF] = useState({ name: '', phone: '', message: '' })
  const [sent, setSent] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    try {
      await publicApi.post(`/${slug}/enquiries`, { ...f, productId })
      setSent(true)
    } catch (err) { toast.error(errMsg(err)) }
  }
  if (sent) return <div className="rounded-[var(--radius)] bg-emerald-50 p-4 text-sm text-emerald-800">Thanks! We have received your enquiry and will contact you soon.</div>
  const cls = `w-full rounded-[var(--radius)] border px-3 py-2 text-sm outline-none focus:border-brand ${s.input}`
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input required minLength={2} placeholder="Your name" className={cls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input required minLength={6} placeholder="Mobile number" inputMode="tel" className={cls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </div>
      <textarea required minLength={2} placeholder="Your question or requirement" className={`${cls} min-h-20`} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      <button className="rounded-[var(--radius)] bg-brand px-4 py-2 text-sm font-semibold text-brand-fg">Send enquiry</button>
    </form>
  )
}

function ProductPage() {
  const { id } = useParams()
  const { slug, business, s } = useStore()
  const { add } = useCart(slug)
  const [data, setData] = useState(null)
  const [qty, setQty] = useState(1)
  const navigate = useNavigate()
  useEffect(() => { setData(null); publicApi.get(`/${slug}/products/${id}`).then((r) => setData(r.data)).catch(() => setData({ error: true })) }, [slug, id])
  if (!data) return <Spinner />
  if (data.error) return <p className="py-20 text-center">Product not found. <Link className="text-brand" to={`/s/${slug}`}>Back to store</Link></p>
  const p = data.product
  const details = Object.entries(p.customFields || {}).filter(([, v]) => v)
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="aspect-square overflow-hidden rounded-[var(--radius)] bg-brand-soft">
          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="size-full object-cover" /> : <ProductPlaceholder category={p.category?.name} icon={business.theme.icon} className="size-28" />}
        </div>
        <div>
          {p.category && <Link to={`/s/${slug}?category=${p.category.slug}`} className="text-sm font-medium text-brand">{p.category.name}</Link>}
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{p.name}</h1>
          {p.variant && <div className={s.muted}>{p.variant}{p.brand ? ` · ${p.brand}` : ''}</div>}
          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-3xl font-black"><Price value={p.price} /></span>
            {p.mrp && p.mrp > p.price && <span className={`line-through ${s.muted}`}><Price value={p.mrp} /></span>}
            <span className={`text-sm ${s.muted}`}>/ {p.unit} {p.taxRate > 0 && (business.taxInclusive ? '(incl. tax)' : `+ ${p.taxRate}% tax`)}</span>
          </div>
          <div className={`mt-2 text-sm font-medium ${p.inStock ? 'text-emerald-600' : 'text-red-500'}`}>{p.inStock ? (p.available ? `In stock · ${p.available} ${p.unit} available` : 'In stock') : 'Currently out of stock'}</div>
          {p.inStock && business.website.allowOrders && (
            <div className="mt-5 flex items-center gap-3">
              <div className={`flex items-center rounded-[var(--radius)] border ${s.card}`}>
                <button className="p-2.5" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease"><Minus className="size-4" /></button>
                <span className="w-10 text-center font-semibold">{qty}</span>
                <button className="p-2.5" onClick={() => setQty(qty + 1)} aria-label="Increase"><Plus className="size-4" /></button>
              </div>
              <button onClick={() => { add(p.id, qty); toast.success('Added to cart') }} className="rounded-[var(--radius)] border-2 border-brand px-5 py-2.5 font-semibold text-brand">Add to cart</button>
              <button onClick={() => { add(p.id, qty); navigate(`/s/${slug}/cart`) }} className="rounded-[var(--radius)] bg-brand px-5 py-2.5 font-semibold text-brand-fg">Buy now</button>
            </div>
          )}
          {p.description && <p className={`mt-6 whitespace-pre-wrap leading-relaxed ${s.muted}`}>{p.description}</p>}
          {details.length > 0 && <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">{details.map(([k, v]) => <div key={k}><dt className={s.muted}>{titleCase(k)}</dt><dd className="font-medium">{String(v)}</dd></div>)}</dl>}
          <div className={`mt-8 rounded-[var(--radius)] border p-4 ${s.card}`}>
            <h2 className="mb-2 font-semibold">Have a question about this?</h2>
            <EnquiryForm productId={p.id} />
          </div>
        </div>
      </div>
      {data.related.length > 0 && (
        <div className="mt-12"><h2 className="mb-3 text-lg font-bold">You may also like</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{data.related.map((r) => <ProductCard key={r.id} p={r} />)}</div></div>
      )}
    </div>
  )
}

function CartPage() {
  const { slug, business, s } = useStore()
  const cart = useCart(slug)
  const [params, setParams] = useSearchParams()
  const [priced, setPriced] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', fulfilment: business.website.fulfilment[0] || 'PICKUP', address: '', paymentMethod: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [idem] = useState(() => `ck-${crypto.randomUUID?.() || Date.now()}`)
  const navigate = useNavigate()

  // Cart links built by the AI assistant: ?add=<base64url [{id,q}]>
  useEffect(() => {
    const token = params.get('add')
    if (!token) return
    try {
      const items = JSON.parse(atob(token.replace(/-/g, '+').replace(/_/g, '/')))
      cart.replace(items.map((x) => ({ productId: x.id, qty: Number(x.q) || 1 })))
      toast.success('Your cart is ready')
    } catch { /* ignore malformed link */ }
    setParams({}, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cart.items.length) { setPriced({ lines: [], total: 0, tax: 0, subtotal: 0, problems: [] }); return }
    publicApi.post(`/${slug}/cart`, { items: cart.items }).then((r) => setPriced(r.data)).catch((e) => toast.error(errMsg(e)))
  }, [slug, cart.items])

  const payOptions = [...business.website.paymentOptions.filter((o) => (form.fulfilment === 'DELIVERY' ? o === 'PAY_ON_DELIVERY' : o === 'PAY_AT_PICKUP')), ...(business.onlinePayments ? ['ONLINE'] : [])]
  const payment = payOptions.includes(form.paymentMethod) ? form.paymentMethod : payOptions[0]

  const placeOrder = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { data } = await publicApi.post(`/${slug}/orders`, {
        items: cart.items, contact: { name: form.name, phone: form.phone, email: form.email || undefined }, fulfilment: form.fulfilment,
        address: form.fulfilment === 'DELIVERY' ? form.address : undefined, paymentMethod: payment, notes: form.notes || undefined, idempotencyKey: idem,
      })
      const trackUrl = `/s/${slug}/track/${data.order.trackingToken}?placed=1`
      cart.clear()
      if (data.checkout?.provider === 'razorpay') {
        // Payment is confirmed server-side by the verified webhook, not by this callback.
        await loadScript('https://checkout.razorpay.com/v1/checkout.js')
        new window.Razorpay({
          key: data.checkout.keyId, order_id: data.checkout.gatewayOrderId, amount: data.checkout.amount, currency: data.checkout.currency,
          name: business.name, prefill: { name: form.name, contact: form.phone },
          handler: () => navigate(trackUrl), modal: { ondismiss: () => navigate(trackUrl) },
        }).open()
        return
      }
      navigate(trackUrl)
    } catch (err) {
      toast.error(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const cls = `w-full rounded-[var(--radius)] border px-3 py-2 text-sm outline-none focus:border-brand ${s.input}`
  if (!priced) return <Spinner />
  if (!cart.items.length) return <div className="py-24 text-center"><ShoppingCart className={`mx-auto size-10 ${s.muted}`} /><p className="mt-3">Your cart is empty.</p><Link to={`/s/${slug}`} className="mt-2 inline-block font-medium text-brand">Continue shopping</Link></div>
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <h1 className="mb-4 text-2xl font-bold">Your cart</h1>
        <div className={`divide-y rounded-[var(--radius)] border ${s.card} divide-slate-500/10`}>
          {priced.lines.map((l) => (
            <div key={l.productId} className="flex items-center gap-3 p-3">
              <div className="size-14 shrink-0 overflow-hidden rounded-md bg-brand-soft">{l.product.imageUrl && <img src={l.product.imageUrl} alt="" className="size-full object-cover" />}</div>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{l.name}</div><div className={`text-xs ${s.muted}`}>{money(l.unitPrice, business.currency)} / {l.unit}</div></div>
              <div className={`flex items-center rounded-md border ${s.card}`}>
                <button className="p-1.5" onClick={() => cart.setQty(l.productId, l.qty - 1)} aria-label="Decrease"><Minus className="size-3.5" /></button>
                <span className="w-8 text-center text-sm">{l.qty}</span>
                <button className="p-1.5" onClick={() => cart.setQty(l.productId, l.qty + 1)} aria-label="Increase"><Plus className="size-3.5" /></button>
              </div>
              <div className="w-24 text-right font-semibold">{money(l.lineTotal, business.currency)}</div>
              <button onClick={() => cart.setQty(l.productId, 0)} className={s.muted} aria-label="Remove"><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
        {priced.problems.map((p) => <p key={p.productId} className="mt-2 text-sm text-red-500">{p.message}</p>)}
        <div className="mt-3 space-y-1 text-right text-sm">
          <div className={s.muted}>Tax {money(priced.tax, business.currency)}</div>
          <div className="text-xl font-bold">Total {money(priced.total, business.currency)}</div>
        </div>
      </div>
      <form onSubmit={placeOrder} className={`h-fit space-y-3 rounded-[var(--radius)] border p-4 lg:col-span-2 ${s.card}`}>
        <h2 className="text-lg font-bold">Checkout</h2>
        {!business.website.allowOrders ? <p className={s.muted}>Online ordering is currently unavailable. Please use the chat or enquiry form.</p> : <>
          <input required minLength={2} placeholder="Full name" className={cls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input required minLength={6} placeholder="Mobile number" inputMode="tel" className={cls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input type="email" placeholder="Email (optional)" className={cls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            {business.website.fulfilment.map((f) => (
              <button type="button" key={f} onClick={() => setForm({ ...form, fulfilment: f })} className={`flex items-center justify-center gap-2 rounded-[var(--radius)] border p-2.5 text-sm font-medium ${form.fulfilment === f ? 'border-brand bg-brand-soft text-brand' : s.card}`}>
                {f === 'DELIVERY' ? <Truck className="size-4" /> : <StoreIcon className="size-4" />}{f === 'DELIVERY' ? 'Delivery' : 'Store pickup'}
              </button>
            ))}
          </div>
          {form.fulfilment === 'DELIVERY' && <textarea required placeholder="Delivery address" className={`${cls} min-h-20`} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />}
          <div className="space-y-1.5">
            {payOptions.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm"><input type="radio" name="pay" checked={payment === o} onChange={() => setForm({ ...form, paymentMethod: o })} />{o === 'ONLINE' ? 'Pay online now' : titleCase(o)}</label>
            ))}
            {!payOptions.length && <p className="text-sm text-red-500">No payment option is available for this fulfilment method.</p>}
          </div>
          <input placeholder="Order notes (optional)" className={cls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button disabled={busy || !payOptions.length || priced.problems.length > 0} className="w-full rounded-[var(--radius)] bg-brand py-3 font-bold text-brand-fg disabled:opacity-50">
            {busy ? 'Placing order…' : `Place order · ${money(priced.total, business.currency)}`}
          </button>
          <p className={`text-center text-xs ${s.muted}`}>Prices and availability are confirmed by the store when you order.</p>
        </>}
      </form>
    </div>
  )
}

const TRACK_STEPS = ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY', 'COMPLETED']
function TrackPage() {
  const { token } = useParams()
  const { slug, business, s } = useStore()
  const [params] = useSearchParams()
  const [data, setData] = useState(null)
  useEffect(() => {
    const load = () => publicApi.get(`/${slug}/track/${token}`).then((r) => setData(r.data)).catch(() => setData({ error: true }))
    load()
    const id = setInterval(load, 20000)
    return () => clearInterval(id)
  }, [slug, token])
  if (!data) return <Spinner />
  if (data.error) return <p className="py-20 text-center">Order not found.</p>
  const o = data.order
  const idx = TRACK_STEPS.indexOf(o.status)
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {params.get('placed') && <div className="mb-6 flex items-center gap-3 rounded-[var(--radius)] bg-emerald-50 p-4 text-emerald-800"><CheckCircle2 className="size-6" /><div><b>Thank you, {o.contactName}!</b><div className="text-sm">Your order {o.number} has been received. Bookmark this page to track it.</div></div></div>}
      <h1 className="text-2xl font-bold">{o.kind === 'QUOTATION' ? 'Quotation' : 'Order'} {o.number}</h1>
      <p className={s.muted}>Placed {dateTime(o.createdAt)} · {titleCase(o.fulfilment)} · {titleCase(o.paymentMethod)}</p>
      {o.status === 'CANCELLED' ? <p className="mt-6 font-semibold text-red-500">This order was cancelled.</p> : (
        <ol className="mt-6 space-y-3">
          {TRACK_STEPS.map((st, i) => (
            <li key={st} className="flex items-center gap-3">
              <span className={`flex size-8 items-center justify-center rounded-full ${i <= idx ? 'bg-brand text-brand-fg' : `border ${s.card}`}`}>{i < idx || o.status === 'COMPLETED' ? <CheckCircle2 className="size-4" /> : i === idx ? <Package className="size-4" /> : i + 1}</span>
              <span className={i <= idx ? 'font-semibold' : s.muted}>{{ PENDING: 'Received', CONFIRMED: 'Confirmed', PROCESSING: 'Being prepared', READY: o.fulfilment === 'DELIVERY' ? 'Out for delivery' : 'Ready for pickup', COMPLETED: 'Completed' }[st]}</span>
            </li>
          ))}
        </ol>
      )}
      <div className={`mt-8 rounded-[var(--radius)] border p-4 ${s.card}`}>
        {o.items.map((i) => <div key={i.name} className="flex justify-between py-1 text-sm"><span>{i.qty} × {i.name}</span><span>{money(i.lineTotal, business.currency)}</span></div>)}
        <div className="mt-2 flex justify-between border-t border-slate-500/20 pt-2 font-bold"><span>Total</span><span>{money(o.total, business.currency)}</span></div>
        <div className={`mt-1 text-sm ${s.muted}`}>Payment: {o.paymentStatus.toLowerCase()}</div>
        {o.invoice && <Link to={`/verify/${o.invoice.verifyToken}`} className="mt-2 inline-block text-sm font-medium text-brand">View invoice {o.invoice.number}</Link>}
      </div>
    </div>
  )
}

function About() {
  const { business, s } = useStore()
  const w = business.website
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-bold">About {business.name}</h1>
      {w.about && <p className={`whitespace-pre-wrap leading-relaxed ${s.muted}`}>{w.about}</p>}
      <div className={`grid gap-4 rounded-[var(--radius)] border p-5 sm:grid-cols-2 ${s.card}`}>
        {business.address && <div className="flex gap-2"><MapPin className="size-5 text-brand" />{[business.address, business.city].filter(Boolean).join(', ')}</div>}
        {business.phone && <a href={`tel:${business.phone}`} className="flex gap-2"><Phone className="size-5 text-brand" />{business.phone}</a>}
        {business.email && <a href={`mailto:${business.email}`} className="flex gap-2"><Mail className="size-5 text-brand" />{business.email}</a>}
        {w.hours && <div className="flex gap-2"><Clock className="size-5 text-brand" />{w.hours}</div>}
      </div>
      {w.mapUrl && <a href={w.mapUrl} target="_blank" rel="noreferrer" className="font-medium text-brand">Open in Maps →</a>}
      {Object.entries(w.policies).filter(([, v]) => v).map(([k, v]) => (
        <section key={k} id={k}><h2 className="mb-1 text-lg font-semibold">{titleCase(k)} policy</h2><p className={`whitespace-pre-wrap ${s.muted}`}>{v}</p></section>
      ))}
      <section><h2 className="mb-2 text-lg font-semibold">Contact us</h2><EnquiryForm /></section>
    </div>
  )
}

export default function Store() {
  const { slug } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const cart = useCart(slug)

  useEffect(() => {
    publicApi.get(`/${slug}`).then((r) => {
      setData(r.data)
      applyTheme(r.data.business.theme)
      setFavicon(r.data.business.logoUrl)
      const w = r.data.business.website
      document.title = w.seo?.title || `${r.data.business.name} · Shop online`
      const meta = document.querySelector('meta[name="description"]')
      if (meta) meta.setAttribute('content', w.seo?.description || w.tagline || r.data.business.name)
    }).catch((e) => setError(errMsg(e)))
  }, [slug])

  const value = useMemo(() => data && { slug, business: data.business, categories: data.categories, s: SURFACES[data.business.theme.mode === 'dark' ? 'dark' : 'light'] }, [data, slug])
  if (error) return <div className="flex h-full items-center justify-center p-6 text-center"><div><h1 className="text-2xl font-bold">Store unavailable</h1><p className="text-slate-500">{error}</p></div></div>
  if (!value) return <Spinner className="h-full items-center" />
  const { business, s } = value
  const w = business.website
  const wa = w.social?.whatsapp || business.phone

  return (
    <StoreCtx.Provider value={value}>
      <div className={`min-h-full ${s.page}`}>
        <header className={`sticky top-0 z-40 border-b backdrop-blur ${s.header}`}>
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
            <Link to={`/s/${slug}`} className="flex min-w-0 items-center gap-2.5">
              <BusinessMark logoUrl={business.logoUrl} theme={business.theme} />
              <span className="truncate text-lg font-bold">{business.name}</span>
            </Link>
            <nav className="ml-auto flex items-center gap-4 text-sm font-medium">
              <Link to={`/s/${slug}`} className="hidden sm:inline">Shop</Link>
              <Link to={`/s/${slug}/about`} className="hidden sm:inline">About</Link>
              <Link to={`/s/${slug}/cart`} className="relative flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-brand-fg" aria-label="Cart">
                <ShoppingCart className="size-4" /><span>{cart.count || 0}</span>
              </Link>
            </nav>
          </div>
        </header>
        <main className="min-h-[60vh]">
          <Routes>
            <Route index element={<Home />} />
            <Route path="p/:id" element={<ProductPage />} />
            <Route path="cart" element={<CartPage />} />
            <Route path="track/:token" element={<TrackPage />} />
            <Route path="about" element={<About />} />
          </Routes>
        </main>
        <footer className={`mt-12 border-t ${s.header}`}>
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm sm:grid-cols-3">
            <div><div className="font-bold">{business.name}</div><p className={s.muted}>{w.tagline}</p></div>
            <div className={`space-y-1 ${s.muted}`}>
              {business.address && <div>{[business.address, business.city].filter(Boolean).join(', ')}</div>}
              {business.phone && <div>{business.phone}</div>}
              {w.hours && <div>{w.hours}</div>}
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex gap-3">
                {w.social?.instagram && <a href={w.social.instagram} target="_blank" rel="noreferrer" aria-label="Instagram"><AtSign className="size-5" /></a>}
                {w.social?.facebook && <a href={w.social.facebook} target="_blank" rel="noreferrer" aria-label="Facebook"><Globe className="size-5" /></a>}
                {wa && <a href={`https://wa.me/${String(wa).replace(/\D/g, '').length === 10 ? `91${String(wa).replace(/\D/g, '')}` : String(wa).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" aria-label="WhatsApp"><MessageCircle className="size-5" /></a>}
              </div>
              <Link to={`/s/${slug}/about`} className={s.muted}>Policies & contact</Link>
            </div>
          </div>
        </footer>
        {business.ai.enabled && <ChatWidget slug={slug} business={business} />}
      </div>
    </StoreCtx.Provider>
  )
}
