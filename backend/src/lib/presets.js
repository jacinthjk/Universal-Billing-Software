// Business-type and theme presets. Business type configures terminology, optional fields and default
// modules; the theme configures visuals only. Neither changes the underlying sales/inventory engine.

const THEMES = {
  classic: { name: 'Classic Blue', primary: '#2563eb', secondary: '#0f172a', accent: '#f59e0b', font: 'Inter', mode: 'light', radius: 'md', icon: 'Store' },
  organic: { name: 'Organic Earth', primary: '#3f7d3a', secondary: '#5b4636', accent: '#d4a017', font: 'Nunito', mode: 'light', radius: 'lg', icon: 'Leaf' },
  tech: { name: 'Tech Midnight', primary: '#7c3aed', secondary: '#0b1020', accent: '#06b6d4', font: 'Space Grotesk', mode: 'dark', radius: 'sm', icon: 'Cpu' },
  fashion: { name: 'Fashion Rose', primary: '#be185d', secondary: '#1f1f1f', accent: '#f9a8d4', font: 'Playfair Display', mode: 'light', radius: 'none', icon: 'Shirt' },
  beauty: { name: 'Beauty Blush', primary: '#db2777', secondary: '#4a2c3a', accent: '#fbcfe8', font: 'Poppins', mode: 'light', radius: 'lg', icon: 'Sparkles' },
  cafe: { name: 'Cafe Mocha', primary: '#92400e', secondary: '#2b1d14', accent: '#f59e0b', font: 'Merriweather', mode: 'light', radius: 'md', icon: 'Coffee' },
  pharmacy: { name: 'Pharmacy Teal', primary: '#0d9488', secondary: '#134e4a', accent: '#22c55e', font: 'Inter', mode: 'light', radius: 'md', icon: 'Pill' },
  wholesale: { name: 'Wholesale Slate', primary: '#475569', secondary: '#0f172a', accent: '#ea580c', font: 'Roboto', mode: 'light', radius: 'sm', icon: 'Warehouse' },
  dental: { name: 'Dental Care', primary: '#0e7490', secondary: '#083344', accent: '#5eead4', font: 'Nunito', mode: 'light', radius: 'lg', icon: 'Tooth' },
};

const FONTS = ['Inter', 'Nunito', 'Poppins', 'Roboto', 'Space Grotesk', 'Playfair Display', 'Merriweather', 'Lato'];

const BASE_TERMS = {
  product: 'Product', products: 'Products', customer: 'Customer', customers: 'Customers',
  invoice: 'Invoice', sale: 'Sale', supplier: 'Supplier', order: 'Order',
};

const BUSINESS_TYPES = {
  RETAIL: { label: 'Retail', theme: 'classic', terms: {}, fields: ['barcode'], modules: [] },
  GROCERY: { label: 'Grocery / Organic', theme: 'organic', terms: {}, fields: ['barcode', 'batch', 'expiry'], modules: [] },
  ELECTRONICS: { label: 'Electronics', theme: 'tech', terms: {}, fields: ['barcode', 'brand', 'model', 'serial', 'warranty'], modules: [] },
  FASHION: { label: 'Fashion', theme: 'fashion', terms: {}, fields: ['size', 'colour', 'variant'], modules: [] },
  BEAUTY: { label: 'Beauty / Cosmetics', theme: 'beauty', terms: {}, fields: ['variant', 'batch', 'expiry', 'ingredients'], modules: [] },
  RESTAURANT: { label: 'Restaurant / Cafe', theme: 'cafe', terms: { product: 'Menu Item', products: 'Menu', customer: 'Guest', customers: 'Guests', invoice: 'Bill' }, fields: ['vegType', 'modifiers'], modules: [] },
  PHARMACY: { label: 'Pharmacy', theme: 'pharmacy', terms: {}, fields: ['batch', 'expiry', 'manufacturer'], modules: [] },
  SERVICE: { label: 'Service Business', theme: 'classic', terms: { product: 'Service', products: 'Services', customer: 'Client', customers: 'Clients' }, fields: ['duration', 'staff'], modules: [] },
  WHOLESALE: { label: 'Wholesale', theme: 'wholesale', terms: { customer: 'Buyer', customers: 'Buyers' }, fields: ['barcode', 'bulkPrice', 'moq'], modules: [] },
  DENTAL: { label: 'Dental Clinic', theme: 'dental', terms: { product: 'Treatment', products: 'Treatments', customer: 'Patient', customers: 'Patients' }, fields: ['duration', 'staff', 'toothNumber'], modules: [] },
  CUSTOM: { label: 'Custom', theme: 'classic', terms: {}, fields: [], modules: [] },
};

