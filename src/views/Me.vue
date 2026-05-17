<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { dsm } from '../api/dsm'
import { formatBytes, formatSpeed } from '../utils/format'

const router = useRouter()
const app = useAppStore()

const loading = ref(false)
const cpuPct = ref(0)
const memPct = ref(0)
const memTotal = ref(0)
const memUsed = ref(0)
const netSend = ref(0)
const netRecv = ref(0)
const diskRead = ref(0)
const diskWrite = ref(0)
const volumes = ref<any[]>([])
const disks = ref<any[]>([])
const sharesCount = ref(0)
const apisCount = ref(0)
const lastUpdate = ref('')

// 历史趋势数据（最近60个采样点 = 5分钟 @5s间隔）
const HISTORY_MAX = 60
const cpuHistory = ref<number[]>([])
const memHistory = ref<number[]>([])
const netSendHistory = ref<number[]>([])
const netRecvHistory = ref<number[]>([])

function pushHistory(arr: number[], val: number) {
  arr.push(val)
  if (arr.length > HISTORY_MAX) arr.shift()
}

function sparklinePath(data: number[], width: number, height: number): string {
  if (data.length < 2) return ''
  const max = Math.max(...data, 1)
  const step = width / (data.length - 1)
  return data.map((v, i) => {
    const x = i * step
    const y = height - (v / max) * height
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

let timer: any = null

onMounted(async () => {
  await app.load()
  if (!dsm.sid) {
    router.replace('/servers')
    return
  }
  apisCount.value = Object.keys(dsm.apiInfo).length
  await refreshAll()
  timer = setInterval(refreshUtil, 5000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function refreshAll() {
  loading.value = true
  try {
    await Promise.all([refreshUtil(), refreshStorage(), refreshDisks(), refreshShares()])
  } finally {
    loading.value = false
  }
}

async function refreshUtil() {
  try {
    const res = await dsm.systemUtilization()
    if (res.success && res.data) {
      const d: any = res.data
      const cpu = d.cpu ?? {}
      const user = Number(cpu.user_load ?? 0)
      const sys = Number(cpu.system_load ?? 0)
      cpuPct.value = Math.min(100, user + sys)
      const mem = d.memory ?? {}
      memTotal.value = Number(mem.total_real ?? 0) * 1024
      const avail = Number(mem.avail_real ?? mem.avail ?? 0) * 1024
      memUsed.value = Math.max(0, memTotal.value - avail)
      memPct.value = memTotal.value ? Math.round((memUsed.value / memTotal.value) * 100) : 0
      const nets: any[] = d.network ?? []
      const total = nets.find((n) => n.device === 'total') ?? nets[0] ?? {}
      netSend.value = Number(total.tx ?? 0)
      netRecv.value = Number(total.rx ?? 0)
      const disk = d.disk ?? {}
      const total2 = (disk.total ?? {}) as any
      diskRead.value = Number(total2.read_byte ?? 0)
      diskWrite.value = Number(total2.write_byte ?? 0)
      lastUpdate.value = new Date().toLocaleTimeString()

      pushHistory(cpuHistory.value, cpuPct.value)
      pushHistory(memHistory.value, memPct.value)
      pushHistory(netSendHistory.value, netSend.value)
      pushHistory(netRecvHistory.value, netRecv.value)
    }
  } catch (e) { console.warn('[Me] refreshUtil failed:', e) }
}

async function refreshStorage() {
  try {
    const res = await dsm.storageInfo()
    if (res.success && res.data) {
      volumes.value = ((res.data as any).volumes ?? []) as any[]
    }
  } catch (e) { console.warn('[Me] refreshStorage failed:', e) }
}

async function refreshDisks() {
  try {
    const res = await dsm.diskInfo()
    if (res.success && res.data) {
      disks.value = ((res.data as any).disks ?? (res.data as any)) as any[]
      if (!Array.isArray(disks.value)) disks.value = []
    }
  } catch (e) { console.warn('[Me] refreshDisks failed:', e) }
}

async function refreshShares() {
  try {
    const res = await dsm.listShare({ limit: 100 })
    if (res.success) {
      const shares: any[] = (res.data as any)?.shares ?? []
      sharesCount.value = shares.length
    }
  } catch (e) { console.warn('[Me] refreshShares failed:', e) }
}

function volUsed(v: any): number {
  return Number(v.size_used_in_byte ?? v.used_size ?? v.used ?? 0)
}
function volTotal(v: any): number {
  return Number(v.size_total_in_byte ?? v.total_size ?? v.size ?? v.total ?? 0)
}
function volPct(v: any) {
  const used = volUsed(v)
  const size = volTotal(v)
  return size ? Math.round((used / size) * 100) : 0
}
function pctColor(p: number) {
  if (p >= 90) return '#f56c6c'
  if (p >= 70) return '#e6a23c'
  return '#409eff'
}

async function logout() {
  try { await dsm.logout() } catch (e) { console.warn('[Me] logout failed:', e) }
  dsm.synoToken = ''
  dsm.sid = ''
  router.replace('/servers')
}

function switchServer() {
  router.replace('/servers')
}
</script>

<template>
  <div class="page" v-loading="loading">
    <!-- 顶部个人区 -->
    <div class="profile">
      <div class="profile-left">
        <div class="avatar">
          <el-icon :size="20"><UserFilled /></el-icon>
        </div>
        <div class="info">
          <div class="name">{{ app.accounts.find(a => a.id === app.currentAccountId)?.account || '未登录' }}</div>
          <div class="sub">{{ dsm.baseUrl || '—' }}</div>
        </div>
      </div>
      <el-button @click="refreshAll" size="small" text>
        <el-icon><Refresh /></el-icon>
      </el-button>
    </div>

    <!-- 监控区 -->
    <div class="section-title">
      <span>SYSTEM STATUS</span>
      <span class="right">{{ lastUpdate || '—' }}</span>
    </div>
    <div class="grid">
      <div class="stat-card">
        <div class="stat-accent accent-blue"></div>
        <div class="stat-body">
          <div class="stat-label">CPU</div>
          <div class="stat-number">{{ cpuPct }}<span class="stat-unit">%</span></div>
          <svg v-if="cpuHistory.length > 1" class="sparkline" viewBox="0 0 120 30" preserveAspectRatio="none">
            <path :d="sparklinePath(cpuHistory, 120, 30)" fill="none" stroke="#3B82F6" stroke-width="1.5" />
          </svg>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-accent accent-indigo"></div>
        <div class="stat-body">
          <div class="stat-label">MEMORY</div>
          <div class="stat-number">{{ memPct }}<span class="stat-unit">%</span></div>
          <div class="stat-detail">{{ formatBytes(memUsed) }} / {{ formatBytes(memTotal) }}</div>
          <svg v-if="memHistory.length > 1" class="sparkline" viewBox="0 0 120 30" preserveAspectRatio="none">
            <path :d="sparklinePath(memHistory, 120, 30)" fill="none" stroke="#6366F1" stroke-width="1.5" />
          </svg>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-accent accent-green"></div>
        <div class="stat-body">
          <div class="stat-label">NETWORK</div>
          <div class="stat-rows">
            <div class="stat-row"><span>↑</span><b>{{ formatSpeed(netSend) }}</b></div>
            <div class="stat-row"><span>↓</span><b>{{ formatSpeed(netRecv) }}</b></div>
          </div>
          <svg v-if="netSendHistory.length > 1" class="sparkline" viewBox="0 0 120 30" preserveAspectRatio="none">
            <path :d="sparklinePath(netSendHistory, 120, 30)" fill="none" stroke="#10B981" stroke-width="1.5" stroke-opacity="0.5" />
            <path :d="sparklinePath(netRecvHistory, 120, 30)" fill="none" stroke="#10B981" stroke-width="1.5" />
          </svg>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-accent accent-amber"></div>
        <div class="stat-body">
          <div class="stat-label">DISK I/O</div>
          <div class="stat-rows">
            <div class="stat-row"><span>Read</span><b>{{ formatSpeed(diskRead) }}</b></div>
            <div class="stat-row"><span>Write</span><b>{{ formatSpeed(diskWrite) }}</b></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 存储卷 -->
    <div class="section-title" v-if="volumes.length"><span>STORAGE</span></div>
    <div class="volumes">
      <div v-for="v in volumes" :key="v.id ?? v.volume_path ?? v.fs_type" class="vol-card">
        <div class="vol-head">
          <span class="vol-name">{{ v.volume_path ?? v.id }}</span>
          <span class="vol-pct">{{ volPct(v) }}%</span>
        </div>
        <div class="vol-bar">
          <div class="vol-fill" :style="{ width: volPct(v) + '%', background: pctColor(volPct(v)) }"></div>
        </div>
        <div class="vol-detail">{{ formatBytes(volUsed(v)) }} / {{ formatBytes(volTotal(v)) }}</div>
      </div>
    </div>

    <!-- 磁盘健康 -->
    <div class="section-title" v-if="disks.length"><span>DISK HEALTH</span></div>
    <div class="disks" v-if="disks.length">
      <div v-for="d in disks" :key="d.id ?? d.name" class="disk-card">
        <div class="disk-head">
          <span class="disk-name">{{ d.name || d.id }}</span>
          <span class="disk-status" :class="(d.status ?? d.smart_status ?? '').toLowerCase() === 'normal' ? 'ok' : 'warn'">
            {{ d.status ?? d.smart_status ?? '未知' }}
          </span>
        </div>
        <div class="disk-detail">
          <span v-if="d.model">{{ d.model }}</span>
          <span v-if="d.temp">{{ d.temp }}°C</span>
          <span v-if="d.size_total">{{ formatBytes(Number(d.size_total)) }}</span>
        </div>
      </div>
    </div>

    <!-- 账户信息区 -->
    <div class="section-title"><span>ACCOUNT</span></div>
    <div class="info-card">
      <div class="info-row"><span>共享文件夹</span><b>{{ sharesCount }}</b></div>
      <div class="info-row"><span>可用 API</span><b>{{ apisCount }}</b></div>
      <div class="info-row"><span>SynoToken</span><b>{{ dsm.synoToken ? '已注入' : '未下发' }}</b></div>
    </div>

    <!-- 操作区 -->
    <div class="actions">
      <el-button @click="switchServer" style="width: 100%">切换服务器</el-button>
      <el-button type="danger" @click="logout" style="width: 100%; margin-top: 8px">注销登录</el-button>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 24px 28px; max-width: 960px; margin: 0 auto; }

/* Profile */
.profile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: var(--sl-border);
  margin-bottom: 8px;
}
.profile-left { display: flex; align-items: center; gap: 12px; }
.avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--sl-radius-sm);
  background: var(--el-color-primary-light-9);
  color: var(--sl-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.info { flex: 1; }
.name { font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); }
.sub { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 2px; }

/* Section titles */
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 24px 0 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
}
.section-title .right { font-weight: 400; font-size: 11px; letter-spacing: 0; text-transform: none; }

/* Stat cards grid */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.stat-card {
  display: flex;
  border-radius: var(--sl-radius-sm);
  border: var(--sl-border);
  background: var(--sl-bg-card);
  overflow: hidden;
}
.stat-accent {
  width: 4px;
  flex-shrink: 0;
}
.accent-blue { background: #3B82F6; }
.accent-indigo { background: #6366F1; }
.accent-green { background: #10B981; }
.accent-amber { background: #F59E0B; }
.stat-body {
  flex: 1;
  padding: 14px 16px;
  min-width: 0;
}
.stat-label { font-size: 11px; font-weight: 600; color: var(--el-text-color-secondary); letter-spacing: 0.03em; text-transform: uppercase; }
.stat-number { font-size: 28px; font-weight: 700; color: var(--el-text-color-primary); margin-top: 4px; line-height: 1.1; }
.stat-unit { font-size: 14px; font-weight: 500; margin-left: 2px; color: var(--el-text-color-secondary); }
.stat-detail { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; }
.stat-rows { margin-top: 8px; }
.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.stat-row b { font-weight: 600; color: var(--el-text-color-primary); }
.sparkline { width: 100%; height: 24px; margin-top: 8px; }

/* Volumes */
.volumes { display: flex; flex-direction: column; gap: 8px; }
.vol-card {
  background: var(--sl-bg-card);
  border-radius: var(--sl-radius-sm);
  padding: 12px 16px;
  border: var(--sl-border);
}
.vol-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.vol-name { font-weight: 500; font-size: 13px; color: var(--el-text-color-primary); }
.vol-pct { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); }
.vol-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--el-fill-color);
  overflow: hidden;
}
.vol-fill {
  height: 100%;
  border-radius: 2px;
  transition: width var(--sl-transition-slow);
}
.vol-detail { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 6px; }

/* Disks */
.disks { display: flex; flex-direction: column; gap: 8px; }
.disk-card {
  background: var(--sl-bg-card);
  border-radius: var(--sl-radius-sm);
  padding: 12px 16px;
  border: var(--sl-border);
}
.disk-head { display: flex; justify-content: space-between; align-items: center; }
.disk-name { font-weight: 500; font-size: 13px; color: var(--el-text-color-primary); }
.disk-status { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: var(--sl-radius-sm); }
.disk-status.ok { background: rgba(16, 185, 129, 0.1); color: #10B981; }
.disk-status.warn { background: rgba(239, 68, 68, 0.1); color: #EF4444; }
.disk-detail { display: flex; gap: 12px; margin-top: 6px; font-size: 12px; color: var(--el-text-color-secondary); }

/* Info card */
.info-card {
  background: var(--sl-bg-card);
  border-radius: var(--sl-radius-sm);
  padding: 4px 16px;
  border: var(--sl-border);
}
.info-row {
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.info-row:last-child { border-bottom: 0; }
.info-row span { color: var(--el-text-color-regular); font-size: 13px; }
.info-row b { color: var(--el-text-color-primary); font-size: 13px; }

/* Actions */
.actions { margin-top: 24px; }
</style>
