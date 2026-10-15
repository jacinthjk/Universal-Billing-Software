import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bot, Send, User, Wrench, AlertTriangle, Plus, Pencil, Trash2, UserCheck, MessagesSquare, FlaskConical, BookOpen, SlidersHorizontal } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Tabs, Textarea, Toggle, act, useFetch } from '../components/ui'
import { ago, dateTime } from '../lib/format'

const TOOL_INFO = {
  search_products: ['Search products', 'Read'], get_product_details: ['Product details', 'Read'], check_stock: ['Check stock', 'Read'],
  get_business_info: ['Business info & FAQs', 'Read'], search_customer: ['Identify customer', 'Read'], create_customer: ['Create customer', 'Create'],
  create_enquiry: ['Create enquiry / lead', 'Create'], update_enquiry: ['Update enquiry', 'Update'], create_followup: ['Schedule follow-up', 'Create'],
  create_cart: ['Build website cart', 'Create'], create_quotation: ['Create quotation', 'Create'], create_order: ['Place order (after confirmation)', 'Create'],
  handoff_to_staff: ['Hand off to staff', 'Create'], get_order_status: ['Order status', 'Read'],
}

function Bubble({ m }) {
  const mine = m.role !== 'user'
  return (
    <div className={`flex ${mine ? 'justify-end' : ''}`}>
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${m.role === 'user' ? 'rounded-bl-sm bg-slate-100' : m.role === 'staff' ? 'rounded-br-sm bg-violet-600 text-white' : 'rounded-br-sm bg-brand text-brand-fg'}`}>
        <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70">{m.role === 'user' ? <User className="size-3" /> : m.role === 'staff' ? <UserCheck className="size-3" /> : <Bot className="size-3" />}{m.role === 'staff' ? m.by || 'Staff' : m.role === 'user' ? 'Customer' : 'AI'}</div>
        <div className="whitespace-pre-wrap break-words">{m.text}</div>
      </div>
    </div>
  )
}

function Inbox() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('conversation')
  const [status, setStatus] = useState('')
  const list = useFetch(`/ai/conversations?${new URLSearchParams(status === 'UNCERTAIN' ? { uncertain: '1' } : status ? { status } : {})}`)
  const conv = useFetch(selected ? `/ai/conversations/${selected}` : null)
  const [reply, setReply] = useState('')
  const [showTools, setShowTools] = useState(false)
  const { can } = useAuth()
  const c = conv.data?.conversation

  const send = async () => {
    await act(() => api.post(`/ai/conversations/${selected}/reply`, { text: reply }))
    setReply(''); conv.reload(); list.reload()
  }
  const setConvStatus = async (s) => { await act(() => api.post(`/ai/conversations/${selected}/status`, { status: s }), 'Updated'); conv.reload(); list.reload() }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2" bodyClass="p-0" title="Conversations" actions={<Select className="w-36 py-1 text-xs" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, { value: 'HANDOFF', label: 'Needs human' }, { value: 'STAFF', label: 'Staff replying' }, { value: 'AI', label: 'AI handling' }, { value: 'UNCERTAIN', label: 'Uncertain answers' }]} />}>
        {list.loading ? <Spinner /> : !list.data?.conversations.length ? <Empty title="No conversations yet">Share your website - the assistant appears as a chat bubble.</Empty> : (
          <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {list.data.conversations.map((x) => (
              <li key={x.id}>
                <button onClick={() => setParams({ tab: 'inbox', conversation: x.id })} className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${selected === x.id ? 'bg-brand-soft' : ''}`}>
                  <div className="flex items-center gap-2 text-sm font-medium">{x.customer?.name || 'Visitor'} <StatusBadge status={x.status} />{x.uncertain && <AlertTriangle className="size-3.5 text-amber-500" />}<span className="ml-auto text-xs font-normal text-slate-400">{ago(x.updatedAt)}</span></div>
                  <div className="truncate text-xs text-slate-500">{x.lastMessage}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="lg:col-span-3" title={c ? `${c.customer?.name || 'Visitor'} · ${c.channel}` : 'Conversation'}
        actions={c && <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setShowTools(!showTools)}><Wrench className="size-3.5" /> {showTools ? 'Hide' : 'Show'} tool log</Button>
          {can('enquiries.manage') && c.status !== 'AI' && <Button size="sm" variant="secondary" onClick={() => setConvStatus('AI')}>Return to AI</Button>}
          {can('enquiries.manage') && c.status !== 'CLOSED' && <Button size="sm" variant="secondary" onClick={() => setConvStatus('CLOSED')}>Close</Button>}
        </div>}>
        {!selected ? <Empty title="Select a conversation" /> : !c ? <Spinner /> : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs text-slate-500">
              <StatusBadge status={c.status} /> started {dateTime(c.createdAt)}
              {c.customer && <Link to={`/customers/${c.customer.id}`} className="text-brand">{c.customer.name} · {c.customer.phone}</Link>}
              {c.enquiryId && <Link to={`/enquiries/${c.enquiryId}`} className="text-brand">Open enquiry →</Link>}
            </div>
            {c.summary && <div className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900"><b>Handoff summary:</b> {c.summary}</div>}
            <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border border-slate-100 p-3">
              {c.transcript.map((m, i) => <Bubble key={i} m={m} />)}
            </div>
            {showTools && (
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-200">
                {c.toolCalls.map((t) => (
                  <div key={t.id}><span className={t.ok ? 'text-emerald-400' : 'text-red-400'}>{t.ok ? '✓' : '✗'} {t.tool}</span> <span className="text-slate-400">{JSON.stringify(t.input)}</span><div className="truncate pl-3 text-slate-500">→ {JSON.stringify(t.output)}</div></div>
                ))}
                {!c.toolCalls.length && 'No tool calls'}
              </div>
            )}
            {can('enquiries.manage') && c.status !== 'CLOSED' && (
              <div className="flex gap-2">
                <Input placeholder="Reply as staff (takes over from the AI)…" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reply.trim() && send()} />
                <Button onClick={send} disabled={!reply.trim()}><Send className="size-4" /></Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function TestChat() {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [cid, setCid] = useState(null)
  const [busy, setBusy] = useState(false)
  const end = useRef()
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  const send = async () => {
    const msg = text.trim()
    if (!msg) return
    setText('')
    setMessages((m) => [...m, { role: 'user', text: msg }])
    setBusy(true)
    try {
      const { data } = await act(() => api.post('/ai/test', { message: msg, conversationId: cid || undefined }))
      setCid(data.conversationId)
      setMessages((m) => [...m, { role: 'assistant', text: data.reply || '(Handed to staff - the AI will not reply further in this conversation.)' }])
    } catch { /* toast */ } finally { setBusy(false) }
  }
  return (
    <Card title="Try your assistant" actions={<Button size="sm" variant="ghost" onClick={() => { setMessages([]); setCid(null) }}>New chat</Button>}>
      <p className="mb-3 text-sm text-slate-500">This uses the same tools and permissions as the website widget. Test conversations are logged and may create real leads.</p>
      <div className="h-96 space-y-2 overflow-y-auto rounded-lg border border-slate-100 p-3">
        {!messages.length && <div className="text-sm text-slate-400">Try: "Do you have 1 litre groundnut oil?" or "What are your delivery charges?"</div>}
        {messages.map((m, i) => <Bubble key={i} m={m} />)}
        {busy && <div className="text-xs text-slate-400">Assistant is typing…</div>}
        <div ref={end} />
      </div>
      <div className="mt-3 flex gap-2"><Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Type a customer message" /><Button onClick={send} loading={busy}><Send className="size-4" /></Button></div>
    </Card>
  )
}

function Knowledge() {
  const { data, loading, reload } = useFetch('/ai/knowledge')
  const [edit, setEdit] = useState(null)
  const save = async () => {
    const body = { title: edit.title, content: edit.content, category: edit.category, active: edit.active }
    await act(() => (edit.id ? api.put(`/ai/knowledge/${edit.id}`, body) : api.post('/ai/knowledge', body)), 'Saved')
    setEdit(null); reload()
  }
  return (
    <Card title="Knowledge base" actions={<Button size="sm" onClick={() => setEdit({ title: '', content: '', category: 'FAQ', active: true })}><Plus className="size-4" /> Add answer</Button>} bodyClass="p-0">
      <p className="px-4 pt-3 text-sm text-slate-500">Approved answers the assistant may use: FAQs, ingredients, delivery areas, returns, payment options, hours. Prices and stock always come live from your catalogue.</p>
      {loading ? <Spinner /> : !data?.items.length ? <Empty title="No answers yet" /> : (
        <ul className="divide-y divide-slate-100">
          {data.items.map((k) => (
            <li key={k.id} className={`flex items-start gap-3 px-4 py-3 ${k.active ? '' : 'opacity-50'}`}>
              <Badge>{k.category}</Badge>
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{k.title}</div><div className="line-clamp-2 text-sm text-slate-500">{k.content}</div></div>
              <button onClick={() => setEdit(k)} className="text-slate-400 hover:text-slate-700" aria-label="Edit"><Pencil className="size-4" /></button>
              <button onClick={async () => { if (confirm('Delete this answer?')) { await act(() => api.delete(`/ai/knowledge/${k.id}`)); reload() } }} className="text-slate-400 hover:text-red-600" aria-label="Delete"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit answer' : 'New answer'} footer={<Button onClick={save} disabled={!edit?.title || !edit?.content}>Save</Button>}>
        {edit && <div className="space-y-3">
          <Field label="Question / title"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="Category"><Select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} options={['FAQ', 'HOURS', 'DELIVERY', 'RETURNS', 'PAYMENTS', 'PRODUCT', 'POLICY', 'OTHER']} /></Field>
          <Field label="Approved answer"><Textarea rows={6} value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} /></Field>
          <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />
        </div>}
      </Modal>
    </Card>
  )
}

function AISettings() {
  const { business, refreshBusiness, meta } = useAuth()
  const status = useFetch('/ai/status')
  const [ai, setAi] = useState(business.ai)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await act(() => api.put('/businesses/current', { ai: { ...ai, escalationKeywords: typeof ai.escalationKeywords === 'string' ? ai.escalationKeywords.split(',').map((s) => s.trim()).filter(Boolean) : ai.escalationKeywords } }), 'AI settings saved')
      await refreshBusiness()
    } catch { /* toast */ } finally { setBusy(false) }
  }
  const perm = (k, v) => setAi({ ...ai, permissions: { ...ai.permissions, [k]: v } })
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Assistant">
        <div className="space-y-3">
          <Toggle checked={ai.enabled} onChange={(v) => setAi({ ...ai, enabled: v })} label="AI assistant enabled" description="Shows the chat widget on your website" />
          {status.data && (
            <div className={`rounded-lg p-3 text-sm ${status.data.provider === 'anthropic' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
              {status.data.provider === 'anthropic' ? 'Running on Claude via the platform AI provider.' : status.data.hasApiKey ? 'Using the built-in rule-based assistant (selected below).' : 'No AI provider key is configured on the server, so the built-in rule-based assistant answers from your catalogue and knowledge base.'}
            </div>
          )}
          <Field label="Provider"><Select value={ai.provider || 'auto'} onChange={(e) => setAi({ ...ai, provider: e.target.value })} options={[{ value: 'auto', label: 'Claude (when configured)' }, { value: 'rules', label: 'Rule-based (no LLM)' }]} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Model"><Select value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} options={meta?.aiModels || [ai.model]} /></Field>
            <Field label="Effort" hint="Higher = more thorough, more cost"><Select value={ai.effort} onChange={(e) => setAi({ ...ai, effort: e.target.value })} options={['low', 'medium', 'high']} /></Field>
          </div>
          <Field label="Tone"><Input value={ai.tone} onChange={(e) => setAi({ ...ai, tone: e.target.value })} /></Field>
          <Field label="Greeting"><Input value={ai.greeting} onChange={(e) => setAi({ ...ai, greeting: e.target.value })} /></Field>
          <Field label="Mandatory escalation keywords" hint="Messages containing these always go to staff"><Input value={Array.isArray(ai.escalationKeywords) ? ai.escalationKeywords.join(', ') : ai.escalationKeywords} onChange={(e) => setAi({ ...ai, escalationKeywords: e.target.value })} /></Field>
          <Toggle checked={ai.orderRequiresStaffApproval} onChange={(v) => setAi({ ...ai, orderRequiresStaffApproval: v })} label="AI orders need staff confirmation" />
        </div>
      </Card>
      <Card title="What the AI may do">
        <p className="mb-2 text-sm text-slate-500">The assistant can only act through these tools. Every call is logged. Refunds, price changes, discounts and stock changes are never available to the AI.</p>
        <div className="divide-y divide-slate-100">
          {Object.entries(TOOL_INFO).map(([k, [label, kind]]) => (
            <div key={k} className="flex items-center gap-2">
              <Badge color={kind === 'Read' ? 'blue' : 'amber'}>{kind}</Badge>
              <div className="flex-1"><Toggle checked={!!ai.permissions[k]} onChange={(v) => perm(k, v)} label={label} /></div>
            </div>
          ))}
        </div>
      </Card>
      <div className="flex justify-end lg:col-span-2"><Button loading={busy} onClick={save}>Save AI settings</Button></div>
    </div>
  )
}

export default function AIAssistant() {
  const [params, setParams] = useSearchParams()
  const { can } = useAuth()
  const tab = params.get('tab') || 'inbox'
  const tabs = [{ value: 'inbox', label: 'Conversations', icon: MessagesSquare }, ...(can('ai.manage') ? [{ value: 'test', label: 'Test chat', icon: FlaskConical }, { value: 'kb', label: 'Knowledge base', icon: BookOpen }, { value: 'settings', label: 'Settings & permissions', icon: SlidersHorizontal }] : [])]
  return (
    <div>
      <PageHeader kind="ai" title="AI assistant" subtitle="Answers first questions from verified data, captures leads, and hands over to your team" />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v })} tabs={tabs} />
      {tab === 'inbox' && <Inbox />}
      {tab === 'test' && <TestChat />}
      {tab === 'kb' && <Knowledge />}
      {tab === 'settings' && <AISettings />}
    </div>
  )
}
