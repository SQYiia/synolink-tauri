<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { dsm } from '../api/dsm'

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
const sharesCount = ref(0)
const apisCount = ref(0)
const lastUpdate = ref('')

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
    await Promise.all([refreshUtil(), refreshStorage(), refreshShares()])
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
    }
  } catch {}
}

async function refreshStorage() {
  try {
    const res = await dsm.storageInfo()
    if (res.success && res.data) {
      volumes.value = ((res.data as any).volumes ?? []) as any[]
    }
  } catch {}
}

async function refreshShares() {
  try {
    const res = await dsm.listShare({ limit: 100 })
    if (res.success) {
      const shares: any[] = (res.data as any)?.shares ?? []
      sharesCount.value = shares.length
    }
  } catch {}
}

function formatBytes(n?: number) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i]
}
function formatSpeed(n?: number) { return formatBytes(n) + '/s' }
function volPct(v: any) {
  const used = Number(v.used ?? 0)
  const size = Number(v.size ?? v.total ?? 0)
  return size ? Math.round((used / size) * 100) : 0
}
function pctColor(p: number) {
  if (p >= 90) return '#f56c6c'
  if (p >= 70) return '#e6a23c'
  return '#409eff'
}

async function logout() {
  try { await dsm.logout() } catch {}
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
    <!-- 顶部个人卡片 - 渐变背景 -->
    <div class="profile">
      <div class="profile-bg"></div>
      <div class="profile-content">
        <div class="avatar">
          <el-icon :size="32"><UserFilled /></el-icon>
        </div>
        <div class="info">
          <div class="name">{{ app.accounts.find(a => a.id === app.currentAccountId)?.account || '未登录' }}</div>
          <div class="sub">{{ dsm.baseUrl || '—' }}</div>
        </div>
        <el-button @click="refreshAll" circle class="refresh-btn">
          <el-icon><Refresh /></el-icon>
        </el-button>
      </div>
    </div>

    <!-- 监控区 -->
    <div class="section-title">
      <span>系统状态</span>
      <span class="right">更新于 {{ lastUpdate || '—' }}</span>
    </div>
    <div class="grid">
      <div class="stat-card stat-cpu">
        <div class="stat-label">CPU</div>
        <el-progress type="dashboard" :percentage="cpuPct" :color="'#fff'" :width="90" :stroke-width="6" define-back-color="rgba(255,255,255,0.2)" />
        <div class="stat-value">{{ cpuPct }}%</div>
      </div>
      <div class="stat-card stat-mem">
        <div class="stat-label">内存</div>
        <el-progress type="dashboard" :percentage="memPct" :color="'#fff'" :width="90" :stroke-width="6" define-back-color="rgba(255,255,255,0.2)" />
        <div class="stat-value">{{ formatBytes(memUsed) }} / {{ formatBytes(memTotal) }}</div>
      </div>
      <div class="stat-card stat-net">
        <div class="stat-label">网络</div>
        <div class="stat-rows">
          <div class="stat-row"><span>↑ 上行</span><b>{{ formatSpeed(netSend) }}</b></div>
          <div class="stat-row"><span>↓ 下行</span><b>{{ formatSpeed(netRecv) }}</b></div>
        </div>
      </div>
      <div class="stat-card stat-disk">
        <div class="stat-label">磁盘</div>
        <div class="stat-rows">
          <div class="stat-row"><span>读取</span><b>{{ formatSpeed(diskRead) }}</b></div>
          <div class="stat-row"><span>写入</span><b>{{ formatSpeed(diskWrite) }}</b></div>
        </div>
      </div>
    </div>

    <!-- 存储卷 -->
    <div class="section-title" v-if="volumes.length"><span>存储空间</span></div>
    <div class="volumes">
      <div v-for="v in volumes" :key="v.id ?? v.volume_path ?? v.fs_type" class="vol-card">
        <div class="vol-head">
          <span class="vol-name">{{ v.volume_path ?? v.id }}</span>
          <span class="vol-pct">{{ volPct(v) }}%</span>
        </div>
        <div class="vol-bar">
          <div class="vol-fill" :style="{ width: volPct(v) + '%', background: pctColor(volPct(v)) }"></div>
        </div>
        <div class="vol-detail">{{ formatBytes(Number(v.used ?? 0)) }} / {{ formatBytes(Number(v.size ?? v.total ?? 0)) }}</div>
      </div>
    </div>

    <!-- 账户信息区 -->
    <div class="section-title"><span>账户信息</span></div>
    <div class="info-card">
      <div class="info-row"><span>共享文件夹</span><b>{{ sharesCount }}</b></div>
      <div class="info-row"><span>可用 API</span><b>{{ apisCount }}</b></div>
      <div class="info-row"><span>SynoToken</span><b>{{ dsm.synoToken ? '已注入' : '未下发' }}</b></div>
    </div>

    <!-- 操作区 -->
    <div class="actions">
      <el-button size="large" round @click="switchServer" style="width: 100%">切换服务器</el-button>
      <el-button size="large" type="danger" round @click="logout" style="width: 100%; margin-top: 10px">注销登录</el-button>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 0 16px 24px; max-width: 1200px; margin: 0 auto; }

