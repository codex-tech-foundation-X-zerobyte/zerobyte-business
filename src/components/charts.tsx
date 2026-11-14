import { useId } from 'react'

/**
 * Small, dependency-free SVG charts with a draw-in animation. Colours come from the --chart-* tokens in charts.css, so
 * they follow light and dark mode. Every chart has a text alternative and a legend, so no information is colour-only.
 */

type ChartSlice = { label: string; value: number; color?: string }

const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
]
const colorAt = (index: number, own?: string) => own ?? PALETTE[index % PALETTE.length]

type DonutProps = {
  slices: ChartSlice[]
  /** Big number in the middle of the ring. */
  centerValue?: string
  centerLabel?: string
  size?: number
  thickness?: number
  format?: (value: number) => string
}

export function DonutChart({
  slices,
  centerValue,
  centerLabel,
  size = 168,
  thickness = 18,
  format = String,
}: DonutProps) {
  const id = useId()
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <figure className="chart-donut">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-labelledby={`${id}-title`}
        className="chart-donut-svg"
      >
        <title id={`${id}-title`}>
          {slices.map((slice) => `${slice.label}: ${format(slice.value)}`).join('. ') || 'No data yet'}
        </title>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="chart-donut-track"
          strokeWidth={thickness}
          fill="none"
        />
        {total > 0 &&
          slices.map((slice, index) => {
            const length = (Math.max(slice.value, 0) / total) * circumference
            const dash = `${Math.max(length - 2, 0)} ${circumference - Math.max(length - 2, 0)}`
            const rotation = (offset / total) * 360 - 90
            offset += Math.max(slice.value, 0)
            if (length <= 0) return null
            return (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={thickness}
                strokeLinecap="round"
                stroke={colorAt(index, slice.color)}
                strokeDasharray={dash}
                transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
                className="chart-donut-slice"
                style={{ animationDelay: `${index * 120}ms`, ['--len' as string]: `${length}` }}
              />
            )
          })}
      </svg>
      <figcaption className="chart-donut-center" style={{ width: size, height: size }}>
        <strong>{centerValue ?? format(total)}</strong>
        {centerLabel && <span>{centerLabel}</span>}
      </figcaption>
      <ul className="chart-legend">
        {slices.map((slice, index) => (
          <li key={slice.label}>
            <i style={{ background: colorAt(index, slice.color) }} aria-hidden="true" />
            <span>{slice.label}</span>
            <b>{format(slice.value)}</b>
          </li>
        ))}
      </ul>
    </figure>
  )
}

type BarProps = {
  data: ChartSlice[]
  height?: number
  format?: (value: number) => string
  /** Shown when every value is zero. */
  emptyText?: string
}

export function BarChart({ data, height = 168, format = String, emptyText = 'Nothing to show yet' }: BarProps) {
  const max = Math.max(...data.map((item) => item.value), 0)
  if (!data.length || max <= 0) return <p className="chart-empty">{emptyText}</p>
  return (
    <div
      className="viz-bars"
      style={{ height }}
      role="img"
      aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join('. ')}
    >
      {data.map((item, index) => (
        <div className="viz-bar-col" key={item.label}>
          <span className="viz-bar-value">{format(item.value)}</span>
          <div className="viz-bar-track">
            <div
              className="viz-bar"
              style={{
                height: `${Math.max((item.value / max) * 100, 3)}%`,
                background: colorAt(index, item.color),
                animationDelay: `${index * 70}ms`,
              }}
              title={`${item.label}: ${format(item.value)}`}
            />
          </div>
          <span className="viz-bar-label">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

/** A thin progress bar that fills in on load, for "how close am I to the target" questions. */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div
      className="chart-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="chart-progress-fill" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** A tiny trend line for KPI tiles. */
