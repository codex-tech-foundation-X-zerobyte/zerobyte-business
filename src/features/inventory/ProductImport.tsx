import { useRef, useState } from 'react'
import {
  databaseMessage,
  MAX_IMPORT_ROWS,
  PRODUCT_TEMPLATE_HEADERS,
  PRODUCT_TEMPLATE_ROWS,
  readProductsCsv,
  type ProductsFile,
} from '../../lib/csv'
import { downloadCsv, formatNaira } from '../../lib/format'
import { supabase } from '../../lib/supabase'

type Mode = 'skip' | 'update'
type Result = { created: number; updated: number; skipped: number; low_stock: number }

const plural = (value: number, noun: string) => `${value.toLocaleString('en-NG')} ${noun}${value === 1 ? '' : 's'}`

/**
 * Adds many products at once from a spreadsheet saved as CSV. The file is checked here first (row by row, in plain words)
 * and again by the database, which adds everything or nothing.
 */
export function ProductImport({
  orgId,
  branchId,
  branchName,
  onDone,
}: {
  orgId: string
  branchId: string | null
  branchName: string
  onDone: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [file, setFile] = useState<ProductsFile | null>(null)
  const [mode, setMode] = useState<Mode>('skip')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]
    setResult(null)
    setError('')
    if (!chosen) return
    setFileName(chosen.name)
    if (chosen.size > 5 * 1024 * 1024) {
      setFile(null)
      setError('That file is larger than 5 MB. Split it into smaller files.')
      return
    }
    setFile(readProductsCsv(await chosen.text()))
  }

  function reset() {
    setFile(null)
    setFileName('')
    setError('')
    if (input.current) input.current.value = ''
  }

  async function run() {
    if (!file || !supabase) return
    setError('')
    if (!navigator.onLine) {
      setError('Importing needs a connection. Reconnect and try again.')
      return
    }
    if (file.products.length > MAX_IMPORT_ROWS) {
      setError(
        `This file has ${file.products.length.toLocaleString('en-NG')} usable products. Import up to ${MAX_IMPORT_ROWS.toLocaleString('en-NG')} at a time: split the file and import it in parts.`,
      )
      return
    }
    setBusy(true)
    const { data, error: failure } = await supabase.rpc('import_products', {
      target_org: orgId,
      items: file.products,
      target_branch: branchId,
      on_duplicate: mode,
    })
    setBusy(false)
    if (failure) {
      setError(
        failure.code === 'PGRST202'
          ? 'Importing is not available yet. Please try again shortly.'
          : databaseMessage(failure, 'The import did not finish. Nothing was added.'),
      )
      return
    }
    setResult(data as Result)
    reset()
    onDone()
  }

  const ready = file?.products.length ?? 0
  const skippedRows = file?.problems.length ?? 0
  return (
    <div className="panel product-import">
      <div className="import-step">
        <h3>1. Get the template</h3>
        <p className="field-help">
          Open it in Excel or Google Sheets, fill in your products (one per row) and save it as a CSV file. The columns
          can be in any order. Leave SKU empty and we number it for you. Stock is the opening stock for new products.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() => downloadCsv('zerobyte-products-template.csv', PRODUCT_TEMPLATE_HEADERS, PRODUCT_TEMPLATE_ROWS)}
        >
          Download template (CSV)
        </button>
      </div>
      <div className="import-step">
        <h3>2. Choose your file</h3>
        <input ref={input} type="file" accept=".csv,text/csv" onChange={choose} aria-label="Products CSV file" />
        {fileName && <p className="field-help">{fileName}</p>}
      </div>

      {file?.fileError && (
        <div className="form-error" role="alert">
          {file.fileError}
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="import-result" role="status">
          <strong>Import finished.</strong> {plural(result.created, 'product')} added
          {result.updated ? `, ${plural(result.updated, 'product')} updated` : ''}
          {result.skipped
            ? `, ${plural(result.skipped, 'row')} skipped (the SKU was already there or repeated in the file)`
            : ''}
          .
          {result.low_stock
            ? ` ${plural(result.low_stock, 'product')} ${result.low_stock === 1 ? 'is' : 'are'} at or below the reorder level; you will see it in your notifications.`
            : ''}
        </div>
      )}

      {file && !file.fileError && (
        <div className="import-step">
          <h3>3. Check and import</h3>
          <p>
            <strong>{plural(ready, 'product')}</strong> ready to import
            {skippedRows ? (
              <>
                , <strong className="danger-text">{plural(skippedRows, 'row')}</strong> with a problem (skipped)
              </>
            ) : null}
            . They will be added to <strong>{branchId ? branchName : 'your business (all branches)'}</strong>.
          </p>
          {skippedRows > 0 && (
            <ul className="import-problems">
              {file.problems.slice(0, 8).map((problem) => (
                <li key={problem.row}>
                  Row {problem.row}: {problem.message}
                </li>
              ))}
              {skippedRows > 8 && (
                <li>…and {skippedRows - 8} more. Fix them in your file and import again if you want them.</li>
              )}
            </ul>
          )}
          {ready > 0 && (
            <>
              <div className="table-wrap import-preview">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Category</th>
                      <th>Cost</th>
                      <th>Price</th>
                      <th>Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {file.products.slice(0, 5).map((product, position) => (
                      <tr key={file.rows[position]}>
                        <td>{product.name}</td>
                        <td className="mono">{product.sku || 'automatic'}</td>
                        <td>{product.category || 'Uncategorized'}</td>
                        <td className="amount">{formatNaira(Number(product.cost_price))}</td>
                        <td className="amount">{formatNaira(Number(product.price))}</td>
                        <td>{product.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ready > 5 && <p className="field-help">Showing 5 of {ready.toLocaleString('en-NG')}.</p>}
              <label className="import-mode">
                If a product with the same SKU already exists
                <select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
                  <option value="skip">Leave it as it is</option>
                  <option value="update">Update its name, category, price and reorder level (never its stock)</option>
                </select>
              </label>
              <div className="import-actions">
                <button type="button" className="primary" disabled={busy} onClick={() => void run()}>
                  {busy ? 'Importing…' : `Import ${plural(ready, 'product')}`}
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={reset}>
                  Choose another file
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
