import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { navDirection } from './useNavDirection'

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

export function useInteractiveSwipeBack() {
  const router = useRouter()

  let startX = 0
  let startY = 0
  let tracking = false
  let startTime = 0

  function onTouchStart(e: TouchEvent) {
    if (isTransitioning.value) return
    if (navDirection.value === 'none') return
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    if (t.clientX <= 24) {
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
      if (dx < 10 || dy / Math.max(dx, 1) > 0.7) {
        tracking = false
        return
      }
      swipeActive.value = true
      swipeProgress.value = 0
    }

    swipeProgress.value = Math.min(1, Math.max(0, dx / window.innerWidth))
  }

  function onTouchEnd() {
    if (!tracking) return
    tracking = false

    if (!swipeActive.value) return

    const velocity = (swipeProgress.value * window.innerWidth) / Math.max(Date.now() - startTime, 1) * 1000

    if (swipeProgress.value > 0.35 || velocity > 500) {
      completeSwipe()
    } else {
      cancelSwipe()
    }
  }

  async function completeSwipe() {
    swipeActive.value = false
    isTransitioning.value = true
    await nextTick()

    const handled = await triggerBack(() => {
      if (window.history.length > 1) router.back()
    })

    if (handled) {
      swipeProgress.value = 0
      await waitForTransitionEnd()
      resetState()
      return
    }

    swipeProgress.value = 1
    await waitForTransitionEnd()
    resetState()
  }

  function cancelSwipe() {
    swipeActive.value = false
    isTransitioning.value = true
    swipeProgress.value = 0
    waitForTransitionEnd().then(resetState)
  }

  function waitForTransitionEnd(): Promise<void> {
    return new Promise((resolve) => {
      const el = document.querySelector('.m-shell')
      if (!el) {
        setTimeout(resolve, 350)
        return
      }
      const handler = () => {
        el.removeEventListener('transitionend', handler)
        resolve()
      }
      el.addEventListener('transitionend', handler)
      setTimeout(() => {
        el.removeEventListener('transitionend', handler)
        resolve()
      }, 400)
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
