import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Upload, Download, Lock, Building2, Palette, Receipt, Users, ShieldCheck } from 'lucide-react'
import api, { openFile } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { applyTheme } from '../lib/theme'
import { ICONS, ThemeIcon } from '../lib/icons'
import ThemeCard from '../components/ThemeCard'
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, Toggle, act, useFetch } from '../components/ui'
import { dateTime, titleCase } from '../lib/format'

function useSave() {
  const { refreshBusiness } = useAuth()
  const [busy, setBusy] = useState(false)
  const save = async (body, msg = 'Settings saved') => {
    setBusy(true)
    try {
      await act(() => api.put('/businesses/current', body), msg)
      await refreshBusiness()
    } catch { /* toast */ } finally { setBusy(false) }
  }
  return [save, busy]
}

function Profile() {
  const { business, meta } = useAuth()
  const [f, setF] = useState({ name: business.name, type: business.type, phone: business.phone || '', email: business.email || '', address: business.address || '', city: business.city || '', taxId: business.taxId || '', currency: business.currency, timezone: business.timezone })
  const [save, busy] = useSave()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Card title="Business profile">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Business type" hint="Changes terminology and optional fields - never your data"><Select value={f.type} onChange={set('type')} options={Object.entries(meta.businessTypes).map(([k, v]) => ({ value: k, label: v.label }))} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><Input value={f.email} onChange={set('email')} /></Field>
        <Field label="Address"><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="City"><Input value={f.city} onChange={set('city')} /></Field>
        <Field label="Tax ID (GSTIN / VAT)"><Input value={f.taxId} onChange={set('taxId')} /></Field>
        <Field label="Currency"><Select value={f.currency} onChange={set('currency')} options={['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD']} /></Field>
        <Field label="Timezone"><Select value={f.timezone} onChange={set('timezone')} options={['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC']} /></Field>
      </div>
      <div className="mt-4 flex justify-end"><Button loading={busy} onClick={() => save({ ...f, phone: f.phone || null, email: f.email || null, address: f.address || null, city: f.city || null, taxId: f.taxId || null })}>Save profile</Button></div>
    </Card>
  )
}

