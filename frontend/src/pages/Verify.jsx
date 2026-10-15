import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ShieldCheck, ShieldX } from 'lucide-react'
import { publicApi } from '../lib/api'
import { applyTheme } from '../lib/theme'
import { money, dateTime } from '../lib/format'
import { Spinner, StatusBadge } from '../components/ui'

// Public invoice verification page (target of the QR code printed on invoices).
export default function Verify() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    publicApi.get(`/verify/${token}`).then((r) => { setData(r.data); applyTheme(r.data.business.theme) }).catch(() => setError(true))
  }, [token])
  if (error) return <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"><ShieldX className="size-12 text-red-500" /><h1 className="text-xl font-bold">Invoice not found</h1><p className="text-slate-500">This verification link is not valid.</p></div>
  if (!data) return <Spinner className="h-full items-center" />
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-lg">
        <div className="bg-brand p-5 text-brand-fg">
          {data.business.logoUrl && <img src={data.business.logoUrl} alt="" className="mb-2 size-12 rounded-lg bg-white object-contain" />}
          <div className="text-lg font-bold">{data.business.name}</div>
        </div>
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-emerald-700"><ShieldCheck className="size-6" /><b>Genuine invoice</b></div>
          <div className="text-2xl font-black">{money(data.total, data.business.currency)}</div>
          <div className="text-sm text-slate-600">{data.number} · {dateTime(data.date)}</div>
          <div className="flex flex-wrap gap-2"><StatusBadge status={data.status} /><StatusBadge status={data.paymentStatus} /></div>
          {data.customer && <div className="text-sm">Issued to <b>{data.customer}</b></div>}
          <Link to={`/s/${data.business.slug}`} className="block pt-2 text-center text-sm font-medium text-brand">Visit {data.business.name} online →</Link>
        </div>
      </div>
    </div>
  )
}
