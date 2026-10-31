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
