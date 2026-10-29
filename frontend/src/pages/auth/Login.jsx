import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, LifeBuoy, CheckCheck, QrCode, TrendingUp, UserCheck, Receipt,
  ShoppingBasket, Pill, UtensilsCrossed, Shirt, Smartphone, Scissors, Stethoscope, Warehouse, Sparkles, KeyRound,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { errMsg } from '../../lib/api'
import { Button, Field, Input, Modal } from '../../components/ui'

const TYPES = [[ShoppingBasket, 'Grocery'], [Pill, 'Pharmacy'], [UtensilsCrossed, 'Restaurant'], [Shirt, 'Fashion'], [Smartphone, 'Electronics'], [Scissors, 'Salon'], [Stethoscope, 'Clinic'], [Warehouse, 'Wholesale']]

// A small, static picture of the app at work: a paid bill, today's sales, a WhatsApp delivery and attendance.
function AppPreview() {
  const bars = [38, 52, 44, 66, 58, 80, 96]
  return (
    <div aria-hidden="true" className="relative mx-auto h-[23rem] w-full max-w-[30rem]">
      {/* Invoice */}
      <div className="auth-float absolute left-0 top-6 w-64 rounded-2xl bg-white p-4 text-slate-800 shadow-2xl shadow-black/40 ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-bold"><span className="flex size-7 items-center justify-center rounded-lg bg-blue-600 text-white"><Receipt className="size-4" /></span>Tax Invoice</span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">PAID</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-500">INV-000241 · Today, 11:42 am</div>
        <div className="mt-3 space-y-1.5 text-xs">
          {[['Basmati Rice 5kg', '₹645'], ['Groundnut Oil 1L', '₹357'], ['Toor Dal 1kg', '₹168']].map(([n, v]) => <div key={n} className="flex justify-between"><span className="text-slate-600">{n}</span><span className="font-semibold">{v}</span></div>)}
        </div>
        <div className="mt-3 flex items-end justify-between border-t border-dashed border-slate-200 pt-2.5">
          <div><div className="text-[11px] text-slate-500">Total · UPI</div><div className="text-xl font-extrabold">₹1,170</div></div>
          <QrCode className="size-10 text-slate-700" strokeWidth={1.5} />
        </div>
      </div>
      {/* Sales chart */}
      <div className="auth-float-slow absolute right-0 top-0 w-56 rounded-2xl bg-white/10 p-4 text-white shadow-xl ring-1 ring-white/15 backdrop-blur-md">
        <div className="flex items-center justify-between text-xs text-white/70"><span>Sales this week</span><TrendingUp className="size-4 text-emerald-300" /></div>
        <div className="mt-1 text-2xl font-extrabold">₹48,260</div>
        <div className="text-[11px] font-semibold text-emerald-300">▲ 18% vs last week</div>
        <div className="mt-3 flex h-16 items-end gap-1.5">
          {bars.map((h, i) => <span key={i} className={`flex-1 rounded-t-[4px] ${i === bars.length - 1 ? 'bg-emerald-400' : 'bg-white/35'}`} style={{ height: `${h}%` }} />)}
        </div>
      </div>
      {/* WhatsApp delivery */}
      <div className="auth-float-slow absolute bottom-16 right-2 flex w-60 items-center gap-3 rounded-2xl bg-[#e7fbe9] p-3 text-slate-800 shadow-xl shadow-black/30">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><CheckCheck className="size-5" /></span>
        <div className="min-w-0 text-xs"><div className="font-bold">Bill sent on WhatsApp</div><div className="truncate text-slate-600">to Ravi Kumar · delivered</div></div>
      </div>
      {/* Attendance */}
      <div className="auth-float absolute bottom-2 left-10 flex items-center gap-2.5 rounded-full bg-white/10 py-2 pl-2 pr-4 text-sm text-white ring-1 ring-white/15 backdrop-blur-md">
        <span className="flex size-8 items-center justify-center rounded-full bg-indigo-400/90"><UserCheck className="size-4.5" /></span>
        <span><b>4 of 5</b> staff in today</span>
      </div>
    </div>
  )
}

