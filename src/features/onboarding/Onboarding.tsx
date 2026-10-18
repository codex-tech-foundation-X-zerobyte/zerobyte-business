import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, MessageCircle, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// First-run help for a new account:
//   1. a short product tour that highlights real parts of the screen (Skip is always one click away), then
//   2. a closable invitation to follow our WhatsApp channel for updates. Nothing here is ever forced.
// Both appear once per person (remembered on this device) and the tour can be replayed from Settings > Guide.

export const START_TOUR_EVENT = 'zb:start-tour'
const NEW_ACCOUNT_DAYS = 14

// Set VITE_WHATSAPP_CHANNEL_URL to your channel link (https://whatsapp.com/channel/...). Without it the invitation is simply not shown.
const channelUrl = (() => {
  try {
    const url = new URL(String(import.meta.env.VITE_WHATSAPP_CHANNEL_URL ?? ''))
    return url.protocol === 'https:' && /(^|\.)whatsapp\.com$/.test(url.hostname) ? url.toString() : null
  } catch { return null }
})()

type Step = { title: string; body: string; find?: () => HTMLElement | null; workers?: boolean }
const nav = (label: string) => () => [...document.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find((item) => item.textContent?.trim() === label) ?? null
const q = (selector: string) => () => document.querySelector<HTMLElement>(selector)

const STEPS: Step[] = [
  { title: 'Welcome to Zerøbyte', body: 'Here is a 1-minute look around so you know where everything is. You can skip this at any time and replay it later from Settings > Guide.', workers: true },
  { title: 'Overview', body: 'Your daily snapshot: revenue, profit, recent sales and anything running low on stock.', find: nav('Overview'), workers: true },
  { title: 'Sales', body: 'Record a sale in two steps: choose the customer, then add products and take payment. Totals and stock are double-checked when you complete it.', find: nav('Sales'), workers: true },
  { title: 'Inventory', body: 'Add products, receive new stock and see what is running low. Low and out-of-stock items also send you a notification.', find: nav('Inventory') },
  { title: 'Customers', body: 'Keep a customer book, see who owes you, and record payments against their balance.', find: nav('Customers'), workers: true },
  { title: 'Receipts', body: 'Every completed sale has a receipt you can preview, download as a PDF and share. Your logo and details appear on it.', find: nav('Receipts'), workers: true },
  { title: 'Reports', body: 'Pick a period and see revenue, cost of goods, expenses and net profit calculated from your real records.', find: nav('Reports') },
  { title: 'Search', body: 'Type here to find products, customers and records quickly.', find: q('.topbar .search'), workers: true },
  { title: 'Notifications', body: 'Low-stock alerts and important messages land here. The number shows how many you have not read.', find: q('.top-actions [aria-label*="otification"]'), workers: true },
  { title: 'Settings', body: 'Add your logo, address and phone number so receipts look professional, switch dark mode, and manage your plan and billing.', find: nav('Settings') },
  { title: 'You are all set', body: 'Need a reminder later? Open Settings > Guide for step-by-step help with screenshots, or tap Support to message us.', workers: true },
]

function visible(element: HTMLElement | null) {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  const inView = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight
  return inView ? rect : null
}

function Tour({ steps, onEnd }: { steps: Step[]; onEnd: (completed: boolean) => void }) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = steps[index]
  const last = index === steps.length - 1

  const measure = useCallback(() => setRect(visible(step.find?.() ?? null)), [step])
  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [measure])
  useEffect(() => { nextRef.current?.focus() }, [index])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEnd(false)
      if (event.key === 'ArrowRight') setIndex((value) => Math.min(value + 1, steps.length - 1))
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(value - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEnd, steps.length])

  const width = Math.min(340, window.innerWidth - 24)
  let style: React.CSSProperties = { width }
  if (rect) {
    const roomRight = window.innerWidth - rect.right > width + 24
    const left = roomRight ? rect.right + 16 : Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    const top = roomRight ? Math.max(12, Math.min(rect.top - 8, window.innerHeight - 260)) : Math.min(rect.bottom + 14, window.innerHeight - 260)
    style = { width, left, top }
  }
  return <div className="tour-root" role="dialog" aria-modal="true" aria-labelledby="tour-title">
    <div className={`tour-backdrop${rect ? '' : ' dim'}`} onClick={() => onEnd(false)} />
    {rect && <div className="tour-spot" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />}
    <div className={`tour-card${rect ? '' : ' centered'}`} style={style}>
      <div className="tour-count">Step {index + 1} of {steps.length}</div>
      <h2 id="tour-title">{step.title}</h2>
      <p>{step.body}</p>
      <div className="tour-dots" aria-hidden="true">{steps.map((_, dot) => <i key={dot} className={dot === index ? 'on' : ''} />)}</div>
      <div className="tour-actions">
        <button type="button" className="text-btn" data-no-busy onClick={() => onEnd(false)}>Skip tour</button>
        <span>
          {index > 0 && <button type="button" className="secondary" data-no-busy onClick={() => setIndex(index - 1)}><ArrowLeft size={15} /> Back</button>}
          <button type="button" className="primary" data-no-busy ref={nextRef} onClick={() => last ? onEnd(true) : setIndex(index + 1)}>{last ? 'Finish' : 'Next'}{!last && <ArrowRight size={15} />}</button>
        </span>
      </div>
    </div>
  </div>
}

