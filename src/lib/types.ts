export type View =
  | 'Overview'
  | 'Inventory'
  | 'Purchase Orders'
  | 'Customers'
  | 'Sales'
  | 'Records'
  | 'Receipts'
  | 'Invoices'
  | 'Expenses'
  | 'Reports'
  | 'Branches'
  | 'Workforce'
  | 'User Accounts'
  | 'Settings'

export type Product = {
  id: string
  name: string
  sku: string
  category: string
  stock: number
  price: number
  status: 'In stock' | 'Low stock' | 'Out of stock'
}

export type Sale = {
  id: string
  customer: string
  initials: string
  amount: number
  status: 'Completed' | 'Pending' | 'Refunded'
  date: string
}

// Row shapes shared across workspace features (moved out of App.tsx).
export type ProductRow = { id: string; name: string; sku: string; stock: number; price: number; cost_price: number; category?: string; reorder_point?: number; branch_id?: string | null }
export type CustomerRow = { id: string; name: string; email: string | null; phone: string | null }
export type OrganizationRow = { id: string; name: string; role?: string }
export type NotificationRow = { id: string; organization_id?: string; title: string; body: string; read_at: string | null; created_at: string }
export type RecordRange = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom'
export type SupportMessage = { id: string; conversation_id: string; sender_id: string; sender_role: 'customer' | 'admin'; body: string; created_at: string; delivery?: 'sending' | 'failed' }
export type ReceiptRow = { id: string; receipt_number: string | null; total: number; tax_amount: number; payment_method: string; created_at: string; customer: { name: string; phone: string | null; email: string | null } | null; sale_items: { id: string; quantity: number; unit_price: number; line_total: number; products: { name: string; sku: string } | null }[] }
export type BusinessReceiptProfile = { name: string; address: string; phone: string; email: string; website: string; logo_url: string; currency: string }
export type SupplierRow = { id: string; name: string; phone: string | null; email: string | null }
export type PurchaseOrderRow = { id: string; status: 'ordered' | 'received' | 'cancelled'; total_cost: number; notes: string | null; created_at: string; received_at: string | null; suppliers: { name: string } | null }
export type RecordTab = 'sales' | 'expenses' | 'stock'
