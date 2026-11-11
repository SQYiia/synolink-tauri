<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { updates, checkForUpdates, downloadUpdate, installUpdate, startUpdateChecks } from '../composables/useAppUpdate'
let stop: (() => void) | undefined
onMounted(() => { stop = startUpdateChecks() })
onUnmounted(() => stop?.())
</script>
<template>
  <button v-if="updates.available && !updates.open" class="update-notice" @click="updates.open = true">↑ 新版本 {{ updates.available.version }} 可用</button>
  <el-dialog v-model="updates.open" title="软件更新" width="min(520px, 92vw)" append-to-body>
    <div class="update-content">
      <span class="update-label">SYNOLINK</span>
      <h2>{{ updates.available ? `发现新版本 ${updates.available.version}` : '保持 SynoLink 为最新版本' }}</h2>
      <p>当前版本 {{ updates.currentVersion }} · GitHub Releases 稳定版</p>
      <div v-if="updates.available" class="update-notes">{{ updates.available.notes || '此版本暂无更新说明。' }}</div>
      <p v-if="updates.available">安装包 {{ (updates.available.size / 1024 / 1024).toFixed(1) }} MB · 下载后校验 SHA256</p>
      <el-progress v-if="updates.phase === 'downloading'" :percentage="updates.progress" />
      <p v-if="updates.phase === 'ready'" class="update-success">安装包已下载，完整性校验通过。</p>
      <p v-if="updates.checked && !updates.available && !updates.error">当前已是最新稳定版。</p>
      <el-alert v-if="updates.error" :title="updates.error" type="error" :closable="false" show-icon />
    </div>
    <template #footer>
      <el-button @click="updates.open = false">稍后</el-button>
      <el-button v-if="updates.phase === 'ready' || updates.phase === 'installing'" type="primary" :loading="updates.phase === 'installing'" @click="installUpdate">退出并安装</el-button>
      <el-button v-else-if="updates.available" type="primary" :disabled="updates.phase === 'checking'" :loading="updates.phase === 'downloading'" @click="downloadUpdate">下载更新</el-button>
      <el-button v-else type="primary" :loading="updates.phase === 'checking'" @click="checkForUpdates()">检查更新</el-button>
    </template>
  </el-dialog>
</template>
<style scoped>
.update-notice { position: fixed; right: 24px; bottom: 24px; z-index: 2000; border: 1px solid var(--el-border-color); background: var(--el-bg-color-overlay); color: var(--el-color-primary); border-radius: 14px; padding: 14px 20px; box-shadow: 0 8px 30px #0002; cursor: pointer; }
.update-content h2 { font-size: 23px; margin: 10px 0; color: var(--el-text-color-primary); }
.update-content p { color: var(--el-text-color-secondary); line-height: 1.6; }
.update-label { font-size: 11px; letter-spacing: 2px; color: var(--el-color-primary); }
.update-notes { max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 16px; border-radius: 12px; background: var(--el-fill-color-light); line-height: 1.7; }
.update-content .update-success { color: var(--el-color-success); }
</style>
