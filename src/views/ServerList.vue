<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetch } from '@tauri-apps/plugin-http'
import { useAppStore } from '../stores/app'
import type { ServerConfig } from '../stores/app'
import { useIsMobile } from '../composables/useIsMobile'
import { confirm } from '../utils/feedback'

const router = useRouter()
const app = useAppStore()
const isMobile = useIsMobile()

const status = ref<Record<string, 'unknown' | 'online' | 'offline'>>({})

onMounted(async () => {
  await app.load()
  checkAll()
})

async function checkAll() {
  for (const s of app.servers) {
    status.value[s.id] = 'unknown'
    checkServer(s)
  }
}

async function checkServer(s: ServerConfig) {
  const url = `${s.protocol}://${s.host}:${s.port}/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query`
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const resp = await fetch(url, {
      signal: ctrl.signal,
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    } as any)
    clearTimeout(timer)
    status.value[s.id] = resp.ok ? 'online' : 'offline'
  } catch {
    status.value[s.id] = 'offline'
  }
}

const list = computed(() => app.servers)

function add() {
  router.push('/add-server')
}

function pick(serverId: string) {
  router.push(`/login/${serverId}`)
}

async function remove(id: string) {
  const ok = await confirm('确认删除该服务器？对应账号也会一并删除', '提示', { danger: true })
  if (ok) await app.removeServer(id)
}
</script>

<template>
  <!-- 桌面端 -->
  <div v-if="!isMobile" class="page">
    <header class="hero">
      <div class="hero-text">
        <h1>SynoLink</h1>
        <p>选择一台服务器开始</p>
      </div>
      <el-button type="primary" @click="add">
        <el-icon style="margin-right: 4px"><Plus /></el-icon>
        添加服务器
      </el-button>
    </header>

    <main class="body">
      <div v-if="list.length === 0" class="empty">
        <div class="empty-icon">
          <el-icon :size="28"><Monitor /></el-icon>
        </div>
        <p class="empty-title">还没有服务器</p>
        <p class="empty-sub">添加一台群晖 NAS 开始使用</p>
        <el-button type="primary" @click="add" style="margin-top: 12px">
          <el-icon style="margin-right: 4px"><Plus /></el-icon>
          添加服务器
        </el-button>
      </div>

      <div v-for="s in list" :key="s.id" class="server-card" @click="pick(s.id)">
        <div class="card-icon">
          <el-icon :size="24"><Monitor /></el-icon>
          <span class="status-dot" :class="status[s.id] || 'unknown'" />
        </div>
        <div class="card-info">
          <div class="card-name">{{ s.name || s.host }}</div>
          <div class="card-url">{{ s.protocol }}://{{ s.host }}:{{ s.port }}</div>
          <div class="card-remark" v-if="s.remark">{{ s.remark }}</div>
        </div>
        <div class="card-actions">
          <el-button type="primary" size="small" @click.stop="pick(s.id)">连接</el-button>
          <el-button size="small" circle @click.stop="remove(s.id)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>
    </main>
  </div>

  <!-- 移动端 -->
  <div v-else class="m-page">
    <van-nav-bar title="SynoLink" fixed placeholder safe-area-inset-top>
      <template #right>
        <van-icon name="plus" size="20" @click="add" />
      </template>
    </van-nav-bar>

    <div v-if="list.length === 0" class="m-empty">
      <van-empty description="还没有服务器">
        <van-button round type="primary" @click="add">添加服务器</van-button>
      </van-empty>
    </div>

    <div v-else class="m-srv-list">
      <van-swipe-cell v-for="s in list" :key="s.id">
        <div class="m-srv-row" @click="pick(s.id)">
          <div class="m-srv-icon-wrap">
            <div
              class="m-srv-icon"
              :style="{ background: 'linear-gradient(135deg, #5B8CFF, #3163E5)' }"
            >
              <van-icon name="cluster-o" size="22" color="white" />
            </div>
            <span class="m-status-dot" :class="status[s.id] || 'unknown'" />
          </div>
          <div class="m-srv-info">
            <div class="m-srv-name">{{ s.name || s.host }}</div>
            <div class="m-srv-url">{{ s.protocol }}://{{ s.host }}:{{ s.port }}</div>
            <div v-if="s.remark" class="m-srv-remark">{{ s.remark }}</div>
          </div>
          <van-icon name="arrow" size="14" color="#c0c4cc" class="m-srv-arrow" />
        </div>
        <template #right>
          <van-button square type="danger" text="删除" class="m-srv-del" @click="remove(s.id)" />
        </template>
      </van-swipe-cell>
    </div>

    <div v-if="list.length" class="m-tip">左滑可删除</div>
  </div>
