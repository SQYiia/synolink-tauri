import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'

type BackHandler = () => boolean | void | Promise<boolean | void>
const backHandlerStack: BackHandler[] = []

export async function triggerBack(fallback: () => void): Promise<boolean> {
  for (let i = backHandlerStack.length - 1; i >= 0; i--) {
    try {
      const handled = await backHandlerStack[i]()
      if (handled === true) return true
    } catch { /* swallow */ }
  }
  fallback()
  return false
}

export function useBackHandler(fn: BackHandler) {
  onMounted(() => { backHandlerStack.push(fn) })
  onUnmounted(() => {
    const i = backHandlerStack.lastIndexOf(fn)
    if (i >= 0) backHandlerStack.splice(i, 1)
  })
}

const swipeActive = ref(false)
const swipeProgress = ref(0)
const isTransitioning = ref(false)

export const swipeStyle = computed(() => {
  if (isTransitioning.value || swipeActive.value) {
    return { '--swipe-tx': `${swipeProgress.value * 100}%` } as Record<string, string>
  }
  return {} as Record<string, string>
})

export const swipeClasses = computed(() => ({
  'm-swiping': swipeActive.value,
  'm-swipe-transition': isTransitioning.value,
}))

// 边缘检测阈值
const EDGE_PX = 24
// 激活前：水平位移最小阈值（防误触）
const ACTIVATE_DX_MIN = 10
// 激活前：dy/dx 比例上限（高于则判为竖滑，放弃）
const PRE_ACTIVATE_RATIO_MAX = 0.7
// 激活后：dy/dx 比例上限（高于则判为竖滑取消）
const POST_ACTIVATE_RATIO_MAX = 1.5
// 激活后判定竖滑的 dy 最小位移（避免抖动误判）
const POST_ACTIVATE_DY_MIN = 50
// 提交阈值（向右滑过该比例自动提交）
const COMMIT_PROGRESS = 0.35
// 提交速度阈值（px/s），即使位移不够，速度够也提交
const COMMIT_VELOCITY = 500

export function useInteractiveSwipeBack() {
  const router = useRouter()

  let startX = 0
  let startY = 0
  let tracking = false
  let startTime = 0

  function onTouchStart(e: TouchEvent) {
    if (isTransitioning.value) return
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    if (t.clientX <= EDGE_PX) {
      tracking = true
      startX = t.clientX
      startY = t.clientY
      startTime = Date.now()
    }
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking || isTransitioning.value) return
    const t = e.touches[0]
    const dx = t.clientX - startX
    const dy = Math.abs(t.clientY - startY)

    if (!swipeActive.value) {
      // 激活前：太短或太竖 → 放弃
      if (dx < ACTIVATE_DX_MIN) return
      if (dy / Math.max(dx, 1) > PRE_ACTIVATE_RATIO_MAX) {
        tracking = false
        return
      }
      swipeActive.value = true
      swipeProgress.value = 0
    } else {
      // 激活后：用户突然转竖滑 → 取消并回弹
      if (dy > POST_ACTIVATE_DY_MIN && dy / Math.max(dx, 1) > POST_ACTIVATE_RATIO_MAX) {
        tracking = false
        cancelSwipe()
        return
      }
    }

    swipeProgress.value = Math.min(1, Math.max(0, dx / window.innerWidth))
  }

  function onTouchEnd() {
    if (!tracking) return
    tracking = false
    if (!swipeActive.value) return

    const elapsedMs = Math.max(Date.now() - startTime, 1)
    const velocity = (swipeProgress.value * window.innerWidth) / elapsedMs * 1000

    if (swipeProgress.value >= COMMIT_PROGRESS || velocity >= COMMIT_VELOCITY) {
      void completeSwipe()
    } else {
      cancelSwipe()
    }
  }

  /** 提交：松手当下立即切换路由 / 调用 handler，新内容在当前 swipe 位置出现，
   *  然后短促回弹到 0 — 不再露出黑色背景。 */
  async function completeSwipe() {
    swipeActive.value = false
    // 保留当前 swipeProgress（不要先滑出 100%，会露黑底）
    const fromProgress = swipeProgress.value

    // 切换路由 / 调用页面 BackHandler — 内容立即换成"上一页"
    await triggerBack(() => {
      if (window.history.length > 1) router.back()
    })
    await nextTick()

    // 现在新内容已渲染在当前 transform 位置（用户看到的是新页面在被"推开"的位置）
    // 启用过渡，从 fromProgress 回弹到 0
    isTransitioning.value = true
    swipeProgress.value = fromProgress // 显式保持（避免 v-if 切换时丢值）
    // 下一帧才设 0，确保 transition 触发
    await nextTick()
    swipeProgress.value = 0
    await waitForTransitionEnd()
    isTransitioning.value = false
  }

  /** 取消：带过渡回弹到 0 */
  function cancelSwipe() {
    swipeActive.value = false
    isTransitioning.value = true
    swipeProgress.value = 0
    waitForTransitionEnd().then(resetState)
  }

  function waitForTransitionEnd(): Promise<void> {
    return new Promise((resolve) => {
      const el = document.querySelector('.m-shell') as HTMLElement | null
      if (!el) {
        setTimeout(resolve, 320)
        return
      }
      let done = false
      const handler = (ev: Event) => {
        if ((ev as TransitionEvent).propertyName && (ev as TransitionEvent).propertyName !== 'transform') return
        if (done) return
        done = true
        el.removeEventListener('transitionend', handler)
        resolve()
      }
      el.addEventListener('transitionend', handler)
      // 兜底超时（万一 transition 没触发）
      setTimeout(() => {
        if (done) return
        done = true
        el.removeEventListener('transitionend', handler)
        resolve()
      }, 380)
    })
  }

  function resetState() {
    isTransitioning.value = false
    swipeProgress.value = 0
  }

  onMounted(() => {
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
  })

  onUnmounted(() => {
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('touchend', onTouchEnd)
    window.removeEventListener('touchcancel', onTouchEnd)
  })
}
