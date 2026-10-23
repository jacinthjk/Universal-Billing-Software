import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Upload, Pencil, Landmark, ArrowDownLeft, ArrowUpRight, Scale, Download, Undo2, Trash2, ListOrdered, Info, FileSpreadsheet } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { errMsg, openFile } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Pager, Select, Spinner, Tabs, act, useDebounced, useFetch } from '../components/ui'
import { InOutChart } from '../components/charts'
import { money, date as fmtDate, dateTime, daysAgo, today } from '../lib/format'

const MODES = ['UPI', 'NEFT', 'IMPS', 'RTGS', 'CARD', 'ATM', 'CHEQUE', 'NACH', 'CASH', 'INTEREST', 'CHARGES', 'OTHER']
const monthStart = (offset = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return d.toLocaleDateString('en-CA') }
const monthEnd = (offset = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset + 1); d.setDate(0); return d.toLocaleDateString('en-CA') }
const mask = (a) => (a.accountMask ? ` ••${a.accountMask}` : '')

// ─────────────── Accounts ───────────────

function AccountForm({ account, onClose, onSaved }) {
  const a = account
  const [f, setF] = useState({ name: a?.name || '', bankName: a?.bankName || '', accountMask: a?.accountMask || '', ifsc: a?.ifsc || '', openingBalance: a ? Number(a.openingBalance) : '', openingDate: a?.openingDate ? a.openingDate.slice(0, 10) : '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    const body = { name: f.name, bankName: f.bankName || null, accountMask: f.accountMask || null, ifsc: f.ifsc || null, openingBalance: f.openingBalance === '' ? 0 : Number(f.openingBalance), openingDate: f.openingDate || null }
    await act(() => (a ? api.put(`/bank/accounts/${a.id}`, body) : api.post('/bank/accounts', body)), 'Bank account saved')
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title={a ? `Edit ${a.name}` : 'Add bank account'} footer={<Button onClick={save} disabled={!f.name}>Save</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account name" hint="What you call it, e.g. HDFC Current" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Bank"><Input value={f.bankName} onChange={set('bankName')} placeholder="e.g. HDFC Bank" /></Field>
        <Field label="Last 4 digits of account no." hint="Never enter the full number"><Input value={f.accountMask} onChange={set('accountMask')} inputMode="numeric" maxLength={4} /></Field>
        <Field label="IFSC"><Input value={f.ifsc} onChange={set('ifsc')} /></Field>
        <Field label="Opening balance" hint="Worked out from your first statement if left empty"><Input type="number" value={f.openingBalance} onChange={set('openingBalance')} /></Field>
        <Field label="Opening balance date" className="sm:col-span-2"><Input type="date" value={f.openingDate} onChange={set('openingDate')} /></Field>
      </div>
    </Modal>
  )
}

function ImportStatement({ account, onClose, onDone }) {
  const file = useRef()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const upload = async () => {
    const f = file.current?.files?.[0]
    if (!f) return toast.error('Choose a statement file first')
    const body = new FormData()
    body.append('file', f)
    setBusy(true)
    try { const { data } = await api.post(`/bank/accounts/${account.id}/import`, body); setResult(data); onDone() } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Import statement · ${account.name}${mask(account)}`}
      footer={result ? <Button onClick={onClose}>Done</Button> : <Button loading={busy} onClick={upload}><Upload className="size-4" /> Import</Button>}>
      {!result ? (
        <div className="space-y-3 text-sm text-slate-700">
          <p>Download your account statement from net banking as <b>Excel (.xlsx)</b> or <b>CSV</b> and choose it here. Any bank works: the columns (date, narration, withdrawal, deposit, balance) are found automatically.</p>
          <input ref={file} type="file" accept=".csv,.xlsx,.xls,.txt" className="input py-2" />
          <p className="text-slate-500">Importing the same statement again is safe: lines already saved are skipped. Older <b>.xls</b> files need to be saved as .xlsx in Excel first.</p>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200"><div className="text-2xl font-bold text-emerald-800">{result.added}</div><div className="text-emerald-900">added</div></div>
            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"><div className="text-2xl font-bold">{result.duplicates}</div><div className="text-slate-600">already there</div></div>
            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"><div className="text-2xl font-bold">{result.skipped}</div><div className="text-slate-600">other rows skipped</div></div>
          </div>
          <p className="text-slate-700">Statement period <b>{fmtDate(result.from)}</b> to <b>{fmtDate(result.to)}</b>.</p>
          <p className="text-slate-500">Columns used: {Object.entries(result.columns).filter(([, v]) => v).map(([k, v]) => `${k} = "${v}"`).join(', ')}</p>
        </div>
      )}
    </Modal>
  )
}

function Accounts() {
  const { currency, can } = useAuth()
  const { data, loading, reload } = useFetch('/bank/accounts')
  const imports = useFetch('/bank/imports')
  const [form, setForm] = useState(null)
  const [importTo, setImportTo] = useState(null)
  const manage = can('bank.manage')
  const names = Object.fromEntries((data?.accounts || []).map((a) => [a.id, `${a.name}${mask(a)}`]))
  const undo = async (imp) => {
    if (!window.confirm(`Remove the ${imp.count} transactions from this import?`)) return
    await act(() => api.delete(`/bank/imports/${imp.importId}`), 'Import removed')
    reload(); imports.reload()
  }
  if (loading || !data) return <Spinner />
  return (
    <div className="space-y-4">
      {manage && <div className="flex justify-end"><Button onClick={() => setForm({})}><Plus className="size-4" /> Add bank account</Button></div>}
      {!data.accounts.length ? (
        <Card><Empty icon={Landmark} title="No bank accounts yet">{manage ? 'Add your account, then import its statement to see every credit and debit here.' : 'Ask the owner to add the business bank account.'}</Empty></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.accounts.map((a) => (
            <Card key={a.id} bodyClass="p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Landmark className="size-5.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-slate-800">{a.name}{!a.active && <Badge className="ml-2">Closed</Badge>}</div>
                  <div className="text-sm text-slate-500">{[a.bankName, a.accountMask && `A/c ••${a.accountMask}`, a.ifsc].filter(Boolean).join(' · ') || 'Bank account'}</div>
                </div>
                {manage && <Button size="sm" variant="ghost" onClick={() => setForm(a)} aria-label="Edit account"><Pencil className="size-3.5" /></Button>}
              </div>
              <div className="mt-3 text-sm text-slate-600">Balance</div>
              <div className="text-2xl font-extrabold tracking-tight">{money(a.balance, currency)}</div>
              {a.statementBalance && Math.abs(a.statementBalance.amount - a.balance) > 0.5 && (
                <div className="text-xs text-amber-800">Last statement shows {money(a.statementBalance.amount, currency)} on {fmtDate(a.statementBalance.date)}. Check the opening balance.</div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 p-2.5"><div className="text-slate-600">In this month</div><b className="text-emerald-800">{money(a.monthCredits, currency, { decimals: 0 })}</b></div>
                <div className="rounded-lg bg-slate-50 p-2.5"><div className="text-slate-600">Out this month</div><b className="text-red-700">{money(a.monthDebits, currency, { decimals: 0 })}</b></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
                <span>{a.count} transactions{a.lastDate ? ` · latest ${fmtDate(a.lastDate)}` : ''}</span>
                {manage && <Button size="sm" onClick={() => setImportTo(a)}><Upload className="size-3.5" /> Import statement</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {imports.data?.imports.length > 0 && (
        <Card title="Statement imports" icon={FileSpreadsheet} bodyClass="p-0 overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Imported</th><th>Account</th><th>Period</th><th className="text-right">Lines</th><th className="text-right">In</th><th className="text-right">Out</th>{manage && <th />}</tr></thead>
            <tbody>{imports.data.imports.map((i) => (
              <tr key={i.importId}>
                <td>{dateTime(i.importedAt)}</td><td>{names[i.accountId]}</td><td>{fmtDate(i.from)} – {fmtDate(i.to)}</td>
                <td className="text-right">{i.count}</td><td className="text-right">{money(i.credits, currency, { decimals: 0 })}</td><td className="text-right">{money(i.debits, currency, { decimals: 0 })}</td>
                {manage && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => undo(i)}><Undo2 className="size-3.5" /> Undo</Button></td>}
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
      <div className="flex gap-2.5 rounded-xl bg-blue-50 p-3.5 text-sm text-blue-900 ring-1 ring-blue-200">
        <Info className="mt-0.5 size-4.5 shrink-0" />
        <p>Transactions come from the statements you import. Automatic live updates from the bank need registration with an RBI Account Aggregator (such as Setu or Finvu) and will appear here in the same list once connected.</p>
      </div>
      {form && <AccountForm account={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload() }} />}
      {importTo && <ImportStatement account={importTo} onClose={() => setImportTo(null)} onDone={() => { reload(); imports.reload() }} />}
    </div>
  )
}

// ─────────────── Credits & debits ───────────────

function EntryForm({ accounts, onClose, onSaved }) {
  const [f, setF] = useState({ accountId: accounts[0]?.id || '', type: 'credit', date: today(), amount: '', description: '', reference: '', category: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    await act(() => api.post('/bank/transactions', { ...f, amount: Number(f.amount), reference: f.reference || null, category: f.category || null }), 'Entry added')
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title="Add a bank entry" footer={<Button onClick={save} disabled={!f.accountId || !f.amount || !f.description}>Save</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account" className="sm:col-span-2"><Select value={f.accountId} onChange={set('accountId')} options={accounts.map((a) => ({ value: a.id, label: `${a.name}${mask(a)}` }))} /></Field>
        <Field label="Type"><Select value={f.type} onChange={set('type')} options={[{ value: 'credit', label: 'Money in (credit)' }, { value: 'debit', label: 'Money out (debit)' }]} /></Field>
        <Field label="Date"><Input type="date" value={f.date} max={today()} onChange={set('date')} /></Field>
        <Field label="Amount"><Input type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Reference / UTR"><Input value={f.reference} onChange={set('reference')} /></Field>
        <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={set('description')} placeholder="e.g. UPI from Ravi Kumar" /></Field>
        <Field label="Category" hint="Optional, e.g. Rent, Salary, Sales" className="sm:col-span-2"><Input value={f.category} onChange={set('category')} /></Field>
      </div>
    </Modal>
  )
}

function Transactions() {
  const { currency, can } = useAuth()
  const accounts = useFetch('/bank/accounts')
  const [accountId, setAccountId] = useState('')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [type, setType] = useState('')
  const [mode, setMode] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [entry, setEntry] = useState(false)
  const dq = useDebounced(q)
  const query = new URLSearchParams({ from, to, ...(accountId ? { accountId } : {}), ...(type ? { type } : {}), ...(mode ? { mode } : {}), ...(dq ? { q: dq } : {}) })
  const { data, loading, reload } = useFetch(`/bank/transactions?${query}&page=${page}`)
  const monthly = useFetch(`/bank/monthly${accountId ? `?accountId=${accountId}` : ''}`)
  const manage = can('bank.manage')
  const presets = [['This month', monthStart(), today()], ['Last month', monthStart(-1), monthEnd(-1)], ['3 months', monthStart(-2), today()], ['12 months', daysAgo(364), today()]]
  const go = (fn) => (e) => { fn(e.target.value); setPage(1) }
  const remove = async (t) => {
    if (!window.confirm('Delete this transaction?')) return
    await act(() => api.delete(`/bank/transactions/${t.id}`), 'Deleted'); reload(); monthly.reload()
  }
  if (accounts.loading || !accounts.data) return <Spinner />
  if (!accounts.data.accounts.length) return <Card><Empty icon={Landmark} title="No bank accounts yet">Add your account under "Bank accounts & import" and import a statement to see credits and debits.</Empty></Card>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {presets.map(([l, f, t]) => <Button key={l} size="sm" variant={from === f && to === t ? 'primary' : 'secondary'} onClick={() => { setFrom(f); setTo(t); setPage(1) }}>{l}</Button>)}
        <Input type="date" className="w-40" value={from} onChange={go(setFrom)} />
        <span className="text-slate-400">→</span>
        <Input type="date" className="w-40" value={to} onChange={go(setTo)} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={accountId} onChange={go(setAccountId)} options={[{ value: '', label: 'All accounts' }, ...accounts.data.accounts.map((a) => ({ value: a.id, label: `${a.name}${mask(a)}` }))]} />
        <Select value={type} onChange={go(setType)} options={[{ value: '', label: 'Money in and out' }, { value: 'credit', label: 'Money in (credits)' }, { value: 'debit', label: 'Money out (debits)' }]} />
        <Select value={mode} onChange={go(setMode)} options={[{ value: '', label: 'Any payment mode' }, ...MODES.map((m) => ({ value: m, label: m === 'OTHER' ? 'Other' : m }))]} />
        <Input placeholder="Search narration, UTR or category" value={q} onChange={go(setQ)} />
      </div>
      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[['Money in', data.totals.credits, ArrowDownLeft, 'bg-emerald-100 text-emerald-700'], ['Money out', data.totals.debits, ArrowUpRight, 'bg-red-100 text-red-700'], ['Net', data.totals.net, Scale, 'bg-brand-soft text-brand']].map(([l, v, Icon, cls]) => (
            <div key={l} className="card flex items-center gap-3 p-4">
              <span className={`flex size-11 items-center justify-center rounded-xl ${cls}`}><Icon className="size-5.5" /></span>
              <div><div className="text-sm text-slate-600">{l}</div><div className="text-xl font-bold">{money(v, currency)}</div></div>
            </div>
          ))}
        </div>
      )}
      {monthly.data?.months.length > 0 && <Card title="Last 12 months"><InOutChart data={monthly.data.months} currency={currency} /></Card>}
      <Card title="Transactions" icon={ListOrdered} bodyClass="p-0 overflow-x-auto" actions={<div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => openFile(`/bank/transactions.csv?${query}`, { download: true, filename: `bank-${from}-to-${to}.csv` }).catch((e) => toast.error(errMsg(e)))}><Download className="size-3.5" /> CSV</Button>
        {manage && <Button size="sm" onClick={() => setEntry(true)}><Plus className="size-3.5" /> Add entry</Button>}
      </div>}>
        {loading || !data ? <Spinner /> : !data.transactions.length ? <Empty title="No transactions for these filters" /> : (
          <table className="table-base">
            <thead><tr><th>Date</th><th>Details</th><th>Mode</th><th className="text-right">Money out</th><th className="text-right">Money in</th><th className="text-right">Balance</th>{manage && <th />}</tr></thead>
            <tbody>{data.transactions.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap">{fmtDate(t.date)}</td>
                <td className="max-w-md"><div className="truncate font-medium" title={t.description}>{t.description}</div><div className="text-xs text-slate-500">{[t.account.name + (t.account.accountMask ? ` ••${t.account.accountMask}` : ''), t.reference, t.category, t.source === 'MANUAL' ? 'added by hand' : null].filter(Boolean).join(' · ')}</div></td>
                <td><Badge>{t.mode || 'OTHER'}</Badge></td>
                <td className="text-right font-semibold text-red-700">{Number(t.debit) ? money(t.debit, currency) : ''}</td>
                <td className="text-right font-semibold text-emerald-700">{Number(t.credit) ? money(t.credit, currency) : ''}</td>
                <td className="text-right text-slate-600">{t.balance !== null ? money(t.balance, currency) : ''}</td>
                {manage && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => remove(t)} aria-label="Delete transaction"><Trash2 className="size-3.5" /></Button></td>}
              </tr>
            ))}</tbody>
          </table>
        )}
        {data && <Pager page={page} total={data.total} limit={data.limit} onPage={setPage} />}
      </Card>
      {entry && <EntryForm accounts={accounts.data.accounts} onClose={() => setEntry(false)} onSaved={() => { setEntry(false); reload(); monthly.reload() }} />}
    </div>
  )
}

export default function Bank() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'transactions'
  return (
    <div>
      <PageHeader title="Banking" subtitle="Every credit and debit in your business bank accounts" />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v })} tabs={[{ value: 'transactions', label: 'Credits & debits', icon: ListOrdered }, { value: 'accounts', label: 'Accounts & import', icon: Landmark }]} />
      {tab === 'transactions' ? <Transactions /> : <Accounts />}
    </div>
  )
}
