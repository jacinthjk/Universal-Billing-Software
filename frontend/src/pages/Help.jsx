import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Search, Rocket, Receipt, HandCoins, Users, Boxes, IdCard, Landmark, BarChart3, Globe, Settings, MessageCircle, Mail, Phone,
  ChevronDown, CheckCircle2, LifeBuoy, ArrowLeft, HelpCircle, Building2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// App support contact, set at build time (frontend .env): VITE_SUPPORT_EMAIL, VITE_SUPPORT_WHATSAPP, VITE_SUPPORT_HOURS.
const SUPPORT = {
  email: import.meta.env.VITE_SUPPORT_EMAIL || '',
  whatsapp: import.meta.env.VITE_SUPPORT_WHATSAPP || '',
  hours: import.meta.env.VITE_SUPPORT_HOURS || 'Monday to Saturday, 10 am - 7 pm',
}

// ─────────────── The user guide ───────────────
// Each guide: short "what it is", then numbered steps, then tips. Written for first-time users.

const GUIDES = [
  {
    key: 'start', icon: Rocket, title: 'Getting started', intro: 'Set up your business once, then billing takes seconds.',
    steps: [
      'Log in with the email and password you were given. If you got a temporary password, you will be asked to choose your own.',
      'Owners: open Settings → Business profile and check your business name, address, GSTIN and logo. These appear on every bill.',
      'Add what you sell under Stock & purchases → Products (name, price, tax %, and stock if you track it).',
      'Add your team under Settings → Team & roles. Each person gets a role that decides what they can see and do.',
      'Make your first bill: tap New invoice (the big + button), add items, take payment and save.',
    ],
    tips: ['Use the A / A+ / A++ button at the top to make text larger.', 'The Home page shows today\'s sales and anything that needs your attention.'],
  },
  {
    key: 'billing', icon: Receipt, title: 'Making a bill (billing counter)', intro: 'The billing counter (POS) is where you sell.',
    steps: [
      'Open Sales & billing → New invoice, or tap the + button at the bottom on a phone.',
      'Search an item by name or scan its barcode; tap it to add. Change the quantity with + and −.',
      'Add the customer\'s mobile number to track repeat visits and send the bill on WhatsApp.',
      'Choose how they paid (cash, UPI, card). For part payment, enter the amount received; the rest shows as due.',
      'Save. Print the bill, download the PDF or share it on WhatsApp.',
    ],
    tips: ['Find old bills under Sales & billing → Invoices.', 'Bills can be edited or cancelled only by people with that permission (and the bill passcode, if one is set).'],
  },
  {
    key: 'dues', icon: HandCoins, title: 'Payments due & outstanding days', intro: 'See who still owes you money and for how long.',
    steps: [
      'Open Reports → Outstanding bills (also under Sales & billing → Payments due).',
      'Each unpaid bill shows its balance and how many days it has been outstanding.',
      'Bills unpaid for more than 30 days are highlighted in red. Tick "Only over 30 days" to see just those.',
      'Switch to "By customer" to see the total each customer owes.',
      'Download the list as Excel to share or follow up.',
    ],
    tips: ['Send payment reminders from the WhatsApp page.'],
  },
  {
    key: 'customers', icon: Users, title: 'Customers, enquiries & WhatsApp', intro: 'Keep one profile per customer and follow up on leads.',
    steps: [
      'Customers are created automatically when you bill with a mobile number, or add them under Customers → All customers.',
      'Open a customer to see their visits, total spent and every bill.',
      'Record walk-in or phone enquiries under Customers → Enquiries & follow-ups, with a follow-up date.',
      'Link your business WhatsApp (Customers → WhatsApp) by scanning the QR code, then send bills, reminders and product updates.',
    ],
  },
  {
    key: 'stock', icon: Boxes, title: 'Products, stock & purchases', intro: 'Know what you have and what to reorder.',
    steps: [
      'Add or edit items under Stock & purchases → Products. Set a reorder level to get low-stock alerts.',
      'Record stock you buy under Purchases & suppliers. Stock goes up automatically when a purchase is received.',
      'Stock goes down automatically with every bill. Use Stock levels to check counts or adjust after a stock-take.',
      'For items with expiry dates, enter the batch and expiry when purchasing; Home warns you before they expire.',
    ],
  },
  {
    key: 'staff', icon: IdCard, title: 'Employees, attendance & leave', intro: 'Track who came in, working hours and leave.',
    steps: [
      'Add each person under Employees → Employee details with their shift times and weekly off.',
      'Link an employee to their login so they can punch in and out from Home on their own phone.',
      'Managers can punch people in or out, or correct any day, from Employees → Attendance today.',
      'Staff ask for leave from Home; approve or reject it under Employees → Leave requests.',
      'Employees → Monthly attendance shows days worked, late days and hours for each person, with an Excel download.',
    ],
    tips: ['Punching in after the shift start counts as late. Working less than half the shift counts as a half day.'],
  },
  {
    key: 'bank', icon: Landmark, title: 'Banking: credits & debits', intro: 'See every rupee in and out of your bank account.',
    steps: [
      'Open Banking → Bank accounts & import and add your account (only the last 4 digits are stored).',
      'Download your statement from net banking as Excel (.xlsx) or CSV.',
      'Tap Import statement and choose the file. Columns are recognised automatically for all major banks.',
      'See money in, money out and every transaction under Banking → Credits & debits. Filter by date, type or payment mode.',
    ],
    tips: ['Importing the same statement twice is safe: duplicates are skipped.', 'Imported the wrong file? Use Undo next to that import.'],
  },
  {
    key: 'reports', icon: BarChart3, title: 'Reports & the daily report', intro: 'Your numbers, ready to share.',
    steps: [
      'Reports → Business overview: sales, profit, top items and more for any date range. Download as PDF, image or Excel.',
      'Reports → Daily visual report: a one-page summary of the day, sent automatically on WhatsApp at the time you choose.',
      'The daily report image looks like an Excel sheet so it is easy to read on a phone.',
    ],
  },
  {
    key: 'online', icon: Globe, title: 'Your website & AI assistant', intro: 'Sell online and answer customers 24×7.',
    steps: [
      'Online store → My website: turn on your free website, then share its link or QR code.',
      'Customers can browse products and place orders; new orders appear under Sales & billing → Online orders.',
      'Online store → AI assistant: the assistant answers customer questions on your website and creates enquiries for you.',
    ],
  },
  {
    key: 'settings', icon: Settings, title: 'Settings, team & roles', intro: 'For owners: control who can do what.',
    steps: [
      'Settings → Team & roles → Add member: enter their name, email and mobile. Their login details can be sent on WhatsApp.',
      'Forgot password? The owner taps Reset & send next to the person; a new temporary password is created and sent.',
      'Each role (Cashier, Manager…) has a list of permissions. Use Preview to see the app exactly as that role sees it.',
      'Settings → Billing & modules: invoice format, payment modes, and which features (Employees, Banking…) are switched on.',
    ],
  },
]

