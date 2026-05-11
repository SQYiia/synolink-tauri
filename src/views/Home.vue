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
      // CPU
      const cpu = d.cpu ?? {}
      const user = Number(cpu.user_load ?? 0)
      const sys = Number(cpu.system_load ?? 0)
      cpuPct.value = Math.min(100, user + sys)
      // Memory
      const mem = d.memory ?? {}
      memTotal.value = Number(mem.total_real ?? 0) * 1024
      const avail = Number(mem.avail_real ?? mem.avail ?? 0) * 1024
      memUsed.value = Math.max(0, memTotal.value - avail)
      memPct.value = memTotal.value ? Math.round((memUsed.value / memTotal.value) * 100) : 0
      // Network (total)
      const nets: any[] = d.network ?? []
      const total = nets.find((n) => n.device === 'total') ?? nets[0] ?? {}
      netSend.value = Number(total.tx ?? 0)
      netRecv.value = Number(total.rx ?? 0)
      // Disk I/O total
      const disk = d.disk ?? {}
      const total2 = (disk.total ?? {}) as any
      diskRead.value = Number(total2.read_byte ?? 0)
      diskWrite.value = Number(total2.write_byte ?? 0)
      lastUpdate.value = new Date().toLocaleTimeString()
    }
  } catch (e) {
    // 静默失败，保留旧值
  }
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
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i]
}

function formatSpeed(n?: number) {
  return formatBytes(n) + '/s'
}

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

async function gotoFiles() {
  router.push('/files')
}

async function logout() {
  try {
    await dsm.logout()
  } catch {}
  dsm.synoToken = ''
  dsm.sid = ''
  router.replace('/servers')
}
</script>

<template>
  <el-container class="page">
    <el-header>
      <div class="header">
        <h2>SynoLink · 监控</h2>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span style="color:#909399; font-size:12px;">更新于 {{ lastUpdate || '—' }}</span>
          <el-button @click="refreshAll" :loading="loading">刷新</el-button>
          <el-button @click="gotoFiles">文件</el-button>
          <el-button @click="router.push('/album')">相册</el-button>
          <el-button @click="router.push('/videos')">视频集</el-button>
          <el-button type="danger" @click="logout">注销</el-button>
        </div>
      </div>
    </el-header>
    <el-main v-loading="loading">
      <div class="grid">
        <el-card shadow="hover">
          <div class="title">CPU 使用率</div>
          <el-progress type="dashboard" :percentage="cpuPct" :color="pctColor(cpuPct)" />
        </el-card>
        <el-card shadow="hover">
          <div class="title">内存使用</div>
          <el-progress type="dashboard" :percentage="memPct" :color="pctColor(memPct)" />
          <div class="sub">{{ formatBytes(memUsed) }} / {{ formatBytes(memTotal) }}</div>
        </el-card>
        <el-card shadow="hover">
          <div class="title">网络 (总)</div>
          <div class="row"><span>↑ 发送</span><b>{{ formatSpeed(netSend) }}</b></div>
          <div class="row"><span>↓ 接收</span><b>{{ formatSpeed(netRecv) }}</b></div>
        </el-card>
        <el-card shadow="hover">
          <div class="title">磁盘 I/O</div>
          <div class="row"><span>读取</span><b>{{ formatSpeed(diskRead) }}</b></div>
          <div class="row"><span>写入</span><b>{{ formatSpeed(diskWrite) }}</b></div>
        </el-card>
        <el-card shadow="hover" v-for="v in volumes" :key="v.id ?? v.volume_path ?? v.fs_type">
          <div class="title">存储卷 {{ v.volume_path ?? v.id }}</div>
          <el-progress :percentage="volPct(v)" :color="pctColor(volPct(v))" />
          <div class="sub">{{ formatBytes(Number(v.used ?? 0)) }} / {{ formatBytes(Number(v.size ?? v.total ?? 0)) }} · {{ v.fs_type ?? '' }}</div>
        </el-card>
        <el-card shadow="hover">
          <div class="title">快捷信息</div>
          <div class="row"><span>共享文件夹</span><b>{{ sharesCount }}</b></div>
          <div class="row"><span>可用 API</span><b>{{ apisCount }}</b></div>
          <div class="row"><span>账号</span><b>{{ app.accounts.find(a => a.id === app.currentAccountId)?.account || '—' }}</b></div>
          <div class="row"><span>SynoToken</span><b>{{ dsm.synoToken ? '已注入' : '未下发' }}</b></div>
        </el-card>
      </div>
    </el-main>
  </el-container>
</template>

<style scoped>
.page { height: 100vh; }
.header { display: flex; align-items: center; justify-content: space-between; height: 60px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.title { font-weight: 600; margin-bottom: 12px; color: #303133; }
.sub { margin-top: 8px; color: #909399; font-size: 12px; text-align: center; }
.row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #ebeef5; }
.row:last-child { border-bottom: 0; }
.row span { color: #606266; }
.row b { color: #303133; }
</style>
