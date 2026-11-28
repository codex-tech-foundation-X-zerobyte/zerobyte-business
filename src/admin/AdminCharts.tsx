import { useEffect, useRef, useState } from 'react'
import { compact, niceScale, smoothPath } from './chartUtils'

// Small dependency-free SVG charts for the admin dashboard. Colours come from theme tokens so they follow light/dark.

type Series = { label: string; color: string; values: number[] }
// Charts draw at the real width of their box, so text stays the same size on any screen.
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const box = ref.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const next = Math.round(box.clientWidth)
      if (next > 0) setWidth(next)
    })
    observer.observe(box)
    setWidth(Math.round(box.clientWidth) || fallback)
    return () => observer.disconnect()
  }, [fallback])
  return { ref, width }
}
const nf = compact

/** Counts up to a number when it first appears (instant for people who prefer reduced motion). */
function CountUp({
  value,
  format = (n: number) => n.toLocaleString('en-NG'),
}: {
  value: number
  format?: (n: number) => string
}) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      value === 0
    ) {
      setShown(value)
      return
    }
    let frame = 0
    const start = performance.now()
    const run = (now: number) => {
      const t = Math.min((now - start) / 700, 1)
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(run)
    }
    frame = requestAnimationFrame(run)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <>{format(shown)}</>
}

/** A small smooth trend line with a soft fill, for the corner of a KPI tile. */
function MiniTrend({ values, color = 'var(--brand)' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null
  const width = 120
  const height = 34
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * width,
    y: height - 4 - ((value - min) / span) * (height - 8),
  }))
  const line = smoothPath(points)
  return (
    <svg className="amini" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={color} opacity="0.14" />
      <path
        d={line}
        pathLength={1}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        className="aline-draw"
      />
    </svg>
  )
}

