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
/* ===== SynoLink Design System ===== */
:root {
  /* Primary palette (warm coral-orange, 极空间 signature feel) */
  --sl-primary: #FF6B4A;
  --sl-primary-light: #FF8A6B;
  --sl-primary-dark: #E85535;
  --sl-gradient-primary: linear-gradient(135deg, #FF6B4A 0%, #FF9A5C 100%);
  --sl-gradient-accent: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);
  --sl-gradient-info: linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%);
  --sl-gradient-success: linear-gradient(135deg, #10B981 0%, #34D399 100%);
  --sl-gradient-warning: linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%);
  --sl-gradient-danger: linear-gradient(135deg, #EF4444 0%, #F87171 100%);

  /* Surfaces */
  --sl-surface: rgba(255, 255, 255, 0.78);
  --sl-surface-blur: 20px;
  --sl-bg-page: #F5F6FA;
  --sl-bg-card: #FFFFFF;

  /* Radii */
  --sl-radius-sm: 8px;
  --sl-radius-md: 14px;
  --sl-radius-lg: 20px;
  --sl-radius-pill: 100px;

  /* Shadows (layered soft shadows) */
  --sl-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04);
  --sl-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.06), 0 1px 4px rgba(0, 0, 0, 0.03);
  --sl-shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
  --sl-shadow-hover: 0 12px 40px rgba(0, 0, 0, 0.12);

  /* Transitions */
  --sl-transition-fast: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  --sl-transition-normal: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  --sl-transition-slow: 0.4s cubic-bezier(0.4, 0, 0.2, 1);

  /* Element Plus overrides */
  --el-color-primary: #FF6B4A;
  --el-color-primary-light-3: #FF8A6B;
  --el-color-primary-light-5: #FFB299;
  --el-color-primary-light-7: #FFD4C4;
  --el-color-primary-light-9: #FFF0EB;
  --el-color-primary-dark-2: #E85535;
  --el-border-radius-base: 10px;
  --el-border-radius-small: 8px;
  --el-bg-color-page: #F5F6FA;
  --el-card-border-radius: 14px;
}

html.dark {
  --sl-bg-page: #121218;
  --sl-bg-card: #1E1E28;
  --sl-surface: rgba(30, 30, 40, 0.82);
  --sl-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.2);
  --sl-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.3);
  --sl-shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.4);
  --sl-shadow-hover: 0 12px 40px rgba(0, 0, 0, 0.5);
  --el-bg-color-page: #121218;
  --el-bg-color: #1E1E28;
}

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

/* ===== Global Element Plus Overrides ===== */
.el-card {
  border: none !important;
  border-radius: var(--sl-radius-md) !important;
  box-shadow: var(--sl-shadow-sm) !important;
  transition: transform var(--sl-transition-normal), box-shadow var(--sl-transition-normal) !important;
}
.el-card:hover {
  box-shadow: var(--sl-shadow-md) !important;
}
.el-button--primary {
  background: var(--sl-gradient-primary) !important;
  border: none !important;
  border-radius: var(--sl-radius-sm) !important;
}
.el-button--primary:hover {
  opacity: 0.9;
}
.el-button--primary:active {
  transform: scale(0.96);
}
.el-button--danger {
  background: var(--sl-gradient-danger) !important;
  border: none !important;
  border-radius: var(--sl-radius-sm) !important;
}
.el-button {
  border-radius: var(--sl-radius-sm) !important;
  transition: transform var(--sl-transition-fast), opacity var(--sl-transition-fast) !important;
}
.el-button:active {
  transform: scale(0.96);
}
.el-input__wrapper,
.el-textarea__inner {
  border-radius: var(--sl-radius-sm) !important;
}
.el-dialog {
  border-radius: var(--sl-radius-lg) !important;
  overflow: hidden;
}

/* ===== Page Transitions ===== */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity var(--sl-transition-normal), transform var(--sl-transition-normal);
}
.page-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ===== Dialog Transitions ===== */
.el-overlay {
  transition: opacity var(--sl-transition-normal) !important;
}
.el-dialog {
  transition: transform var(--sl-transition-normal), opacity var(--sl-transition-normal) !important;
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
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}
html.dark ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
}
html.dark ::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* ===== Focus Rings ===== */
*:focus-visible {
  outline: 2px solid var(--sl-primary);
  outline-offset: 2px;
  border-radius: var(--sl-radius-sm);
}
</style>
