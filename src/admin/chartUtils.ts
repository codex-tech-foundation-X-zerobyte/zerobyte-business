// Number formatting shared by the admin charts and KPI cards.
export const compact = (value: number) =>
  value >= 1e9
    ? `${(value / 1e9).toFixed(1)}B`
    : value >= 1e6
      ? `${(value / 1e6).toFixed(1)}M`
      : value >= 1e4
        ? `${(value / 1e3).toFixed(1)}K`
        : Math.round(value).toLocaleString('en-NG')
export const delta = (now: number, before: number) =>
  before === 0
    ? now === 0
      ? 'no change'
      : 'new'
    : `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}% vs yesterday`

/** A tidy scale for the vertical axis: 0, a few whole steps (1, 2, 5, 10, 20, 50...), and a top that is at least the data. */
export function niceScale(maxValue: number, wantTicks = 4) {
  const max = Math.max(maxValue, 1)
  const rough = max / wantTicks
  const power = Math.pow(10, Math.floor(Math.log10(rough)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough) ?? 10 * power
  const whole = Math.max(step, 1) // counts are whole numbers: never a step like 0.5
  const top = Math.ceil(max / whole) * whole
  const ticks: number[] = []
  for (let tick = 0; tick <= top + 1e-9; tick += whole) ticks.push(tick)
  return { top, ticks }
}

/** A smooth curve through the points that never dips below or above them (monotone cubic), as an SVG path. */
export function smoothPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return ''
  if (points.length === 1) return `M${points[0].x},${points[0].y}`
  const n = points.length
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x || 1)
    slope.push((points[i + 1].y - points[i].y) / dx[i])
  }
  const tangent = [slope[0]]
  for (let i = 1; i < n - 1; i++) tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2)
  tangent.push(slope[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0
      tangent[i + 1] = 0
      continue
    }
    const a = tangent[i] / slope[i]
    const b = tangent[i + 1] / slope[i]
    const h = Math.hypot(a, b)
    if (h > 3) {
      tangent[i] = (3 * a * slope[i]) / h
      tangent[i + 1] = (3 * b * slope[i]) / h
    }
  }
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const c1x = points[i].x + dx[i] / 3
    const c1y = points[i].y + (tangent[i] * dx[i]) / 3
    const c2x = points[i + 1].x - dx[i] / 3
    const c2y = points[i + 1].y - (tangent[i + 1] * dx[i]) / 3
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${points[i + 1].x},${points[i + 1].y}`
  }
  return d
}