const FAQ = [
  ['I forgot my password. What do I do?', 'Ask your business owner to reset it from Settings → Team & roles. You will receive a temporary password (often on WhatsApp) and choose a new one when you log in. Owners who forgot their own password should contact support below.'],
  ['Why can\'t I see some menus?', 'Menus appear only for features your role is allowed to use and that are switched on for the business. Ask your owner if you need access.'],
  ['Can I use the app on my phone?', 'Yes. Open the same link in your phone\'s browser. The main actions are in the bar at the bottom; everything else is under More.'],
  ['Is my data shared with other businesses?', 'No. Each business only ever sees its own data, and every request is checked against your access.'],
  ['How do I send a bill on WhatsApp?', 'Link your business WhatsApp once (Customers → WhatsApp). After that, open any bill and tap WhatsApp, or turn on automatic sending in the WhatsApp settings.'],
]

function GuideCard({ g, open, onToggle }) {
  const Icon = g.icon
  return (
    <section className="card overflow-hidden">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left hover:bg-slate-50">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Icon className="size-5.5" /></span>
        <span className="min-w-0 flex-1"><span className="block font-bold text-slate-800">{g.title}</span><span className="block text-sm text-slate-600">{g.intro}</span></span>
        <ChevronDown className={`size-5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          <ol className="space-y-2.5">
            {g.steps.map((s, i) => (
              <li key={s} className="flex gap-3 text-[0.9375rem] text-slate-700">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-fg">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
          {g.tips?.length > 0 && (
            <div className="mt-3 space-y-1.5 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200">
              {g.tips.map((t) => <p key={t} className="flex gap-2"><LifeBuoy className="mt-0.5 size-4 shrink-0 text-amber-600" />{t}</p>)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Contact() {
  const auth = useAuth()
  const business = auth?.business
  const wa = SUPPORT.whatsapp.replace(/\D/g, '')
  return (
    <section aria-labelledby="contact-title" className="grid gap-4 md:grid-cols-2">
      {business && (business.phone || business.email) && (
        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2"><Building2 className="size-5 text-brand" /><h3 className="font-bold text-slate-800">Your business admin</h3></div>
          <p className="mb-3 text-sm text-slate-600">For access, passwords and how things are set up at {business.name}.</p>
          <div className="space-y-1.5 text-sm">
            {business.phone && <a href={`tel:${business.phone}`} className="flex items-center gap-2 font-semibold text-brand"><Phone className="size-4" />{business.phone}</a>}
            {business.email && <a href={`mailto:${business.email}`} className="flex items-center gap-2 font-semibold text-brand"><Mail className="size-4" />{business.email}</a>}
          </div>
        </div>
      )}
      <div className="card p-5">
        <div className="mb-2 flex items-center gap-2"><MessageCircle className="size-5 text-emerald-600" /><h3 id="contact-title" className="font-bold text-slate-800">Contact us</h3></div>
        <p className="mb-3 text-sm text-slate-600">Questions, problems or ideas? We are happy to help. {SUPPORT.hours}.</p>
        {SUPPORT.whatsapp || SUPPORT.email ? (
          <div className="flex flex-wrap gap-2">
            {wa && <a href={`https://wa.me/${wa.length === 10 ? `91${wa}` : wa}?text=${encodeURIComponent('Hello, I need help with the billing app.')}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"><MessageCircle className="size-4" /> WhatsApp us</a>}
            {SUPPORT.email && <a href={`mailto:${SUPPORT.email}?subject=${encodeURIComponent('Help with the billing app')}`} className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"><Mail className="size-4" /> Email us</a>}
          </div>
        ) : <p className="text-sm text-slate-500">Ask your business owner, or the person who set up this app for you.</p>}
      </div>
    </section>
  )
}

