<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from './stores/app'

const app = useAppStore()

/** 根据系统主题切换 <html class="dark"> */
let mql: MediaQueryList | null = null
function applyTheme(isDark: boolean) {
  const html = document.documentElement
  if (isDark) html.classList.add('dark')
  else html.classList.remove('dark')
}
function onMqlChange(e: MediaQueryListEvent) {
  applyTheme(e.matches)
}

onMounted(() => {
  app.load()
  try {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    applyTheme(mql.matches)
    mql.addEventListener('change', onMqlChange)
  } catch {}
})

onUnmounted(() => {
  if (mql) {
    try { mql.removeEventListener('change', onMqlChange) } catch {}
  }
})
</script>

<template>
  <router-view />
</template>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
}
</style>
