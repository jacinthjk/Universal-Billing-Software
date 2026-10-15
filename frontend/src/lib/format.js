const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', SGD: 'S$', AUD: 'A$' }

export function money(v, currency = 'INR', { decimals = 2 } = {}) {
  const n = Number(v || 0)
  const sym = SYMBOLS[currency] ?? `${currency} `
  return `${n < 0 ? '-' : ''}${sym}${Math.abs(n).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function compactMoney(v, currency = 'INR') {
  const n = Number(v || 0)
  const sym = SYMBOLS[currency] ?? ''
  const a = Math.abs(n)
  if (currency === 'INR' && a >= 1e7) return `${sym}${(n / 1e7).toFixed(1)}Cr`
  if (currency === 'INR' && a >= 1e5) return `${sym}${(n / 1e5).toFixed(1)}L`
  if (a >= 1e6) return `${sym}${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sym}${(n / 1e3).toFixed(1)}K`
  return `${sym}${Math.round(n)}`
}

export const qty = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })

export function dateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}
export function date(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}
export function ago(d) {
  if (!d) return ''
  const s = (Date.now() - new Date(d).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const today = () => new Date().toLocaleDateString('en-CA')
export const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('en-CA')
}

export const titleCase = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
