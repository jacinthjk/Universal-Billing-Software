// Business-specific icon packs used across the billing portal. Each business type gets themed icons
// for its key screens (POS, products, customers, bills...) plus a set of decorative "hero" icons;
// category chips pick an icon from the category's name.
import {
  ShoppingCart, ShoppingBasket, ShoppingBag, Tag, Gift, Package, Apple, Carrot, Wheat, Milk, Egg, Leaf, Smartphone, Laptop,
  Headphones, Cpu, Plug, PlugZap, BatteryCharging, Shirt, Scissors, Gem, Watch, Glasses, Footprints, Sparkles, Flower2,
  Droplet, Droplets, Heart, Brush, ChefHat, UtensilsCrossed, Coffee, Pizza, Soup, Croissant, IceCreamCone, CakeSlice, Cookie,
  Pill, Syringe, HeartPulse, Thermometer, Stethoscope, ClipboardPlus, Wrench, Hammer, Calendar, Clock, Briefcase,
  ClipboardCheck, Boxes, Truck, Warehouse, PackageCheck, Forklift, Container, Smile, ShieldPlus, ShieldCheck, CalendarHeart,
  Users, UserRound, Receipt, ReceiptText, Flame, Cable, Baby, PawPrint, BookOpen, Sofa, Paintbrush, Wine, Fish, Beef, Salad,
  Candy, Sandwich, Citrus, Sprout, Boxes as Inventory, MessageSquare, ShoppingBag as Orders, BarChart3, Globe, Bot, Settings,
  Truck as Purchases, LayoutDashboard, Store,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Tooth, ThemeIcon } from './icons'

const BASE = { pos: ShoppingCart, products: Package, customers: Users, sale: Receipt, hero: [ShoppingBag, Tag, Gift, Package, Receipt, Store] }

export const TYPE_PACKS = {
  RETAIL: BASE,
  GROCERY: { pos: ShoppingBasket, products: Apple, customers: Users, sale: ReceiptText, hero: [Apple, Carrot, Wheat, Milk, Egg, Leaf, Citrus, Sprout] },
  ELECTRONICS: { pos: ShoppingCart, products: Smartphone, customers: Users, sale: Receipt, hero: [Smartphone, Laptop, Headphones, Cpu, Plug, BatteryCharging, Watch, Cable] },
  FASHION: { pos: ShoppingBag, products: Shirt, customers: Users, sale: Receipt, hero: [Shirt, Scissors, Gem, Watch, Glasses, Footprints, ShoppingBag, Tag] },
  BEAUTY: { pos: ShoppingBag, products: Sparkles, customers: Heart, sale: Receipt, hero: [Sparkles, Flower2, Droplet, Heart, Gem, Brush, Droplets, Smile] },
  RESTAURANT: { pos: ChefHat, products: UtensilsCrossed, customers: Users, sale: ReceiptText, hero: [Coffee, Pizza, Soup, Croissant, IceCreamCone, CakeSlice, Sandwich, ChefHat] },
  PHARMACY: { pos: ClipboardPlus, products: Pill, customers: HeartPulse, sale: ReceiptText, hero: [Pill, Syringe, HeartPulse, Thermometer, Stethoscope, ShieldPlus, Droplet, ClipboardPlus] },
  SERVICE: { pos: ClipboardCheck, products: Wrench, customers: UserRound, sale: Receipt, hero: [Wrench, Hammer, Calendar, Clock, Briefcase, ClipboardCheck, ShieldCheck, Smile] },
  WHOLESALE: { pos: ShoppingCart, products: Boxes, customers: Users, sale: ReceiptText, hero: [Boxes, Truck, Warehouse, PackageCheck, Forklift, Container, Package, Tag] },
  DENTAL: { pos: Stethoscope, products: Tooth, customers: Smile, sale: ReceiptText, hero: [Tooth, Smile, Sparkles, ShieldPlus, CalendarHeart, Stethoscope, Syringe, HeartPulse] },
  CUSTOM: BASE,
}

