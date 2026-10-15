// Business/theme icons. Themes store an icon name (e.g. 'Leaf'); this maps it to a component.
// Only the icons listed here are bundled, and they double as the icon picker in Settings.
import {
  Store, Leaf, Cpu, Shirt, Sparkles, Coffee, Pill, Warehouse, Smile, Stethoscope, HeartPulse, Scissors, Flower2, Gem,
  ShoppingBag, Package, Wrench, Dumbbell, Car, BookOpen, PawPrint, Cake, Pizza, Smartphone, Glasses, Baby, Gift, Sofa,
  Briefcase, GraduationCap, Apple, Salad, Wine, Camera, Palette, Shapes,
} from 'lucide-react'
import { onColor } from './theme'

// lucide has no tooth icon - same 24px grid and 2px stroke so it sits naturally beside the others.
export function Tooth({ className = '', strokeWidth = 2, ...props }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      <path d="M7.5 3C5 3 3.5 4.9 3.5 7.4c0 1.9.7 3.3 1.4 4.8.7 1.6.9 3.3 1.2 5.2.3 1.9.8 3.6 2.1 3.6 1.4 0 1.7-1.6 2-3.3.3-1.5.6-2.9 1.8-2.9s1.5 1.4 1.8 2.9c.3 1.7.6 3.3 2 3.3 1.3 0 1.8-1.7 2.1-3.6.3-1.9.5-3.6 1.2-5.2.7-1.5 1.4-2.9 1.4-4.8C20.5 4.9 19 3 16.5 3c-1.9 0-2.9 1-4.5 1S9.4 3 7.5 3Z" />
      <path d="M9 7.5c.9.4 2 .6 3 .6" />
    </svg>
  )
}

export const ICONS = {
  Store, Leaf, Cpu, Shirt, Sparkles, Coffee, Pill, Warehouse, Tooth, Smile, Stethoscope, HeartPulse, Scissors, Flower2, Gem,
  ShoppingBag, Package, Wrench, Dumbbell, Car, BookOpen, PawPrint, Cake, Pizza, Smartphone, Glasses, Baby, Gift, Sofa,
  Briefcase, GraduationCap, Apple, Salad, Wine, Camera, Palette, Shapes,
}

export function ThemeIcon({ name, ...props }) {
  const Icon = ICONS[name] || Store
  return <Icon {...props} />
}

// Logo when the business has one, otherwise its theme icon on the brand colour.
export function BusinessMark({ logoUrl, theme = {}, className = 'size-9', iconClass = 'size-5', rounded = 'rounded-md' }) {
  if (logoUrl) return <img src={logoUrl} alt="" className={`${className} ${rounded} bg-white object-contain`} />
  return (
    <span className={`${className} ${rounded} flex shrink-0 items-center justify-center`} style={{ background: theme.primary || 'var(--brand)', color: theme.primary ? onColor(theme.primary) : 'var(--brand-fg)' }}>
      <ThemeIcon name={theme.icon} className={iconClass} />
    </span>
  )
}
