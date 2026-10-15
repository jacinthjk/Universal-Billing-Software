import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext'
import { errMsg } from '../../lib/api'
import { Button, Field, Input } from '../../components/ui'

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-white/10 text-xl font-black">B</div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-white/70">{subtitle}</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">{children}</div>
      </div>
    </div>
  )
}

export default function Login() {
  const { login, user } = useAuth()
  const [form, setForm] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  if (user) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const data = await login(form.email, form.password)
      navigate(data.businesses.length ? '/' : '/onboarding')
    } catch (err) {
      toast.error(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Billing, inventory, CRM and your online store - in one place">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><Input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Button type="submit" className="w-full" size="lg" loading={busy}>Log in</Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">New here? <Link to="/register" className="font-medium text-brand">Create an account</Link></p>
      <p className="mt-3 rounded-lg bg-slate-50 p-2 text-center text-xs text-slate-500">Demo: owner@demo.com / Demo@12345</p>
    </AuthShell>
  )
}
