import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bot, Truck, Store } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Badge, Card, Empty, Input, PageHeader, Pager, Select, Spinner, StatusBadge, Tabs, useDebounced, useFetch } from '../components/ui'
import { money, ago } from '../lib/format'

const ACTIVE = 'PENDING,CONFIRMED,PROCESSING,READY'

export default function Orders() {
  const { currency, t } = useAuth()
  const [status, setStatus] = useState(ACTIVE)
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const dq = useDebounced(q)
  const navigate = useNavigate()
  const { data, loading } = useFetch(`/orders?${new URLSearchParams({ page, ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(dq ? { q: dq } : {}) })}`)
  const c = data?.counts || {}

  return (
    <div>
      <PageHeader kind="orders" title={`Online ${t('order').toLowerCase()}s`} subtitle="Website, AI assistant, enquiry and staff orders in one queue" />
      <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1) }} tabs={[
        { value: ACTIVE, label: 'Active', count: (c.PENDING || 0) + (c.CONFIRMED || 0) + (c.PROCESSING || 0) + (c.READY || 0) },
        { value: 'PENDING', label: 'New', count: c.PENDING || 0 }, { value: 'READY', label: 'Ready', count: c.READY || 0 },
        { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' }, { value: '', label: 'All' },
      ]} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Order #, name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-44" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: 'Orders & quotes' }, { value: 'ORDER', label: 'Orders' }, { value: 'QUOTATION', label: 'Quotations' }]} />
      </div>
      <Card bodyClass="p-0 overflow-x-auto">
        {loading ? <Spinner /> : !data?.orders.length ? <Empty title="No orders in this view" /> : (
          <table className="table-base">
            <thead><tr><th>Order</th><th>{t('customer')}</th><th>Channel</th><th>Fulfilment</th><th>Status</th><th>Payment</th><th className="text-right">Total</th></tr></thead>
            <tbody>{data.orders.map((o) => (
              <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/orders/${o.id}`)}>
                <td><Link to={`/orders/${o.id}`} className="font-medium text-brand">{o.number}</Link>{o.kind === 'QUOTATION' && <Badge color="blue" className="ml-1">Quote</Badge>}<div className="text-xs text-slate-400">{ago(o.createdAt)} · {o._count.items} items</div></td>
                <td>{o.contactName}<div className="text-xs text-slate-500">{o.contactPhone}</div></td>
                <td className="text-xs">{o.channel} {o.createdByAi && <Badge color="brand"><Bot className="size-3" /></Badge>}</td>
                <td className="text-xs"><span className="flex items-center gap-1">{o.fulfilment === 'DELIVERY' ? <Truck className="size-3.5" /> : <Store className="size-3.5" />}{o.fulfilment.toLowerCase()}</span></td>
                <td><StatusBadge status={o.status} />{o.sale && <div className="text-[11px] text-slate-400">{o.sale.number}</div>}</td>
                <td><StatusBadge status={o.paymentStatus} /></td>
                <td className="text-right font-semibold">{money(o.total, currency)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {data && <Pager page={page} total={data.total} onPage={setPage} />}
      </Card>
    </div>
  )
}