/* Profile card */
.profile {
  position: relative;
  border-radius: var(--sl-radius-lg);
  overflow: hidden;
  margin-top: 16px;
}
.profile-bg {
  position: absolute;
  inset: 0;
  background: var(--sl-gradient-primary);
}
.profile-content {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px 20px;
  z-index: 1;
}
.avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  border: 2px solid rgba(255, 255, 255, 0.6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.info { flex: 1; }
.name { font-size: 18px; font-weight: 700; color: #fff; }
.sub { color: rgba(255, 255, 255, 0.8); font-size: 12px; margin-top: 4px; }
.refresh-btn {
  background: rgba(255, 255, 255, 0.2) !important;
  border: 1px solid rgba(255, 255, 255, 0.4) !important;
  color: #fff !important;
}
.refresh-btn:hover {
  background: rgba(255, 255, 255, 0.3) !important;
}

/* Section titles */
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 20px 4px 10px;
  font-size: 15px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.section-title .right { font-weight: 400; font-size: 12px; color: var(--el-text-color-secondary); }

/* Stat cards grid */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.stat-card {
  border-radius: var(--sl-radius-md);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #fff;
}
.stat-cpu { background: var(--sl-gradient-info); }
.stat-mem { background: var(--sl-gradient-accent); }
.stat-net { background: var(--sl-gradient-success); }
.stat-disk { background: var(--sl-gradient-warning); }
.stat-label { font-size: 13px; font-weight: 600; opacity: 0.9; }
.stat-value { font-size: 12px; opacity: 0.85; }
.stat-rows { width: 100%; margin-top: 4px; }
.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 13px;
}
.stat-row:last-child { border-bottom: 0; }
.stat-row b { font-weight: 600; }

/* Volumes */
.volumes { display: flex; flex-direction: column; gap: 10px; }
.vol-card {
  background: var(--sl-bg-card);
  border-radius: var(--sl-radius-md);
  padding: 14px 18px;
  box-shadow: var(--sl-shadow-sm);
}
.vol-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.vol-name { font-weight: 600; font-size: 14px; color: var(--el-text-color-primary); }
.vol-pct { font-size: 14px; font-weight: 600; color: var(--sl-primary); }
.vol-bar {
  height: 6px;
  border-radius: 3px;
  background: var(--el-fill-color);
  overflow: hidden;
}
.vol-fill {
  height: 100%;
  border-radius: 3px;
  transition: width var(--sl-transition-slow);
}
.vol-detail { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 6px; }

/* Info card */
.info-card {
  background: var(--sl-bg-card);
  border-radius: var(--sl-radius-md);
  padding: 4px 18px;
  box-shadow: var(--sl-shadow-sm);
}
.info-row {
  display: flex;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.info-row:last-child { border-bottom: 0; }
.info-row span { color: var(--el-text-color-regular); font-size: 14px; }
.info-row b { color: var(--el-text-color-primary); font-size: 14px; }

/* Actions */
.actions { margin-top: 24px; }
</style>
