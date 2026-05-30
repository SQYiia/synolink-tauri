<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ActionSheetAction } from 'vant'
import { useVmm, getVmmStatusLabel, type VmmGuest } from '../composables/useVmm'
import { useIsMobile } from '../composables/useIsMobile'
import { confirm } from '../utils/feedback'

const isMobile = useIsMobile()

const sheetOpen = ref(false)
const sheetActions = ref<ActionSheetAction[]>([])
function openGuestActions(g: VmmGuest) {
  const actions: ActionSheetAction[] = []
  if (g.status === 'shutdown' || g.status === 'crashed') {
    actions.push({ name: '开机', callback: () => powerOn(g.guestId) } as any)
  }
  if (g.status === 'running') {
    actions.push({ name: '关机', callback: () => shutdown(g.guestId) } as any)
    actions.push({ name: '强制关机', color: '#EF4444', callback: () => handlePowerOff(g) } as any)
  }
  if (!actions.length) return
  sheetActions.value = actions
  sheetOpen.value = true
}
function onSheetSelect(action: ActionSheetAction) {
  sheetOpen.value = false
  ;(action as any).callback?.()
}

const { guests, hosts, storages, loading, available, startPolling, refresh, powerOn, shutdown, powerOff } = useVmm()

function isTransitioning(status: string) {
  return ['booting', 'shutting_down', 'moving', 'stor_migrating', 'creating', 'importing', 'preparing'].includes(status)
}

function autorunLabel(v: number) {
  if (v === 2) return '自动开机'
  if (v === 1) return '上次状态'
  return '手动'
}

function storagePct(s: { size: number; used: number }) {
  return s.size ? Math.round((s.used / s.size) * 100) : 0
}

async function handlePowerOn(guest: VmmGuest) {
  await powerOn(guest.guestId)
}

async function handleShutdown(guest: VmmGuest) {
  await shutdown(guest.guestId)
}

async function handlePowerOff(guest: VmmGuest) {
  const ok = await confirm(
    `强制关机「${guest.guestName}」？相当于直接断电，可能导致数据丢失。`,
    '强制关机',
    { danger: true, confirmText: '强制关机' },
  )
  if (!ok) return
  await powerOff(guest.guestId)
}

onMounted(() => {
  startPolling(5000)
})
</script>

<template>
  <div class="vmm-page">
    <!-- 未安装提示 -->
    <div v-if="!available" class="vmm-unavailable">
      <el-icon :size="40"><Monitor /></el-icon>
      <h3>Virtual Machine Manager 未安装</h3>
      <p>请在群晖套件中心安装 VMM</p>
      <el-button @click="refresh">重试</el-button>
    </div>

    <template v-else>
      <!-- 顶部栏（桌面） -->
      <div v-if="!isMobile" class="vmm-header">
        <div class="vmm-header-left">
          <h3 class="vmm-title">虚拟机</h3>
          <el-icon v-if="loading" class="is-loading" :size="14"><Loading /></el-icon>
        </div>
        <el-button size="small" @click="refresh">
          <el-icon><Refresh /></el-icon>刷新
        </el-button>
      </div>

      <!-- 主机信息 -->
      <div v-if="hosts.length" class="vmm-section">
        <div class="vmm-section-title">主机</div>
        <div class="vmm-host-grid">
          <div v-for="h in hosts" :key="h.hostId" class="vmm-host-card">
            <div class="vmm-host-head">
              <span class="vmm-host-name">{{ h.hostName }}</span>
              <el-tag :type="h.status === 'running' ? 'success' : 'danger'" size="small" disable-transitions>
                {{ h.status === 'running' ? '在线' : h.status }}
              </el-tag>
            </div>
            <div class="vmm-host-stats">
              <div class="vmm-host-stat">
                <span class="vmm-host-stat-label">CPU</span>
                <span class="vmm-host-stat-val">{{ h.totalCpu - h.freeCpu }} / {{ h.totalCpu }} 核</span>
              </div>
              <div class="vmm-host-stat">
                <span class="vmm-host-stat-label">内存</span>
                <span class="vmm-host-stat-val">{{ Math.round((h.totalRam - h.freeRam) / 1024 * 10) / 10 }} / {{ Math.round(h.totalRam / 1024 * 10) / 10 }} GB</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 虚拟机列表 -->
      <div class="vmm-section">
        <div class="vmm-section-title">虚拟机 ({{ guests.length }})</div>
        <div v-if="guests.length" class="vmm-grid">
          <div v-for="g in guests" :key="g.guestId" class="vmm-card">
            <div class="vmm-card-header">
              <div class="vmm-card-status-dot" :class="g.status === 'running' ? 'dot-on' : g.status === 'shutdown' ? 'dot-off' : 'dot-warn'"></div>
              <span class="vmm-card-name">{{ g.guestName }}</span>
              <el-tag :type="getVmmStatusLabel(g.status).type as any" size="small" disable-transitions>
                {{ getVmmStatusLabel(g.status).label }}
              </el-tag>
            </div>
            <div class="vmm-card-info">
              <div class="vmm-card-spec">
                <span>{{ g.vcpuNum }} vCPU</span>
                <span>{{ g.vramSize >= 1024 ? (g.vramSize / 1024).toFixed(1) + ' GB' : g.vramSize + ' MB' }}</span>
              </div>
              <div class="vmm-card-meta">
                <span v-if="g.storageName">{{ g.storageName }}</span>
                <span>{{ autorunLabel(g.autorun) }}</span>
              </div>
            </div>
            <div v-if="g.description" class="vmm-card-desc">{{ g.description }}</div>
            <!-- 桌面操作按钮 -->
            <div v-if="!isMobile" class="vmm-card-actions">
              <el-button
                v-if="g.status === 'shutdown' || g.status === 'crashed'"
                size="small"
                type="success"
                @click="handlePowerOn(g)"
              >开机</el-button>
              <el-button
                v-if="g.status === 'running'"
                size="small"
                type="warning"
                @click="handleShutdown(g)"
              >关机</el-button>
              <el-button
                v-if="g.status === 'running'"
                size="small"
                type="danger"
                plain
                @click="handlePowerOff(g)"
              >强制关机</el-button>
              <span v-if="isTransitioning(g.status)" class="vmm-card-wait">
                <el-icon class="is-loading"><Loading /></el-icon>
                <span style="font-size: 12px; margin-left: 4px">处理中…</span>
              </span>
            </div>
            <!-- 移动端单一 "操作" 按钮，点开 ActionSheet -->
            <div v-else class="vmm-card-actions">
              <van-button
                v-if="!isTransitioning(g.status)"
                size="small"
                type="primary"
                plain
                @click="openGuestActions(g)"
              >操作</van-button>
              <span v-else class="vmm-card-wait">
                <van-loading size="14" />
                <span style="font-size: 12px; margin-left: 6px">处理中…</span>
              </span>
            </div>
          </div>
        </div>
        <div v-else class="vmm-empty">
          <el-icon :size="36"><Monitor /></el-icon>
          <p>暂无虚拟机</p>
        </div>
      </div>

      <!-- 存储信息 -->
      <div v-if="storages.length" class="vmm-section">
        <div class="vmm-section-title">VMM 存储</div>
        <div class="vmm-storage-list">
          <div v-for="s in storages" :key="s.storageId" class="vmm-storage-card">
            <div class="vmm-storage-head">
              <span class="vmm-storage-name">{{ s.storageName }}</span>
              <el-tag :type="s.status === 'online' ? 'success' : 'danger'" size="small" disable-transitions>
                {{ s.status === 'online' ? '在线' : s.status }}
              </el-tag>
            </div>
            <div class="vmm-storage-bar">
              <div class="vmm-storage-fill" :style="{ width: storagePct(s) + '%' }"></div>
            </div>
            <div class="vmm-storage-detail">
              {{ s.used ? (s.used / 1024).toFixed(1) : 0 }} / {{ (s.size / 1024).toFixed(1) }} GB · {{ s.volumePath }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <van-action-sheet
      v-if="isMobile"
      v-model:show="sheetOpen"
      :actions="sheetActions"
      cancel-text="取消"
      close-on-click-action
      @select="onSheetSelect"
    />
  </div>
</template>

<style scoped>
.vmm-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px;
  gap: 12px;
  overflow: auto;
}
.vmm-unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--el-text-color-secondary);
}
.vmm-unavailable h3 { margin: 8px 0 0; font-size: 16px; color: var(--el-text-color-primary); }
.vmm-unavailable p { margin: 4px 0 16px; font-size: 13px; }

