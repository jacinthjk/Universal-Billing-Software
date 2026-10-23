// Feature/action-level permissions. Roles store a list of these keys; "*" grants everything.
const PERMISSIONS = {
  'dashboard.view': 'View dashboard',
  'pos.sell': 'Create sales at POS',
  'sales.view': 'View sales & invoices',
  'sales.discount': 'Give discounts',
  'sales.change_price': 'Override selling price',
  'sales.refund': 'Process returns / refunds',
  'sales.edit': 'Edit saved bills',
  'sales.void': 'Cancel bills',
  'products.view': 'View products/services',
  'products.manage': 'Create & edit products/services',
  'products.view_cost': 'View purchase cost & margin',
  'inventory.view': 'View stock & ledger',
  'inventory.adjust': 'Adjust stock',
  'purchases.view': 'View purchases',
  'purchases.manage': 'Record purchases & returns',
  'suppliers.manage': 'Manage suppliers & payments',
  'customers.view': 'View customers',
  'customers.manage': 'Create & edit customers',
  'customers.export': 'Export customer data',
  'enquiries.view': 'View enquiries',
  'enquiries.manage': 'Manage enquiries & follow-ups',
  'orders.view': 'View online orders',
  'orders.manage': 'Process online orders',
  'reports.view': 'View reports',
  'reports.export': 'Export reports',
  'website.manage': 'Manage website & sharing',
  'ai.manage': 'Manage AI assistant & knowledge base',
  'whatsapp.manage': 'Link WhatsApp & send product updates / reminders',
  'staff.view': 'View employees, attendance & leave',
  'staff.manage': 'Manage employees, mark attendance & approve leave',
  'bank.view': 'View bank accounts & transactions',
  'bank.manage': 'Add bank accounts & import statements',
  'users.manage': 'Manage users & roles',
  'settings.manage': 'Manage business settings & theme',
};

const ALL = Object.keys(PERMISSIONS);

const SYSTEM_ROLES = {
  Owner: ['*'],
  Manager: ALL.filter((p) => !['users.manage', 'settings.manage'].includes(p)),
  Cashier: ['dashboard.view', 'pos.sell', 'sales.view', 'products.view', 'customers.view', 'customers.manage', 'enquiries.view', 'enquiries.manage', 'orders.view'],
  'Stock Staff': ['dashboard.view', 'products.view', 'products.manage', 'inventory.view', 'inventory.adjust', 'purchases.view', 'purchases.manage', 'suppliers.manage'],
  'Sales Staff': ['dashboard.view', 'products.view', 'customers.view', 'customers.manage', 'enquiries.view', 'enquiries.manage', 'orders.view', 'orders.manage', 'sales.view'],
  'Website Manager': ['dashboard.view', 'products.view', 'products.manage', 'website.manage', 'orders.view', 'orders.manage', 'ai.manage', 'enquiries.view'],
};

const has = (perms, p) => perms.includes('*') || perms.includes(p);

module.exports = { PERMISSIONS, ALL, SYSTEM_ROLES, has };
