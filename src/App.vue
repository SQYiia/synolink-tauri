<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from './stores/app'
import { initTheme } from './composables/useTheme'

const app = useAppStore()

onMounted(() => {
  app.load()
  initTheme()
})
</script>

<template>
  <router-view />
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* ===========================================================
   SynoLink Design System
   参考 shadcn/ui (https://github.com/shadcn-ui/ui) zinc 主题。
   核心：中性灰 + 细 1px 边框 + 无阴影 + 圆角 8/12px
   =========================================================== */
:root {
  /* ---- shadcn HSL tokens (light) ---- */
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;            /* near-black */
  --primary-foreground: 0 0% 98%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 240 5.9% 10%;
  --radius: 0.5rem;
  /* 业务强调色（用于状态指示/按钮等少数地方，shadcn 项目通常会保留 1 个） */
  --brand: 217 91% 60%;               /* clear blue */
  --brand-foreground: 0 0% 100%;

  /* ---- 兼容旧变量名（逐步迁移） ---- */
  --sl-primary: hsl(var(--brand));
  --sl-primary-light: hsl(var(--brand) / 0.6);
  --sl-primary-dark: hsl(var(--brand) / 0.85);
  --sl-accent-indigo: hsl(217 91% 60%);
  --sl-accent-purple: hsl(262 83% 58%);
  --sl-accent-green: hsl(142 71% 45%);
  --sl-accent-amber: hsl(38 92% 50%);
  --sl-accent-red: hsl(0 84% 60%);
  --sl-bg-page: hsl(var(--background));
  --sl-bg-card: hsl(var(--card));
  --sl-border: 1px solid hsl(var(--border));
  --sl-border-hover: 1px solid hsl(var(--border) / 0.6);
  --sl-radius-sm: 6px;
  --sl-radius-md: 8px;
  --sl-radius-lg: 12px;
  --sl-radius-pill: 9999px;
  --sl-shadow-md: none;
  --sl-shadow-lg: 0 8px 24px -4px hsl(240 5% 30% / 0.08);
  --sl-transition-fast: 0.12s ease;
  --sl-transition-normal: 0.18s ease;
  --sl-transition-slow: 0.28s ease;

  /* ---- Element Plus overrides ---- */
  --el-color-primary: hsl(var(--brand));
  --el-color-primary-light-3: hsl(var(--brand) / 0.7);
  --el-color-primary-light-5: hsl(var(--brand) / 0.5);
  --el-color-primary-light-7: hsl(var(--brand) / 0.3);
  --el-color-primary-light-8: hsl(var(--brand) / 0.18);
  --el-color-primary-light-9: hsl(var(--brand) / 0.08);
  --el-color-primary-dark-2: hsl(217 91% 50%);
  --el-color-danger: hsl(var(--destructive));
  --el-color-success: hsl(142 71% 45%);
  --el-color-warning: hsl(38 92% 50%);
  --el-text-color-primary: hsl(var(--foreground));
  --el-text-color-regular: hsl(var(--foreground) / 0.85);
  --el-text-color-secondary: hsl(var(--muted-foreground));
  --el-text-color-placeholder: hsl(var(--muted-foreground) / 0.7);
  --el-border-color: hsl(var(--border));
  --el-border-color-light: hsl(var(--border));
  --el-border-color-lighter: hsl(var(--border) / 0.6);
  --el-border-color-extra-light: hsl(var(--border) / 0.4);
  --el-bg-color: hsl(var(--card));
  --el-bg-color-page: hsl(var(--background));
  --el-bg-color-overlay: hsl(var(--popover));
  --el-fill-color: hsl(var(--muted));
  --el-fill-color-light: hsl(var(--muted) / 0.6);
  --el-fill-color-lighter: hsl(var(--muted) / 0.4);
  --el-fill-color-blank: hsl(var(--background));
  --el-border-radius-base: var(--radius);
  --el-border-radius-small: calc(var(--radius) - 2px);
  --el-card-border-radius: calc(var(--radius) + 4px);

  /* ---- Vant overrides ---- */
  --van-primary-color: hsl(var(--brand));
  --van-text-color: hsl(var(--foreground));
  --van-text-color-2: hsl(var(--muted-foreground));
  --van-background-2: hsl(var(--card));
  --van-background: hsl(var(--background));
  --van-border-color: hsl(var(--border));
  --van-cell-background: hsl(var(--card));
  --van-cell-text-color: hsl(var(--foreground));
  --van-cell-value-color: hsl(var(--muted-foreground));
  --van-tabbar-background: hsl(var(--card));
  --van-tabbar-item-active-color: hsl(var(--brand));
  --van-tabbar-item-text-color: hsl(var(--muted-foreground));
  --van-nav-bar-background: hsl(var(--card));
  --van-nav-bar-title-text-color: hsl(var(--foreground));
  --van-nav-bar-icon-color: hsl(var(--foreground));
  --van-button-primary-background: hsl(var(--primary));
  --van-button-primary-color: hsl(var(--primary-foreground));
  --van-button-primary-border-color: hsl(var(--primary));
  --van-button-default-background: hsl(var(--card));
  --van-button-default-color: hsl(var(--foreground));
  --van-button-default-border-color: hsl(var(--border));
  --van-button-danger-background: hsl(var(--destructive));
  --van-button-danger-color: hsl(var(--destructive-foreground));
  --van-button-danger-border-color: hsl(var(--destructive));
  --van-popup-background: hsl(var(--popover));
  --van-search-background: hsl(var(--muted) / 0.5);
  --van-field-input-text-color: hsl(var(--foreground));
  --van-field-label-color: hsl(var(--foreground));
  --van-field-placeholder-text-color: hsl(var(--muted-foreground));
}

html.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 6% 7%;
  --card-foreground: 0 0% 98%;
  --popover: 240 10% 4%;
  --popover-foreground: 0 0% 98%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 5.9% 10%;
  --secondary: 240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 50.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 15.9%;
  --ring: 240 4.9% 83.9%;
  --brand: 217 91% 60%;

  --sl-shadow-md: none;
  --sl-shadow-lg: 0 8px 24px -4px rgb(0 0 0 / 0.4);
}

