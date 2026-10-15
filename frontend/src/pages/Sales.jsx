import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Pencil, Ban, Lock } from 'lucide-react'
import { useBillActions } from '../components/BillActions'
import { useAuth } from '../context/AuthContext'
import { Button, Card, CustomerStatus, Input, PageHeader, Pager, Select, Spinner, StatusBadge, useDebounced, useFetch, Empty } from '../components/ui'
import { money, dateTime, daysAgo, today } from '../lib/format'
import { openFile } from '../lib/api'

export default function Sales() {
  const { currency, t, can, business } = useAuth()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [pay, setPay] = useState('')
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [page, setPage] = useState(1)
  const dq = useDebounced(q)
  const params = new URLSearchParams({ page, limit: 50, from, to, ...(dq ? { q: dq } : {}), ...(status ? { status } : {}), ...(pay ? { paymentStatus: pay } : {}) })
  const { data, loading, reload } = useFetch(`/sales?${params}`)
  const actions = useBillActions({ onChanged: reload })

  return (
    <div>
      <PageHeader kind="sale" title={`${t('sale')}s & ${t('invoice')}s`} subtitle="Every completed bill, its payment status and customer visit"
        actions={can('reports.export') && <Button variant="secondary" onClick={() => openFile(`/reports/export/sales.csv?from=${from}&to=${to}`, { download: true, filename: `sales-${from}-${to}.csv` })}><Download className="size-4" /> Export CSV</Button>} />
      <div className="mb-3 grid gap-2 sm:grid-cols-5">
        <Input placeholder={`Search ${t('invoice').toLowerCase()} #, name, phone`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All statuses' }, 'COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED']} />
        <Select value={pay} onChange={(e) => setPay(e.target.value)} options={[{ value: '', label: 'Any payment' }, 'PAID', 'PARTIAL', 'UNPAID', 'REFUNDED']} />
      </div>
      <Card bodyClass="p-0 overflow-x-auto">
        {loading ? <Spinner /> : !data?.sales.length ? <Empty title={`No ${t('invoice').toLowerCase()}s in this period`} /> : (
          <table className="table-base">
            <thead><tr><th>{t('invoice')}</th><th>Date</th><th>{t('customer')}</th><th>Channel</th><th>Status</th><th>Payment</th><th className="text-right">Total</th><th /></tr></thead>
            <tbody>
              {data.sales.map((s) => (
                <tr key={s.id}>
                  <td><Link className="font-medium text-brand" to={`/sales/${s.id}`}>{s.number}</Link></td>
                  <td className="whitespace-nowrap text-slate-500">{dateTime(s.createdAt)}</td>
                  <td>
                    <div>{s.billName || s.customer?.name || <span className="text-slate-400">Walk-in</span>}</div>
                    {s.customerStatus && <CustomerStatus status={s.customerStatus} visit={s.customerStatus === 'REPEAT' ? s.visitNumber : null} compact />}
                  </td>
                  <td className="text-xs text-slate-500">{s.channel}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td><StatusBadge status={s.paymentStatus} /><div className="text-[11px] text-slate-400">{s.payments.map((p) => p.method).join(' + ')}</div></td>
                  <td className={`text-right font-semibold ${s.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>{money(s.total, currency)}</td>
                  <td className="whitespace-nowrap text-right">
                    {s.status !== 'CANCELLED' && can('sales.edit') && <button onClick={() => actions.startEdit(s)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit bill" aria-label={`Edit ${s.number}`}>{business.hasBillPasscode ? <Lock className="size-4" /> : <Pencil className="size-4" />}</button>}
                    {s.status !== 'CANCELLED' && can('sales.void') && <button onClick={() => actions.startCancel(s)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Cancel bill" aria-label={`Cancel ${s.number}`}><Ban className="size-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && <Pager page={page} total={data.total} onPage={setPage} />}
      </Card>
      {actions.dialogs}
    </div>
  )
}
