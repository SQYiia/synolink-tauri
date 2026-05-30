<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../stores/app'
import { dsm } from '../api/dsm'
import { formatBytes, formatSpeed } from '../utils/format'
import { useIsMobile } from '../composables/useIsMobile'
import { confirm, toast } from '../utils/feedback'

const router = useRouter()
const app = useAppStore()
const isMobile = useIsMobile()

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
const lastUpdate = ref('')

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
  await refreshAll()
  timer = setInterval(refreshUtil, 5000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function refreshAll() {
  loading.value = true
  try {
    await Promise.all([refreshUtil(), refreshStorage(), refreshDisks(), refreshShares(), refreshCacheStats()])
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
      const raw = ((res.data as any).volumes ?? []) as any[]
      volumes.value = raw.map(normalizeVolume)
    }
  } catch (e) { console.warn('[Me] refreshStorage failed:', e) }
}

async function refreshDisks() {
  try {
    const res = await dsm.diskInfo()
    if (res.success && res.data) {
      const raw = ((res.data as any).disks ?? (res.data as any)) as any[]
      const arr = Array.isArray(raw) ? raw : []
      disks.value = arr.map(normalizeDisk)
    }
  } catch (e) { console.warn('[Me] refreshDisks failed:', e) }
}

function normalizeVolume(v: any) {
  const sizeObj = (v?.size && typeof v.size === 'object') ? v.size : null
  const size = Number(
    v?.size_total ?? sizeObj?.total ?? v?.total ??
    (typeof v?.size === 'number' || typeof v?.size === 'string' ? v.size : 0)
  ) || 0
  const free = Number(
    v?.size_free_user ?? sizeObj?.free_user ?? sizeObj?.free ?? v?.free ?? 0
  ) || 0
  let used = Number(
    v?.size_used ?? v?.used_size ?? sizeObj?.used ?? v?.used ?? 0
  ) || 0
  if (!used && size > 0 && free > 0) used = Math.max(0, size - free)
  return {
    ...v,
    _name: v?.display_name ?? v?.volume_path ?? v?.id ?? '-',
    _size: size,
    _used: used,
    _status: v?.status ?? v?.volume_status,
  }
}

