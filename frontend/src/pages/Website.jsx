import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import toast from 'react-hot-toast'
import { Copy, ExternalLink, MessageCircle, Download, Upload, Share2, ShoppingBag } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Button, Card, Field, Input, PageHeader, Textarea, Toggle, act, useDebounced, useFetch } from '../components/ui'
import { money } from '../lib/format'

function copy(text) {
  navigator.clipboard.writeText(text)
  toast.success('Link copied')
}
const wa = (text) => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')

function ShareLinks() {
  const { websiteUrl, business, currency } = useAuth()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const products = useFetch(dq ? `/catalog/products?q=${encodeURIComponent(dq)}&limit=5` : null)
  const cats = useFetch('/catalog/categories')
  const qrRef = useRef()
  const downloadQr = () => {
    const canvas = qrRef.current?.querySelector('canvas')
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `${business.slug}-qr.png`
    a.click()
  }
  const nativeShare = async () => {
    if (navigator.share) await navigator.share({ title: business.name, url: websiteUrl }).catch(() => {})
    else copy(websiteUrl)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Your website" className="lg:col-span-2">
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
          <code className="min-w-0 flex-1 truncate text-sm">{websiteUrl}</code>
          <Button size="sm" variant="secondary" onClick={() => copy(websiteUrl)}><Copy className="size-3.5" /> Copy</Button>
          <a href={websiteUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><ExternalLink className="size-3.5" /> Preview</Button></a>
          <Button size="sm" variant="success" onClick={() => wa(`Shop online at ${business.name}: ${websiteUrl}`)}><MessageCircle className="size-3.5" /> WhatsApp</Button>
          <Button size="sm" variant="secondary" onClick={nativeShare}><Share2 className="size-3.5" /> Share</Button>
        </div>
        <div className="mt-5">
          <div className="label">Share a product</div>
          <Input placeholder="Search a product to share" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-2 divide-y divide-slate-100">
            {products.data?.products.filter((p) => p.showOnWebsite).map((p) => {
              const url = `${websiteUrl}/p/${p.id}`
              return (
                <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="flex-1">{p.name} {p.variant} · {money(p.sellingPrice, currency)}</span>
                  <Button size="sm" variant="ghost" onClick={() => copy(url)}><Copy className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => wa(`${p.name} ${p.variant || ''} - ${money(p.sellingPrice, currency)}\n${url}`)}><MessageCircle className="size-3.5 text-emerald-600" /></Button>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="mt-4">
          <div className="label">Share a category</div>
          <div className="flex flex-wrap gap-2">
            {cats.data?.categories.map((c) => (
              <Button key={c.id} size="sm" variant="secondary" onClick={() => copy(`${websiteUrl}?category=${c.slug}`)}><Copy className="size-3" /> {c.name}</Button>
            ))}
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Link to="/orders"><Button variant="secondary"><ShoppingBag className="size-4" /> Order inbox</Button></Link>
        </div>
      </Card>
      <Card title="QR code for counter & marketing">
        <div ref={qrRef} className="flex flex-col items-center gap-3">
          <div className="rounded-xl border-4 p-3" style={{ borderColor: 'var(--brand)' }}>
            <QRCodeCanvas value={websiteUrl} size={200} level="M" marginSize={1} />
          </div>
          <div className="text-center"><div className="font-semibold">{business.name}</div><div className="text-xs text-slate-500">Scan to shop online</div></div>
          <Button onClick={downloadQr}><Download className="size-4" /> Download QR</Button>
        </div>
      </Card>
    </div>
  )
}

function WebsiteSettings() {
  const { business, refreshBusiness } = useAuth()
  const [w, setW] = useState(business.website)
  const [slug, setSlug] = useState(business.slug)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setW({ ...w, [k]: e.target.value })
  const toggleArr = (k, v) => setW({ ...w, [k]: w[k].includes(v) ? w[k].filter((x) => x !== v) : [...w[k], v] })
  const save = async () => {
    setBusy(true)
    try {
      await act(() => api.put('/businesses/current', { website: w, ...(slug !== business.slug ? { slug } : {}) }), 'Website updated')
      await refreshBusiness()
    } catch { /* toast */ } finally { setBusy(false) }
  }
  const upload = async (kind, file) => {
    const fd = new FormData()
    fd.append('file', file)
    const { data } = await act(() => api.post(`/businesses/current/${kind}`, fd), 'Uploaded')
    // Keep local form state in sync so a later save doesn't overwrite the new banner URL.
    setW((x) => ({ ...x, bannerUrl: data.business.website.bannerUrl }))
    await refreshBusiness()
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Storefront">
        <div className="space-y-3">
          <Toggle checked={w.enabled} onChange={(v) => setW({ ...w, enabled: v })} label="Website published" />
          <Field label="Web address" hint="Changing this breaks links and QR codes you have already shared"><Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></Field>
          <Field label="Hero title"><Input value={w.heroTitle} onChange={set('heroTitle')} /></Field>
          <Field label="Hero subtitle"><Input value={w.heroSubtitle} onChange={set('heroSubtitle')} /></Field>
          <Field label="Tagline"><Input value={w.tagline} onChange={set('tagline')} /></Field>
          <Field label="About us"><Textarea value={w.about} onChange={set('about')} /></Field>
          <Field label="Opening hours"><Input value={w.hours} onChange={set('hours')} /></Field>
          <Field label="Google Maps link"><Input value={w.mapUrl} onChange={set('mapUrl')} /></Field>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-brand"><Upload className="size-4" /> Upload logo<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && upload('logo', e.target.files[0])} /></label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-brand"><Upload className="size-4" /> Upload banner<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && upload('banner', e.target.files[0])} /></label>
          </div>
        </div>
      </Card>
      <div className="space-y-4">
        <Card title="Ordering">
          <Toggle checked={w.allowOrders} onChange={(v) => setW({ ...w, allowOrders: v })} label="Accept online orders" />
          <Toggle checked={w.showPrices} onChange={(v) => setW({ ...w, showPrices: v })} label="Show prices" />
          <Toggle checked={w.showStock} onChange={(v) => setW({ ...w, showStock: v })} label="Show stock quantities" description="Otherwise only in/out of stock is shown" />
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><div className="label">Fulfilment</div>{['PICKUP', 'DELIVERY'].map((f) => <label key={f} className="flex items-center gap-2"><input type="checkbox" checked={w.fulfilment.includes(f)} onChange={() => toggleArr('fulfilment', f)} />{f.toLowerCase()}</label>)}</div>
            <div><div className="label">Payment options</div>{['PAY_ON_DELIVERY', 'PAY_AT_PICKUP'].map((f) => <label key={f} className="flex items-center gap-2"><input type="checkbox" checked={w.paymentOptions.includes(f)} onChange={() => toggleArr('paymentOptions', f)} />{f.replace(/_/g, ' ').toLowerCase()}</label>)}</div>
          </div>
          <Field label="Delivery note" className="mt-3"><Input value={w.deliveryNote} onChange={set('deliveryNote')} /></Field>
        </Card>
        <Card title="Policies, social & SEO">
          <div className="space-y-3">
            <Field label="Returns policy"><Textarea value={w.policies.returns} onChange={(e) => setW({ ...w, policies: { ...w.policies, returns: e.target.value } })} /></Field>
            <Field label="Shipping policy"><Textarea value={w.policies.shipping} onChange={(e) => setW({ ...w, policies: { ...w.policies, shipping: e.target.value } })} /></Field>
            <Field label="Privacy policy"><Textarea value={w.policies.privacy} onChange={(e) => setW({ ...w, policies: { ...w.policies, privacy: e.target.value } })} /></Field>
            <div className="grid grid-cols-3 gap-2">
              {['instagram', 'facebook', 'whatsapp'].map((s) => <Field key={s} label={s}><Input value={w.social[s]} onChange={(e) => setW({ ...w, social: { ...w.social, [s]: e.target.value } })} /></Field>)}
            </div>
            <Field label="SEO title"><Input value={w.seo.title} onChange={(e) => setW({ ...w, seo: { ...w.seo, title: e.target.value } })} /></Field>
            <Field label="SEO description"><Textarea value={w.seo.description} onChange={(e) => setW({ ...w, seo: { ...w.seo, description: e.target.value } })} /></Field>
          </div>
        </Card>
        <div className="flex justify-end"><Button loading={busy} onClick={save}>Save website settings</Button></div>
      </div>
    </div>
  )
}

export default function Website() {
  const [tab, setTab] = useState('share')
  return (
    <div>
      <PageHeader kind="website" title="Website" subtitle="Your branded storefront - powered by the same products, prices and stock as your POS" />
      <div className="mb-4 flex gap-2">
        <Button variant={tab === 'share' ? 'primary' : 'secondary'} onClick={() => setTab('share')}>Share</Button>
        <Button variant={tab === 'settings' ? 'primary' : 'secondary'} onClick={() => setTab('settings')}>Website manager</Button>
      </div>
      {tab === 'share' ? <ShareLinks /> : <WebsiteSettings />}
    </div>
  )
}
