import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Home, Boxes, Truck, MessageSquare, ShoppingBag, BarChart3, PlusCircle, Type,
  Globe, Bot, Settings, ChevronsUpDown, Check, Plus, LogOut, Bell, Menu, X, Shield, Store, MessageCircle,
} from 'lucide-react'
import { TEXT_SIZES, applyTextSize, getTextSize } from '../lib/textSize'
import { useAuth } from '../context/AuthContext'
import { BusinessMark } from '../lib/icons'
import { useBusinessIcons } from '../lib/businessIcons'
import api from '../lib/api'
import { ago } from '../lib/format'

// Sidebar grouped by everyday purpose, with plain-language names and a one-line hint per item.
function useNav() {
  const { can, hasModule, t } = useAuth()
  const bi = useBusinessIcons() // business-specific icons for the key sections
  const groups = [
    {
      title: 'Daily work',
      items: [
        { to: '/', label: 'Home', hint: "Today's summary", icon: Home, show: can('dashboard.view'), end: true },
        { to: '/pos', label: `New ${t('invoice').toLowerCase()}`, hint: 'Billing counter (POS)', icon: bi.pos, show: hasModule('pos') && can('pos.sell') },
        { to: '/sales', label: `${t('invoice')}s`, hint: 'Find, print or share', icon: bi.sale, show: can('sales.view') },
        { to: '/orders', label: 'Online orders', hint: 'From your website', icon: ShoppingBag, show: hasModule('orders') && can('orders.view') },
      ],
    },
    {
      title: 'People',
      items: [
        { to: '/customers', label: t('customers'), hint: 'Profiles & history', icon: bi.customers, show: hasModule('customers') && can('customers.view') },
        { to: '/enquiries', label: 'Enquiries', hint: 'Leads & follow-ups', icon: MessageSquare, show: hasModule('enquiries') && can('enquiries.view') },
        { to: '/whatsapp', label: 'WhatsApp', hint: 'Reminders & product updates', icon: MessageCircle, show: can('whatsapp.manage', 'sales.view') },
      ],
    },
    {
      title: 'Stock',
      items: [
        { to: '/products', label: t('products'), hint: 'Prices & catalogue', icon: bi.products, show: hasModule('products') && can('products.view') },
        { to: '/inventory', label: 'Stock', hint: 'Levels & movements', icon: Boxes, show: hasModule('inventory') && can('inventory.view') },
        { to: '/purchases', label: 'Purchases', hint: 'Suppliers & bills', icon: Truck, show: hasModule('purchases') && can('purchases.view', 'suppliers.manage') },
      ],
    },
    {
      title: 'Business',
      items: [
        { to: '/reports', label: 'Reports', hint: 'Sales & daily report', icon: BarChart3, show: hasModule('reports') && can('reports.view') },
        { to: '/website', label: 'My website', hint: 'Share & QR code', icon: Globe, show: hasModule('website') && can('website.manage') },
        { to: '/ai', label: 'AI assistant', hint: 'Chats with customers', icon: Bot, show: hasModule('ai') && can('ai.manage', 'enquiries.view') },
        { to: '/settings', label: 'Settings', hint: 'Business, theme, team', icon: Settings, show: can('settings.manage', 'users.manage') },
      ],
    },
  ]
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length)
}

