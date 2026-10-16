import { useEffect, useState, useCallback } from 'react'
import {
  X, Loader2, Inbox, CheckCircle2, BadgeCheck, PackageCheck, ThumbsUp, Loader, Clock, CircleDashed, XCircle, AlertOctagon, AlertTriangle,
  Undo2, Sparkles, Phone, MessageCircle, Heart, Star, Flame, FileText, Archive, ShoppingCart, Hand, UserCheck, Bot,
} from 'lucide-react'
import { useBusinessIcons } from '../lib/businessIcons'

function EmptyBrandIcon(props) {
  const { brand: Brand } = useBusinessIcons()
  return Brand ? <Brand {...props} /> : <Inbox {...props} />
}
import api, { errMsg } from '../lib/api'
import toast from 'react-hot-toast'

export function Button({ variant = 'primary', size = 'md', loading, className = '', children, ...props }) {
  // Generous sizes: comfortable to read and to tap.
  const base = 'inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/30'
  const sizes = { sm: 'min-h-9 px-3 py-1.5 text-sm', md: 'min-h-11 px-4 py-2.5 text-[0.9375rem]', lg: 'min-h-13 px-6 py-3 text-base' }
  const variants = {
    primary: 'bg-brand text-brand-fg hover:brightness-110 shadow-sm',
    secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 hover:border-slate-400',
    ghost: 'text-slate-700 hover:bg-slate-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  }
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export const Input = ({ className = '', ...props }) => <input className={`input ${className}`} {...props} />
export const Textarea = ({ className = '', ...props }) => <textarea className={`input min-h-20 ${className}`} {...props} />
export function Select({ options, children, className = '', ...props }) {
  return (
    <select className={`input ${className}`} {...props}>
      {children}
      {options?.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  )
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1.5">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
      <button type="button" role="switch" aria-checked={!!checked} onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`flex max-h-[92dvh] w-full ${widths[size]} flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="size-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

// kind: which section this page is (e.g. 'products') - shows that section's business-specific icon.
export function PageHeader({ title, subtitle, actions, kind }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {kind && <SectionBadge kind={kind} />}
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

// icon: optional lucide component shown in a soft brand tile before the title.
export function Card({ title, icon: Icon, actions, children, className = '', bodyClass = 'p-4' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2.5 text-base font-semibold text-slate-800">
            {Icon && <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon className="size-4.5" /></span>}
            {title}
          </h2>
          {actions}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

const BADGE = {
  gray: 'bg-slate-100 text-slate-700', green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', red: 'bg-red-50 text-red-700 ring-red-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20', blue: 'bg-blue-50 text-blue-700 ring-blue-600/20', violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  brand: 'bg-brand-soft text-brand',
}
export function Badge({ color = 'gray', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.8125rem] font-semibold ring-1 ring-inset ring-transparent ${BADGE[color]} ${className}`}>{children}</span>
}

// Every status gets a colour, an icon and a plain-English label (never colour alone).
const STATUS_META = {
  COMPLETED: ['green', CheckCircle2, 'Completed'], PAID: ['green', CheckCircle2, 'Paid'], CONVERTED: ['green', BadgeCheck, 'Converted'],
  RECEIVED: ['green', PackageCheck, 'Received'], OK: ['green', CheckCircle2, 'In stock'], READY: ['blue', PackageCheck, 'Ready'],
  CONFIRMED: ['blue', ThumbsUp, 'Confirmed'], PROCESSING: ['blue', Loader, 'Preparing'], PENDING: ['amber', Clock, 'Waiting'],
  PARTIAL: ['amber', CircleDashed, 'Part paid'], UNPAID: ['red', Clock, 'Unpaid'], CANCELLED: ['red', XCircle, 'Cancelled'],
  OUT: ['red', AlertOctagon, 'Out of stock'], LOW: ['amber', AlertTriangle, 'Low stock'], RETURNED: ['gray', Undo2, 'Returned'],
  PARTIALLY_RETURNED: ['amber', Undo2, 'Part returned'], REFUNDED: ['gray', Undo2, 'Refunded'], NEW: ['blue', Sparkles, 'New'],
  CONTACTED: ['violet', Phone, 'Contacted'], ENGAGED: ['violet', MessageCircle, 'Engaged'], INTERESTED: ['violet', Heart, 'Interested'],
  QUALIFIED: ['amber', Star, 'Qualified'], HIGH_INTENT: ['red', Flame, 'Hot lead'], QUOTATION: ['blue', FileText, 'Quoted'],
  CLOSED: ['gray', Archive, 'Closed'], ORDERED: ['blue', ShoppingCart, 'Ordered'], HANDOFF: ['red', Hand, 'Needs staff'],
  STAFF: ['violet', UserCheck, 'Staff replying'], AI: ['brand', Bot, 'AI handling'], HIGH: ['red', Flame, 'High'],
}
export function StatusBadge({ status }) {
  if (!status) return null
  const [color, Icon, label] = STATUS_META[status] || ['gray', null, String(status).replace(/_/g, ' ').toLowerCase()]
  return <Badge color={color}>{Icon && <Icon className="size-3.5" />}{label}</Badge>
}

// New/Repeat customer indicator used in POS, sales and invoices.
export function CustomerStatus({ status, visit, compact }) {
  if (!status) return null
  const isNew = status === 'NEW'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${isNew ? 'bg-emerald-100 text-emerald-800' : 'bg-violet-100 text-violet-800'}`}>
      {isNew ? '🆕 New customer' : `🔁 Repeat${compact ? '' : ' customer'}`}
      {visit ? <span className="opacity-80">· Visit #{visit}</span> : null}
    </span>
  )
}

// Figure card: coloured icon circle, large number, readable caption.
export function Stat({ label, value, sub, icon: Icon, tone, color = 'brand' }) {
  const tones = { brand: 'bg-brand-soft text-brand', green: 'bg-emerald-50 text-emerald-700', blue: 'bg-blue-50 text-blue-700', amber: 'bg-amber-50 text-amber-700', violet: 'bg-violet-50 text-violet-700', rose: 'bg-rose-50 text-rose-700' }
  return (
    <div className="card flex items-start gap-3 p-4">
      {Icon && <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${tones[color] || tones.brand}`}><Icon className="size-6" /></span>}
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-600">{label}</div>
        <div className="mt-0.5 text-2xl font-bold tracking-tight sm:text-[1.75rem]">{value}</div>
        {sub && <div className={`mt-0.5 text-[0.8125rem] ${tone === 'up' ? 'text-emerald-700' : tone === 'down' ? 'text-red-600' : 'text-slate-600'}`}>{sub}</div>}
      </div>
    </div>
  )
}

