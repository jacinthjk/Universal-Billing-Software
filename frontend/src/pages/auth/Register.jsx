import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext'
import { errMsg } from '../../lib/api'
import { Button, Field, Input } from '../../components/ui'
import { AuthShell } from './Login'

export default function Register() {
  const { register, user } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  if (user) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await register(form)
      navigate('/onboarding')
    } catch (err) {
      toast.error(errMsg(err))
    } finally {
      setBusy(false)
    }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <AuthShell title="Create your account" subtitle="Set up your business in under two minutes">
      <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-[0_10px_40px_-12px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/70">
        <Field label="Your name"><Input required value={form.name} onChange={set('name')} /></Field>
        <Field label="Email"><Input type="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label="Password" hint="At least 8 characters"><Input type="password" minLength={8} required value={form.password} onChange={set('password')} /></Field>
        <Button type="submit" className="w-full !bg-gradient-to-r from-blue-600 to-indigo-600 !text-white" size="lg" loading={busy}>Create account</Button>
        <p className="text-center text-sm text-slate-600">Already registered? <Link to="/login" className="font-semibold text-blue-700 hover:underline">Log in</Link></p>
      </form>
    </AuthShell>
  )
}
