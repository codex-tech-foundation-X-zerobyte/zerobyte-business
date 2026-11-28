import { useState } from 'react'
import { downloadBytes, exportBusinessData, type ExportProgress, type ExportReport } from '../../lib/dataExport'

/** Download everything the business has recorded, as spreadsheets in one ZIP. Free on every plan, at any time. */
export function DataExportCard({ orgId, businessName }: { orgId: string; businessName: string }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [report, setReport] = useState<ExportReport[] | null>(null)
  const [error, setError] = useState('')

  async function run() {
    setError('')
    setReport(null)
    if (!navigator.onLine) {
      setError('Downloading your data needs a connection. Reconnect and try again.')
      return
    }
    setBusy(true)
    try {
      const { zip, report: done } = await exportBusinessData(orgId, businessName, setProgress)
      const failed = done.filter((item) => item.error)
      if (failed.length === done.length) {
        setError('Your records could not be read just now. Please try again in a moment.')
      } else {
        downloadBytes(`zerobyte-business-data-${new Date().toISOString().slice(0, 10)}.zip`, zip)
        setReport(done)
      }
    } catch {
      setError('The download did not finish. Please try again.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const failed = report?.filter((item) => item.error) ?? []
  return (
    <section className="panel settings-info data-export-card">
      <span className="section-label">Your data</span>
      <h2>Your records belong to you</h2>
      <p>
        Download everything you have recorded (products, customers, sales, expenses, invoices, purchase orders and stock
        history) as spreadsheets in one ZIP file. It is free, on every plan, whenever you want it, so you can keep a
        backup or open your books in Excel.
      </p>
      <div className="import-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void run()}>
          {busy ? 'Preparing your files…' : 'Download all my data (ZIP)'}
        </button>
      </div>
      {progress && (
        <p className="field-help" role="status">
          {progress.label}… ({Math.min(progress.done + 1, progress.total)} of {progress.total})
        </p>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {report && (
        <p className="field-help" role="status">
          Downloaded {report.length - failed.length} files with{' '}
          {report.reduce((sum, item) => sum + item.rows, 0).toLocaleString('en-NG')} rows in total.
          {failed.length > 0 && ` Could not read: ${failed.map((item) => item.label).join(', ')}.`} Open README.txt
          inside for a guide.
        </p>
      )}
    </section>
  )
}
