import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, KeyRound, LogOut } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Button, Field, Input, Modal, act } from './ui'

// Shown across the top while the owner previews the portal as another role.
export function PreviewBanner() {
  const { preview, previewAs } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  if (!preview) return null
  const exit = async () => {
    setBusy(true)
    try { await previewAs(null); navigate('/settings?tab=team') } finally { setBusy(false) }
  }
  return (
    <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-amber-400 px-4 py-2 text-sm text-amber-950">
      <Eye className="size-4.5 shrink-0" />
      <span className="min-w-0 flex-1"><b>Viewing as {preview.roleName}.</b> You see exactly the menus, pages and figures this role can see. Nothing can be changed while previewing.</span>
      <Button size="sm" variant="secondary" loading={busy} onClick={exit}><LogOut className="size-3.5" /> Exit preview</Button>
    </div>
  )
}

// After someone else set a temporary password, the user must choose their own before continuing.
export function ForcePasswordChange() {
  const { user, setUser, logout } = useAuth()
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  if (!user?.mustChangePassword) return null
  const mismatch = f.confirm && f.newPassword !== f.confirm
  const save = async () => {
    const { data } = await act(() => api.put('/auth/me', { currentPassword: f.currentPassword, newPassword: f.newPassword }), 'Password changed')
    setUser(data.user)
  }
  return (
    <Modal open title="Choose your own password" size="sm" onClose={() => {}}
      footer={<><Button variant="ghost" onClick={logout}>Log out</Button><Button onClick={save} disabled={!f.currentPassword || f.newPassword.length < 8 || f.newPassword !== f.confirm}>Save password</Button></>}>
      <div className="space-y-3">
        <div className="flex gap-2.5 rounded-xl bg-brand-soft p-3 text-sm text-slate-700"><KeyRound className="mt-0.5 size-4.5 shrink-0 text-brand" />You signed in with a temporary password. Set a password only you know to keep your account safe.</div>
        <Field label="Temporary password"><Input type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} autoFocus /></Field>
        <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
        <Field label="Type it again" hint={mismatch ? <span className="text-red-600">The two passwords do not match</span> : null}><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
