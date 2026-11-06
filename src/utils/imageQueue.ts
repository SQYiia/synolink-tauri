// Module scope is shared by all thumbnails, unlike variables in <script setup>.
export function createImageQueue(limit: number) {
  let active = 0
  const pending: Array<{ start: (done: () => void) => void; cancelled: boolean; finish?: () => void }> = []
  function pump() {
    while (active < limit && pending.length) {
      const task = pending.shift()!
      if (task.cancelled) continue
      active++
      let finished = false
      task.finish = () => {
        if (finished) return
        finished = true
        active--
        pump()
      }
      try { task.start(task.finish) } catch { task.finish() }
    }
  }
  return (start: (done: () => void) => void) => {
    const task = { start, cancelled: false, finish: undefined as (() => void) | undefined }
    pending.push(task)
    pump()
    return () => { task.cancelled = true; task.finish?.() }
  }
}
export const enqueueImage = createImageQueue(6)