// Generic sections keep their meaning everywhere; business-specific ones come from the pack.
const SECTIONS = {
  dashboard: LayoutDashboard, inventory: Inventory, purchases: Purchases, orders: Orders, enquiries: MessageSquare,
  reports: BarChart3, website: Globe, ai: Bot, settings: Settings,
}

/** Icons for the active business: { brand, pos, products, customers, sale, hero[], section(kind) }. */
export function useBusinessIcons() {
  const { business } = useAuth()
  const pack = TYPE_PACKS[business?.type] || BASE
  const brandName = business?.theme?.icon
  const Brand = (props) => <ThemeIcon name={brandName} {...props} />
  return { ...pack, brand: Brand, section: (kind) => pack[kind] || SECTIONS[kind] || Brand }
}

// Category name → icon (first match wins); unmatched categories use the business icon.
const CATEGORY_RULES = [
  [/oil|ghee/i, Droplet], [/dairy|milk|curd|paneer/i, Milk], [/grain|millet|rice|wheat|atta|flour|pulse|dal/i, Wheat],
  [/fruit/i, Citrus], [/veg|produce|fresh|green/i, Carrot], [/spice|masala|chilli/i, Flame], [/egg/i, Egg], [/meat|chicken|mutton/i, Beef],
  [/fish|sea ?food/i, Fish], [/salad/i, Salad], [/snack|biscuit|cookie|bakery|bread/i, Cookie], [/sweet|candy|chocolate/i, Candy],
  [/cake|dessert/i, CakeSlice], [/coffee|tea|beverage|drink|juice/i, Coffee], [/wine|beer|liquor/i, Wine], [/pizza/i, Pizza],
  [/soup|curry|main/i, Soup], [/starter|sandwich|burger/i, Sandwich], [/audio|headphone|speaker|earbud/i, Headphones],
  [/charger|cable|power|adapter/i, PlugZap], [/battery/i, BatteryCharging], [/phone|mobile/i, Smartphone], [/laptop|computer/i, Laptop],
  [/watch/i, Watch], [/accessor/i, Gem], [/shirt|top|cloth|wear|apparel|dress|saree|kurta/i, Shirt], [/shoe|foot/i, Footprints],
  [/glass|eyewear/i, Glasses], [/jewel|ornament/i, Gem], [/skin|face|cosmetic|make ?up|whiten|beauty/i, Sparkles],
  [/hair|salon/i, Scissors], [/fragrance|perfume/i, Flower2], [/medicine|tablet|capsule|drug/i, Pill], [/injection|vaccine/i, Syringe],
  [/consult|diagnos|check/i, Stethoscope], [/prevent|protect/i, ShieldCheck], [/restor|filling|crown|implant|surgery/i, Tooth],
  [/oral|dental|tooth/i, Smile], [/baby|kid|child/i, Baby], [/pet/i, PawPrint], [/book|stationery/i, BookOpen], [/furniture|home/i, Sofa],
  [/paint|art/i, Paintbrush], [/service|repair/i, Wrench], [/bulk|carton|wholesale/i, Boxes],
]

export function CategoryIcon({ name, ...props }) {
  const rule = CATEGORY_RULES.find(([re]) => re.test(name || ''))
  if (rule) {
    const Icon = rule[1]
    return <Icon {...props} />
  }
  return <BrandIcon {...props} />
}

function BrandIcon(props) {
  const { business } = useAuth()
  return <ThemeIcon name={business?.theme?.icon} {...props} />
}

// Standalone variant for the public store (no signed-in business context).
export function StoreCategoryIcon({ name, fallback, ...props }) {
  const rule = CATEGORY_RULES.find(([re]) => re.test(name || ''))
  if (rule) {
    const Icon = rule[1]
    return <Icon {...props} />
  }
  return <ThemeIcon name={fallback} {...props} />
}