html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  -webkit-font-smoothing: antialiased;
}

/* ===== Global Element Plus Overrides ===== */
.el-card {
  border: 1px solid hsl(var(--border)) !important;
  border-radius: calc(var(--radius) + 4px) !important;
  box-shadow: none !important;
  background: hsl(var(--card)) !important;
  transition: border-color var(--sl-transition-fast) !important;
}
.el-card:hover {
  border-color: hsl(var(--border) / 0.7) !important;
}

/* shadcn-style button: 主按钮深色 / hover 80% / 圆角 */
.el-button {
  border-radius: var(--radius) !important;
  font-weight: 500 !important;
  transition: background-color var(--sl-transition-fast), opacity var(--sl-transition-fast), border-color var(--sl-transition-fast) !important;
}
.el-button:active {
  opacity: 0.85;
}
.el-button--primary {
  background: hsl(var(--primary)) !important;
  color: hsl(var(--primary-foreground)) !important;
  border: 1px solid hsl(var(--primary)) !important;
}
.el-button--primary:hover {
  background: hsl(var(--primary) / 0.9) !important;
  border-color: hsl(var(--primary) / 0.9) !important;
}
.el-button--default {
  background: hsl(var(--card)) !important;
  color: hsl(var(--foreground)) !important;
  border: 1px solid hsl(var(--border)) !important;
}
.el-button--default:hover {
  background: hsl(var(--accent)) !important;
  border-color: hsl(var(--border)) !important;
  color: hsl(var(--accent-foreground)) !important;
}
.el-button--danger {
  background: hsl(var(--destructive)) !important;
  color: hsl(var(--destructive-foreground)) !important;
  border: 1px solid hsl(var(--destructive)) !important;
}
.el-button--danger:hover {
  background: hsl(var(--destructive) / 0.9) !important;
  border-color: hsl(var(--destructive) / 0.9) !important;
}
.el-button.is-text, .el-button.is-link {
  background: transparent !important;
  color: hsl(var(--foreground)) !important;
}

.el-input__wrapper,
.el-textarea__inner {
  border-radius: var(--radius) !important;
  background: hsl(var(--card)) !important;
  box-shadow: 0 0 0 1px hsl(var(--border)) inset !important;
}
.el-input__wrapper.is-focus,
.el-textarea__inner:focus {
  box-shadow: 0 0 0 2px hsl(var(--ring) / 0.4) inset !important;
}

.el-dialog {
  border-radius: calc(var(--radius) + 4px) !important;
  overflow: hidden;
  border: 1px solid hsl(var(--border)) !important;
  box-shadow: var(--sl-shadow-lg) !important;
  background: hsl(var(--popover)) !important;
}
.el-dialog__header {
  border-bottom: 1px solid hsl(var(--border));
  margin-right: 0 !important;
  padding: 14px 18px !important;
}
.el-dialog__title {
  font-size: 15px !important;
  font-weight: 600 !important;
  color: hsl(var(--foreground)) !important;
}
.el-dialog__body {
  padding: 18px !important;
}