function normalizeDisk(d: any) {
  const sizeObj = (d?.size && typeof d.size === 'object') ? d.size : null
  const size = Number(
    d?.size_total ?? sizeObj?.total ?? d?.capacity ??
    (typeof d?.size === 'number' || typeof d?.size === 'string' ? d.size : 0)
  ) || 0
  const temp = Number(d?.temp ?? d?.temperature ?? 0) || 0
  return {
    ...d,
    _name: d?.name ?? d?.disk_id ?? d?.id ?? d?.disk_path ?? '-',
    _model: [d?.vendor, d?.model].filter(Boolean).join(' ').trim() || d?.model || '',
    _temp: temp,
    _size: size,
    _status: d?.status ?? d?.smart_status ?? d?.smart_test_status ?? '',
  }
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

const cacheSize = ref(0)
const cacheCount = ref(0)
const cacheBusy = ref(false)
const CACHE_LIMIT_BYTES = 200 * 1024 * 1024

async function refreshCacheStats() {
  try {
    const res = await invoke<[number, number] | { 0: number; 1: number }>('get_thumb_cache_stats')
    const total = Array.isArray(res) ? Number(res[0]) : Number((res as any)[0] ?? 0)
    const count = Array.isArray(res) ? Number(res[1]) : Number((res as any)[1] ?? 0)
    cacheSize.value = total || 0
    cacheCount.value = count || 0
  } catch (e) { console.warn('[Me] cache stats failed:', e) }
}

async function clearCache() {
  const ok = await confirm('确定清除全部缩略图缓存？后续访问相册将重新从 NAS 拉取。', '清除缓存', { danger: true, confirmText: '清除' })
  if (!ok) return
  cacheBusy.value = true
  try {
    const removed = await invoke<number>('clear_thumb_cache')
    toast(`已释放 ${formatBytes(Number(removed) || 0)}`, 'success')
    await refreshCacheStats()
  } catch (e) {
    toast('清除失败：' + String(e), 'error')
  } finally {
    cacheBusy.value = false
  }
}

function cachePct() {
  if (!CACHE_LIMIT_BYTES) return 0
  return Math.min(100, Math.round((cacheSize.value / CACHE_LIMIT_BYTES) * 100))
}

function volPct(v: any) {
  const used = Number(v?._used ?? v?.used ?? 0)
  const size = Number(v?._size ?? v?.size ?? v?.total ?? 0)
  return size ? Math.round((used / size) * 100) : 0
}
function pctColor(p: number) {
  if (p >= 90) return '#f56c6c'
  if (p >= 70) return '#e6a23c'
  return '#409eff'
}

async function logout() {
  const ok = await confirm('确定注销当前账户？', '注销', { danger: true, confirmText: '注销' })
  if (!ok) return
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
  <!-- 桌面端 -->
  <div v-if="!isMobile" class="page" v-loading="loading">
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

    <div class="section-title" v-if="volumes.length"><span>STORAGE</span></div>
    <div class="volumes">
      <div v-for="v in volumes" :key="v.id ?? v.volume_path ?? v._name" class="vol-card">
        <div class="vol-head">
          <span class="vol-name">{{ v._name }}</span>
          <span class="vol-pct">{{ volPct(v) }}%</span>
        </div>
        <div class="vol-bar">
          <div class="vol-fill" :style="{ width: volPct(v) + '%', background: pctColor(volPct(v)) }"></div>
        </div>
        <div class="vol-detail">{{ formatBytes(v._used) }} / {{ formatBytes(v._size) }}</div>
      </div>
    </div>

    <div class="section-title" v-if="disks.length"><span>DISK HEALTH</span></div>
    <div class="disks" v-if="disks.length">
      <div v-for="d in disks" :key="d.id ?? d._name" class="disk-card">
        <div class="disk-head">
          <span class="disk-name">{{ d._name }}</span>
          <span class="disk-status" :class="String(d._status).toLowerCase() === 'normal' ? 'ok' : 'warn'">
            {{ d._status || '未知' }}
          </span>
        </div>
        <div class="disk-detail">
          <span v-if="d._model">{{ d._model }}</span>
          <span v-if="d._temp">{{ d._temp }}°C</span>
          <span v-if="d._size">{{ formatBytes(d._size) }}</span>
        </div>
      </div>
    </div>

    <div class="section-title"><span>ACCOUNT</span></div>
    <div class="info-card">
      <div class="info-row"><span>共享文件夹</span><b>{{ sharesCount }}</b></div>
      <div class="info-row"><span>SynoToken</span><b>{{ dsm.synoToken ? '已注入' : '未下发' }}</b></div>
    </div>

    <div class="section-title">
      <span>LOCAL CACHE</span>
      <span class="right">上限 {{ formatBytes(CACHE_LIMIT_BYTES) }}</span>
    </div>
    <div class="vol-card">
      <div class="vol-head">
        <span class="vol-name">缩略图缓存</span>
        <span class="vol-pct">{{ cachePct() }}%</span>
      </div>
      <div class="vol-bar">
        <div class="vol-fill" :style="{ width: cachePct() + '%', background: pctColor(cachePct()) }"></div>
      </div>
      <div class="vol-detail">
        {{ formatBytes(cacheSize) }} / {{ formatBytes(CACHE_LIMIT_BYTES) }} · {{ cacheCount }} 个文件
      </div>
      <div class="cache-actions">
        <el-button size="small" :loading="cacheBusy" @click="refreshCacheStats" text>
          <el-icon><Refresh /></el-icon><span style="margin-left:4px">刷新</span>
        </el-button>
        <el-button size="small" type="danger" :loading="cacheBusy" @click="clearCache" plain>
          清除缓存
        </el-button>
      </div>
    </div>

    <div class="actions">
      <el-button @click="switchServer" style="width: 100%">切换服务器</el-button>
      <el-button type="danger" @click="logout" style="width: 100%; margin-top: 8px">注销登录</el-button>
    </div>
  </div>

  <!-- 移动端 -->
  <div v-else class="m-me">
    <!-- 头像 / 账户区 -->
    <div class="m-profile-card">
      <div class="m-avatar">
        <van-icon name="manager" size="28" />
      </div>
      <div class="m-profile-info">
        <div class="m-profile-name">{{ app.accounts.find(a => a.id === app.currentAccountId)?.account || '未登录' }}</div>
        <div class="m-profile-sub">{{ dsm.baseUrl || '—' }}</div>
      </div>
      <van-icon name="replay" size="20" @click="refreshAll" />
    </div>

    <!-- 系统状态 -->
    <div class="m-group-title">
      <span>系统状态</span>
      <span class="m-group-right">{{ lastUpdate || '—' }}</span>
    </div>
    <van-cell-group inset>
      <van-cell title="CPU 使用率" :value="cpuPct + '%'" />
      <van-cell title="内存使用">
        <template #value>
          <span>{{ memPct }}% · {{ formatBytes(memUsed) }} / {{ formatBytes(memTotal) }}</span>
        </template>
      </van-cell>
      <van-cell title="网络">
        <template #value>
          <span>↑ {{ formatSpeed(netSend) }} · ↓ {{ formatSpeed(netRecv) }}</span>
        </template>
      </van-cell>
      <van-cell title="磁盘 I/O">
        <template #value>
          <span>R {{ formatSpeed(diskRead) }} · W {{ formatSpeed(diskWrite) }}</span>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 存储卷 -->
    <template v-if="volumes.length">
      <div class="m-group-title"><span>存储</span></div>
      <van-cell-group inset>
        <van-cell v-for="v in volumes" :key="v.id ?? v.volume_path ?? v._name">
          <template #title>
            <div class="m-vol-row">
              <span class="m-vol-name">{{ v._name }}</span>
              <span class="m-vol-pct">{{ volPct(v) }}%</span>
            </div>
            <van-progress
              :percentage="volPct(v)"
              :color="pctColor(volPct(v))"
              :show-pivot="false"
              stroke-width="4"
              style="margin-top: 6px"
            />
            <div class="m-vol-detail">{{ formatBytes(v._used) }} / {{ formatBytes(v._size) }}</div>
          </template>
        </van-cell>
      </van-cell-group>
    </template>

    <!-- 磁盘健康 -->
    <template v-if="disks.length">
      <div class="m-group-title"><span>磁盘</span></div>
      <van-cell-group inset>
        <van-cell v-for="d in disks" :key="d.id ?? d._name">
          <template #title>
            <div class="m-vol-row">
              <span class="m-vol-name">{{ d._name }}</span>
              <span
                class="m-disk-status"
                :class="String(d._status).toLowerCase() === 'normal' ? 'ok' : 'warn'"
              >{{ d._status || '未知' }}</span>
            </div>
            <div class="m-vol-detail">
              <span v-if="d._model">{{ d._model }}</span>
              <span v-if="d._temp"> · {{ d._temp }}°C</span>
              <span v-if="d._size"> · {{ formatBytes(d._size) }}</span>
            </div>
          </template>
        </van-cell>
      </van-cell-group>
    </template>

    <!-- 账户信息 -->
    <div class="m-group-title"><span>账户</span></div>
    <van-cell-group inset>
      <van-cell title="共享文件夹" :value="String(sharesCount)" />
      <van-cell title="SynoToken" :value="dsm.synoToken ? '已注入' : '未下发'" />
    </van-cell-group>

    <!-- 缓存 -->
    <div class="m-group-title">
      <span>本地缓存</span>
      <span class="m-group-right">上限 {{ formatBytes(CACHE_LIMIT_BYTES) }}</span>
    </div>
    <van-cell-group inset>
      <van-cell>
        <template #title>
          <div class="m-vol-row">
            <span class="m-vol-name">缩略图缓存</span>
            <span class="m-vol-pct">{{ cachePct() }}%</span>
          </div>
          <van-progress
            :percentage="cachePct()"
            :color="pctColor(cachePct())"
            :show-pivot="false"
            stroke-width="4"
            style="margin-top: 6px"
          />
          <div class="m-vol-detail">
            {{ formatBytes(cacheSize) }} / {{ formatBytes(CACHE_LIMIT_BYTES) }} · {{ cacheCount }} 个文件
          </div>
        </template>
      </van-cell>
      <van-cell title="清除缓存" is-link clickable @click="clearCache" :value="cacheBusy ? '处理中...' : ''" />
    </van-cell-group>

    <!-- 操作 -->
    <div class="m-group-title"><span>操作</span></div>
    <van-cell-group inset>
      <van-cell title="切换服务器" is-link clickable @click="switchServer" />
      <van-cell title="注销登录" is-link clickable @click="logout" title-style="color: var(--el-color-danger)" />
    </van-cell-group>

    <div class="m-bottom-pad" />
  </div>
</template>

<style scoped>
/* Desktop */
.page { padding: 24px 28px; max-width: 960px; margin: 0 auto; }
.profile {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 0; border-bottom: var(--sl-border); margin-bottom: 8px;
}
.profile-left { display: flex; align-items: center; gap: 12px; }
.avatar {
  width: 36px; height: 36px; border-radius: var(--sl-radius-sm);
  background: var(--el-color-primary-light-9); color: var(--sl-primary);
  display: flex; align-items: center; justify-content: center;
}
.info { flex: 1; }
.name { font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); }
.sub { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 2px; }
.section-title {
  display: flex; justify-content: space-between; align-items: center;
  margin: 24px 0 12px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.05em;
  color: var(--el-text-color-secondary); text-transform: uppercase;
}
.section-title .right { font-weight: 400; font-size: 11px; letter-spacing: 0; text-transform: none; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.stat-card {
  display: flex; border-radius: var(--sl-radius-sm); border: var(--sl-border);
  background: var(--sl-bg-card); overflow: hidden;
}
.stat-accent { width: 4px; flex-shrink: 0; }
.accent-blue { background: #3B82F6; }
.accent-indigo { background: #6366F1; }
.accent-green { background: #10B981; }
.accent-amber { background: #F59E0B; }
.stat-body { flex: 1; padding: 14px 16px; min-width: 0; }
.stat-label { font-size: 11px; font-weight: 600; color: var(--el-text-color-secondary); letter-spacing: 0.03em; text-transform: uppercase; }
.stat-number { font-size: 28px; font-weight: 700; color: var(--el-text-color-primary); margin-top: 4px; line-height: 1.1; }
.stat-unit { font-size: 14px; font-weight: 500; margin-left: 2px; color: var(--el-text-color-secondary); }
.stat-detail { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; }
.stat-rows { margin-top: 8px; }
.stat-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; color: var(--el-text-color-regular); }
.stat-row b { font-weight: 600; color: var(--el-text-color-primary); }
.sparkline { width: 100%; height: 24px; margin-top: 8px; }
.volumes { display: flex; flex-direction: column; gap: 8px; }
.vol-card {
  background: var(--sl-bg-card); border-radius: var(--sl-radius-sm);
  padding: 12px 16px; border: var(--sl-border);
}
.vol-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.vol-name { font-weight: 500; font-size: 13px; color: var(--el-text-color-primary); }
.vol-pct { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); }
.vol-bar { height: 4px; border-radius: 2px; background: var(--el-fill-color); overflow: hidden; }
.vol-fill { height: 100%; border-radius: 2px; transition: width var(--sl-transition-slow); }
.vol-detail { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 6px; }
.disks { display: flex; flex-direction: column; gap: 8px; }
.disk-card { background: var(--sl-bg-card); border-radius: var(--sl-radius-sm); padding: 12px 16px; border: var(--sl-border); }
.disk-head { display: flex; justify-content: space-between; align-items: center; }
.disk-name { font-weight: 500; font-size: 13px; color: var(--el-text-color-primary); }
.disk-status { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: var(--sl-radius-sm); }
.disk-status.ok { background: rgba(16, 185, 129, 0.1); color: #10B981; }
.disk-status.warn { background: rgba(239, 68, 68, 0.1); color: #EF4444; }
.disk-detail { display: flex; gap: 12px; margin-top: 6px; font-size: 12px; color: var(--el-text-color-secondary); }
.info-card { background: var(--sl-bg-card); border-radius: var(--sl-radius-sm); padding: 4px 16px; border: var(--sl-border); }
.info-row {
  display: flex; justify-content: space-between; padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.info-row:last-child { border-bottom: 0; }
.info-row span { color: var(--el-text-color-regular); font-size: 13px; }
.info-row b { color: var(--el-text-color-primary); font-size: 13px; }
.actions { margin-top: 24px; }
.cache-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }

/* Mobile (shadcn-style) */
.m-me {
  min-height: 100%;
  background: hsl(var(--background));
}
.m-profile-card {
  display: flex; align-items: center; gap: 14px;
  margin: 12px;
  padding: 16px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
}
.m-avatar {
  width: 48px; height: 48px;
  border-radius: 10px;
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.m-profile-info { flex: 1; min-width: 0; }
.m-profile-name {
  font-size: 15px; font-weight: 600; color: hsl(var(--foreground));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  letter-spacing: -0.01em;
}
.m-profile-sub {
  font-size: 12px; color: hsl(var(--muted-foreground)); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.m-group-title {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 24px 6px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  text-transform: none;
}
.m-group-right { font-size: 11px; color: hsl(var(--muted-foreground) / 0.7); font-weight: 400; }

.m-vol-row {
  display: flex; justify-content: space-between; align-items: center;
}
.m-vol-name { font-size: 14px; font-weight: 500; color: hsl(var(--foreground)); }
.m-vol-pct { font-size: 13px; color: hsl(var(--foreground)); font-weight: 600; font-variant-numeric: tabular-nums; }
.m-vol-detail {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.m-disk-status {
  font-size: 11px; font-weight: 500; padding: 2px 7px; border-radius: 5px;
  border: 1px solid hsl(var(--border));
}
.m-disk-status.ok { background: hsl(142 71% 45% / 0.08); color: hsl(142 71% 30%); border-color: hsl(142 71% 45% / 0.2); }
.m-disk-status.warn { background: hsl(var(--destructive) / 0.08); color: hsl(var(--destructive)); border-color: hsl(var(--destructive) / 0.2); }
.m-bottom-pad { height: 30px; }
</style>