function FollowPrompt({ onClose }: { onClose: (followed: boolean) => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="follow-backdrop" onClick={() => onClose(false)}>
    <div className="follow-card" role="dialog" aria-modal="true" aria-labelledby="follow-title" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="icon-btn follow-close" aria-label="Close" data-no-busy onClick={() => onClose(false)}><X size={17} /></button>
      <div className="follow-icon"><MessageCircle size={22} /></div>
      <h2 id="follow-title">Get Zerøbyte updates on WhatsApp</h2>
      <p>New features, selling tips and important notices, straight to your phone. It is optional, and you can leave the channel whenever you like.</p>
      <div className="follow-actions">
        <a className="primary" href={channelUrl ?? '#'} target="_blank" rel="noopener noreferrer" onClick={() => onClose(true)}>Follow on WhatsApp</a>
        <button type="button" className="secondary" data-no-busy onClick={() => onClose(false)}>Maybe later</button>
      </div>
    </div>
  </div>
}

export function OnboardingLayer({ userId, ready, workerMode }: { userId: string | null; ready: boolean; workerMode: boolean }) {
  const [stage, setStage] = useState<'idle' | 'tour' | 'follow'>('idle')
  const checked = useRef(false)
  const mounted = useRef(true)
  // Only a real unmount cancels pending work (React's dev double-mount and dependency changes must not).
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const tourKey = `zerobyte.tour.v1.${userId}`
  const followKey = `zerobyte.follow.v1.${userId}`
  const read = (key: string) => { try { return window.localStorage.getItem(key) } catch { return 'done' } }
  const write = (key: string, value: string) => { try { window.localStorage.setItem(key, value) } catch { /* storage unavailable */ } }
  const steps = STEPS.filter((step) => !workerMode || step.workers)

  const afterTour = useCallback(() => {
    if (channelUrl && !read(followKey)) window.setTimeout(() => setStage('follow'), 350); else setStage('idle')
  }, [followKey])

  useEffect(() => {
    if (!ready || !userId || checked.current) return
    checked.current = true
    void (async () => {
      let isNewAccount = false
      try {
        const { data } = await supabase?.auth.getUser() ?? { data: { user: null } }
        const created = data.user?.created_at ? new Date(data.user.created_at).getTime() : 0
        isNewAccount = created > 0 && Date.now() - created < NEW_ACCOUNT_DAYS * 86400e3
      } catch { /* treat as an existing account */ }
      if (!mounted.current) return
      if (!read(tourKey) && isNewAccount) window.setTimeout(() => { if (mounted.current) setStage('tour') }, 900)
      else if (channelUrl && !read(followKey)) window.setTimeout(() => { if (mounted.current) setStage('follow') }, 1500)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userId])

  useEffect(() => {
    const replay = () => setStage('tour')
    window.addEventListener(START_TOUR_EVENT, replay)
    return () => window.removeEventListener(START_TOUR_EVENT, replay)
  }, [])

  if (stage === 'tour') return <Tour steps={steps} onEnd={(completed) => { write(tourKey, completed ? 'done' : 'skipped'); afterTour() }} />
  if (stage === 'follow' && channelUrl) return <FollowPrompt onClose={(followed) => { write(followKey, followed ? 'followed' : 'dismissed'); setStage('idle') }} />
  return null
}
