import { onMounted, onUnmounted } from 'vue'

/** 当前页面注册的返回处理器栈。最后注册的最先被调用。
 *  返回 true 表示已处理（不再继续向后传递），返回 false/void 表示透传给全局 router.back()。 */
type BackHandler = () => boolean | void | Promise<boolean | void>
const backHandlerStack: BackHandler[] = []

/** 页面级返回处理：在 onMounted 注册，onUnmounted 自动卸载。
 *  例：Files.vue 中注册「按上级目录返回」，相册 viewer 打开时注册「关闭 viewer」。 */
export function useBackHandler(fn: BackHandler) {
  onMounted(() => { backHandlerStack.push(fn) })
  onUnmounted(() => {
    const i = backHandlerStack.lastIndexOf(fn)
    if (i >= 0) backHandlerStack.splice(i, 1)
  })
}

/** 触发返回：从栈顶向栈底依次询问，第一个 return true 的人吃掉事件；否则调用全局 fallback。 */
async function triggerBack(fallback: () => void) {
  for (let i = backHandlerStack.length - 1; i >= 0; i--) {
    try {
      const handled = await backHandlerStack[i]()
      if (handled === true) return
    } catch { /* swallow */ }
  }
  fallback()
}

interface Options {
  /** 触发返回的回调；如果不传则只调用页面级 BackHandler 栈 */
  onBack?: () => void
  /** 触发的边缘像素阈值，默认 24 */
  edgeSize?: number
  /** 触发的水平最小位移，默认 80 */
  minDx?: number
  /** 最大允许的垂直/水平比例（防止误触竖向滚动），默认 0.6 */
  maxRatio?: number
}

/** 在 mount 期间挂载全局触摸监听，监听从左边缘开始的右滑手势。
 *  仅监听 touchstart/move/end，不阻止默认行为（避免影响内部横滑组件）。 */
export function useEdgeSwipeBack(opts: Options = {}) {
  const edgeSize = opts.edgeSize ?? 24
  const minDx = opts.minDx ?? 80
  const maxRatio = opts.maxRatio ?? 0.6

  let startX = 0
  let startY = 0
  let tracking = false
  let startTime = 0

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    if (t.clientX <= edgeSize) {
      tracking = true
      startX = t.clientX
      startY = t.clientY
      startTime = Date.now()
    } else {
      tracking = false
    }
  }

  function onTouchEnd(e: TouchEvent) {
    if (!tracking) return
    tracking = false
    const t = e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - startX
    const dy = Math.abs(t.clientY - startY)
    const dt = Date.now() - startTime
    if (dx >= minDx && dy / Math.max(dx, 1) <= maxRatio && dt < 800) {
      void triggerBack(() => opts.onBack?.())
    }
  }

  function onTouchCancel() { tracking = false }

  onMounted(() => {
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchCancel, { passive: true })
  })
  onUnmounted(() => {
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchend', onTouchEnd)
    window.removeEventListener('touchcancel', onTouchCancel)
  })
}
