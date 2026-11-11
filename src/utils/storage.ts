// SYNO.Core.Storage.Volume returns byte counts, often encoded as strings.
// Do not interpret missing/invalid capacity as an empty volume.
function bytes(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value !== 'number' && typeof value !== 'string') continue
    if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value.trim())) continue
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return null
}

export function normalizeVolume(v: any) {
  const nested = v?.size && typeof v.size === 'object' ? v.size : {}
  const total = bytes(v?.size_total_byte, v?.size_total, nested.total, v?.total, v?.size)
  let free = bytes(v?.size_free_byte, v?.size_free_user, v?.size_free, nested.free_user, nested.free, v?.free)
  let used = bytes(v?.size_used_byte, v?.size_used, v?.used_size, nested.used, v?.used)

  if (total != null) {
    // Inconsistent responses must not become negative capacity or >100% usage.
    if ((free != null && free > total) || (used != null && used > total)) {
      free = null
      used = null
    } else if (free != null && bytes(v?.size_free_byte) != null) {
      used = total - free
    } else if (used == null && free != null) {
      used = total - free
    } else if (free == null && used != null) {
      free = total - used
    }
  }

  return {
    ...v,
    _name: v?.display_name || v?.volume_path || v?.id || '-',
    _size: total,
    _used: used,
    _free: free,
    _pct: total != null && total > 0 && used != null ? Math.round(used / total * 100) : null,
    _status: v?.status ?? v?.volume_status,
  }
}
