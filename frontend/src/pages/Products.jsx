import { useState } from 'react'
import { Plus, Pencil, Upload, Tags, Trash2 } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { CategoryIcon } from '../lib/businessIcons'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Pager, Select, Spinner, StatusBadge, Textarea, Toggle, act, useDebounced, useFetch } from '../components/ui'
import { money, qty } from '../lib/format'

const FIELD_LABELS = { toothNumber: 'Tooth / area', barcode: null, batch: null, expiry: null, serial: null, brand: null, model: 'Model', warranty: 'Warranty', size: 'Size', colour: 'Colour', variant: null, ingredients: 'Ingredients', vegType: 'Veg / Non-veg', modifiers: 'Modifiers / add-ons', manufacturer: 'Manufacturer', duration: 'Duration', staff: 'Staff', bulkPrice: 'Bulk price', moq: 'Min. order qty' }

const EMPTY = { name: '', sku: '', barcode: '', hsn: '', kind: 'PRODUCT', categoryId: '', brand: '', variant: '', unit: 'pcs', costPrice: '', sellingPrice: '', mrp: '', taxRate: 0, trackStock: true, reorderLevel: '', batchTracking: false, serialTracking: false, description: '', customFields: {}, showOnWebsite: true, active: true, openingStock: '' }

function ProductForm({ product, categories, onClose, onSaved }) {
  const { business, can, t } = useAuth()
  const [f, setF] = useState(product ? { ...EMPTY, ...product, categoryId: product.categoryId || '', mrp: product.mrp ?? '', reorderLevel: product.reorderLevel ?? '', costPrice: product.costPrice ?? '' } : EMPTY)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState(null)
  const fields = business.settings.fields || []
  const custom = fields.filter((k) => FIELD_LABELS[k])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const num = (v) => (v === '' || v === null ? null : Number(v))

  const save = async () => {
    setBusy(true)
    try {
      const body = {
        name: f.name, sku: f.sku || undefined, barcode: f.barcode || null, hsn: f.hsn || null, kind: f.kind, categoryId: f.categoryId || null, brand: f.brand || null,
        variant: f.variant || null, unit: f.unit, sellingPrice: Number(f.sellingPrice), mrp: num(f.mrp), taxRate: Number(f.taxRate) || 0,
        trackStock: f.kind === 'SERVICE' ? false : f.trackStock, reorderLevel: num(f.reorderLevel), batchTracking: f.batchTracking, serialTracking: f.serialTracking,
        description: f.description || null, customFields: f.customFields, showOnWebsite: f.showOnWebsite, active: f.active,
        ...(can('products.view_cost') && f.costPrice !== '' ? { costPrice: Number(f.costPrice) } : {}),
        ...(!product && f.openingStock ? { openingStock: Number(f.openingStock) } : {}),
      }
      const { data } = await act(() => (product ? api.put(`/catalog/products/${product.id}`, body) : api.post('/catalog/products', body)), `${t('product')} saved`)
      if (file) {
        const fd = new FormData()
        fd.append('file', file)
        await act(() => api.post(`/catalog/products/${data.product.id}/image`, fd))
      }
      onSaved()
    } catch { /* toast shown */ } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={product ? `Edit ${t('product').toLowerCase()}` : `New ${t('product').toLowerCase()}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={!f.name || f.sellingPrice === ''}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Type"><Select value={f.kind} onChange={set('kind')} options={[{ value: 'PRODUCT', label: 'Physical product' }, { value: 'SERVICE', label: 'Service' }]} /></Field>
        <Field label="SKU" hint="Auto-generated if empty"><Input value={f.sku} onChange={set('sku')} /></Field>
        <Field label="Barcode"><Input value={f.barcode || ''} onChange={set('barcode')} /></Field>
        <Field label="HSN / SAC code" hint="Printed on the tax invoice"><Input value={f.hsn || ''} onChange={set('hsn')} /></Field>
        <Field label="Category"><Select value={f.categoryId} onChange={set('categoryId')} options={[{ value: '', label: '—' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} /></Field>
        <Field label="Brand"><Input value={f.brand || ''} onChange={set('brand')} /></Field>
        <Field label="Variant" hint="Size, pack, colour, model…"><Input value={f.variant || ''} onChange={set('variant')} /></Field>
        <Field label="Unit"><Select value={f.unit} onChange={set('unit')} options={['pcs', 'kg', 'g', 'litre', 'ml', 'pack', 'bottle', 'jar', 'box', 'dozen', 'metre', 'hour', 'service', 'plate', 'cup']} /></Field>
        {can('products.view_cost') && <Field label="Purchase cost"><Input type="number" min="0" step="0.01" value={f.costPrice} onChange={set('costPrice')} /></Field>}
        <Field label="Selling price"><Input type="number" min="0" step="0.01" value={f.sellingPrice} onChange={set('sellingPrice')} /></Field>
        <Field label="MRP"><Input type="number" min="0" step="0.01" value={f.mrp} onChange={set('mrp')} /></Field>
        <Field label="Tax %"><Select value={String(f.taxRate)} onChange={set('taxRate')} options={['0', '3', '5', '12', '18', '28']} /></Field>
        {f.kind === 'PRODUCT' && <>
          <Field label="Reorder level"><Input type="number" min="0" value={f.reorderLevel} onChange={set('reorderLevel')} /></Field>
          {!product && <Field label="Opening stock"><Input type="number" min="0" value={f.openingStock} onChange={set('openingStock')} /></Field>}
        </>}
        {custom.map((k) => (
          <Field key={k} label={FIELD_LABELS[k]}><Input value={f.customFields?.[k] || ''} onChange={(e) => setF({ ...f, customFields: { ...f.customFields, [k]: e.target.value } })} /></Field>
        ))}
        <Field label="Description (shown on website)" className="sm:col-span-3"><Textarea value={f.description || ''} onChange={set('description')} /></Field>
        <Field label="Image" className="sm:col-span-3">
          <div className="flex items-center gap-3">
            {(file || f.imageUrl) && <img src={file ? URL.createObjectURL(file) : f.imageUrl} alt="" className="size-14 rounded-lg object-cover" />}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              <Upload className="size-4" /> Choose image<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setFile(e.target.files[0])} />
            </label>
          </div>
        </Field>
        <div className="space-y-1 sm:col-span-3">
          {f.kind === 'PRODUCT' && <Toggle checked={f.trackStock} onChange={(v) => setF({ ...f, trackStock: v })} label="Track stock" />}
          {f.kind === 'PRODUCT' && (fields.includes('batch') || fields.includes('expiry') || f.batchTracking) && <Toggle checked={f.batchTracking} onChange={(v) => setF({ ...f, batchTracking: v })} label="Batch / expiry tracking" />}
          {f.kind === 'PRODUCT' && (fields.includes('serial') || f.serialTracking) && <Toggle checked={f.serialTracking} onChange={(v) => setF({ ...f, serialTracking: v })} label="Serial / IMEI numbers" />}
          <Toggle checked={f.showOnWebsite} onChange={(v) => setF({ ...f, showOnWebsite: v })} label="Show on website" />
          <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" description="Inactive items are hidden from POS and website" />
        </div>
      </div>
    </Modal>
  )
}

function Categories({ categories, onClose, reload }) {
  const [name, setName] = useState('')
  const add = async () => {
    await act(() => api.post('/catalog/categories', { name }), 'Category added')
    setName(''); reload()
  }
  return (
    <Modal open onClose={onClose} title="Categories" size="sm">
      <div className="mb-3 flex gap-2"><Input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name && add()} /><Button onClick={add} disabled={!name}>Add</Button></div>
      <ul className="divide-y divide-slate-100">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm">
            <span>{c.name} <span className="text-slate-400">({c._count.products})</span></span>
            <button className="text-slate-400 hover:text-red-600" onClick={async () => { if (confirm(`Delete ${c.name}? Items will become uncategorized.`)) { await act(() => api.delete(`/catalog/categories/${c.id}`)); reload() } }} aria-label="Delete"><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

export default function Products() {
  const { currency, can, t } = useAuth()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  // ?new=1 (from the Home shortcuts) opens the form straight away.
  const [editing, setEditing] = useState(() => (new URLSearchParams(window.location.search).get('new') === '1' ? 'new' : null))
  const [catsOpen, setCatsOpen] = useState(false)
  const dq = useDebounced(q)
  const { data, loading, reload } = useFetch(`/catalog/products?${new URLSearchParams({ page, active: 'all', ...(dq ? { q: dq } : {}), ...(cat ? { categoryId: cat } : {}), ...(status ? { status } : {}) })}`)
  const cats = useFetch('/catalog/categories')
  const categories = cats.data?.categories || []

  return (
    <div>
      <PageHeader kind="products" title={t('products')} subtitle={`${data?.total ?? '…'} items in your catalogue - shared by POS, website and AI assistant`}
        actions={can('products.manage') && <>
          <Button variant="secondary" onClick={() => setCatsOpen(true)}><Tags className="size-4" /> Categories</Button>
          <Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add {t('product').toLowerCase()}</Button>
        </>} />
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Input className="sm:col-span-2" placeholder="Search name, SKU, barcode, brand" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Any stock' }, { value: 'LOW', label: 'Low stock' }, { value: 'OUT', label: 'Out of stock' }, { value: 'OK', label: 'In stock' }]} />
      </div>
      <Card bodyClass="p-0 overflow-x-auto">
        {loading ? <Spinner /> : !data?.products.length ? <Empty title={`No ${t('products').toLowerCase()} yet`}>{can('products.manage') && <Button className="mt-2" onClick={() => setEditing('new')}>Add your first</Button>}</Empty> : (
          <table className="table-base">
            <thead><tr><th>{t('product')}</th><th>SKU</th><th>Category</th>{can('products.view_cost') && <th className="text-right">Cost</th>}<th className="text-right">Price</th><th className="text-right">Stock</th><th>Website</th><th /></tr></thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-9 rounded-md object-cover" /> : <div className="flex size-9 items-center justify-center rounded-md bg-brand-soft text-brand"><CategoryIcon name={p.category?.name} className="size-4.5" /></div>}
                      <div><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{[p.variant, p.brand, p.kind === 'SERVICE' && 'Service'].filter(Boolean).join(' · ')}</div></div>
                    </div>
                  </td>
                  <td className="text-xs text-slate-500">{p.sku}{p.barcode && <div>{p.barcode}</div>}</td>
                  <td className="text-slate-600">{p.category ? <span className="inline-flex items-center gap-1.5"><CategoryIcon name={p.category.name} className="size-4 text-brand" />{p.category.name}</span> : '—'}</td>
                  {can('products.view_cost') && <td className="text-right text-slate-500">{money(p.costPrice, currency)}</td>}
                  <td className="text-right font-medium">{money(p.sellingPrice, currency)}{Number(p.taxRate) > 0 && <div className="text-[11px] text-slate-400">+{Number(p.taxRate)}% tax</div>}</td>
                  <td className="text-right">
                    {p.stockStatus === 'NA' ? <span className="text-slate-400">—</span> : <>
                      <div>{qty(p.stockQty)} {p.unit}</div>
                      {p.reserved > 0 && <div className="text-[11px] text-slate-400">{qty(p.reserved)} reserved</div>}
                      {p.stockStatus !== 'OK' && <StatusBadge status={p.stockStatus} />}
                    </>}
                  </td>
                  <td>{p.showOnWebsite ? <Badge color="green">Live</Badge> : <Badge>Hidden</Badge>}</td>
                  <td>{can('products.manage') && <button onClick={() => setEditing(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit"><Pencil className="size-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && <Pager page={page} total={data.total} onPage={setPage} />}
      </Card>
      {editing && <ProductForm product={editing === 'new' ? null : editing} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {catsOpen && <Categories categories={categories} onClose={() => setCatsOpen(false)} reload={cats.reload} />}
    </div>
  )
}
