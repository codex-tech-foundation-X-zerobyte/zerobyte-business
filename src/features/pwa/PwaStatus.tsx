import { ArrowRight, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { type OfflineScope, readOfflineOperations, syncOfflineQueue } from '../../lib/offline'
import { applyPwaUpdate, dismissPwaUpdate, subscribeToPwaUpdate } from '../../lib/pwaUpdate'
import { supabase } from '../../lib/supabase'

export function OfflineStatus({ scope }: { scope: OfflineScope | null }) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [counts, setCounts] = useState({ pending: 0, conflicts: 0, failed: 0 })
  const refresh = useCallback(async () => {
    if (!scope) return
    const operations = await readOfflineOperations(scope)
    setCounts({
      pending: operations.filter((operation) => operation.status === 'pending' || operation.status === 'in_flight').length,
      conflicts: operations.filter((operation) => operation.status === 'conflict').length,
      failed: operations.filter((operation) => operation.status === 'failed').length,
    })
  }, [scope])
  const sync = useCallback(async () => {
    if (!scope || !supabase || !navigator.onLine) return
    setSyncing(true)
    try {
      await syncOfflineQueue(supabase, scope)
      await refresh()
    } finally {
      setSyncing(false)
    }
  }, [refresh, scope])
  useEffect(() => {
    const onOnline = () => { setOnline(true); void sync() }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void refresh()
    if (navigator.onLine) void sync()
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [refresh, sync])
  const needsAttention = counts.conflicts + counts.failed > 0
  if (online && !syncing && counts.pending === 0 && !needsAttention) return null
  const message = !online
    ? 'You are offline. Cached products and customers remain available.'
    : syncing
      ? 'Syncing your changes…'
      : needsAttention
        ? `${counts.conflicts + counts.failed} change${counts.conflicts + counts.failed === 1 ? '' : 's'} require attention.`
        : `${counts.pending} offline change${counts.pending === 1 ? '' : 's'} waiting to sync.`
  return <div className={`offline-status ${!online ? 'offline-status-offline' : needsAttention ? 'offline-status-attention' : 'offline-status-pending'}`} role="status" aria-live="polite"><span className="offline-dot" />{message}{online && !syncing && counts.pending > 0 && <button className="text-btn" onClick={() => void sync()}>Sync now</button>}</div>
}

export function UpdateBanner() {
  const [available, setAvailable] = useState(false)
  useEffect(() => subscribeToPwaUpdate(setAvailable), [])
  if (!available) return null
  return (
    <div className="update-banner" role="status">
      <span><RefreshCw size={15} /> A new version of Zerøbyte is ready.</span>
      <div className="update-banner-actions">
        <button type="button" className="text-btn" onClick={() => dismissPwaUpdate()}>Later</button>
        <button type="button" className="secondary" onClick={() => applyPwaUpdate()}>Update now</button>
      </div>
    </div>
  )
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  if (!installEvent) return null
  return <section className="install-strip"><div><strong>Take Zerøbyte with you</strong><p>Install the workspace on your device for a focused, app-like experience.</p></div><button className="secondary" onClick={async () => { await installEvent.prompt(); setInstallEvent(null) }}>Install app <ArrowRight size={15} /></button></section>
}
