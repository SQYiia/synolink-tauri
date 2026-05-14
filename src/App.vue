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
  mql = window.matchMedia('(prefers-color-scheme: dark)')
  applyTheme(mql.matches)
  mql.addEventListener('change', onMqlChange)
})

onUnmounted(() => {
  if (mql) {
    mql.removeEventListener('change', onMqlChange)
  }
})
</script>

<template>
  <router-view />
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* ===== SynoLink Design System ===== */
:root {
  /* Primary palette (indigo, professional) */
  --sl-primary: #6366F1;
  --sl-primary-light: #818CF8;
  --sl-primary-dark: #4F46E5;

  /* Accent colors (for stat cards, charts) */
  --sl-accent-indigo: #6366F1;
  --sl-accent-purple: #8B5CF6;
  --sl-accent-green: #10B981;
  --sl-accent-amber: #F59E0B;
  --sl-accent-red: #EF4444;

  /* Surfaces */
  --sl-bg-page: #F8F9FC;
  --sl-bg-card: #FFFFFF;

  /* Borders (replace shadows for cards) */
  --sl-border: 1px solid rgba(0, 0, 0, 0.08);
  --sl-border-hover: 1px solid rgba(0, 0, 0, 0.15);

  /* Radii (tighter, professional) */
  --sl-radius-sm: 6px;
  --sl-radius-md: 8px;
  --sl-radius-lg: 12px;
  --sl-radius-pill: 100px;

  /* Shadows (only for elevated elements: modals, dropdowns) */
  --sl-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --sl-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);

  /* Transitions */
  --sl-transition-fast: 0.12s ease;
  --sl-transition-normal: 0.2s ease;
  --sl-transition-slow: 0.3s ease;

  /* Element Plus overrides */
  --el-color-primary: #6366F1;
  --el-color-primary-light-3: #818CF8;
  --el-color-primary-light-5: #A5B4FC;
  --el-color-primary-light-7: #C7D2FE;
  --el-color-primary-light-9: #EEF2FF;
  --el-color-primary-dark-2: #4F46E5;
  --el-border-radius-base: 6px;
  --el-border-radius-small: 4px;
  --el-bg-color-page: #F8F9FC;
  --el-card-border-radius: 8px;
}

html.dark {
  --sl-bg-page: #0F0F14;
  --sl-bg-card: #1A1A24;
  --sl-border: 1px solid rgba(255, 255, 255, 0.08);
  --sl-border-hover: 1px solid rgba(255, 255, 255, 0.15);
  --sl-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
  --sl-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4);
  --el-bg-color-page: #0F0F14;
  --el-bg-color: #1A1A24;
}

html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
  -webkit-font-smoothing: antialiased;
}

/* ===== Global Element Plus Overrides ===== */
.el-card {
  border: var(--sl-border) !important;
  border-radius: var(--sl-radius-md) !important;
  box-shadow: none !important;
  transition: border-color var(--sl-transition-fast) !important;
}
.el-card:hover {
  border-color: rgba(0, 0, 0, 0.15) !important;
}
.el-button--primary {
  background: var(--sl-primary) !important;
  border: none !important;
  border-radius: var(--sl-radius-sm) !important;
}
.el-button--primary:hover {
  background: var(--sl-primary-dark) !important;
}
.el-button--danger {
  border-radius: var(--sl-radius-sm) !important;
}
.el-button {
  border-radius: var(--sl-radius-sm) !important;
  transition: opacity var(--sl-transition-fast), background var(--sl-transition-fast) !important;
}
.el-button:active {
  opacity: 0.8;
}
.el-input__wrapper,
.el-textarea__inner {
  border-radius: var(--sl-radius-sm) !important;
}
.el-dialog {
  border-radius: var(--sl-radius-lg) !important;
  overflow: hidden;
  box-shadow: var(--sl-shadow-lg) !important;
}

/* ===== Page Transitions ===== */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity var(--sl-transition-normal);
}
.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

/* ===== Custom Scrollbar ===== */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}
html.dark ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
}
html.dark ::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* ===== Focus Rings ===== */
*:focus-visible {
  outline: 2px solid var(--sl-primary);
  outline-offset: 2px;
  border-radius: var(--sl-radius-sm);
}
</style>
