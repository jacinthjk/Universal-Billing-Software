import { Navigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Button, Card, PageHeader, Spinner, StatusBadge, act, useFetch } from '../components/ui'
import { date } from '../lib/format'

// Platform (SaaS) administration: tenants, status and plan. No access to business transactions.
export default function Admin() {
  const { user } = useAuth()
  const { data, loading, reload } = useFetch(user.isPlatformAdmin ? '/admin/businesses' : null)
  if (!user.isPlatformAdmin) return <Navigate to="/" replace />
  if (loading || !data) return <Spinner />
  const setStatus = async (b, status) => {
    if (status === 'SUSPENDED' && !confirm(`Suspend ${b.name}? Users lose access but no data is deleted.`)) return
    await act(() => api.patch(`/admin/businesses/${b.id}`, { status }), 'Updated')
    reload()
  }
  return (
    <div>
      <PageHeader title="Platform admin" subtitle={`${data.businesses.length} businesses on the platform`} />
      <Card bodyClass="p-0 overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>Business</th><th>Type</th><th>Plan</th><th className="text-right">Users</th><th className="text-right">Products</th><th className="text-right">Sales</th><th>Created</th><th>Status</th><th /></tr></thead>
          <tbody>{data.businesses.map((b) => (
            <tr key={b.id}>
              <td><div className="font-medium">{b.name}</div><div className="text-xs text-slate-500">/s/{b.slug}</div></td>
              <td className="text-xs">{b.type}</td><td className="text-xs">{b.plan}</td>
              <td className="text-right">{b._count.memberships}</td><td className="text-right">{b._count.products}</td><td className="text-right">{b._count.sales}</td>
              <td className="text-slate-500">{date(b.createdAt)}</td><td><StatusBadge status={b.status === 'ACTIVE' ? 'OK' : 'CANCELLED'} /></td>
              <td>{b.status === 'ACTIVE' ? <Button size="sm" variant="secondary" onClick={() => setStatus(b, 'SUSPENDED')}>Suspend</Button> : <Button size="sm" onClick={() => setStatus(b, 'ACTIVE')}>Reactivate</Button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  )
}
