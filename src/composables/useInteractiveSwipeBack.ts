import { computed, getCurrentInstance, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'
import { router } from '../router'

type BackHandler = () => boolean | void | Promise<boolean | void>
const backHandlerStack: BackHandler[] = []

interface UseSwipeOptions {
  /** 当所有页面级 BackHandler 都未消费时调用；返回 false 表示不应有返回行为
   *  （例如已在 tab 根、再 back 就会跳出 /app 到登录页）。 */
  fallback?: () => boolean | void
  /** 在触摸起始时判断当前是否允许激活 swipe。返回 false 直接 bail，连动画都不起。
   *  典型场景：tab 根 + 无 BackHandler 注册 → 没有有意义的"返回"，干脆不滑。 */
  canSwipe?: () => boolean
}

// ============ 路由级快照缓存（用于 swipe 时贴在底层显示"上一页"）============

/** 导航历史栈（fullPath），用于知道侧滑要回到哪个路由的快照 */
const navStack: string[] = []
/** 路由快照缓存：fullPath → 离开该路由那一刻 m-shell 的 DOM clone */
const routeSnapshots = new Map<string, HTMLElement>()
const MAX_SNAPSHOTS = 10

router.afterEach((to) => {
  navStack.push(to.fullPath)
  if (navStack.length > MAX_SNAPSHOTS * 2) navStack.shift()
})

router.beforeEach((_to, from) => {
  // 离开 from 时拍一份 m-shell 当前 DOM —— 此时 DOM 还是 from 的内容
  if (from.fullPath && from.name) {
    const shell = document.querySelector('.m-shell') as HTMLElement | null
    if (shell) {
      const clone = shell.cloneNode(true) as HTMLElement
      clone.classList.remove('m-swiping', 'm-swipe-transition')
      routeSnapshots.set(from.fullPath, clone)
      // GC：超过上限淘汰最早的
      if (routeSnapshots.size > MAX_SNAPSHOTS) {
        const firstKey = routeSnapshots.keys().next().value
        if (firstKey) routeSnapshots.delete(firstKey)
      }
    }
  }
  return true
})

export async function triggerBack(fallback: () => boolean | void): Promise<boolean> {
  for (let i = backHandlerStack.length - 1; i >= 0; i--) {
    try {
      const handled = await backHandlerStack[i]()
      if (handled === true) return true
    } catch { /* swallow */ }
  }
  // fallback 返回 false 表示不应执行返回（例如在 tab 根上）
  const r = fallback()
  return r === false ? false : false
}

/** 注册一个页面级 BackHandler。
 *  keep-alive 友好：当页面被切换离开（onDeactivated）时自动从栈里移除，
 *  回到该页面（onActivated）时重新加入。否则切到别的 tab 后仍能误触发返回。 */
export function useBackHandler(fn: BackHandler) {
  const push = () => {
    if (!backHandlerStack.includes(fn)) backHandlerStack.push(fn)
  }
  const pop = () => {
    const i = backHandlerStack.lastIndexOf(fn)
    if (i >= 0) backHandlerStack.splice(i, 1)
  }
  // 只在组件实例存在时挂钩 lifecycle（避免被错误调用）
  if (getCurrentInstance()) {
    onMounted(push)
    onActivated(push)
    onDeactivated(pop)
    onUnmounted(pop)
  } else {
    push()
  }
}

/** 当前是否有任何页面级 BackHandler 注册（用于 canSwipe 判断） */
export function hasBackHandler(): boolean {
  return backHandlerStack.length > 0
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

export function useInteractiveSwipeBack(opts: UseSwipeOptions = {}) {
  const fallback = opts.fallback ?? (() => { /* no-op default */ })
  const canSwipe = opts.canSwipe ?? (() => true)

  let startX = 0
  let startY = 0
  let tracking = false
  let startTime = 0
  /** swipe 期间贴在 m-shell 底层的"上一页快照"DOM */
  let snapshotEl: HTMLElement | null = null

  /** 在 swipe 开始时使用「上一路由的快照」作为底层背景。
   *  只有当 routeSnapshots 里有真实的前驱快照时才贴；
   *  没有时让背景色直接露出（不再 clone 当前页，避免"两份当前页"的视觉假象）。 */
  function attachSnapshot() {
    const container = document.querySelector('.m-shell-container') as HTMLElement | null
    if (!container || snapshotEl) return

    const prevPath = navStack.length >= 2 ? navStack[navStack.length - 2] : null
    if (!prevPath || !routeSnapshots.has(prevPath)) {
      // 没有真实的上一页快照 —— 留空底背景（页面 BackHandler 场景就是这样）
      return
    }
    const clone = routeSnapshots.get(prevPath)!.cloneNode(true) as HTMLElement

    clone.classList.add('m-prev-snapshot')
    clone.classList.remove('m-swiping', 'm-swipe-transition')
    // 关键：translateZ(0) 让 clone 成为 fixed 子元素的 containing block，
    // 否则 cloned navbar/tabbar (position: fixed) 会跑回 viewport 跟实时 navbar 重叠
    clone.style.cssText = `
      position: absolute; inset: 0; z-index: 0;
      transform: translateZ(0) !important; transition: none !important;
      pointer-events: none;
    `
    container.insertBefore(clone, container.firstChild)
    snapshotEl = clone
  }

  function detachSnapshot() {
    snapshotEl?.remove()
    snapshotEl = null
  }

  function onTouchStart(e: TouchEvent) {
    if (isTransitioning.value) return
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    if (t.clientX > EDGE_PX) return
    // 没有真正的"上一页"——既无页面 handler 又 fallback 拒绝（tab 根）→ 不允许 swipe，
    // 避免出现"两份当前页"的视觉假象
    if (!canSwipe()) return
    tracking = true
    startX = t.clientX
    startY = t.clientY
    startTime = Date.now()
  }

  function ensureSnapshotOnActivate() {
    if (!snapshotEl) attachSnapshot()
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
      ensureSnapshotOnActivate()
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

  /** 提交：先尝试页面级 BackHandler；如未消费则交由 fallback 决定是否 router.back。
   *  fallback 返回 false（表示当前在 tab 根，不该跳出 /app）则视为取消回弹。 */
  async function completeSwipe() {
    swipeActive.value = false
    const fromProgress = swipeProgress.value

    // 1. 先问页面级 handler
    let handled = false
    for (let i = backHandlerStack.length - 1; i >= 0; i--) {
      try {
        const r = await backHandlerStack[i]()
        if (r === true) { handled = true; break }
      } catch { /* ignore */ }
    }

    // 2. 没人接管 → 问 fallback；fallback 返回 false 表示"不返回"
    let didNav = handled
    if (!handled) {
      const r = fallback()
      didNav = r !== false
    }

    if (didNav) {
      // 路由/内容已变，进入回弹动画（snapshot 还在底层，新内容跟着回弹）
      await nextTick()
      isTransitioning.value = true
      swipeProgress.value = fromProgress
      await nextTick()
      swipeProgress.value = 0
      await waitForTransitionEnd()
      isTransitioning.value = false
      detachSnapshot()
    } else {
      // 没有任何返回行为，直接像取消那样回弹（cancelSwipe 内会 detachSnapshot）
      cancelSwipe()
    }
  }

  /** 取消：带过渡回弹到 0 */
  function cancelSwipe() {
    swipeActive.value = false
    isTransitioning.value = true
    swipeProgress.value = 0
    waitForTransitionEnd().then(() => {
      detachSnapshot()
      resetState()
    })
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
