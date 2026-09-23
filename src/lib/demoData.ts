import type { Product, Sale } from './types'

export const products: Product[] = [
  { id: '1', name: 'Studio Headphones', sku: 'AUD-2048', category: 'Audio', stock: 42, price: 189, status: 'In stock' },
  { id: '2', name: 'USB-C Hub 8-in-1', sku: 'ACC-8812', category: 'Accessories', stock: 8, price: 74, status: 'Low stock' },
  { id: '3', name: 'Mechanical Keyboard', sku: 'ACC-4490', category: 'Accessories', stock: 24, price: 129, status: 'In stock' },
  { id: '4', name: '4K Monitor 27"', sku: 'DSP-2701', category: 'Displays', stock: 0, price: 449, status: 'Out of stock' },
  { id: '5', name: 'Desk Light — Graphite', sku: 'DSK-1204', category: 'Workspace', stock: 16, price: 68, status: 'In stock' },
]

export const sales: Sale[] = [
  { id: 'ZB-1048', customer: 'Maya Chen', initials: 'MC', amount: 378, status: 'Completed', date: 'Today, 11:42' },
  { id: 'ZB-1047', customer: 'Northstar Studio', initials: 'NS', amount: 1290, status: 'Completed', date: 'Today, 10:18' },
  { id: 'ZB-1046', customer: 'Alex Morgan', initials: 'AM', amount: 74, status: 'Pending', date: 'Yesterday, 16:05' },
  { id: 'ZB-1045', customer: 'Loam & Co.', initials: 'LC', amount: 542, status: 'Completed', date: 'Yesterday, 14:22' },
]

export const chartData = [38, 46, 41, 57, 52, 61, 58, 73, 68, 84, 78, 91]
