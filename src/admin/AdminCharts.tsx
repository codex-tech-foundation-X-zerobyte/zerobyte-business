import { useEffect, useRef, useState } from 'react'
import { compact } from './chartUtils'

// Small dependency-free SVG charts for the admin dashboard. Colours come from theme tokens so they follow light/dark.

export type Series = { label: string; color: string; values: number[] }
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
  const max = Math.max(1, ...series.flatMap((item) => item.values))
  const ticks = [0, 0.5, 1].map((fraction) => max * fraction)
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
        {series.map((item) => (
          <g key={item.label}>
            <polyline
              fill="none"
              stroke={item.color}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={item.values.map((value, index) => `${x(index)},${y(value)}`).join(' ')}
            />
            {hover != null && <circle cx={x(hover)} cy={y(item.values[hover] ?? 0)} r="4" fill={item.color} />}
          </g>
        ))}
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
  const max = Math.max(1, ...values)
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
        {[0, 0.5, 1].map((fraction) => {
          const value = max * fraction
          const yy = pad.top + (1 - fraction) * (height - pad.top - pad.bottom)
          return (
            <g key={fraction}>
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
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'warn' | 'bad'
  onClick?: () => void
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small className={tone}>{sub}</small>}
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