.vmm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.vmm-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vmm-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.vmm-section { margin-top: 4px; }
.vmm-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 8px;
}

/* 主机卡片 */
.vmm-host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.vmm-host-card {
  padding: 12px 14px;
  background: var(--sl-bg-card);
  border: var(--sl-border);
  border-radius: var(--sl-radius-sm);
}
.vmm-host-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.vmm-host-name { font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); }
.vmm-host-stats { display: flex; flex-direction: column; gap: 4px; }
.vmm-host-stat { display: flex; justify-content: space-between; font-size: 12px; }
.vmm-host-stat-label { color: var(--el-text-color-secondary); }
.vmm-host-stat-val { color: var(--el-text-color-primary); font-weight: 500; }

/* 虚拟机卡片 */
.vmm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.vmm-card {
  border: var(--sl-border);
  border-radius: var(--sl-radius-sm);
  padding: 14px 16px;
  background: var(--sl-bg-card);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vmm-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vmm-card-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-on { background: #10B981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.4); }
.dot-off { background: #9CA3AF; }
.dot-warn { background: #F59E0B; }
.vmm-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vmm-card-info { display: flex; flex-direction: column; gap: 4px; }
.vmm-card-spec {
  display: flex;
  gap: 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}
.vmm-card-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.vmm-card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vmm-card-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
}
.vmm-card-wait {
  display: flex;
  align-items: center;
  color: var(--el-text-color-secondary);
}

/* 存储 */
.vmm-storage-list { display: flex; flex-direction: column; gap: 8px; }
.vmm-storage-card {
  background: var(--sl-bg-card);
  border-radius: var(--sl-radius-sm);
  padding: 10px 14px;
  border: var(--sl-border);
}
.vmm-storage-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.vmm-storage-name { font-weight: 500; font-size: 13px; color: var(--el-text-color-primary); }
.vmm-storage-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--el-fill-color);
  overflow: hidden;
}
.vmm-storage-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--sl-primary);
  transition: width var(--sl-transition-slow);
}
.vmm-storage-detail { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 6px; }

.vmm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

@media (max-width: 640px) {
  .vmm-page {
    padding: 12px 12px;
    gap: 10px;
  }
  .vmm-grid, .vmm-host-grid {
    grid-template-columns: 1fr;
  }
  .vmm-card-actions {
    flex-wrap: wrap;
  }
}
</style>
