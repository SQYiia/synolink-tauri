// SYNO.Core.System.Utilization memory capacities are KiB; real_usage is percent.
function nonnegative(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}
export function parseMemory(raw: any = {}) {
  const memory = raw ?? {}
  const total = nonnegative(memory.total_real)
  const installed = nonnegative(memory.memory_size)
  const reported = nonnegative(memory.real_usage)
  const free = nonnegative(memory.avail_real)
  const cache = nonnegative(memory.cached)
  const buffer = nonnegative(memory.buffer)
  const totalBytes = total && total > 0 ? total * 1024 : null
  let percentage = reported != null && reported <= 100 ? reported : null
  let usedBytes: number | null = totalBytes != null && percentage != null ? totalBytes * percentage / 100 : null
  let estimated = usedBytes != null
  // Older responses without a percentage require all components. Never assume
  // an absent free/cache field is zero or substitute installed RAM for total_real.
  if (percentage == null && totalBytes != null && free != null && cache != null && buffer != null && free + cache + buffer <= total!) {
    usedBytes = (total! - free - cache - buffer) * 1024
    percentage = Math.round(usedBytes / totalBytes * 1000) / 10
    estimated = true
  }
  return { percentage, usedBytes, totalBytes, installedBytes: installed && installed > 0 ? installed * 1024 : null, estimated }
}