/** Shared frame for the login and sign-up pages: app story on the left, the form on the right. */
export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="flex min-h-full flex-col bg-slate-50 lg:flex-row">
      <aside className="auth-hero relative overflow-hidden px-6 pb-8 pt-6 text-white lg:flex lg:w-[55%] lg:flex-col lg:px-12 lg:py-10">
        <div aria-hidden="true" className="auth-grid absolute inset-0 opacity-40" />
        <div aria-hidden="true" className="absolute -left-24 top-1/3 size-96 rounded-full bg-blue-500/30 blur-3xl" />
        <div aria-hidden="true" className="absolute -right-16 -top-16 size-80 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-emerald-400 shadow-lg shadow-blue-500/30"><Sparkles className="size-5.5" /></span>
          <span className="text-xl font-extrabold tracking-tight">BizOS</span>
          <span className="ml-1 hidden rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/80 ring-1 ring-white/15 sm:inline">Billing &amp; commerce</span>
        </div>
        <div className="relative mt-6 max-w-xl lg:mt-14">
          <h2 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl lg:text-[2.6rem]">Billing that runs your <span className="bg-gradient-to-r from-sky-300 to-emerald-300 bg-clip-text text-transparent">whole business</span>.</h2>
          <p className="mt-3 text-white/75 lg:text-lg">Bills, stock, customers, staff attendance, bank credits and your online store, in one simple app.</p>
        </div>
        <div className="relative mt-10 hidden flex-1 items-center lg:flex"><AppPreview /></div>
        <div className="relative mt-6 hidden lg:block">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">Made for every kind of business</div>
          <ul className="flex flex-wrap gap-2">
            {TYPES.map(([Icon, label]) => <li key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-sm text-white/85 ring-1 ring-white/10"><Icon className="size-4 text-sky-300" />{label}</li>)}
          </ul>
        </div>
      </aside>
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:px-6 lg:py-10">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-1.5 text-slate-600">{subtitle}</p>
          </div>
          {children}
          <p className="mt-8 flex items-center justify-center gap-1.5 text-sm text-slate-500">
            <LifeBuoy className="size-4" /> New to the app? <Link to="/guide" className="font-semibold text-blue-700 hover:underline">Read the user guide</Link>
          </p>
        </div>
      </main>
    </div>
  )
}

export default function Login() {
  const { login, user } = useAuth()
  const [form, setForm] = useState({ email: '', password: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
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
    <AuthShell title="Welcome back" subtitle="Log in to open your billing counter, reports and more.">
      <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-[0_10px_40px_-12px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/70">
        <Field label="Email">
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-slate-400" />
            <Input className="pl-10" type="email" autoComplete="email" required placeholder="you@business.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </span>
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-semibold text-slate-700">Password</label>
            <button type="button" onClick={() => setForgot(true)} className="text-sm font-semibold text-blue-700 hover:underline">Forgot password?</button>
          </div>
          <span className="relative block">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-slate-400" />
            <Input id="password" className="px-10" type={show ? 'text' : 'password'} autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
            </button>
          </span>
        </div>
        <Button type="submit" className="w-full !bg-gradient-to-r from-blue-600 to-indigo-600 !text-white" size="lg" loading={busy}>Log in {!busy && <ArrowRight className="size-4.5" />}</Button>
        <p className="text-center text-sm text-slate-600">New business? <Link to="/register" className="font-semibold text-blue-700 hover:underline">Create a free account</Link></p>
      </form>
      <p className="mt-3 rounded-xl bg-white/70 p-2.5 text-center text-xs text-slate-500 ring-1 ring-slate-200">Demo: owner@demo.com / Demo@12345</p>
      <Modal open={forgot} onClose={() => setForgot(false)} title="Forgot your password?" size="sm" footer={<Button onClick={() => setForgot(false)}>Got it</Button>}>
        <div className="space-y-3 text-sm text-slate-700">
          <p className="flex gap-2.5"><KeyRound className="mt-0.5 size-5 shrink-0 text-blue-600" /><span><b>Staff:</b> ask your business owner to reset it. They tap <b>Reset &amp; send</b> next to your name in Settings → Team &amp; roles, and you receive a temporary password (often on WhatsApp).</span></p>
          <p className="flex gap-2.5"><LifeBuoy className="mt-0.5 size-5 shrink-0 text-blue-600" /><span><b>Owners:</b> contact us from the <Link to="/guide" className="font-semibold text-blue-700 hover:underline">help centre</Link> and we will help you get back in.</span></p>
        </div>
      </Modal>
    </AuthShell>
  )
}
