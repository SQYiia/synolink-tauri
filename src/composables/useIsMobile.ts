import { isMobileUA } from '../utils/platform'
import { ref, readonly } from 'vue'

const MOBILE_BREAKPOINT = 640

const _isMobile = ref(isMobileUA || (typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT))

if (typeof window !== 'undefined') {
  let timer: number | undefined
  window.addEventListener('resize', () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      _isMobile.value = isMobileUA || window.innerWidth <= MOBILE_BREAKPOINT
    }, 100)
  })
}

export function useIsMobile() {
  return readonly(_isMobile)
}
