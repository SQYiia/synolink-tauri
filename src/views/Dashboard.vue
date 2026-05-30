<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { dsm } from '../api/dsm'
import { formatBytes, formatSpeed } from '../utils/format'
import { useIsMobile } from '../composables/useIsMobile'
import FolderIcon from '../components/FolderIcon.vue'

const router = useRouter()
const app = useAppStore()
const isMobile = useIsMobile()
const refreshing = ref(false)
async function onPullRefresh() {
  refreshing.value = true
  try {
    await refreshUtil()
  } finally {
    refreshing.value = false
  }
}

const cpuPct = ref(0)
const memPct = ref(0)
const memUsed = ref(0)
const memTotal = ref(0)
const netSend = ref(0)
const netRecv = ref(0)
const diskRead = ref(0)
const diskWrite = ref(0)

let timer: ReturnType<typeof setInterval> | null = null

async function refreshUtil() {
  try {
    const res = await dsm.systemUtilization()
    if (res.success && res.data) {
      const d: any = res.data
      const cpu = d.cpu ?? {}
      cpuPct.value = Math.min(100, Number(cpu.user_load ?? 0) + Number(cpu.system_load ?? 0))
      const mem = d.memory ?? {}
      memTotal.value = Number(mem.total_real ?? 0) * 1024
      const avail = Number(mem.avail_real ?? mem.avail ?? 0) * 1024
      memUsed.value = Math.max(0, memTotal.value - avail)
      memPct.value = memTotal.value ? Math.round((memUsed.value / memTotal.value) * 100) : 0
      const nets: any[] = d.network ?? []
      const total = nets.find((n: any) => n.device === 'total') ?? nets[0] ?? {}
      netSend.value = Number(total.tx ?? 0)
      netRecv.value = Number(total.rx ?? 0)
      const disk = d.disk ?? {}
      const total2 = (disk.total ?? {}) as any
      diskRead.value = Number(total2.read_byte ?? 0)
      diskWrite.value = Number(total2.write_byte ?? 0)
    }
  } catch { /* ignore */ }
}

interface DashApp {
  id: string
  label: string
  to: string
  icon: string
  color: string
}

const ALL_APPS: DashApp[] = [
  { id: 'files',      label: '文件',   to: '/app/files',      icon: 'Folder',       color: '#3B82F6' },
  { id: 'album',      label: '相册',   to: '/app/album',      icon: 'Picture',      color: '#EC4899' },
  { id: 'videos',     label: '视频',   to: '/app/videos',     icon: 'VideoCamera',  color: '#8B5CF6' },
  { id: 'downloads',  label: '下载站', to: '/app/downloads',  icon: 'Connection',   color: '#10B981' },
  { id: 'monitor',    label: '性能',   to: '/app/monitor',    icon: 'Odometer',     color: '#06B6D4' },
  { id: 'vmm',        label: '虚拟机', to: '/app/vmm',        icon: 'Monitor',      color: '#F59E0B' },
  { id: 'me',         label: '设置',   to: '/app/me',         icon: 'User',         color: '#6B7280' },
]

const MOBILE_ICON_MAP: Record<string, string> = {
  Folder: 'folder', Picture: 'photo-o', VideoCamera: 'video-o',
  Connection: 'down', Odometer: 'bar-chart-o', Monitor: 'cluster-o', User: 'user-o',
}

const LS_HIDDEN_KEY = 'synolink.dashHiddenApps'
const hiddenIds = ref<Set<string>>(loadHidden())

function loadHidden(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_HIDDEN_KEY) || '[]')) } catch { return new Set() }
}
function saveHidden() {
  localStorage.setItem(LS_HIDDEN_KEY, JSON.stringify([...hiddenIds.value]))
}
function toggleApp(id: string) {
  if (hiddenIds.value.has(id)) hiddenIds.value.delete(id)
  else hiddenIds.value.add(id)
  hiddenIds.value = new Set(hiddenIds.value)
  saveHidden()
}

const visibleApps = computed(() => ALL_APPS.filter(a => !hiddenIds.value.has(a.id)))
const editing = ref(false)

function goTo(path: string) {
  if (editing.value) return
  router.push(path)
}

