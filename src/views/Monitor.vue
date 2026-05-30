<script setup lang="ts">
import { useRouter } from 'vue-router'
import { onMounted, ref } from 'vue'
import { dsm } from '../api/dsm'
import { formatBytes, formatSpeed } from '../utils/format'
import { useIsMobile } from '../composables/useIsMobile'
import { useSystemMonitor } from '../composables/useSystemMonitor'

const router = useRouter()
const isMobile = useIsMobile()

const m = useSystemMonitor()

const refreshing = ref(false)
async function onPullRefresh() {
  refreshing.value = true
  try { await m.refreshAll() } finally { refreshing.value = false }
}

onMounted(() => {
  if (!dsm.sid) router.replace('/servers')
})

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

function volPct(v: any) {
  const used = Number(v?._used ?? v?.used ?? 0)
  const size = Number(v?._size ?? v?.size ?? v?.total ?? 0)
  return size ? Math.round((used / size) * 100) : 0
}
function pctColor(p: number) {
  if (p >= 90) return 'hsl(0 84% 60%)'
  if (p >= 70) return 'hsl(38 92% 50%)'
  return 'hsl(217 91% 60%)'
}
</script>

<template>
  <!-- 桌面端 -->
  <div v-if="!isMobile" class="mon-page" v-loading="m.loading.value">
    <header class="mon-head">
      <h2 class="mon-title">性能监控</h2>
      <span class="mon-sub">{{ m.lastUpdate.value || '—' }}</span>
    </header>

    <!-- 状态卡片 -->
    <div class="grid">
      <div class="stat-card">
        <div class="stat-label">CPU</div>
        <div class="stat-number">{{ m.cpuPct.value }}<span class="stat-unit">%</span></div>
        <svg v-if="m.cpuHistory.value.length > 1" class="sparkline" viewBox="0 0 120 30" preserveAspectRatio="none">
          <path :d="sparklinePath(m.cpuHistory.value, 120, 30)" fill="none" stroke="hsl(217 91% 60%)" stroke-width="1.5" />
        </svg>
      </div>
      <div class="stat-card">
        <div class="stat-label">内存</div>
        <div class="stat-number">{{ m.memPct.value }}<span class="stat-unit">%</span></div>
        <div class="stat-detail">{{ formatBytes(m.memUsed.value) }} / {{ formatBytes(m.memTotal.value) }}</div>
        <svg v-if="m.memHistory.value.length > 1" class="sparkline" viewBox="0 0 120 30" preserveAspectRatio="none">
          <path :d="sparklinePath(m.memHistory.value, 120, 30)" fill="none" stroke="hsl(262 83% 58%)" stroke-width="1.5" />
        </svg>
      </div>
      <div class="stat-card">
        <div class="stat-label">网络</div>
        <div class="stat-rows">
          <div class="stat-row"><span>↑</span><b>{{ formatSpeed(m.netSend.value) }}</b></div>
          <div class="stat-row"><span>↓</span><b>{{ formatSpeed(m.netRecv.value) }}</b></div>
        </div>
        <svg v-if="m.netSendHistory.value.length > 1" class="sparkline" viewBox="0 0 120 30" preserveAspectRatio="none">
          <path :d="sparklinePath(m.netSendHistory.value, 120, 30)" fill="none" stroke="hsl(142 71% 45%)" stroke-width="1.5" stroke-opacity="0.5" />
          <path :d="sparklinePath(m.netRecvHistory.value, 120, 30)" fill="none" stroke="hsl(142 71% 45%)" stroke-width="1.5" />
        </svg>
      </div>
      <div class="stat-card">
        <div class="stat-label">磁盘 I/O</div>
        <div class="stat-rows">
          <div class="stat-row"><span>读</span><b>{{ formatSpeed(m.diskRead.value) }}</b></div>
          <div class="stat-row"><span>写</span><b>{{ formatSpeed(m.diskWrite.value) }}</b></div>
        </div>
      </div>
    </div>

    <div class="section-title" v-if="m.volumes.value.length"><span>存储卷</span></div>
    <div class="vol-list">
      <div v-for="v in m.volumes.value" :key="v.id ?? v.volume_path ?? v._name" class="vol-card">
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

    <div class="section-title" v-if="m.disks.value.length"><span>磁盘健康</span></div>
    <div class="vol-list">
      <div v-for="d in m.disks.value" :key="d.id ?? d._name" class="disk-card">
        <div class="vol-head">
          <span class="vol-name">{{ d._name }}</span>
          <span
            class="disk-status"
            :class="String(d._status).toLowerCase() === 'normal' ? 'ok' : 'warn'"
          >{{ d._status || '未知' }}</span>
        </div>
        <div class="vol-detail">
          <span v-if="d._model">{{ d._model }}</span>
          <span v-if="d._temp"> · {{ d._temp }}°C</span>
          <span v-if="d._size"> · {{ formatBytes(d._size) }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- 移动端 -->
  <div v-else class="m-mon">
    <van-pull-refresh v-model="refreshing" @refresh="onPullRefresh">
      <!-- 状态 grid -->
      <div class="m-stat-grid">
        <div class="m-stat-card">
          <div class="m-stat-label">CPU</div>
          <div class="m-stat-number">{{ m.cpuPct.value }}<span class="m-stat-unit">%</span></div>
          <svg v-if="m.cpuHistory.value.length > 1" class="m-spark" viewBox="0 0 100 24" preserveAspectRatio="none">
            <path :d="sparklinePath(m.cpuHistory.value, 100, 24)" fill="none" stroke="hsl(217 91% 60%)" stroke-width="1.5" />
          </svg>
        </div>
        <div class="m-stat-card">
          <div class="m-stat-label">内存</div>
          <div class="m-stat-number">{{ m.memPct.value }}<span class="m-stat-unit">%</span></div>
          <div class="m-stat-sub">{{ formatBytes(m.memUsed.value) }}</div>
        </div>
        <div class="m-stat-card">
          <div class="m-stat-label">↑ 上行</div>
          <div class="m-stat-number-sm">{{ formatSpeed(m.netSend.value) }}</div>
        </div>
        <div class="m-stat-card">
          <div class="m-stat-label">↓ 下行</div>
          <div class="m-stat-number-sm">{{ formatSpeed(m.netRecv.value) }}</div>
        </div>
        <div class="m-stat-card">
          <div class="m-stat-label">读</div>
          <div class="m-stat-number-sm">{{ formatSpeed(m.diskRead.value) }}</div>
        </div>
        <div class="m-stat-card">
          <div class="m-stat-label">写</div>
          <div class="m-stat-number-sm">{{ formatSpeed(m.diskWrite.value) }}</div>
        </div>
      </div>

      <!-- 存储卷 -->
      <template v-if="m.volumes.value.length">
        <div class="m-group-title"><span>存储</span></div>
        <van-cell-group inset>
          <van-cell v-for="v in m.volumes.value" :key="v.id ?? v.volume_path ?? v._name">
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

      <!-- 磁盘 -->
      <template v-if="m.disks.value.length">
        <div class="m-group-title"><span>磁盘</span></div>
        <van-cell-group inset>
          <van-cell v-for="d in m.disks.value" :key="d.id ?? d._name">
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

      <div class="m-mon-foot">最近更新 {{ m.lastUpdate.value || '—' }}</div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
/* Desktop */
.mon-page { padding: 24px 28px; max-width: 1100px; margin: 0 auto; }
.mon-head { display: flex; align-items: baseline; justify-content: space-between; padding: 8px 0 18px; border-bottom: 1px solid hsl(var(--border)); margin-bottom: 16px; }
.mon-title { margin: 0; font-size: 18px; font-weight: 600; color: hsl(var(--foreground)); }
.mon-sub { font-size: 12px; color: hsl(var(--muted-foreground)); }
.section-title { margin: 24px 0 10px; font-size: 12px; font-weight: 500; color: hsl(var(--muted-foreground)); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.stat-card { padding: 14px 16px; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 10px; }
.stat-label { font-size: 11px; font-weight: 500; color: hsl(var(--muted-foreground)); }
.stat-number { font-size: 28px; font-weight: 700; color: hsl(var(--foreground)); margin-top: 4px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.stat-unit { font-size: 14px; font-weight: 500; margin-left: 2px; color: hsl(var(--muted-foreground)); }
.stat-detail { font-size: 12px; color: hsl(var(--muted-foreground)); margin-top: 4px; font-variant-numeric: tabular-nums; }
.stat-rows { margin-top: 6px; }
.stat-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; color: hsl(var(--foreground)); }
.stat-row b { font-weight: 600; }
.sparkline { width: 100%; height: 24px; margin-top: 8px; }
.vol-list { display: flex; flex-direction: column; gap: 8px; }
.vol-card, .disk-card { background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 10px; padding: 12px 14px; }
.vol-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.vol-name { font-weight: 500; font-size: 13px; color: hsl(var(--foreground)); }
.vol-pct { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); font-variant-numeric: tabular-nums; }
.vol-bar { height: 4px; border-radius: 2px; background: hsl(var(--muted)); overflow: hidden; }
.vol-fill { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
.vol-detail { font-size: 12px; color: hsl(var(--muted-foreground)); margin-top: 6px; font-variant-numeric: tabular-nums; }
.disk-status { font-size: 11px; font-weight: 500; padding: 2px 7px; border-radius: 5px; border: 1px solid hsl(var(--border)); }
.disk-status.ok { background: hsl(142 71% 45% / 0.08); color: hsl(142 71% 30%); border-color: hsl(142 71% 45% / 0.2); }
.disk-status.warn { background: hsl(var(--destructive) / 0.08); color: hsl(var(--destructive)); border-color: hsl(var(--destructive) / 0.2); }

/* Mobile (shadcn) */
.m-mon { min-height: 100%; background: hsl(var(--background)); padding-bottom: 30px; }
.m-stat-grid {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin: 12px;
}
.m-stat-card {
  padding: 12px 14px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
}
.m-stat-label { font-size: 11px; font-weight: 500; color: hsl(var(--muted-foreground)); letter-spacing: 0.02em; }
.m-stat-number {
  font-size: 22px; font-weight: 700; color: hsl(var(--foreground));
  margin-top: 2px; line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.m-stat-number-sm {
  font-size: 15px; font-weight: 600; color: hsl(var(--foreground));
  margin-top: 4px; line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.m-stat-unit { font-size: 12px; font-weight: 500; margin-left: 2px; color: hsl(var(--muted-foreground)); }
.m-stat-sub { font-size: 11px; color: hsl(var(--muted-foreground)); margin-top: 4px; font-variant-numeric: tabular-nums; }
.m-spark { width: 100%; height: 22px; margin-top: 6px; }

.m-group-title {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 24px 6px;
  font-size: 12px; font-weight: 500; color: hsl(var(--muted-foreground));
}

.m-vol-row { display: flex; justify-content: space-between; align-items: center; }
.m-vol-name { font-size: 14px; font-weight: 500; color: hsl(var(--foreground)); }
.m-vol-pct { font-size: 13px; color: hsl(var(--foreground)); font-weight: 600; font-variant-numeric: tabular-nums; }
.m-vol-detail { font-size: 12px; color: hsl(var(--muted-foreground)); margin-top: 4px; font-variant-numeric: tabular-nums; }
.m-disk-status {
  font-size: 11px; font-weight: 500; padding: 2px 7px; border-radius: 5px;
  border: 1px solid hsl(var(--border));
}
.m-disk-status.ok { background: hsl(142 71% 45% / 0.08); color: hsl(142 71% 30%); border-color: hsl(142 71% 45% / 0.2); }
.m-disk-status.warn { background: hsl(var(--destructive) / 0.08); color: hsl(var(--destructive)); border-color: hsl(var(--destructive) / 0.2); }
.m-mon-foot { text-align: center; padding: 24px 0 16px; font-size: 11px; color: hsl(var(--muted-foreground) / 0.7); }
</style>
