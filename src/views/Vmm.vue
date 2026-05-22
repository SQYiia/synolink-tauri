<script setup lang="ts">
import { onMounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useVmm, getVmmStatusLabel, type VmmGuest } from '../composables/useVmm'

const { guests, loading, available, startPolling, refresh, powerOn, shutdown, powerOff } = useVmm()

function isTransitioning(status: string) {
  return ['booting', 'shutting_down', 'moving', 'stor_migrating', 'creating', 'importing', 'preparing'].includes(status)
}

async function handlePowerOn(guest: VmmGuest) {
  await powerOn(guest.guestId)
}

async function handleShutdown(guest: VmmGuest) {
  await shutdown(guest.guestId)
}

async function handlePowerOff(guest: VmmGuest) {
  await ElMessageBox.confirm(
    `强制关机「${guest.guestName}」？相当于直接断电，可能导致数据丢失。`,
    '强制关机',
    { type: 'warning' },
  )
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
      <!-- 顶部栏 -->
      <div class="vmm-header">
        <div class="vmm-header-left">
          <h3 class="vmm-title">虚拟机</h3>
          <el-icon v-if="loading" class="is-loading" :size="14"><Loading /></el-icon>
        </div>
        <el-button size="small" @click="refresh">
          <el-icon><Refresh /></el-icon>刷新
        </el-button>
      </div>

      <!-- 卡片网格 -->
      <div v-if="guests.length" class="vmm-grid">
        <div v-for="g in guests" :key="g.guestId" class="vmm-card">
          <div class="vmm-card-header">
            <span class="vmm-card-name">{{ g.guestName }}</span>
            <el-tag :type="getVmmStatusLabel(g.status).type as any" size="small" disable-transitions>
              {{ getVmmStatusLabel(g.status).label }}
            </el-tag>
          </div>
          <div class="vmm-card-info">
            <span>{{ g.vcpuNum }} vCPU</span>
            <span>{{ g.vramSize }} MB</span>
            <span v-if="g.storageName">{{ g.storageName }}</span>
          </div>
          <div v-if="g.description" class="vmm-card-desc">{{ g.description }}</div>
          <div class="vmm-card-actions">
            <el-button
              v-if="g.status === 'shutdown'"
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
              @click="handlePowerOff(g)"
            >强制关机</el-button>
            <span v-if="isTransitioning(g.status)" class="vmm-card-wait">
              <el-icon class="is-loading"><Loading /></el-icon>
            </span>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="vmm-empty">
        <el-icon :size="36"><Monitor /></el-icon>
        <p>暂无虚拟机</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.vmm-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px;
  gap: 12px;
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

.vmm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  flex: 1;
  overflow: auto;
  align-content: start;
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
  justify-content: space-between;
}
.vmm-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vmm-card-info {
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
  color: var(--el-text-color-secondary);
}

.vmm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 80px 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
