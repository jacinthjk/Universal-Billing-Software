// Applies a business theme to the document by setting CSS variables + loading the chosen font.
const RADII = { none: '0px', sm: '0.3rem', md: '0.6rem', lg: '1rem' }

export function onColor(hex = '#000000') {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#ffffff'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#111111' : '#ffffff'
}

const loadedFonts = new Set(['Inter'])
function loadFont(family) {
  if (!family || loadedFonts.has(family)) return
  loadedFonts.add(family)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700;800&display=swap`
  document.head.appendChild(link)
}

export function applyTheme(theme = {}, target = document.documentElement) {
  const primary = theme.primary || '#2563eb'
  target.style.setProperty('--brand', primary)
  target.style.setProperty('--brand-2', theme.secondary || '#0f172a')
  target.style.setProperty('--accent', theme.accent || '#f59e0b')
  target.style.setProperty('--brand-fg', onColor(primary))
  target.style.setProperty('--brand-soft', `color-mix(in oklab, ${primary} 12%, white)`)
  target.style.setProperty('--font', `'${theme.font || 'Inter'}'`)
  target.style.setProperty('--radius', RADII[theme.radius] || RADII.md)
  loadFont(theme.font)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', primary)
}

export function setFavicon(url) {
  let link = document.querySelector('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = url || '/favicon.svg'
}
