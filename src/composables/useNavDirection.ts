import { ref } from 'vue'
import { router } from '../router'

/** 'forward' | 'back' | 'none'，由 router beforeEach 维护 */
export const navDirection = ref<'forward' | 'back' | 'none'>('none')

/** 同 tab 之间切换（depth 不变、都是 tab）走横向滑动；其余 forward/back 也滑动；初次/同路径用 none */
let prevPosition = (typeof window !== 'undefined' && window.history.state?.position) ?? 0

router.beforeEach((to, from) => {
  const newPos = (typeof window !== 'undefined' && window.history.state?.position) ?? 0
  if (!from.name && to.name) {
    navDirection.value = 'none'
  } else if (newPos < prevPosition) {
    navDirection.value = 'back'
  } else if (newPos > prevPosition || to.fullPath !== from.fullPath) {
    navDirection.value = 'forward'
  } else {
    navDirection.value = 'none'
  }
  prevPosition = newPos
})

/** 给 <Transition :name="..."> 用 */
export function transitionName(): string {
  if (navDirection.value === 'back') return 'slide-back'
  if (navDirection.value === 'forward') return 'slide-fwd'
  return 'fade-quick'
}