const MODULES = ['pos', 'products', 'inventory', 'purchases', 'customers', 'enquiries', 'orders', 'website', 'reports', 'ai'];

const DEFAULT_SETTINGS = {
  modules: MODULES,
  taxInclusive: false,
  allowNegativeStock: false,
  invoice: {
    title: 'Tax Invoice',
    prefix: 'INV-',
    numberDigits: 6, // zero-padding; 0 prints plain numbers like 319
    format: 'A4', // A4 | THERMAL
    footer: 'Thank you for your business!',
    terms: '',
    showQr: true,
    // New/Repeat customer and visit number are tracked internally but not printed for customers.
    showCustomerStatus: false,
  },
  customerMatch: ['phone', 'email'],
  visitRule: 'PAID', // PAID: count paid sales only | COMPLETED: count any completed (incl. credit) sale
  paymentModes: ['CASH', 'UPI', 'CARD', 'OTHER'],
  reportTime: '22:00',
  reportEnabled: true,
  reportSize: '1080x1350',
  reportPdf: true,
  // Automatic delivery of the daily report (WhatsApp image + Excel).
  reportDelivery: { enabled: false, channel: 'WHATSAPP', recipients: [], formats: ['image', 'excel'], countryCode: '91' },
  // WhatsApp sending. provider: LINKED (own number via QR code) | CLOUD (official Business Cloud API).
  // autoSendInvoice: send the invoice PDF to the customer's WhatsApp when a POS bill is saved.
  whatsapp: { provider: 'LINKED', countryCode: '91', autoSendInvoice: false },
  stockOnOrderStage: 'COMPLETED',
};

const DEFAULT_WEBSITE = {
  enabled: true,
  tagline: 'Quality you can trust',
  about: '',
  heroTitle: '',
  heroSubtitle: '',
  bannerUrl: '',
  showPrices: true,
  showStock: true,
  allowOrders: true,
  fulfilment: ['PICKUP', 'DELIVERY'],
  paymentOptions: ['PAY_ON_DELIVERY', 'PAY_AT_PICKUP'],
  deliveryNote: '',
  policies: { returns: '', shipping: '', privacy: '' },
  social: { instagram: '', facebook: '', whatsapp: '' },
  hours: '',
  mapUrl: '',
  seo: { title: '', description: '' },
};

// AI permission matrix defaults (section 51).
const DEFAULT_AI = {
  enabled: true,
  model: 'claude-opus-5-5',
  effort: 'low',
  tone: 'friendly and concise',
  greeting: 'Hi! 👋 How can I help you today?',
  permissions: {
    search_products: true, get_product_details: true, check_stock: true, get_business_info: true,
    search_customer: true, create_customer: true, create_enquiry: true, update_enquiry: true,
    create_followup: true, create_cart: true, create_quotation: false, create_order: false,
    handoff_to_staff: true, get_order_status: true,
  },
  orderRequiresStaffApproval: true,
  escalationKeywords: ['refund', 'complaint', 'cancel', 'damaged', 'legal', 'lawyer', 'fraud', 'dispute'],
  leadRules: { productSelected: 15, quantityGiven: 15, priceAsked: 10, deliveryAsked: 15, quotationAsked: 20, cartCreated: 25, callbackAsked: 20, repeatCustomer: 10 },
};

function terminologyFor(type, overrides = {}) {
  return { ...BASE_TERMS, ...(BUSINESS_TYPES[type]?.terms || {}), ...overrides };
}

module.exports = { THEMES, FONTS, BUSINESS_TYPES, MODULES, DEFAULT_SETTINGS, DEFAULT_WEBSITE, DEFAULT_AI, terminologyFor };