</template>

<style scoped>
/* Desktop */
.page {
  height: 100%; padding: 24px 28px; max-width: 640px; margin: 0 auto;
  display: flex; flex-direction: column;
}
.hero {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 0 20px; border-bottom: var(--sl-border); margin-bottom: 20px;
}
.hero-text h1 { margin: 0; font-size: 20px; font-weight: 600; color: var(--el-text-color-primary); }
.hero-text p { margin: 2px 0 0; font-size: 13px; color: var(--el-text-color-secondary); }
.body { flex: 1; overflow-y: auto; }
.empty { text-align: center; padding: 60px 0; }
.empty-icon {
  width: 56px; height: 56px; margin: 0 auto 12px;
  border-radius: var(--sl-radius-sm);
  background: var(--el-color-primary-light-9);
  display: flex; align-items: center; justify-content: center; color: var(--sl-primary);
}
.empty-title { font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); margin: 0; }
.empty-sub { font-size: 13px; color: var(--el-text-color-secondary); margin: 4px 0 0; }
.server-card {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  background: var(--sl-bg-card); border-radius: var(--sl-radius-sm); border: var(--sl-border);
  margin-bottom: 8px; cursor: pointer; transition: border-color var(--sl-transition-fast);
}
.server-card:hover { border-color: var(--sl-primary); }
.card-icon {
  width: 36px; height: 36px; border-radius: var(--sl-radius-sm);
  background: var(--el-color-primary-light-9); color: var(--sl-primary);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; position: relative;
}
.status-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid var(--sl-bg-card); background: #909399;
}
.status-dot.online { background: #10B981; }
.status-dot.offline { background: #EF4444; }
.status-dot.unknown { background: #909399; }
.card-info { flex: 1; min-width: 0; }
.card-name { font-size: 14px; font-weight: 500; color: var(--el-text-color-primary); }
.card-url { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.card-remark { font-size: 12px; color: var(--el-text-color-placeholder); margin-top: 2px; }
.card-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }

/* Mobile */
.m-page {
  min-height: 100vh;
  background: var(--sl-bg-page);
  padding-bottom: var(--sl-safe-bottom);
  max-width: 100vw;
  overflow-x: hidden;
}
.m-empty { padding-top: 60px; }

.m-srv-list {
  background: var(--sl-bg-card);
  border-radius: 12px;
  margin: 12px;
  overflow: hidden;
}
.m-srv-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--sl-bg-card);
  cursor: pointer;
  min-width: 0;
}
.m-srv-row:last-child { border-bottom: none; }
.m-srv-row:active { background: var(--el-fill-color-light); }

.m-srv-icon-wrap {
  position: relative;
  flex-shrink: 0;
}
.m-srv-icon {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.m-status-dot {
  position: absolute; bottom: -2px; right: -2px;
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid var(--sl-bg-card); background: #909399;
}
.m-status-dot.online { background: #10B981; }
.m-status-dot.offline { background: #EF4444; }

.m-srv-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-srv-name {
  font-size: 15px; font-weight: 500;
  color: var(--el-text-color-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.m-srv-url {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.m-srv-remark {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.m-srv-arrow { flex-shrink: 0; }
.m-srv-del { height: 100%; }
.m-tip { text-align: center; color: var(--el-text-color-placeholder); font-size: 12px; margin-top: 16px; }
</style>