/** The guide itself; used inside the app (Help & guide) and on the public /guide page. */
export function HelpContent() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState('start')
  const query = q.trim().toLowerCase()
  const guides = useMemo(() => (query ? GUIDES.filter((g) => [g.title, g.intro, ...g.steps, ...(g.tips || [])].join(' ').toLowerCase().includes(query)) : GUIDES), [query])
  const faq = query ? FAQ.filter(([a, b]) => `${a} ${b}`.toLowerCase().includes(query)) : FAQ
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-brand-2 p-5 text-white sm:p-7">
        <div aria-hidden="true" className="absolute -right-10 -top-10 size-48 rounded-full bg-brand opacity-40 blur-2xl" />
        <div className="relative">
          <h1 className="text-2xl font-bold sm:text-3xl">How can we help?</h1>
          <p className="mt-1 text-white/80">Step-by-step guides for every part of the app.</p>
          <label className="relative mt-4 block max-w-xl">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. password, attendance, WhatsApp" className="input pl-11 text-slate-900" aria-label="Search the guide" />
          </label>
        </div>
      </div>

      {!query && (
        <section className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-slate-800"><Rocket className="size-5 text-brand" /> Your first steps</h2>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {['Log in and set your own password', 'Check your business details', 'Add your products or services', 'Make your first bill'].map((s, i) => (
              <li key={s} className="flex items-center gap-2.5 rounded-xl bg-slate-50 p-3 text-sm font-medium text-slate-700"><CheckCircle2 className="size-5 shrink-0 text-emerald-600" /><span><span className="text-slate-400">{i + 1}.</span> {s}</span></li>
            ))}
          </ol>
        </section>
      )}

      <section aria-label="Guides" className="space-y-3">
        <h2 className="text-lg font-bold text-slate-800">User guide</h2>
        {!guides.length && <p className="card p-4 text-sm text-slate-600">Nothing matches "{q}". Try another word, or contact us below.</p>}
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {guides.map((g) => <GuideCard key={g.key} g={g} open={!!query || open === g.key} onToggle={() => setOpen(open === g.key ? null : g.key)} />)}
        </div>
      </section>

      {faq.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800"><HelpCircle className="size-5 text-brand" /> Common questions</h2>
          <div className="card divide-y divide-slate-100">
            {faq.map(([qq, a]) => (
              <details key={qq} className="group p-4" open={!!query}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-slate-800">{qq}<ChevronDown className="size-4.5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" /></summary>
                <p className="mt-2 text-[0.9375rem] text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <Contact />
    </div>
  )
}

// In the app (inside the menu layout).
export default function Help() {
  return <div className="mx-auto max-w-5xl"><HelpContent /></div>
}

// Public page linked from the login screen, for people who have not logged in yet.
export function PublicGuide() {
  return (
    <div className="min-h-full bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand"><ArrowLeft className="size-4" /> Back to login</Link>
          <span className="ml-auto text-sm font-semibold text-slate-700">BizOS help centre</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6"><HelpContent /></main>
    </div>
  )
}