function NavItem({ to, label, hint, icon: Icon, end, onNavigate }) {
  return (
    <NavLink to={to} end={end} onClick={onNavigate}
      className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-2 py-1.5 transition ${isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-white/85 hover:bg-white/10 hover:text-white'}`}>
      {({ isActive }) => (
        <>
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${isActive ? 'bg-brand text-brand-fg' : 'bg-white/10 text-white group-hover:bg-white/15'}`}><Icon className="size-5" /></span>
          <span className="min-w-0">
            <span className="block truncate text-[0.9375rem] font-semibold leading-tight">{label}</span>
            <span className={`block truncate text-xs leading-tight ${isActive ? 'text-slate-600' : 'text-white/60'}`}>{hint}</span>
          </span>
        </>
      )}
    </NavLink>
  )
}

// A / A+ / A++ text size switch (remembered on this device).
function TextSizeSwitch() {
  const [size, setSize] = useState(getTextSize())
  return (
    <div className="hidden items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:flex" role="group" aria-label="Text size">
      <Type className="mx-1 size-4 text-slate-500" aria-hidden="true" />
      {TEXT_SIZES.map((t, i) => (
        <button key={t.key} onClick={() => setSize(applyTextSize(t.key))} title={t.title} aria-pressed={size === t.key}
          className={`min-w-9 rounded-lg px-2 py-1 font-bold transition ${size === t.key ? 'bg-brand text-brand-fg shadow-sm' : 'text-slate-700 hover:bg-white'}`}
          style={{ fontSize: `${13 + i * 2}px` }}>{t.label}</button>
      ))}
    </div>
  )
}

function BusinessSwitcher() {
  const { business, businesses, switchBusiness } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef()
  const navigate = useNavigate()
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 rounded-lg bg-white/10 p-2 text-left hover:bg-white/15" aria-label="Switch business">
        <BusinessMark logoUrl={business.logoUrl} theme={business.theme} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{business.name}</div>
          <div className="truncate text-xs text-white/60">{business.type.toLowerCase()} · {business.slug}</div>
        </div>
        <ChevronsUpDown className="size-4 text-white/60" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-slate-200 bg-white p-1 text-slate-800 shadow-lg">
          <div className="px-2 py-1 text-xs font-medium text-slate-500">Your businesses</div>
          {businesses.map((b) => (
            <button key={b.businessId} onClick={async () => { setOpen(false); if (b.businessId !== business.id) { navigate('/'); await switchBusiness(b.businessId) } }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100">
              <BusinessMark logoUrl={b.logoUrl} theme={b.theme} className="size-6" iconClass="size-3.5" />
              <span className="flex-1 truncate">{b.name}</span>
              <span className="text-xs text-slate-400">{b.role}</span>
              {b.businessId === business.id && <Check className="size-4 text-brand" />}
            </button>
          ))}
          <button onClick={() => { setOpen(false); navigate('/onboarding') }} className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-slate-100 px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            <Plus className="size-4" /> Add a business
          </button>
        </div>
      )}
    </div>
  )
}

function Notifications() {
  const { business } = useAuth()
  const [data, setData] = useState({ items: [], unread: 0 })
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    let alive = true
    const load = () => api.get('/reports/notifications').then((r) => alive && setData(r.data)).catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => { alive = false; clearInterval(id) }
  }, [business.id])
  const toggle = async () => {
    setOpen(!open)
    if (!open && data.unread) {
      await api.post('/reports/notifications/read').catch(() => {})
      setData((d) => ({ ...d, unread: 0 }))
    }
  }
  return (
    <div className="relative">
      <button onClick={toggle} className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
        <Bell className="size-5" />
        {data.unread > 0 && <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">{Math.min(data.unread, 9)}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold">Notifications</div>
          <div className="max-h-96 overflow-y-auto">
            {data.items.length === 0 && <div className="p-4 text-sm text-slate-500">You're all caught up.</div>}
            {data.items.map((n) => (
              <button key={n.id} onClick={() => { setOpen(false); if (n.link) navigate(n.link) }} className="block w-full border-b border-slate-50 px-3 py-2 text-left hover:bg-slate-50">
                <div className="text-sm font-medium">{n.title}</div>
                {n.body && <div className="line-clamp-2 text-xs text-slate-500">{n.body}</div>}
                <div className="mt-0.5 text-[11px] text-slate-400">{ago(n.createdAt)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { business, user, role, logout, websiteUrl, can, hasModule, t } = useAuth()
  const groups = useNav()
  const bi = useBusinessIcons()
  const [mobile, setMobile] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => { setMobile(false) }, [location.pathname])
  const canSell = hasModule('pos') && can('pos.sell')

  const sidebar = (
    <aside className="flex h-full w-72 flex-col bg-brand-2 p-3 text-white">
      <BusinessSwitcher />
      {canSell && (
        <button onClick={() => navigate('/pos')}
          className="mt-3 flex items-center justify-center gap-2.5 rounded-xl bg-brand px-4 py-3 text-base font-bold text-brand-fg shadow-md ring-1 ring-white/20 transition hover:brightness-110">
          <PlusCircle className="size-5" /> New {t('invoice').toLowerCase()}
        </button>
      )}
      <nav className="mt-3 flex-1 space-y-4 overflow-y-auto pr-1" aria-label="Main">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="mb-1 px-2 text-xs font-bold uppercase tracking-wider text-white/50">{g.title}</div>
            <div className="space-y-0.5">{g.items.map((i) => <NavItem key={i.to} {...i} />)}</div>
          </div>
        ))}
        {user.isPlatformAdmin && <NavItem to="/admin" label="Platform admin" hint="All businesses" icon={Shield} />}
      </nav>
      <a href={websiteUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-3 rounded-xl px-2 py-1.5 text-white/85 hover:bg-white/10">
        <span className="flex size-9 items-center justify-center rounded-lg bg-white/10"><Store className="size-5" /></span>
        <span className="text-[0.9375rem] font-semibold">View my store</span>
      </a>
      <div className="mt-2 flex items-center gap-2.5 border-t border-white/10 px-1 pt-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-white/15 text-base font-bold">{user.name[0]}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.9375rem] font-semibold">{user.name}</div>
          <div className="truncate text-xs text-white/60">{role}</div>
        </div>
        <button onClick={logout} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white" title="Log out">
          <LogOut className="size-4.5" /> <span className="hidden xl:inline">Log out</span>
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-full">
      <div className="hidden lg:block">{sidebar}</div>
      {mobile && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="relative">{sidebar}<button onClick={() => setMobile(false)} className="absolute -right-11 top-3 rounded-full bg-white p-2" aria-label="Close menu"><X className="size-5" /></button></div>
          <div className="flex-1 bg-slate-900/40" onClick={() => setMobile(false)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <button className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-semibold hover:bg-slate-100 lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu">
            <Menu className="size-5" /> Menu
          </button>
          <div className="flex min-w-0 items-center gap-2.5">
            <BusinessMark logoUrl={business.logoUrl} theme={business.theme} className="size-9" iconClass="size-5" rounded="rounded-lg" />
            <div className="min-w-0">
              <div className="truncate text-base font-bold leading-tight">{business.name}</div>
              <div className="hidden truncate text-xs text-slate-500 sm:block">All information shown belongs to this business</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <TextSizeSwitch />
            {canSell && location.pathname !== '/pos' && (
              <button onClick={() => navigate('/pos')} className="hidden items-center gap-2 rounded-xl bg-brand px-3.5 py-2 text-sm font-bold text-brand-fg hover:brightness-110 md:flex">
                <bi.pos className="size-4.5" /> New {t('invoice').toLowerCase()}
              </button>
            )}
            <Notifications />
          </div>
        </header>
        {/* key forces every page to remount (and refetch) when the active business changes */}
        <main key={business.id} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
