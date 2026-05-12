const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(n?: number | string): string {
  const num = typeof n === 'string' ? Number(n) : (n ?? 0)
  if (!num || isNaN(num)) return '0 B'
  let i = 0
  let v = num
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + UNITS[i]
}

export function formatSpeed(n?: number | string): string {
  return formatBytes(n) + '/s'
}
