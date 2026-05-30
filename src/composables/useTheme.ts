import { ref, watch } from 'vue'

export type ThemeMode = 'auto' | 'light' | 'dark'

const LS_KEY = 'synolink.themeMode'
const mode = ref<ThemeMode>(
  ((typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) as ThemeMode) || 'auto'
)

let mql: MediaQueryList | null = null

function effectiveDark(): boolean {
  if (mode.value === 'dark') return true
  if (mode.value === 'light') return false
  // auto
  return !!mql?.matches
}

function apply() {
  const html = document.documentElement
  if (effectiveDark()) html.classList.add('dark')
  else html.classList.remove('dark')
}

function onMqlChange() {
  if (mode.value === 'auto') apply()
}

/** 在 App.vue onMounted 调用一次 */
export function initTheme() {
  if (typeof window === 'undefined') return
  mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', onMqlChange)
  apply()
}

watch(mode, () => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LS_KEY, mode.value)
  }
  apply()
})

export function useTheme() {
  return {
    mode,
    setMode(m: ThemeMode) { mode.value = m },
  }
}
