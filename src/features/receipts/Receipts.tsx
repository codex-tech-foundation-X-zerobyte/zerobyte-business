import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyInline, PageIntro, TableSkeleton } from '../../components/ui'
import { amountInWords, normalizeLogoUrl } from '../../lib/format'
import { type ReceiptPdfData, buildReceiptPdf, loadImageAsDataUrl, receiptPdfFilename } from '../../lib/receiptPdf'
import { supabase } from '../../lib/supabase'
import { type BusinessReceiptProfile, type ReceiptRow } from '../../lib/types'

export function Receipts({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [business, setBusiness] = useState<BusinessReceiptProfile>({ name: 'Zerøbyte Business', address: '', phone: '', email: '', website: '', logo_url: '', currency: 'NGN' }); const [preview, setPreview] = useState<ReceiptRow | null>(null); const [error, setError] = useState(''); const [pdfBusyId, setPdfBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { if (!supabase) return; Promise.all([supabase.from('sales').select('id,receipt_number,total,tax_amount,payment_method,created_at,customers(name,phone,email),sale_items(id,quantity,unit_price,line_total,products(name,sku))').eq('organization_id', orgId).order('created_at', { ascending: false }), supabase.from('organizations').select('name,address,phone,email,website,logo_url,currency').eq('id', orgId).single()]).then(([salesResult, orgResult]) => { if (salesResult.error) setError(salesResult.error.message); if (orgResult.error) setError(orgResult.error.message); setRows((salesResult.data ?? []) as unknown as ReceiptRow[]); if (orgResult.data) setBusiness({ name: orgResult.data.name, address: orgResult.data.address ?? '', phone: orgResult.data.phone ?? '', email: orgResult.data.email ?? '', website: orgResult.data.website ?? '', logo_url: normalizeLogoUrl(orgResult.data.logo_url), currency: orgResult.data.currency ?? 'NGN' }); setLoading(false) }) }, [orgId])
  function toReceiptPdfData(row: ReceiptRow): ReceiptPdfData {
    return {
      receiptNumber: row.receipt_number ?? `RC-${row.id.slice(0, 8).toUpperCase()}`,
      createdAt: row.created_at,
      paymentMethod: row.payment_method,
      subtotal: Number(row.total),
      taxAmount: Number(row.tax_amount),
      taxLabel: 'VAT / tax',
      total: Number(row.total) + Number(row.tax_amount),
      amountInWords: amountInWords(Number(row.total) + Number(row.tax_amount)),
      customer: row.customer,
      items: row.sale_items.map((item) => ({ name: item.products?.name ?? 'Item', sku: item.products?.sku, quantity: item.quantity, unitPrice: Number(item.unit_price), lineTotal: Number(item.line_total) })),
    }
  }
  async function generateReceiptPdfBlob(row: ReceiptRow) {
    const logoDataUrl = business.logo_url ? await loadImageAsDataUrl(business.logo_url) : null
    const doc = buildReceiptPdf(toReceiptPdfData(row), { name: business.name, address: business.address, phone: business.phone, email: business.email, website: business.website, currency: business.currency, logoDataUrl })
    const filename = receiptPdfFilename(row.receipt_number ?? `RC-${row.id.slice(0, 8).toUpperCase()}`)
    return { blob: doc.output('blob') as Blob, filename }
  }
  async function download(row: ReceiptRow) {
    setPdfBusyId(row.id)
    try {
      const { blob, filename } = await generateReceiptPdfBlob(row)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = filename
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not generate the receipt PDF.')
    } finally {
      setPdfBusyId(null)
    }
  }
  async function share(row: ReceiptRow) {
    setPdfBusyId(row.id)
    try {
      const { blob, filename } = await generateReceiptPdfBlob(row)
      const title = `Receipt ${row.receipt_number ?? row.id.slice(0, 8).toUpperCase()}`
      const summary = `Receipt ${row.receipt_number ?? row.id.slice(0, 8).toUpperCase()} from ${business.name}. Total: ${business.currency} ${Number(row.total).toLocaleString('en-NG')}`
      const file = new File([blob], filename, { type: 'application/pdf' })
      // Web Share API Level 2 (file sharing) -- where supported (most
      // mobile browsers), this hands the real PDF straight to WhatsApp,
      // Mail, etc. from the share sheet, not just a text summary.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title, text: summary, files: [file] })
        return
      }
      if (navigator.share) {
        await navigator.share({ title, text: summary })
        return
      }
      await download(row)
      const phone = window.prompt('Optional WhatsApp number, including country code. The branded PDF has been downloaded for you to attach manually:')
      if (phone) window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(summary)}`, '_blank', 'noopener,noreferrer')
    } catch (reason) {
      // AbortError just means the person closed the native share sheet --
      // not a real failure worth surfacing.
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Could not share the receipt PDF.')
    } finally {
      setPdfBusyId(null)
    }
  }
  return <div className="page"><PageIntro label="Receipts" title="Every sale, ready to prove." description="Receipt items and totals come from the persisted sale and sale_items records." />{error && <div className="form-error" role="alert">{error}</div>}<section className="panel table-panel">{loading ? <TableSkeleton /> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Customer</th><th>Date</th><th>Total</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="mono">{row.receipt_number ?? `RC-${row.id.slice(0, 8).toUpperCase()}`}</td><td>{row.customer?.name || 'Walk-in customer'}</td><td>{new Date(row.created_at).toLocaleString('en-NG')}</td><td className="amount">₦{(Number(row.total) + Number(row.tax_amount)).toLocaleString('en-NG')}</td><td><button className="text-btn" onClick={() => setPreview(row)}>Preview</button><button className="text-btn" disabled={pdfBusyId === row.id} onClick={() => void download(row)}>{pdfBusyId === row.id ? 'Preparing…' : 'Download PDF'}</button><button className="text-btn" disabled={pdfBusyId === row.id} onClick={() => void share(row)}>Share</button></td></tr>)}</tbody></table></div> : <EmptyInline title="No receipts yet" text="Complete a sale and its receipt will appear here." />}</section>{preview && <div className="receipt-preview-backdrop" onClick={() => setPreview(null)}><article className="receipt-preview" onClick={(event) => event.stopPropagation()}><button className="icon-btn receipt-close" onClick={() => setPreview(null)} aria-label="Close receipt"><X size={16} /></button><header className="receipt-document-header">{business.logo_url ? <img className="receipt-logo" src={business.logo_url} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <div className="receipt-brand-mark">ø</div>}<div><h2>{business.name}</h2><span>INNOVATION · SKILLS · IMPACT</span><small>{[business.address, business.phone, business.email, business.website].filter(Boolean).join('  ·  ')}</small></div></header><div className="receipt-title-row"><div><h1>SALES RECEIPT</h1><p>Thank you for your business!</p></div><div className="receipt-meta-grid"><div><small>Receipt No.</small><strong>{preview.receipt_number ?? `RC-${preview.id.slice(0, 8).toUpperCase()}`}</strong></div><div><small>Date & time</small><strong>{new Date(preview.created_at).toLocaleString('en-NG')}</strong></div></div></div><div className="receipt-customer"><small>CUSTOMER</small><strong>{preview.customer?.name || 'Walk-in Customer'}</strong>{preview.customer?.phone && <span>{preview.customer.phone}</span>}{preview.customer?.email && <span>{preview.customer.email}</span>}</div><div className="receipt-table-wrap"><table className="receipt-table"><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{preview.sale_items.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><strong>{item.products?.name ?? 'Item'}</strong>{item.products?.sku && <small>{item.products.sku}</small>}</td><td>{item.quantity}</td><td>{business.currency} {Number(item.unit_price).toLocaleString('en-NG')}</td><td>{business.currency} {Number(item.line_total).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div><div className="receipt-summary"><div><span>Subtotal</span><strong>{business.currency} {Number(preview.total).toLocaleString('en-NG')}</strong></div><div><span>Discount</span><strong>{business.currency} 0</strong></div><div><span>VAT / tax</span><strong>{business.currency} {Number(preview.tax_amount).toLocaleString('en-NG')}</strong></div><div className="receipt-grand-total"><span>Total</span><strong>{business.currency} {(Number(preview.total) + Number(preview.tax_amount)).toLocaleString('en-NG')}</strong></div></div><div className="receipt-detail-grid"><div className="receipt-payment"><span>Payment method</span><strong>{preview.payment_method}</strong></div><div className="receipt-words"><small>AMOUNT IN WORDS</small><p>{amountInWords(Number(preview.total) + Number(preview.tax_amount))}</p></div></div><footer className="receipt-document-footer"><strong>✓ &nbsp; Thank you for your business.</strong><span>Powered by Zerøbyte</span></footer><div className="action-row receipt-actions"><button className="primary receipt-print" disabled={pdfBusyId === preview.id} onClick={() => void download(preview)}>{pdfBusyId === preview.id ? 'Preparing…' : 'Download PDF'}</button><button className="secondary" disabled={pdfBusyId === preview.id} onClick={() => void share(preview)}>Share / WhatsApp</button></div></article></div>}</div>
}