export function Spinner({ className = '' }) {
  return <div className={`flex justify-center py-10 ${className}`}><Loader2 className="size-6 animate-spin text-slate-400" /></div>
}

function SectionBadge({ kind }) {
  const Icon = useBusinessIcons().section(kind)
  return <span className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand sm:flex"><Icon className="size-5.5" /></span>
}

// Empty states show the business's own icon unless a specific one is given.
export function Empty({ title = 'Nothing here yet', children, icon }) {
  const Icon = icon || EmptyBrandIcon
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-slate-100"><Icon className="size-7 text-slate-400" strokeWidth={1.5} /></span>
      <div className="font-medium text-slate-600">{title}</div>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  )
}

// tabs: [{ value, label, icon?, count? }]
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((t) => {
        const key = t.value ?? t
        const active = key === value
        const Icon = t.icon
        return (
          <button key={key} role="tab" aria-selected={active} onClick={() => onChange(key)}
            className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-[3px] px-4 py-2.5 text-[0.9375rem] font-semibold transition ${active ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
            {Icon && <Icon className="size-4.5" />}
            {t.label ?? t}{t.count !== undefined ? <span className="rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-700">{t.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

export function Pager({ page, total, limit = 50, onPage }) {
  const pages = Math.max(Math.ceil(total / limit), 1)
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-sm text-slate-500">
      <span>{total} records</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Button>
        <span>{page} / {pages}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  )
}

// Small data hook: GET a URL, expose data/loading/reload. Re-runs when deps change.
export function useFetch(url, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!!url)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    if (!url) return
    setLoading(true)
    try {
      const res = await api.get(url)
      setData(res.data)
      setError(null)
    } catch (e) {
      setError(errMsg(e))
      if (e.response?.status !== 404) toast.error(errMsg(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps])
  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load, setData }
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// Wraps an async action with toast feedback.
export async function act(fn, success) {
  try {
    const r = await fn()
    if (success) toast.success(success)
    return r
  } catch (e) {
    toast.error(errMsg(e))
    throw e
  }
}
