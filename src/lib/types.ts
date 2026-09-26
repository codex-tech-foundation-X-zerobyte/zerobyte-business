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
