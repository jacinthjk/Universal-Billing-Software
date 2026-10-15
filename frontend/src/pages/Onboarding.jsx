import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Store, ShoppingBasket, Cpu, Shirt, Sparkles, Coffee, Pill, Wrench, Warehouse, Puzzle } from 'lucide-react'
import { Tooth } from '../lib/icons'
import ThemeCard from '../components/ThemeCard'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { applyTheme } from '../lib/theme'
import { Button, Field, Input, Select, act } from '../components/ui'

const ICONS = { RETAIL: Store, GROCERY: ShoppingBasket, ELECTRONICS: Cpu, FASHION: Shirt, BEAUTY: Sparkles, RESTAURANT: Coffee, PHARMACY: Pill, SERVICE: Wrench, WHOLESALE: Warehouse, DENTAL: Tooth, CUSTOM: Puzzle }
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

export default function Onboarding() {
  const { meta: ctxMeta, refreshMemberships, switchBusiness, businesses, logout } = useAuth()
  const [meta, setMeta] = useState(ctxMeta)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ type: '', name: '', slug: '', phone: '', address: '', city: '', taxId: '', currency: 'INR', timezone: 'Asia/Kolkata', themeKey: '', primaryColor: '' })
  const navigate = useNavigate()

  useEffect(() => {
    if (!meta) api.get('/businesses/meta').then((r) => setMeta(r.data))
  }, [meta])
  const theme = meta && form.themeKey ? { ...meta.themes[form.themeKey], ...(form.primaryColor ? { primary: form.primaryColor } : {}) } : null
  useEffect(() => { if (theme) applyTheme(theme) }, [theme?.primary, theme?.font]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!meta) return null
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const create = async () => {
    setBusy(true)
    try {
      const payload = { ...form, slug: form.slug || undefined, primaryColor: form.primaryColor || undefined, email: undefined }
      const { data } = await act(() => api.post('/businesses', payload), 'Your business is ready!')
      await refreshMemberships()
      await switchBusiness(data.business.id)
      navigate('/')
    } catch { /* toast shown */ } finally {
      setBusy(false)
    }
  }

  const steps = ['Business type', 'Details', 'Theme']
  return (
    <div className="min-h-full bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Set up your business</h1>
          {businesses.length ? <Button variant="ghost" onClick={() => navigate('/')}>Cancel</Button> : <Button variant="ghost" onClick={logout}>Log out</Button>}
        </div>
        <ol className="mb-6 flex gap-2">
          {steps.map((s, i) => (
            <li key={s} className={`flex-1 rounded-full py-1.5 text-center text-xs font-medium ${i <= step ? 'bg-brand text-brand-fg' : 'bg-slate-200 text-slate-500'}`}>{i + 1}. {s}</li>
          ))}
        </ol>

        {step === 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Object.entries(meta.businessTypes).map(([key, t]) => {
              const Icon = ICONS[key] || Store
              const active = form.type === key
              return (
                <button key={key} onClick={() => setForm((f) => ({ ...f, type: key, themeKey: f.themeKey || t.theme }))}
                  className={`card flex flex-col items-start gap-2 p-4 text-left transition hover:border-brand ${active ? 'border-brand ring-2 ring-brand/30' : ''}`}>
                  <Icon className="size-6 text-brand" />
                  <span className="font-semibold">{t.label}</span>
                  <span className="text-xs text-slate-500">{t.fields.length ? `Fields: ${t.fields.join(', ')}` : 'Fully configurable'}</span>
                </button>
              )
            })}
            <div className="col-span-full flex justify-end"><Button disabled={!form.type} onClick={() => setStep(1)}>Continue</Button></div>
          </div>
        )}

        {step === 1 && (
          <div className="card grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Business name" className="sm:col-span-2"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: f.slugTouched ? f.slug : slugify(e.target.value) }))} placeholder="e.g. Green Leaf Organics" /></Field>
            <Field label="Website address" hint={`${location.origin}/s/${form.slug || 'your-store'}`} className="sm:col-span-2">
              <Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value), slugTouched: true }))} />
            </Field>
            <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
            <Field label="Tax ID (GSTIN etc.)"><Input value={form.taxId} onChange={set('taxId')} /></Field>
            <Field label="Address"><Input value={form.address} onChange={set('address')} /></Field>
            <Field label="City"><Input value={form.city} onChange={set('city')} /></Field>
            <Field label="Currency"><Select value={form.currency} onChange={set('currency')} options={['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD']} /></Field>
            <Field label="Timezone"><Select value={form.timezone} onChange={set('timezone')} options={['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC']} /></Field>
            <div className="flex justify-between sm:col-span-2">
              <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
              <Button disabled={form.name.trim().length < 2} onClick={() => setStep(2)}>Continue</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(meta.themes).map(([key, t]) => (
                <ThemeCard key={key} theme={t} active={form.themeKey === key} onClick={() => setForm((f) => ({ ...f, themeKey: key, primaryColor: '' }))} />
              ))}
            </div>
            <div className="card flex flex-wrap items-center gap-4 p-4">
              <Field label="Custom brand colour (optional)">
                <input type="color" value={form.primaryColor || theme?.primary || '#2563eb'} onChange={set('primaryColor')} className="h-10 w-20 cursor-pointer rounded border border-slate-300" />
              </Field>
              <div className="flex-1 text-sm text-slate-500">Themes change colours, fonts, invoices and your website - never your data. You can change this any time in Settings.</div>
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button loading={busy} onClick={create}>Create business</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
