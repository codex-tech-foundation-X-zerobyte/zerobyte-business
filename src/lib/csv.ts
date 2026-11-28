// Reading a products spreadsheet saved as CSV (Excel: File > Save as > CSV). Written for real shop files: any column order,
// common header names, naira signs and thousands separators in prices, Excel's semicolon files, quoted cells.

/** Splits CSV text into rows of cells. Handles quotes, doubled quotes, line breaks inside quotes, commas, semicolons or tabs. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\ufeff/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].reduce(
    (best, candidate) => (firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best),
    ',',
  )
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index++
        } else quoted = false
      } else cell += char
    } else if (char === '"' && cell === '') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else cell += char
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''))
}

export type ImportProduct = {
  name: string
  sku: string
  category: string
  cost_price: string
  price: string
  stock: string
  reorder_point: string
}
export type ImportProblem = { row: number; message: string }
export type ProductsFile = {
  products: ImportProduct[]
  /** The spreadsheet row (the header is row 1) each product came from, in the same order as products. */
  rows: number[]
  problems: ImportProblem[]
  /** Data rows in the file, valid or not. */
  total: number
  /** Set when the file cannot be read at all (for example no name column). */
  fileError: string
}

const COLUMNS: Record<keyof ImportProduct, string[]> = {
  name: ['name', 'productname', 'product', 'item', 'itemname', 'description', 'title'],
  sku: ['sku', 'code', 'itemcode', 'productcode', 'barcode', 'productid'],
  category: ['category', 'group', 'type', 'department'],
  cost_price: ['costprice', 'cost', 'buyingprice', 'purchaseprice', 'buyprice', 'unitcost'],
  price: ['price', 'sellingprice', 'sellprice', 'saleprice', 'unitprice', 'retailprice'],
  stock: ['stock', 'quantity', 'qty', 'openingstock', 'instock', 'onhand', 'stockquantity', 'quantityonhand'],
  reorder_point: ['reorderpoint', 'reorderlevel', 'reorder', 'minstock', 'minimumstock', 'lowstock', 'lowstocklevel'],
}
const REQUIRED_NAMES: Record<string, string> = { name: 'name', price: 'selling price' }

const normalize = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '')

/** "₦1,500.50", "NGN 1500", "1 500" -> "1500.5". Returns null when it is not a plain amount. */
export function cleanAmount(value: string): string | null {
  const stripped = value
    .trim()
    .replace(/^(ngn|₦|n)\s*(?=\d)/i, '')
    .replace(/[,\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(stripped)) return null
  const rounded = Math.round(Number(stripped) * 100) / 100
  if (!Number.isFinite(rounded) || rounded > 9999999999.99) return null
  return String(rounded)
}

function cleanWhole(value: string): string | null {
  const amount = cleanAmount(value)
  if (amount === null) return null
  return Number.isInteger(Number(amount)) && Number(amount) <= 999999999 ? amount : null
}

export const MAX_IMPORT_ROWS = 1000

export function readProductsCsv(text: string): ProductsFile {
  const table = parseCsv(text)
  const empty = (fileError: string): ProductsFile => ({ products: [], rows: [], problems: [], total: 0, fileError })
  if (table.length < 2)
    return empty('The file has no products. The first row must be the column names, then one product per row.')
  const header = table[0].map(normalize)
  const columnOf = (field: keyof ImportProduct) => header.findIndex((name) => COLUMNS[field].includes(name))
  const index = Object.fromEntries(
    (Object.keys(COLUMNS) as (keyof ImportProduct)[]).map((field) => [field, columnOf(field)]),
  ) as Record<keyof ImportProduct, number>
  const missing = Object.entries(REQUIRED_NAMES).filter(([field]) => index[field as keyof ImportProduct] < 0)
  if (missing.length)
    return empty(
      `We could not find a "${missing.map(([, label]) => label).join('" and a "')}" column in the first row. Use the template so the column names match.`,
    )

  const products: ImportProduct[] = []
  const rows: number[] = []
  const problems: ImportProblem[] = []
  const data = table.slice(1)
  data.forEach((cells, offset) => {
    const row = offset + 2
    const cell = (field: keyof ImportProduct) => (index[field] >= 0 ? (cells[index[field]] ?? '').trim() : '')
    const fail = (message: string) => problems.push({ row, message })
    const name = cell('name')
    if (!name) return fail('The product name is empty.')
    if (name.length > 200) return fail('The product name is longer than 200 characters.')
    const sku = cell('sku')
    if (sku.length > 80) return fail('The SKU is longer than 80 characters.')
    const category = cell('category')
    if (category.length > 80) return fail('The category is longer than 80 characters.')
    const price = cleanAmount(cell('price'))
    if (price === null) return fail(`The selling price "${cell('price')}" is not a number such as 1500 or 1500.50.`)
    const costText = cell('cost_price')
    const cost = costText ? cleanAmount(costText) : '0'
    if (cost === null) return fail(`The cost price "${costText}" is not a number such as 1200.`)
    const stockText = cell('stock')
    const stock = stockText ? cleanWhole(stockText) : '0'
    if (stock === null) return fail(`The stock "${stockText}" is not a whole number such as 24.`)
    const reorderText = cell('reorder_point')
    const reorder = reorderText ? cleanWhole(reorderText) : '5'
    if (reorder === null) return fail(`The reorder level "${reorderText}" is not a whole number such as 5.`)
    products.push({ name, sku, category, cost_price: cost, price, stock, reorder_point: reorder })
    rows.push(row)
  })
  return { products, rows, problems, total: data.length, fileError: '' }
}

export const PRODUCT_TEMPLATE_HEADERS = ['name', 'sku', 'category', 'cost_price', 'price', 'stock', 'reorder_point']
export const PRODUCT_TEMPLATE_ROWS: (string | number)[][] = [
  ['5kg Rice', 'RICE-005', 'Groceries', 4200, 5000, 24, 5],
  ['Indomie carton', '', 'Noodles', 3800, 4500, 10, 3],
  ['Peak milk tin', 'MILK-01', 'Dairy', 650, 800, 60, 12],
]

/** Reads the message out of a database error that carries {"code":...,"message":...}. */
export function databaseMessage(error: { message?: string; details?: string } | null | undefined, fallback: string) {
  const raw = error?.message ?? ''
  try {
    const parsed = JSON.parse(raw) as { message?: string }
    if (parsed.message) return parsed.message
  } catch {
    // Not one of our structured errors; fall through.
  }
  return raw || fallback
}