onMounted(() => {
  refreshUtil()
  timer = setInterval(refreshUtil, 5000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <van-pull-refresh v-if="isMobile" v-model="refreshing" @refresh="onPullRefresh">
    <div class="dash-page">
      <div class="dash-profile">
        <div class="dash-profile-left">
          <div class="dash-avatar">
            <el-icon :size="18"><UserFilled /></el-icon>
          </div>
          <div class="dash-user-info">
            <div class="dash-username">{{ app.accounts.find(a => a.id === app.currentAccountId)?.account || '—' }}</div>
            <div class="dash-host">{{ dsm.baseUrl || '—' }}</div>
          </div>
        </div>
      </div>

      <van-cell-group inset style="margin: 0">
        <van-cell title="CPU 使用率" :value="cpuPct + '%'" />
        <van-cell title="内存">
          <template #value>{{ formatBytes(memUsed) }} / {{ formatBytes(memTotal) }}</template>
        </van-cell>
        <van-cell title="网络">
          <template #value>↑ {{ formatSpeed(netSend) }} · ↓ {{ formatSpeed(netRecv) }}</template>
        </van-cell>
        <van-cell title="磁盘">
          <template #value>R {{ formatSpeed(diskRead) }} · W {{ formatSpeed(diskWrite) }}</template>
        </van-cell>
      </van-cell-group>

      <div class="dash-section-title">
        功能
        <button class="dash-edit-btn" @click="editing = !editing">
          {{ editing ? '完成' : '编辑' }}
        </button>
      </div>
      <div class="m-dash-grid-wrap">
        <div
          v-for="item in (editing ? ALL_APPS : visibleApps)"
          :key="item.id"
          class="m-dash-tile"
          :class="{ 'm-dash-tile-hidden': editing && hiddenIds.has(item.id) }"
          @click="editing ? toggleApp(item.id) : goTo(item.to)"
        >
          <div class="m-dash-tile-icon" :style="{ background: item.color + '15', color: item.color }">
            <FolderIcon v-if="item.icon === 'Folder'" :size="22" />
            <van-icon v-else :name="MOBILE_ICON_MAP[item.icon] || item.icon" :size="22" />
          </div>
          <div class="m-dash-tile-label">{{ item.label }}</div>
          <div v-if="editing" class="m-dash-tile-check">
            <van-icon :name="hiddenIds.has(item.id) ? 'circle' : 'success'" :size="18" :color="hiddenIds.has(item.id) ? 'hsl(var(--muted-foreground))' : item.color" />
          </div>
        </div>
      </div>
    </div>
  </van-pull-refresh>

  <div v-else class="dash-page">
    <!-- 顶部个人栏 -->
    <div class="dash-profile">
      <div class="dash-profile-left">
        <div class="dash-avatar">
          <el-icon :size="18"><UserFilled /></el-icon>
        </div>
        <div class="dash-user-info">
          <div class="dash-username">{{ app.accounts.find(a => a.id === app.currentAccountId)?.account || '—' }}</div>
          <div class="dash-host">{{ dsm.baseUrl || '—' }}</div>
        </div>
      </div>
      <el-button size="small" text @click="refreshUtil">
        <el-icon><Refresh /></el-icon>
      </el-button>
    </div>

    <!-- 状态卡片 2x2 -->
    <div class="dash-stats">
      <div class="dash-stat-card">
        <div class="dash-stat-icon" style="background: rgba(59,130,246,0.1); color: #3B82F6">
          <el-icon :size="18"><Monitor /></el-icon>
        </div>
        <div class="dash-stat-content">
          <div class="dash-stat-label">CPU</div>
          <div class="dash-stat-value">{{ cpuPct }}%</div>
        </div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-icon" style="background: rgba(99,102,241,0.1); color: #6366F1">
          <el-icon :size="18"><Coin /></el-icon>
        </div>
        <div class="dash-stat-content">
          <div class="dash-stat-label">内存</div>
          <div class="dash-stat-value">{{ formatBytes(memUsed) }}<span class="dash-stat-sub"> / {{ formatBytes(memTotal) }}</span></div>
        </div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-icon" style="background: rgba(16,185,129,0.1); color: #10B981">
          <el-icon :size="18"><Connection /></el-icon>
        </div>
        <div class="dash-stat-content">
          <div class="dash-stat-label">网络</div>
          <div class="dash-stat-rows">
            <span>↑ {{ formatSpeed(netSend) }}</span>
            <span>↓ {{ formatSpeed(netRecv) }}</span>
          </div>
        </div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-icon" style="background: rgba(245,158,11,0.1); color: #F59E0B">
          <el-icon :size="18"><Coin /></el-icon>
        </div>
        <div class="dash-stat-content">
          <div class="dash-stat-label">磁盘</div>
          <div class="dash-stat-rows">
            <span>R {{ formatSpeed(diskRead) }}</span>
            <span>W {{ formatSpeed(diskWrite) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 功能宫格 -->
    <div class="dash-section-title">
      功能
      <el-button size="small" link @click="editing = !editing">
        {{ editing ? '完成' : '编辑' }}
      </el-button>
    </div>
    <div class="dash-grid">
      <div
        v-for="item in (editing ? ALL_APPS : visibleApps)"
        :key="item.id"
        class="dash-app-item"
        :class="{ 'dash-app-item-hidden': editing && hiddenIds.has(item.id) }"
        @click="editing ? toggleApp(item.id) : goTo(item.to)"
      >
        <div class="dash-app-icon" :style="{ background: item.color + '15', color: item.color }">
          <el-icon :size="24"><component :is="item.icon" /></el-icon>
        </div>
        <span class="dash-app-label">{{ item.label }}</span>
        <el-icon v-if="editing" class="dash-app-check" :color="hiddenIds.has(item.id) ? undefined : item.color">
          <component :is="hiddenIds.has(item.id) ? 'CircleClose' : 'CircleCheck'" />
        </el-icon>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash-page {
  padding: 20px;
  max-width: 600px;
  margin: 0 auto;
}

.dash-profile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0 16px;
}
.dash-profile-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dash-avatar {
  width: 34px;
  height: 34px;
  border-radius: var(--sl-radius-sm);
  background: var(--el-color-primary-light-9);
  color: var(--sl-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dash-user-info { min-width: 0; }
.dash-username {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.dash-host {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态卡片 */
.dash-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.dash-stat-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--sl-bg-card);
  border: var(--sl-border);
  border-radius: var(--sl-radius-md);
}
.dash-stat-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--sl-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.dash-stat-content {
  min-width: 0;
  flex: 1;
}
.dash-stat-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}
.dash-stat-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin-top: 2px;
}
.dash-stat-sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}
.dash-stat-rows {
  display: flex;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-top: 2px;
}

/* 功能宫格 */
.dash-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 20px 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.dash-edit-btn {
  background: none;
  border: none;
  font-size: 12px;
  color: hsl(var(--brand));
  cursor: pointer;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
}
.dash-edit-btn:active { background: hsl(var(--muted)); }
.dash-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.dash-app-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 8px;
  border-radius: var(--sl-radius-md);
  background: var(--sl-bg-card);
  border: var(--sl-border);
  cursor: pointer;
  transition: background var(--sl-transition-fast);
}
.dash-app-item:active {
  background: var(--el-fill-color-light);
}
.dash-app-item-hidden {
  opacity: 0.4;
}
.dash-app-check {
  position: absolute;
  top: 6px;
  right: 6px;
}
.dash-app-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--sl-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dash-app-label {
  font-size: 12px;
  color: var(--el-text-color-primary);
  font-weight: 500;
}

/* Mobile-only tweaks (shadcn-style) */
.m-dash-grid-wrap {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 8px 12px;
}
.m-dash-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 4px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--sl-transition-fast), border-color var(--sl-transition-fast);
}
.m-dash-tile:active {
  background: hsl(var(--muted));
  border-color: hsl(var(--border));
}
.m-dash-tile-hidden {
  opacity: 0.4;
}
.m-dash-tile-check {
  position: absolute;
  top: 6px;
  right: 6px;
}
.m-dash-tile-icon {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.m-dash-tile-label {
  font-size: 12px;
  color: hsl(var(--foreground));
  font-weight: 500;
  letter-spacing: -0.01em;
}
</style>
