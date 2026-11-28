import { csvText } from './format'
import { supabase } from './supabase'
import { createZip, type ZipEntry } from './zip'

// "Your data is yours": every record of the business, as plain CSV files in one ZIP, available at any time. Nothing is
// left out because of a plan, and no staff pay details are included (those stay in Workforce).
type Source = {
  file: string
  label: string
  table: string
  /** Child tables have no business id of their own: filter through the parent that has one. */
  parent?: string
}

export const EXPORT_SOURCES: Source[] = [
  { file: 'products.csv', label: 'Products', table: 'products' },
  { file: 'customers.csv', label: 'Customers', table: 'customers' },
  { file: 'customer-payments.csv', label: 'Customer payments', table: 'customer_payments' },
  { file: 'sales.csv', label: 'Sales', table: 'sales' },
  { file: 'sale-items.csv', label: 'Items on each sale', table: 'sale_items', parent: 'sales' },
  { file: 'invoices.csv', label: 'Invoices', table: 'invoices' },
  { file: 'expenses.csv', label: 'Expenses', table: 'expenses' },
  { file: 'suppliers.csv', label: 'Suppliers', table: 'suppliers' },
  { file: 'purchase-orders.csv', label: 'Purchase orders', table: 'purchase_orders' },
  {
    file: 'purchase-order-items.csv',
    label: 'Items on each purchase order',
    table: 'purchase_order_items',
    parent: 'purchase_orders',
  },
  { file: 'stock-movements.csv', label: 'Stock history', table: 'stock_movements' },
  { file: 'stock-counts.csv', label: 'Stock counts', table: 'stock_counts' },
  {
    file: 'stock-count-items.csv',
    label: 'Items on each stock count',
    table: 'stock_count_items',
    parent: 'stock_counts',
  },
  { file: 'branches.csv', label: 'Branches', table: 'branches' },
]

const PAGE = 1000
const MAX_ROWS_PER_FILE = 500000

/** One spreadsheet cell: nothing for empty, JSON for nested data, plain text for the rest. */
export function exportCell(value: unknown): string | number {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export type ExportProgress = { done: number; total: number; label: string }
export type ExportReport = { file: string; label: string; rows: number; error: string }

async function readAll(
  orgId: string,
  source: Source,
): Promise<{ headers: string[]; rows: (string | number)[][]; error: string }> {
  if (!supabase) return { headers: [], rows: [], error: 'Not connected.' }
  const records: Record<string, unknown>[] = []
  for (let from = 0; from < MAX_ROWS_PER_FILE; from += PAGE) {
    let request = supabase.from(source.table).select(source.parent ? `*,${source.parent}!inner(organization_id)` : '*')
    request = source.parent
      ? request.eq(`${source.parent}.organization_id`, orgId)
      : request.eq('organization_id', orgId)
    const { data, error } = await request.order('id').range(from, from + PAGE - 1)
    if (error) return { headers: [], rows: [], error: error.message }
    const page = (data ?? []) as unknown as Record<string, unknown>[]
    records.push(...page)
    if (page.length < PAGE) break
  }
  // The columns are the union of what the rows have, in the order they first appear; the helper join column is dropped.
  const headers: string[] = []
  for (const record of records)
    for (const key of Object.keys(record)) if (key !== source.parent && !headers.includes(key)) headers.push(key)
  return { headers, rows: records.map((record) => headers.map((key) => exportCell(record[key]))), error: '' }
}

export async function exportBusinessData(
  orgId: string,
  businessName: string,
  onProgress: (progress: ExportProgress) => void,
): Promise<{ zip: Uint8Array; report: ExportReport[] }> {
  const entries: ZipEntry[] = []
  const report: ExportReport[] = []
  for (const [index, source] of EXPORT_SOURCES.entries()) {
    onProgress({ done: index, total: EXPORT_SOURCES.length, label: source.label })
    const result = await readAll(orgId, source)
    report.push({ file: source.file, label: source.label, rows: result.rows.length, error: result.error })
    // A file with no rows is still written (with its column names where known) so the ZIP always has the same shape.
    if (!result.error) entries.push({ name: source.file, data: '\ufeff' + csvText(result.headers, result.rows) })
  }
  onProgress({ done: EXPORT_SOURCES.length, total: EXPORT_SOURCES.length, label: 'Packing the files' })
  const when = new Date()
  const lines = [
    `${businessName || 'Your business'}: a copy of your records`,
    `Exported on ${when.toLocaleString('en-NG')} from Zerøbyte Business.`,
    '',
    'Each file is a spreadsheet (CSV). Open it in Excel, Google Sheets or any spreadsheet app.',
    'Amounts are in naira. Dates and times are in UTC (add 1 hour for Lagos time).',
    'Ids link the files: sale-items.csv points to sales.csv with sale_id, and product_id points to products.csv.',
    'Staff pay details are not included; they stay in the Workforce page.',
    '',
    'What is in this copy:',
    ...report.map(
      (item) =>
        `- ${item.file}: ${item.error ? `could not be exported (${item.error})` : `${item.rows.toLocaleString('en-NG')} rows`}`,
    ),
  ]
  entries.unshift({ name: 'README.txt', data: lines.join('\r\n') + '\r\n' })
  return { zip: createZip(entries), report }
}

export function downloadBytes(filename: string, bytes: Uint8Array, type = 'application/zip') {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