export function LineChart({
  labels,
  series,
  height = 190,
  format = nf,
}: {
  labels: string[]
  series: Series[]
  height?: number
  format?: (value: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const { ref, width } = useWidth()
  const pad = { top: 10, right: 10, bottom: 22, left: 44 }
  const scale = niceScale(Math.max(1, ...series.flatMap((item) => item.values)))
  const max = scale.top
  const ticks = scale.ticks
  const x = (index: number) =>
    pad.left + (labels.length <= 1 ? 0 : (index / (labels.length - 1)) * (width - pad.left - pad.right))
  const y = (value: number) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom)
  const every = Math.max(1, Math.ceil(labels.length / 7))
  return (
    <div className="achart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={series.map((item) => item.label).join(', ')}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const ratio = ((event.clientX - box.left) / box.width) * width
          setHover(
            Math.max(
              0,
              Math.min(
                labels.length - 1,
                Math.round(((ratio - pad.left) / (width - pad.left - pad.right)) * (labels.length - 1)),
              ),
            ),
          )
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="agrid" />
            <text x={pad.left - 6} y={y(tick) + 4} className="atick" textAnchor="end">
              {format(tick)}
            </text>
          </g>
        ))}
        {labels.map((label, index) =>
          index % every === 0 ? (
            <text key={index} x={x(index)} y={height - 6} className="atick" textAnchor="middle">
              {label}
            </text>
          ) : null,
        )}
        {series.map((item, seriesIndex) => {
          const pts = item.values.map((value, index) => ({ x: x(index), y: y(value) }))
          const line = smoothPath(pts)
          const gradient = `agrad-${seriesIndex}-${item.label.replace(/[^a-z0-9]/gi, '')}`
          return (
            <g key={item.label}>
              <defs>
                <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={item.color} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={item.color} stopOpacity="0" />
                </linearGradient>
              </defs>
              {series.length <= 2 && pts.length > 1 && (
                <path
                  d={`${line} L${pts[pts.length - 1].x},${y(0)} L${pts[0].x},${y(0)} Z`}
                  fill={`url(#${gradient})`}
                />
              )}
              <path
                d={line}
                pathLength={1}
                fill="none"
                stroke={item.color}
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="aline-draw"
              />
              {hover != null && <circle cx={x(hover)} cy={y(item.values[hover] ?? 0)} r="4" fill={item.color} />}
            </g>
          )
        })}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} className="acursor" />
        )}
      </svg>
      {hover != null && (
        <div className="atip" style={{ left: `${Math.min(78, Math.max(2, (x(hover) / width) * 100))}%` }}>
          <strong>{labels[hover]}</strong>
          {series.map((item) => (
            <span key={item.label}>
              <i style={{ background: item.color }} />
              {item.label}: {format(item.values[hover] ?? 0)}
            </span>
          ))}
        </div>
      )}
      {series.every((item) => item.values.every((value) => value === 0)) && (
        <p className="achart-empty">Nothing recorded in this period yet.</p>
      )}
      <div className="alegend">
        {series.map((item) => (
          <span key={item.label}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function BarChart({
  labels,
  values,
  color = 'var(--brand)',
  height = 170,
  format = nf,
  name = 'Value',
}: {
  labels: string[]
  values: number[]
  color?: string
  height?: number
  format?: (value: number) => string
  name?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const { ref, width } = useWidth()
  const pad = { top: 10, right: 8, bottom: 22, left: 44 }
  const scale = niceScale(Math.max(1, ...values))
  const max = scale.top
  const slot = (width - pad.left - pad.right) / Math.max(values.length, 1)
  const bar = Math.max(2, slot * 0.62)
  const every = Math.max(1, Math.ceil(labels.length / 7))
  return (
    <div className="achart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={name}
        onMouseLeave={() => setHover(null)}
      >
        {scale.ticks.map((value) => {
          const yy = pad.top + (1 - value / max) * (height - pad.top - pad.bottom)
          return (
            <g key={value}>
              <line x1={pad.left} x2={width - pad.right} y1={yy} y2={yy} className="agrid" />
              <text x={pad.left - 6} y={yy + 4} className="atick" textAnchor="end">
                {format(value)}
              </text>
            </g>
          )
        })}
        {values.map((value, index) => {
          const h = (value / max) * (height - pad.top - pad.bottom)
          return (
            <rect
              key={index}
              x={pad.left + index * slot + (slot - bar) / 2}
              y={height - pad.bottom - h}
              width={bar}
              height={Math.max(h, value ? 1 : 0)}
              rx="3"
              fill={color}
              opacity={hover == null || hover === index ? 1 : 0.45}
              onMouseEnter={() => setHover(index)}
            />
          )
        })}
        {labels.map((label, index) =>
          index % every === 0 ? (
            <text
              key={index}
              x={pad.left + index * slot + slot / 2}
              y={height - 6}
              className="atick"
              textAnchor="middle"
            >
              {label}
            </text>
          ) : null,
        )}
      </svg>
      {values.every((value) => value === 0) && <p className="achart-empty">Nothing recorded in this period yet.</p>}
      {hover != null && (
        <div
          className="atip"
          style={{ left: `${Math.min(78, Math.max(2, ((pad.left + hover * slot + slot / 2) / width) * 100))}%` }}
        >
          <strong>{labels[hover]}</strong>
          <span>
            <i style={{ background: color }} />
            {name}: {format(values[hover])}
          </span>
        </div>
      )}
    </div>
  )
}

export function HBars({
  items,
  format = nf,
  empty = 'No data yet',
}: {
  items: { label: string; value: number; note?: string }[]
  format?: (value: number) => string
  empty?: string
}) {
  const max = Math.max(1, ...items.map((item) => item.value))
  if (!items.length) return <p className="admin-empty">{empty}</p>
  return (
    <div className="ahbars">
      {items.map((item) => (
        <div className="ahbar" key={item.label}>
          <div className="ahbar-head">
            <span title={item.label}>{item.label}</span>
            <strong>{format(item.value)}</strong>
          </div>
          <div className="ahbar-track">
            <i style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </div>
          {item.note && <small>{item.note}</small>}
        </div>
      ))}
    </div>
  )
}

export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1)
  return (
    <div className="afunnel">
      {steps.map((step, index) => {
        const previous = index ? steps[index - 1].value : null
        const rate = previous ? (previous > 0 ? Math.round((step.value / previous) * 1000) / 10 : 0) : null
        return (
          <div className="afunnel-step" key={step.label}>
            <div className="afunnel-head">
              <span>{step.label}</span>
              <strong>{step.value.toLocaleString('en-NG')}</strong>
              {rate != null && (
                <small>
                  {rate}% of the step before · {Math.round((step.value / top) * 1000) / 10}% of visitors
                </small>
              )}
            </div>
            <div className="ahbar-track">
              <i style={{ width: `${Math.max(1.5, Math.min(100, (step.value / top) * 100))}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function Kpi({
  label,
  value,
  sub,
  tone,
  onClick,
  trend,
  count,
  accent,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'warn' | 'bad'
  onClick?: () => void
  /** Recent values, drawn as a small trend line in the corner of the tile. */
  trend?: number[]
  /** When given, the number counts up to it instead of showing `value` as text. */
  count?: number
  /** Colour of the trend line (a CSS colour or token). */
  accent?: string
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong>{count === undefined ? value : <CountUp value={count} />}</strong>
      {sub && <small className={tone}>{sub}</small>}
      {trend && trend.length > 1 && <MiniTrend values={trend} color={accent} />}
    </>
  )
  return onClick ? (
    <button type="button" className="akpi clickable" onClick={onClick}>
      {body}
    </button>
  ) : (
    <article className="akpi">{body}</article>
  )
}
