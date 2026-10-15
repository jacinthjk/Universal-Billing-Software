import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Download } from 'lucide-react'
import api, { openFile } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Pager, Select, Spinner, Textarea, Toggle, act, useDebounced, useFetch } from '../components/ui'
import { money, date } from '../lib/format'

export function CustomerForm({ customer, onClose, onSaved }) {
  const { t } = useAuth()
  const [f, setF] = useState(customer ? { ...customer, tags: (customer.tags || []).join(', ') } : { name: '', phone: '', email: '', address: '', city: '', taxId: '', notes: '', tags: '', marketingConsent: false })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    const body = { name: f.name, phone: f.phone || null, email: f.email || null, address: f.address || null, city: f.city || null, taxId: f.taxId || null, notes: f.notes || null, tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean), marketingConsent: !!f.marketingConsent }
    const { data } = await act(() => (customer ? api.put(`/customers/${customer.id}`, body) : api.post('/customers', body)), `${t('customer')} saved`)
    onSaved(data.customer)
  }
  return (
    <Modal open onClose={onClose} title={customer ? `Edit ${t('customer').toLowerCase()}` : `New ${t('customer').toLowerCase()}`} footer={<Button onClick={save} disabled={!f.name}>Save</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Mobile / WhatsApp" hint="Used to recognise repeat visits"><Input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><Input type="email" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Address"><Input value={f.address || ''} onChange={set('address')} /></Field>
        <Field label="City"><Input value={f.city || ''} onChange={set('city')} /></Field>
        <Field label="Tax ID (GSTIN)"><Input value={f.taxId || ''} onChange={set('taxId')} /></Field>
        <Field label="Tags" hint="Comma separated"><Input value={f.tags} onChange={set('tags')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes || ''} onChange={set('notes')} /></Field>
        <div className="sm:col-span-2"><Toggle checked={f.marketingConsent} onChange={(v) => setF({ ...f, marketingConsent: v })} label="Consents to marketing messages" /></div>
      </div>
    </Modal>
  )
}

export default function Customers() {
  const { currency, can, t } = useAuth()
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  // ?new=1 (from the Home shortcuts) opens the form straight away.
  const [form, setForm] = useState(() => new URLSearchParams(window.location.search).get('new') === '1')
  const dq = useDebounced(q)
  const navigate = useNavigate()
  const { data, loading } = useFetch(`/customers?${new URLSearchParams({ page, ...(dq ? { q: dq } : {}), ...(type ? { type } : {}) })}`)

  return (
    <div>
      <PageHeader kind="customers" title={t('customers')} subtitle="One profile per person across POS, website, enquiries and AI chats"
        actions={<>
          {can('customers.export') && <Button variant="secondary" onClick={() => openFile('/customers/export.csv', { download: true, filename: 'customers.csv' })}><Download className="size-4" /> Export</Button>}
          {can('customers.manage') && <Button onClick={() => setForm(true)}><Plus className="size-4" /> Add {t('customer').toLowerCase()}</Button>}
        </>} />
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Input className="sm:col-span-2" placeholder="Search name, phone, email or code" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <Select value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'Everyone' }, { value: 'repeat', label: 'Repeat (2+ visits)' }, { value: 'new', label: 'One visit' }, { value: 'lead', label: 'Leads (no purchase)' }]} />
      </div>
      <Card bodyClass="p-0 overflow-x-auto">
        {loading ? <Spinner /> : !data?.customers.length ? <Empty title={`No ${t('customers').toLowerCase()} found`} /> : (
          <table className="table-base">
            <thead><tr><th>{t('customer')}</th><th>Contact</th><th className="text-right">Visits</th><th className="text-right">Total spent</th><th className="text-right">Avg order</th><th>Last purchase</th></tr></thead>
            <tbody>{data.customers.map((c) => (
              <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>
                <td><Link to={`/customers/${c.id}`} className="font-medium text-brand">{c.name}</Link> <span className="text-xs text-slate-400">{c.code}</span>
                  <div className="flex gap-1">{c.isLead && <Badge color="amber">Lead</Badge>}{c.createdByAi && <Badge color="brand">AI</Badge>}{c.tags.map((tg) => <Badge key={tg}>{tg}</Badge>)}</div></td>
                <td className="text-slate-600">{c.phone}<div className="text-xs">{c.email}</div></td>
                <td className="text-right font-medium">{c.visitCount}</td>
                <td className="text-right">{money(c.totalSpent, currency)}</td>
                <td className="text-right text-slate-500">{money(c.avgOrderValue, currency)}</td>
                <td className="text-slate-500">{date(c.lastPurchaseAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {data && <Pager page={page} total={data.total} onPage={setPage} />}
      </Card>
      {form && <CustomerForm onClose={() => setForm(false)} onSaved={(c) => navigate(`/customers/${c.id}`)} />}
    </div>
  )
}
