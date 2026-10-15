import { Check } from 'lucide-react'
import { ThemeIcon } from '../lib/icons'
import { onColor } from '../lib/theme'

// Theme preset tile: colour palette (primary / secondary / accent) with the theme's business icon.
export default function ThemeCard({ theme, active, onClick, compact }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`card overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-md ${active ? 'ring-2 ring-brand' : ''}`}>
      <div className={`relative flex ${compact ? 'h-14' : 'h-20'}`}>
        <div className="flex flex-1 items-center justify-center" style={{ background: theme.primary, color: onColor(theme.primary) }}>
          <ThemeIcon name={theme.icon} className={compact ? 'size-6' : 'size-8'} strokeWidth={1.75} />
        </div>
        <div className="w-6" style={{ background: theme.secondary }} />
        <div className="w-3" style={{ background: theme.accent }} />
      </div>
      <div className="flex items-center justify-between gap-1 p-2 text-sm font-medium" style={{ fontFamily: theme.font }}>
        <span className="truncate">{theme.name}</span>
        {active && <Check className="size-4 shrink-0 text-brand" />}
      </div>
    </button>
  )
}