function Branding() {
  const { business, meta, refreshBusiness } = useAuth()
  const [th, setTh] = useState(business.theme)
  const [terms, setTerms] = useState(business.terminology)
  const [save, busy] = useSave()
  const preview = (next) => { setTh(next); applyTheme(next) }
  const uploadLogo = async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    await act(() => api.post('/businesses/current/logo', fd), 'Logo updated')
    await refreshBusiness()
  }
  return (
    <div className="space-y-4">
      <Card title="Theme library">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(meta.themes).map(([key, t]) => (
            <ThemeCard key={key} compact theme={t} active={th.key === key} onClick={() => preview({ ...t, key })} />
          ))}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Customise">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {['primary', 'secondary', 'accent'].map((k) => (
              <Field key={k} label={titleCase(k)}><input type="color" value={th[k]} onChange={(e) => preview({ ...th, [k]: e.target.value })} className="h-10 w-full cursor-pointer rounded border border-slate-300" /></Field>
            ))}
            <Field label="Font"><Select value={th.font} onChange={(e) => preview({ ...th, font: e.target.value })} options={meta.fonts} /></Field>
            <Field label="Corners"><Select value={th.radius} onChange={(e) => preview({ ...th, radius: e.target.value })} options={['none', 'sm', 'md', 'lg']} /></Field>
            <Field label="Website mode"><Select value={th.mode} onChange={(e) => setTh({ ...th, mode: e.target.value })} options={['light', 'dark']} /></Field>
          </div>
          <div className="mt-4 flex items-center gap-4">
            {business.logoUrl && <img src={business.logoUrl} alt="Logo" className="size-14 rounded-lg border object-contain" />}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm"><Upload className="size-4" /> Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files[0] && uploadLogo(e.target.files[0])} /></label>
          </div>
          <div className="mt-4">
            <span className="label">Business icon <span className="font-normal text-slate-400">(shown when there's no logo)</span></span>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(ICONS).map((name) => (
                <button key={name} type="button" onClick={() => setTh({ ...th, icon: name })} title={name} aria-label={`Icon ${name}`} aria-pressed={th.icon === name}
                  className={`flex size-9 items-center justify-center rounded-lg border transition ${th.icon === name ? 'border-brand bg-brand text-brand-fg' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  <ThemeIcon name={name} className="size-4.5" />
                </button>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Applies to the workspace, POS, invoices, daily reports and your website.</p>
        </Card>
        <Card title="Terminology">
          <div className="grid grid-cols-2 gap-3">
            {Object.keys(terms).map((k) => <Field key={k} label={k}><Input value={terms[k]} onChange={(e) => setTerms({ ...terms, [k]: e.target.value })} /></Field>)}
          </div>
        </Card>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => { setTh(business.theme); applyTheme(business.theme) }}>Reset</Button>
        <Button loading={busy} onClick={() => save({ theme: th, terminology: terms }, 'Branding saved')}>Save branding</Button>
      </div>
    </div>
  )
}

function Billing() {
  const { business } = useAuth()
  const [s, setS] = useState(business.settings)
  const [save, busy] = useSave()
  const inv = (k, v) => setS({ ...s, invoice: { ...s.invoice, [k]: v } })
  const MODES = ['CASH', 'UPI', 'CARD', 'BANK', 'WALLET', 'OTHER']
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Invoice">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice title"><Input value={s.invoice.title} onChange={(e) => inv('title', e.target.value)} /></Field>
            <Field label="Number prefix" hint="Leave empty for plain numbers"><Input value={s.invoice.prefix} onChange={(e) => inv('prefix', e.target.value)} /></Field>
            <Field label="Number digits" hint={`Next number looks like ${s.invoice.prefix}${'1'.padStart(Number(s.invoice.numberDigits) || 0, '0')}`}><Select value={String(s.invoice.numberDigits ?? 6)} onChange={(e) => inv('numberDigits', Number(e.target.value))} options={[{ value: '0', label: 'No padding (319)' }, { value: '4', label: '4 digits (0319)' }, { value: '6', label: '6 digits (000319)' }]} /></Field>
            <Field label="Default print format"><Select value={s.invoice.format} onChange={(e) => inv('format', e.target.value)} options={[{ value: 'A4', label: 'A4' }, { value: 'THERMAL', label: 'Thermal 80mm' }]} /></Field>
          </div>
          <Field label="Footer"><Input value={s.invoice.footer} onChange={(e) => inv('footer', e.target.value)} /></Field>
          <Field label="Terms & notes"><Textarea value={s.invoice.terms} onChange={(e) => inv('terms', e.target.value)} /></Field>
          <Toggle checked={s.invoice.showCustomerStatus} onChange={(v) => inv('showCustomerStatus', v)} label="Show New / Repeat customer and visit number" />
          <Toggle checked={s.invoice.showQr} onChange={(v) => inv('showQr', v)} label="Verification QR code" />
        </div>
      </Card>
      <Card title="Billing rules">
        <div className="space-y-3">
          <Toggle checked={s.taxInclusive} onChange={(v) => setS({ ...s, taxInclusive: v })} label="Prices include tax" />
          <Toggle checked={s.allowNegativeStock} onChange={(v) => setS({ ...s, allowNegativeStock: v })} label="Allow selling below zero stock" />
          <Field label="Visit counting rule" hint="When a sale increments the customer's visit number">
            <Select value={s.visitRule} onChange={(e) => setS({ ...s, visitRule: e.target.value })} options={[{ value: 'PAID', label: 'Only fully paid sales' }, { value: 'COMPLETED', label: 'Any completed sale (incl. credit)' }]} />
          </Field>
          <div><span className="label">Recognise customers by</span>
            {['phone', 'email'].map((m) => <label key={m} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={s.customerMatch.includes(m)} onChange={() => setS({ ...s, customerMatch: s.customerMatch.includes(m) ? s.customerMatch.filter((x) => x !== m) : [...s.customerMatch, m] })} />{m}</label>)}
          </div>
          <div><span className="label">Payment modes at POS</span>
            <div className="flex flex-wrap gap-3">{MODES.map((m) => <label key={m} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={s.paymentModes.includes(m)} onChange={() => setS({ ...s, paymentModes: s.paymentModes.includes(m) ? s.paymentModes.filter((x) => x !== m) : [...s.paymentModes, m] })} />{m}</label>)}</div>
          </div>
        </div>
      </Card>
      <Card title="Modules">
        <p className="mb-2 text-sm text-slate-500">Turn features on or off for this business.</p>
        {['pos', 'products', 'inventory', 'purchases', 'customers', 'enquiries', 'orders', 'website', 'reports', 'ai', 'staff', 'bank'].map((m) => (
          <Toggle key={m} checked={s.modules.includes(m)} onChange={(v) => setS({ ...s, modules: v ? [...s.modules, m] : s.modules.filter((x) => x !== m) })} label={{ ai: 'AI assistant', pos: 'POS', staff: 'Employees (attendance & leave)', bank: 'Banking (credits & debits)' }[m] || titleCase(m)} />
        ))}
      </Card>
      <Card title="Daily report">
        <div className="space-y-3">
          <Toggle checked={s.reportEnabled} onChange={(v) => setS({ ...s, reportEnabled: v })} label="Generate daily visual report automatically" />
          <Field label="Generate at (business timezone)"><Input type="time" value={s.reportTime} onChange={(e) => setS({ ...s, reportTime: e.target.value })} /></Field>
          <Toggle checked={s.reportPdf} onChange={(v) => setS({ ...s, reportPdf: v })} label="Also create a PDF" />
        </div>
      </Card>
      <BillPasscode />
      <div className="flex justify-end lg:col-span-2"><Button loading={busy} onClick={() => save({ settings: s })}>Save settings</Button></div>
    </div>
  )
}

// Optional passcode that protects editing and cancelling saved bills.
function BillPasscode() {
  const { business, refreshBusiness } = useAuth()
  const [mode, setMode] = useState(null) // 'set' | 'remove'
  const [code, setCode] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => { setMode(null); setCode(''); setConfirmCode(''); setPassword('') }
  const submit = async () => {
    setBusy(true)
    try {
      await act(() => api.put('/businesses/current/bill-passcode', { password, passcode: mode === 'remove' ? null : code }), mode === 'remove' ? 'Bill passcode removed' : 'Bill passcode saved')
      await refreshBusiness()
      close()
    } catch { /* toast */ } finally { setBusy(false) }
  }
  const valid = mode === 'remove' ? password : /^\d{4,8}$/.test(code) && code === confirmCode && password
  return (
    <Card title="Bill passcode">
      <div className="flex items-start gap-3">
        <Lock className={`mt-0.5 size-5 ${business.hasBillPasscode ? 'text-emerald-600' : 'text-slate-400'}`} />
        <div className="flex-1 text-sm">
          <div className="font-medium">{business.hasBillPasscode ? 'On - a passcode is needed to edit or cancel saved bills' : 'Off - staff with permission can edit or cancel bills without a passcode'}</div>
          <p className="mt-1 text-slate-500">Share the passcode only with people who should be able to change bills. Wrong attempts are logged and limited.</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setMode('set')}>{business.hasBillPasscode ? 'Change passcode' : 'Set passcode'}</Button>
        {business.hasBillPasscode && <Button size="sm" variant="secondary" onClick={() => setMode('remove')}>Remove</Button>}
      </div>
      <Modal open={!!mode} onClose={close} title={mode === 'remove' ? 'Remove bill passcode' : 'Set bill passcode'} size="sm" footer={<Button loading={busy} disabled={!valid} onClick={submit}>{mode === 'remove' ? 'Remove' : 'Save passcode'}</Button>}>
        <div className="space-y-3">
          {mode === 'set' && <>
            <Field label="New passcode (4-8 digits)"><Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Confirm passcode"><Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={confirmCode} onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, ''))} /></Field>
            {confirmCode && code !== confirmCode && <p className="text-sm text-red-600">Passcodes don't match</p>}
          </>}
          <Field label="Your account password" hint="Confirms it's you"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        </div>
      </Modal>
    </Card>
  )
}

function Team() {
  const { meta, user } = useAuth()
  const { data, loading, reload } = useFetch('/team')
  const [invite, setInvite] = useState(null)
  const [role, setRole] = useState(null)
  const [temp, setTemp] = useState(null)
  if (loading || !data) return <Spinner />
  const add = async () => {
    const { data: r } = await act(() => api.post('/team', invite), 'Member added')
    setInvite(null); setTemp(r.tempPassword); reload()
  }
  const saveRole = async () => {
    await act(() => (role.id ? api.put(`/team/roles/${role.id}`, { name: role.name, permissions: role.permissions }) : api.post('/team/roles', { name: role.name, permissions: role.permissions })), 'Role saved')
    setRole(null); reload()
  }
  return (
    <div className="space-y-4">
      <Card title="Members" bodyClass="p-0" actions={<Button size="sm" onClick={() => setInvite({ name: '', email: '', roleId: data.roles.find((r) => r.name === 'Cashier')?.id })}><Plus className="size-4" /> Add member</Button>}>
        <table className="table-base">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th></tr></thead>
          <tbody>{data.members.map((m) => (
            <tr key={m.id}>
              <td>{m.user.name}</td><td className="text-slate-500">{m.user.email}</td>
              <td>{m.user.id === user.id ? <Badge color="brand">{m.role.name}</Badge> : <Select className="w-44 py-1" value={m.roleId} onChange={async (e) => { await act(() => api.patch(`/team/${m.id}`, { roleId: e.target.value }), 'Role updated'); reload() }} options={data.roles.map((r) => ({ value: r.id, label: r.name }))} />}</td>
              <td>{m.user.id !== user.id && <Toggle checked={m.active} onChange={async (v) => { await act(() => api.patch(`/team/${m.id}`, { active: v })); reload() }} label="" />}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <Card title="Roles & permissions" bodyClass="p-0" actions={<Button size="sm" variant="secondary" onClick={() => setRole({ name: '', permissions: [] })}><Plus className="size-4" /> Custom role</Button>}>
        <ul className="divide-y divide-slate-100">{data.roles.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="font-medium">{r.name}</span>{r.isSystem && <Badge>system</Badge>}
            <span className="flex-1 truncate text-xs text-slate-500">{r.permissions.includes('*') ? 'Full access' : `${r.permissions.length} permissions`}</span>
            {r.name !== 'Owner' && <Button size="sm" variant="ghost" onClick={() => setRole(r)}>Edit</Button>}
          </li>
        ))}</ul>
      </Card>
      <Modal open={!!invite} onClose={() => setInvite(null)} title="Add team member" footer={<Button onClick={add} disabled={!invite?.email || !invite?.name}>Add</Button>}>
        {invite && <div className="space-y-3">
          <Field label="Name"><Input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></Field>
          <Field label="Email" hint="Existing platform users are linked; new users get a temporary password"><Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
          <Field label="Role"><Select value={invite.roleId} onChange={(e) => setInvite({ ...invite, roleId: e.target.value })} options={data.roles.map((r) => ({ value: r.id, label: r.name }))} /></Field>
        </div>}
      </Modal>
      <Modal open={!!temp} onClose={() => setTemp(null)} title="Temporary password" size="sm">
        <p className="text-sm">Share this one-time password securely. Ask them to change it after logging in.</p>
        <code className="mt-3 block rounded-lg bg-slate-100 p-3 text-center text-lg">{temp}</code>
      </Modal>
      <Modal open={!!role} onClose={() => setRole(null)} title={role?.id ? `Edit ${role.name}` : 'New role'} size="lg" footer={<Button onClick={saveRole} disabled={!role?.name}>Save role</Button>}>
        {role && <div className="space-y-3">
          <Field label="Role name"><Input value={role.name} onChange={(e) => setRole({ ...role, name: e.target.value })} disabled={role.isSystem} /></Field>
          <div className="grid gap-1 sm:grid-cols-2">
            {Object.entries(meta.permissions).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={role.permissions.includes(k)} onChange={() => setRole({ ...role, permissions: role.permissions.includes(k) ? role.permissions.filter((x) => x !== k) : [...role.permissions, k] })} />
                <span>{label}</span><code className="ml-auto text-[10px] text-slate-400">{k}</code>
              </label>
            ))}
          </div>
        </div>}
      </Modal>
    </div>
  )
}

function Audit() {
  const { data, loading } = useFetch('/team/audit')
  const { business } = useAuth()
  if (loading || !data) return <Spinner />
  return (
    <div className="space-y-4">
      <Card title="Data export" actions={<Button size="sm" variant="secondary" onClick={() => openFile('/businesses/current/export', { download: true, filename: `${business.slug}-export.json` })}><Download className="size-4" /> Export all data (JSON)</Button>}>
        <p className="text-sm text-slate-500">Download everything this business owns - products, customers, sales, purchases, orders, enquiries and the stock ledger. Exports are recorded in the audit log.</p>
      </Card>
      <Card title="Audit log (latest 200)" bodyClass="p-0 overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead>
          <tbody>{data.logs.map((l) => (
            <tr key={l.id}><td className="whitespace-nowrap text-slate-500">{dateTime(l.createdAt)}</td><td>{l.userName}{l.actor === 'AI' && <Badge color="brand" className="ml-1">AI</Badge>}</td><td><code className="text-xs">{l.action}</code></td><td className="text-xs text-slate-500">{l.entity} {l.entityId?.slice(-6)}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  )
}

export default function Settings() {
  const { can, meta } = useAuth()
  const tabs = [
    ...(can('settings.manage') ? [{ value: 'profile', label: 'Business', icon: Building2 }, { value: 'branding', label: 'Theme & branding', icon: Palette }, { value: 'billing', label: 'Billing & modules', icon: Receipt }] : []),
    ...(can('users.manage') ? [{ value: 'team', label: 'Team & roles', icon: Users }, { value: 'audit', label: 'Audit & export', icon: ShieldCheck }] : []),
  ]
  // ?tab= lets the side menu open a section directly.
  const [params, setParams] = useSearchParams()
  const tab = tabs.some((x) => x.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value
  const setTab = (v) => setParams({ tab: v })
  if (!meta) return <Spinner />
  return (
    <div>
      <PageHeader kind="settings" title="Settings" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'profile' && <Profile />}
      {tab === 'branding' && <Branding />}
      {tab === 'billing' && <Billing />}
      {tab === 'team' && <Team />}
      {tab === 'audit' && <Audit />}
    </div>
  )
}
