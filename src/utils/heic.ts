// Decode one photo at a time: phone HEIC images can expand to hundreds of MB.
let conversionTail: Promise<unknown> = Promise.resolve()

export function convertHeic(blob: Blob, maxDimension: number, signal?: AbortSignal): Promise<Blob> {
  const run = conversionTail.then(async () => {
    const check = () => { if (signal?.aborted) throw new DOMException('已取消', 'AbortError') }
    check()
    const { heicTo } = await import('heic-to/csp')
    check()
    const bitmap = await heicTo({ blob, type: 'bitmap' })
    try {
      check()
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      try {
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas unavailable')
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const result = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(value => value ? resolve(value) : reject(new Error('JPEG encoding failed')), 'image/jpeg', 0.88)
        })
        check()
        return result
      } finally { canvas.width = 1; canvas.height = 1 }
    } finally { bitmap.close() }
  })
  conversionTail = run.catch(() => {})
  return run
}
