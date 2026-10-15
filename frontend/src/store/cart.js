import { useCallback, useEffect, useState } from 'react'

// Per-store cart kept in the visitor's browser. Only product ids and quantities are stored;
// prices and availability are always fetched from the server.
const key = (slug) => `cart:${slug}`
const read = (slug) => {
  try { return JSON.parse(localStorage.getItem(key(slug))) || [] } catch { return [] }
}
const write = (slug, items) => {
  try { localStorage.setItem(key(slug), JSON.stringify(items)) } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent('cart-change', { detail: slug }))
}

export function useCart(slug) {
  const [items, setItems] = useState(() => read(slug))
  useEffect(() => {
    const sync = (e) => (!e.detail || e.detail === slug) && setItems(read(slug))
    window.addEventListener('cart-change', sync)
    return () => window.removeEventListener('cart-change', sync)
  }, [slug])
  const add = useCallback((productId, qty = 1) => {
    const cur = read(slug)
    const i = cur.findIndex((x) => x.productId === productId)
    if (i >= 0) cur[i].qty += qty
    else cur.push({ productId, qty })
    write(slug, cur)
  }, [slug])
  const setQty = useCallback((productId, qty) => write(slug, read(slug).map((x) => (x.productId === productId ? { ...x, qty } : x)).filter((x) => x.qty > 0)), [slug])
  const clear = useCallback(() => write(slug, []), [slug])
  const replace = useCallback((next) => write(slug, next), [slug])
  return { items, count: items.reduce((s, x) => s + x.qty, 0), add, setQty, clear, replace }
}

export function visitorId() {
  try {
    let id = localStorage.getItem('visitor-id')
    if (!id) {
      id = `v-${crypto.randomUUID()}`
      localStorage.setItem('visitor-id', id)
    }
    return id
  } catch {
    return `v-${Math.random().toString(36).slice(2)}${Date.now()}`
  }
}
