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
    <!-- 顶部个人卡片 -->
    <div class="profile">
      <div class="avatar">
        <el-icon :size="36"><UserFilled /></el-icon>
      </div>
      <div class="info">
        <div class="name">{{ app.accounts.find(a => a.id === app.currentAccountId)?.account || '未登录' }}</div>
        <div class="sub">{{ dsm.baseUrl || '—' }}</div>
      </div>
      <el-button @click="refreshAll" circle plain>
        <el-icon><Refresh /></el-icon>
      </el-button>
    </div>

    <!-- 监控区 -->
    <div class="section-title">
      <span>系统状态</span>
      <span class="right">更新于 {{ lastUpdate || '—' }}</span>
    </div>
    <div class="grid">
      <el-card shadow="never" class="card">
        <div class="title">CPU</div>
        <el-progress type="dashboard" :percentage="cpuPct" :color="pctColor(cpuPct)" :width="110" />
      </el-card>
      <el-card shadow="never" class="card">
        <div class="title">内存</div>
        <el-progress type="dashboard" :percentage="memPct" :color="pctColor(memPct)" :width="110" />
        <div class="sub">{{ formatBytes(memUsed) }} / {{ formatBytes(memTotal) }}</div>
      </el-card>
      <el-card shadow="never" class="card">
        <div class="title">网络</div>
        <div class="row"><span>↑ 上行</span><b>{{ formatSpeed(netSend) }}</b></div>
        <div class="row"><span>↓ 下行</span><b>{{ formatSpeed(netRecv) }}</b></div>
      </el-card>
      <el-card shadow="never" class="card">
        <div class="title">磁盘</div>
        <div class="row"><span>读取</span><b>{{ formatSpeed(diskRead) }}</b></div>
        <div class="row"><span>写入</span><b>{{ formatSpeed(diskWrite) }}</b></div>
      </el-card>
      <el-card shadow="never" class="card" v-for="v in volumes" :key="v.id ?? v.volume_path ?? v.fs_type">
        <div class="title">{{ v.volume_path ?? v.id }}</div>
        <el-progress :percentage="volPct(v)" :color="pctColor(volPct(v))" />
        <div class="sub">{{ formatBytes(Number(v.used ?? 0)) }} / {{ formatBytes(Number(v.size ?? v.total ?? 0)) }}</div>
      </el-card>
    </div>

    <!-- 账户信息区 -->
    <div class="section-title"><span>账户</span></div>
    <el-card shadow="never" class="list">
      <div class="list-row"><span>共享文件夹</span><b>{{ sharesCount }}</b></div>
      <div class="list-row"><span>可用 API</span><b>{{ apisCount }}</b></div>
      <div class="list-row"><span>SynoToken</span><b>{{ dsm.synoToken ? '已注入' : '未下发' }}</b></div>
    </el-card>

    <!-- 操作区 -->
    <div class="actions">
      <el-button size="large" @click="switchServer" style="width: 100%">切换服务器</el-button>
      <el-button size="large" type="danger" @click="logout" style="width: 100%; margin-top: 10px">注销登录</el-button>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 16px; max-width: 1200px; margin: 0 auto; }
.profile {
  display: flex; align-items: center; gap: 14px;
  background: var(--el-bg-color); padding: 16px; border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.avatar {
  width: 56px; height: 56px; border-radius: 50%;
  background: linear-gradient(135deg, #409eff, #53a8ff);
  color: #fff; display: flex; align-items: center; justify-content: center;
}
.info { flex: 1; }
.name { font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); }
.sub { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; }
.section-title {
  display: flex; justify-content: space-between; align-items: center;
  margin: 18px 4px 8px; font-size: 13px; color: var(--el-text-color-secondary); font-weight: 600;
}
.section-title .right { font-weight: 400; font-size: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.card { border-radius: 10px; }
.card .title { font-weight: 600; margin-bottom: 10px; color: var(--el-text-color-primary); text-align: center; }
.card .sub { text-align: center; color: var(--el-text-color-secondary); font-size: 12px; margin-top: 8px; }
.row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed var(--el-border-color-lighter); }
.row:last-child { border-bottom: 0; }
.row span { color: var(--el-text-color-secondary); }
.row b { color: var(--el-text-color-primary); }
.list { border-radius: 10px; }
.list-row { display: flex; justify-content: space-between; padding: 12px 4px; border-bottom: 1px solid var(--el-border-color-lighter); }
.list-row:last-child { border-bottom: 0; }
.list-row span { color: var(--el-text-color-regular); }
.list-row b { color: var(--el-text-color-primary); }
.actions { margin-top: 24px; }
</style>