/* el-table: 紧凑 + neutral */
.el-table {
  --el-table-border-color: hsl(var(--border));
  --el-table-bg-color: hsl(var(--card));
  --el-table-tr-bg-color: hsl(var(--card));
  --el-table-header-bg-color: hsl(var(--muted) / 0.5);
  --el-table-row-hover-bg-color: hsl(var(--muted) / 0.6);
  border-radius: calc(var(--radius) + 2px);
  overflow: hidden;
}
.el-table th.el-table__cell {
  font-weight: 600 !important;
  font-size: 12px !important;
  letter-spacing: 0 !important;
  text-transform: none !important;
  color: hsl(var(--muted-foreground)) !important;
}

/* el-tag: 中性 outline 风 */
.el-tag {
  background: hsl(var(--muted) / 0.6) !important;
  border: 1px solid hsl(var(--border)) !important;
  color: hsl(var(--foreground)) !important;
  border-radius: calc(var(--radius) - 2px) !important;
}

/* ===== Vant overrides ===== */
.van-cell {
  --van-cell-vertical-padding: 12px;
  --van-cell-horizontal-padding: 14px;
}
.van-cell-group--inset {
  margin: 8px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) + 4px);
  overflow: hidden;
}
.van-cell::after {
  border-color: hsl(var(--border)) !important;
}
.van-tabbar {
  border-top: 1px solid hsl(var(--border)) !important;
}
.van-nav-bar {
  border-bottom: 1px solid hsl(var(--border)) !important;
}
.van-nav-bar::after { display: none !important; }
.van-search {
  background: transparent !important;
  padding: 8px 12px !important;
}
.van-search__content {
  background: hsl(var(--muted) / 0.5) !important;
  border-radius: var(--radius) !important;
}
.van-button {
  border-radius: var(--radius) !important;
  font-weight: 500 !important;
}
.van-button--round {
  border-radius: 9999px !important;
}
.van-popup {
  background: hsl(var(--popover)) !important;
  color: hsl(var(--foreground)) !important;
}
.van-dialog {
  border-radius: calc(var(--radius) + 4px) !important;
  background: hsl(var(--popover)) !important;
  color: hsl(var(--foreground)) !important;
}
.van-action-sheet {
  background: hsl(var(--popover)) !important;
}
.van-action-sheet__item {
  background: hsl(var(--popover)) !important;
  color: hsl(var(--foreground)) !important;
}
.van-action-sheet__item:active {
  background: hsl(var(--muted)) !important;
}

/* ===== Page Transitions (iOS-style slide) ===== */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity var(--sl-transition-normal);
}
.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

/* 前进：新页从右滑入；旧页向左轻退淡出 */
.slide-fwd-enter-active {
  transition: transform 240ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease-out;
}
.slide-fwd-leave-active {
  transition: transform 200ms cubic-bezier(0.32, 0.72, 0, 1), opacity 150ms ease-in;
}
.slide-fwd-enter-from { transform: translateX(28%); opacity: 0; }
.slide-fwd-leave-to { transform: translateX(-12%); opacity: 0; }

/* 后退：新页从左滑入；旧页向右滑出 */
.slide-back-enter-active {
  transition: transform 240ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease-out;
}
.slide-back-leave-active {
  transition: transform 200ms cubic-bezier(0.32, 0.72, 0, 1), opacity 150ms ease-in;
}
.slide-back-enter-from { transform: translateX(-12%); opacity: 0; }
.slide-back-leave-to { transform: translateX(28%); opacity: 0; }

/* 同位/初次：快速淡入 */
.fade-quick-enter-active, .fade-quick-leave-active { transition: opacity 120ms ease; }
.fade-quick-enter-from, .fade-quick-leave-to { opacity: 0; }

/* ===== Custom Scrollbar ===== */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 0.4);
}

/* ===== Focus Rings ===== */
*:focus-visible {
  outline: 2px solid hsl(var(--ring) / 0.4);
  outline-offset: 2px;
  border-radius: calc(var(--radius) - 2px);
}

/* ===== iOS / Mobile Adaptations ===== */
:root {
  --sl-safe-top: env(safe-area-inset-top, 0px);
  --sl-safe-bottom: env(safe-area-inset-bottom, 0px);
  --sl-safe-left: env(safe-area-inset-left, 0px);
  --sl-safe-right: env(safe-area-inset-right, 0px);
}

@media (max-width: 640px) {
  html, body, #app {
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'PingFang SC', 'Helvetica Neue', sans-serif;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior-y: none;
  }
  ::-webkit-scrollbar { display: none; }
  .van-toast, .van-dialog, .van-popup, .van-overlay { z-index: 3000; }

  /* 移动端整体降一点 cell-group 间距，更紧凑 shadcn 风 */
  .van-cell-group--inset {
    margin: 10px 12px;
  }
}
</style>
