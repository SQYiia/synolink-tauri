import { createImageQueue } from './imageQueue'
const enqueueFrame = createImageQueue(2)

// Read through the authenticated range-stream proxy, never download a whole movie.
export function captureVideoFrame(source: string, signal?: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('已取消', 'AbortError')); return }
    let video: HTMLVideoElement | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let release: (() => void) | undefined
    let cancelQueue: (() => void) | undefined
    let settled = false
    const finish = (error?: unknown, blob?: Blob) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (video) {
        video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null
        video.pause(); video.removeAttribute('src'); video.load()
      }
      release?.(); cancelQueue?.()
      error ? reject(error) : resolve(blob!)
    }
    const abort = () => finish(new DOMException('已取消', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    cancelQueue = enqueueFrame(done => {
      release = done
      if (signal?.aborted) { abort(); return }
      video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'
      timer = setTimeout(() => finish(new Error('视频封面生成超时')), 8000)
      let capturing = false
      const capture = () => {
        if (settled || capturing || !video || video.readyState < 2 || !video.videoWidth) return
        capturing = true
        try {
          const canvas = document.createElement('canvas')
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
          const context = canvas.getContext('2d')
          if (!context) throw new Error('无法生成封面')
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          canvas.toBlob(blob => {
            canvas.width = canvas.height = 1
            blob ? finish(undefined, blob) : finish(new Error('无法生成封面'))
          }, 'image/jpeg', 0.85)
        } catch (error) { finish(error) }
      }
      // Use the first decoded frame. Seeking to 3s caused extra remote range reads
      // and keyframe decoding before any card could appear.
      video.onloadeddata = capture
      video.onerror = () => finish(new Error('当前视频编码无法生成封面'))
      video.src = source
    })
  })
}
