import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, RefreshCw, UserCheck, UserPlus, AlertTriangle } from 'lucide-react'
import api, { errMsg } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Button, CustomerStatus, Field, Input, Modal, Spinner, Textarea, useDebounced } from './ui'
import { money } from '../lib/format'

/**
 * POS bill preview: shows the bill exactly as it will be printed (server-rendered, nothing saved yet)
 * and lets the cashier correct the customer's name, mobile, address and other details before confirming.
 */
export default function BillPreview({ open, payload, initialBilling, onBack, onConfirmed }) {
  const { currency, t, can } = useAuth()
  const [billing, setBilling] = useState(initialBilling)
  const [notes, setNotes] = useState('')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const reqId = useRef(0)
  const debounced = useDebounced(JSON.stringify({ billing, notes }), 500)

  useEffect(() => { if (open) { setBilling(initialBilling); setNotes(''); setPreview(null) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render the preview whenever the bill details change (latest request wins).
  useEffect(() => {
    if (!open) return
    const id = ++reqId.current
    setLoading(true)
    api.post('/sales/preview', { ...payload, ...JSON.parse(debounced) })
      .then((r) => { if (id === reqId.current) setPreview(r.data) })
      .catch((e) => { if (id === reqId.current) setPreview({ error: errMsg(e) }) })
      .finally(() => { if (id === reqId.current) setLoading(false) })
  }, [open, debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setBilling((b) => ({ ...b, [k]: e.target.value }))
  const phoneDigits = (billing.phone || '').replace(/\D/g, '')
  const hasContact = phoneDigits.length >= 6 || !!billing.email?.trim()
  const due = preview?.invoice ? preview.invoice.due : 0

  const confirm = async () => {
    if (hasContact && !billing.name?.trim()) return setPreview((p) => ({ ...p, localError: `Enter the ${t('customer').toLowerCase()}'s name` }))
    if (due > 0 && !hasContact) return setPreview((p) => ({ ...p, localError: 'A mobile number is required for credit / partly paid bills' }))
    setBusy(true)
    try {
      const { data } = await api.post('/sales', { ...payload, billing, notes: notes.trim() || undefined })
      onConfirmed(data)
    } catch (e) {
      setPreview((p) => ({ ...p, localError: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'F9') { e.preventDefault(); if (!busy) confirm() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const c = preview?.invoice?.customer
  const matched = preview?.matchedCustomer
  return (
    <Modal open={open} onClose={onBack} title="Bill preview" size="xl"
      footer={<>
        <Button variant="secondary" onClick={onBack}><ArrowLeft className="size-4" /> Back to cart</Button>
        <Button size="lg" loading={busy} disabled={!preview?.invoice || preview?.errors?.length > 0} onClick={confirm}>
          <CheckCircle2 className="size-4" /> Confirm & generate bill{preview?.invoice ? ` · ${money(preview.invoice.total, currency)}` : ''} <kbd className="ml-1 rounded bg-black/15 px-1 text-[10px]">F9</kbd>
        </Button>
      </>}>
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-2">
          <h4 className="text-sm font-semibold text-slate-700">Bill to</h4>
          <Field label={`${t('customer')} name`}><Input value={billing.name} onChange={set('name')} placeholder={`Walk-in ${t('customer').toLowerCase()}`} autoFocus /></Field>
          <Field label="Mobile number" hint="Used to recognise new / repeat customers">
            <Input value={billing.phone} onChange={set('phone')} inputMode="tel" placeholder="10-digit mobile" />
          </Field>
          <Field label="Address" hint="Printed below the customer's name"><Textarea rows={3} value={billing.address} onChange={set('address')} placeholder="Door no, street, area, city, PIN" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><Input type="email" value={billing.email} onChange={set('email')} /></Field>
            <Field label="GSTIN"><Input value={billing.taxId} onChange={set('taxId')} /></Field>
          </div>
          <Field label="Notes on bill"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>

          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            {!hasContact ? (
              <span className="text-slate-500">No mobile number - this will be a walk-in bill (no visit tracking).</span>
            ) : matched ? (
              <div className="flex items-start gap-2"><UserCheck className="mt-0.5 size-4 text-emerald-600" /><span>Existing {t('customer').toLowerCase()} <b>{matched.name}</b> · {matched.visitCount} previous visits.{can('customers.manage') && ' Changes here will update their profile.'}</span></div>
            ) : (
              <div className="flex items-start gap-2"><UserPlus className="mt-0.5 size-4 text-blue-600" /><span>A new {t('customer').toLowerCase()} profile will be created.</span></div>
            )}
            {c?.status && <div className="mt-2"><CustomerStatus status={c.status} visit={c.status === 'REPEAT' ? c.visitNumber : null} /></div>}
          </div>
          {[...(preview?.errors || []), preview?.error, preview?.localError].filter(Boolean).map((e) => (
            <div key={e} className="flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-700"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{e}</div>
          ))}
        </div>

        <div className="lg:col-span-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>Exactly as it will print · number assigned on confirm</span>
            {loading && <span className="flex items-center gap-1"><RefreshCw className="size-3 animate-spin" /> Updating…</span>}
          </div>
          <div className="relative min-h-80 rounded-lg border border-slate-200 bg-slate-50">
            {preview?.image ? <img src={preview.image} alt="Bill preview" className={`w-full rounded-lg transition ${loading ? 'opacity-60' : ''}`} /> : <Spinner className="pt-32" />}
          </div>
        </div>
      </div>
    </Modal>
  )
}
