// Per-device text size (A / A+ / A++). Stored in this browser only; everything is rem-based so it scales.
export const TEXT_SIZES = [
  { key: 'normal', label: 'A', title: 'Normal text', scale: '106.25%' },
  { key: 'large', label: 'A+', title: 'Larger text', scale: '118.75%' },
  { key: 'xlarge', label: 'A++', title: 'Largest text', scale: '131.25%' },
]
const KEY = 'ubb_text_size'

export function getTextSize() {
  try { return localStorage.getItem(KEY) || 'normal' } catch { return 'normal' }
}

export function applyTextSize(key = getTextSize()) {
  const size = TEXT_SIZES.find((s) => s.key === key) || TEXT_SIZES[0]
  document.documentElement.style.setProperty('--text-scale', size.scale)
  try { localStorage.setItem(KEY, size.key) } catch { /* storage unavailable */ }
  return size.key
}
