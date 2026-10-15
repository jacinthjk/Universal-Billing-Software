import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Bot } from 'lucide-react'
import { publicApi } from '../lib/api'
import { visitorId } from './cart'

// Website AI enquiry widget, styled by the business theme (brand CSS variables).
export default function ChatWidget({ slug, business }) {
  const storeKey = `chat:${slug}`
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([{ role: 'assistant', text: business.ai.greeting }])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState(() => { try { return localStorage.getItem(storeKey) } catch { return null } })
  const [status, setStatus] = useState('AI')
  const end = useRef()
  const vid = useRef(visitorId())

  // Restore an existing conversation and poll for staff replies once a human takes over.
  useEffect(() => {
    if (!conversationId || !open) return
    const load = () => publicApi.get(`/${slug}/chat/${conversationId}`, { params: { visitorId: vid.current } })
      .then((r) => { setMessages([{ role: 'assistant', text: business.ai.greeting }, ...r.data.messages]); setStatus(r.data.status) })
      .catch(() => { try { localStorage.removeItem(storeKey) } catch { /* ignore */ } setConversationId(null) })
    load()
    const id = setInterval(load, 8000)
    return () => clearInterval(id)
  }, [conversationId, open, slug]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, open])

  const send = async (msg = text) => {
    const m = msg.trim()
    if (!m || busy) return
    setText('')
    setMessages((x) => [...x, { role: 'user', text: m }])
    setBusy(true)
    try {
      const { data } = await publicApi.post(`/${slug}/chat`, { visitorId: vid.current, conversationId: conversationId || undefined, message: m, page: location.pathname })
      if (data.conversationId !== conversationId) {
        setConversationId(data.conversationId)
        try { localStorage.setItem(storeKey, data.conversationId) } catch { /* ignore */ }
      }
      setStatus(data.status)
      if (data.reply) setMessages((x) => [...x, { role: 'assistant', text: data.reply }])
    } catch (e) {
      setMessages((x) => [...x, { role: 'assistant', text: e.response?.status === 429 ? 'You are sending messages quickly - please wait a moment.' : 'Sorry, I could not reach the store right now. Please try again.' }])
    } finally {
      setBusy(false)
    }
  }

  const linkify = (s) => s.split(/(https?:\/\/\S+)/g).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part} className="break-all underline" target={part.includes(location.host) ? '_self' : '_blank'} rel="noreferrer">{part.replace(/^https?:\/\/[^/]+/, '')}</a> : part))

  return (
    <>
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-[85vh] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:h-[560px] sm:w-[380px] sm:rounded-2xl">
          <div className="flex items-center gap-3 bg-brand px-4 py-3 text-brand-fg">
            <div className="flex size-9 items-center justify-center rounded-full bg-white/20"><Bot className="size-5" /></div>
            <div className="flex-1"><div className="font-semibold">{business.name}</div><div className="text-xs opacity-80">{status === 'HANDOFF' || status === 'STAFF' ? 'A team member will reply here' : 'AI assistant · usually replies instantly'}</div></div>
            <button onClick={() => setOpen(false)} aria-label="Close chat"><X className="size-5" /></button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${m.role === 'user' ? 'rounded-br-sm bg-brand text-brand-fg' : m.role === 'staff' ? 'rounded-bl-sm border border-violet-200 bg-violet-50' : 'rounded-bl-sm bg-white shadow-sm'}`}>
                  {m.role === 'staff' && <div className="mb-0.5 text-[10px] font-semibold uppercase text-violet-700">Team member</div>}
                  {linkify(m.text || '')}
                </div>
              </div>
            ))}
            {busy && <div className="flex gap-1 px-2"><span className="size-2 animate-bounce rounded-full bg-slate-400" /><span className="size-2 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" /><span className="size-2 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" /></div>}
            <div ref={end} />
          </div>
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-2">
              {['What do you have in stock?', 'Do you deliver?', 'Store timings?'].map((q) => <button key={q} onClick={() => send(q)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50">{q}</button>)}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex gap-2 border-t border-slate-200 p-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your question…" maxLength={1000} className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm outline-none focus:border-brand" />
            <button disabled={busy || !text.trim()} className="flex size-10 items-center justify-center rounded-full bg-brand text-brand-fg disabled:opacity-50" aria-label="Send"><Send className="size-4" /></button>
          </form>
          <div className="pb-1.5 text-center text-[10px] text-slate-400">AI answers use the store's live catalogue. Staff can join anytime.</div>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className={`fixed bottom-5 right-5 z-50 ${open ? 'hidden sm:flex' : 'flex'} size-14 items-center justify-center rounded-full bg-brand text-brand-fg shadow-xl transition hover:scale-105 sm:bottom-6 sm:right-6`} aria-label="Chat with us">
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>
    </>
  )
}
