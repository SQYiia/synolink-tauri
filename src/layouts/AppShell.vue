<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { dsm, setSessionRecoverer } from '../api/dsm'
import { useAppStore } from '../stores/app'
import { downloadQueue, cancelTask, removeTask, clearCompleted } from '../composables/useDownloadQueue'
import { formatBytes } from '../utils/format'

const router = useRouter()
const app = useAppStore()
const booting = ref(true)

// 全局搜索
const globalSearchOpen = ref(false)
const globalSearchQuery = ref('')
const globalSearchResults = ref<any[]>([])
const globalSearching = ref(false)
const downloadDrawerOpen = ref(false)

async function doGlobalSearch() {
  if (!globalSearchQuery.value.trim()) return
  globalSearching.value = true
  globalSearchResults.value = []
  try {
    const start = await dsm.searchStart('/', globalSearchQuery.value, true)
    if (!start.success || !start.data?.taskid) {
      ElMessage.error('搜索失败')
      return
    }
    const taskid = start.data.taskid
    const MAX_WAIT = 15000
    const POLL = 500
    const t0 = Date.now()
    let results: any[] = []
    while (Date.now() - t0 < MAX_WAIT) {
      await new Promise((r) => setTimeout(r, POLL))
      const list = await dsm.searchList(taskid, { limit: 200 })
      if (list.success) {
        const data = list.data as any
        results = data?.files ?? []
        if (data?.finished) break
      }
    }
    await dsm.searchStop(taskid).catch(() => {})
    globalSearchResults.value = results
    if (!results.length) ElMessage.info('未找到匹配文件')
  } finally {
    globalSearching.value = false
  }
}

function goToResult(item: any) {
  globalSearchOpen.value = false
  // Navigate to Files view with the folder of the result
  const filePath = item.path as string
  const folder = filePath.substring(0, filePath.lastIndexOf('/')) || '/'
  router.push({ path: '/app/files', query: { open: folder } })
}

/** 根据当前保存的账户 重建 DSM 会话；返回是否成功。 */
async function reloginFromStore(): Promise<boolean> {
  const acc = app.accounts.find(a => a.id === app.currentAccountId)
  const srv = app.servers.find(s => s.id === app.currentServerId)
  if (!acc || !srv) return false
  dsm.baseUrl = `${srv.protocol}://${srv.host}:${srv.port}`
  try {
    if (!Object.keys(dsm.apiInfo).length) {
      await dsm.loadApiInfo()
    }
    const res = await dsm.login({ account: acc.account, passwd: acc.password })
    return !!res.success
  } catch {
    return false
  }
}

onMounted(async () => {
  await app.load()
  // 注册全局会话恢复器：dsm.request 遇到 code=119 会自动回调
  setSessionRecoverer(reloginFromStore)

  // 刷新 / 重启后单例被重置，自动重建会话
  if (!dsm.sid) {
    if (!app.currentAccountId || !app.currentServerId) {
      router.replace('/servers')
      return
    }
    const ok = await reloginFromStore()
    if (!ok) {
      ElMessage.warning('会话已过期，请重新登录')
      router.replace(`/login/${app.currentServerId}`)
      return
    }
    ElMessage.success({ message: '会话已自动恢复', duration: 2000 })
  }
  booting.value = false
})

const tabs = [
  { to: '/app/files', label: '文件', icon: 'Folder' },
  { to: '/app/album', label: '相册', icon: 'Picture' },
  { to: '/app/videos', label: '视频', icon: 'VideoCamera' },
  { to: '/app/me', label: '我的', icon: 'User' },
]
</script>

<template>
  <div class="app-shell">
    <main class="content">
      <div v-if="booting" class="booting">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>正在恢复会话…</span>
      </div>
      <RouterView v-else v-slot="{ Component }">
        <Transition name="page-fade" mode="out-in">
          <keep-alive :max="3">
            <component :is="Component" :key="$route.path" />
          </keep-alive>
        </Transition>
      </RouterView>
    </main>
    <nav class="tabbar">
      <RouterLink
        v-for="t in tabs"
        :key="t.to"
        :to="t.to"
        class="tab"
        active-class="active"
      >
        <el-icon :size="22">
          <component :is="t.icon" />
        </el-icon>
        <span>{{ t.label }}</span>
      </RouterLink>
      <a class="tab" @click="globalSearchOpen = true">
        <el-icon :size="22"><Search /></el-icon>
        <span>搜索</span>
      </a>
      <a class="tab" @click="downloadDrawerOpen = true">
        <el-icon :size="22"><Download /></el-icon>
        <span>下载</span>
      </a>
    </nav>

    <!-- 全局搜索对话框 -->
    <el-dialog v-model="globalSearchOpen" title="全局搜索" width="90%" top="5vh" destroy-on-close>
      <div class="gsearch-bar">
        <el-input
          v-model="globalSearchQuery"
          placeholder="输入关键词，搜索所有文件夹"
          clearable
          @keyup.enter="doGlobalSearch"
        />
        <el-button type="primary" :loading="globalSearching" @click="doGlobalSearch">搜索</el-button>
      </div>
      <div v-if="globalSearchResults.length" class="gsearch-results">
        <div
          v-for="r in globalSearchResults"
          :key="r.path"
          class="gsearch-item"
          @click="goToResult(r)"
        >
          <el-icon :size="16"><Document /></el-icon>
          <div class="gsearch-info">
            <div class="gsearch-name">{{ r.name }}</div>
            <div class="gsearch-path">{{ r.path }}</div>
          </div>
        </div>
      </div>
      <div v-else-if="!globalSearching && globalSearchQuery" class="gsearch-empty">
        暂无结果
      </div>
    </el-dialog>

    <!-- 下载队列 -->
    <el-drawer v-model="downloadDrawerOpen" title="下载队列" direction="btt" size="45%">
      <div class="dl-toolbar" v-if="downloadQueue.length">
        <el-button size="small" @click="clearCompleted">清除已完成</el-button>
      </div>
      <div v-if="!downloadQueue.length" class="gsearch-empty">暂无下载任务</div>
      <div v-for="t in downloadQueue" :key="t.id" class="dl-item">
        <div class="dl-info">
          <div class="dl-name">{{ t.name }}</div>
          <div class="dl-meta">
            <span v-if="t.status === 'downloading'">{{ formatBytes(t.loaded) }} / {{ t.size ? formatBytes(t.size) : '未知' }}</span>
            <span v-else-if="t.status === 'done'">已完成</span>
            <span v-else-if="t.status === 'error'" class="dl-error">失败: {{ t.error }}</span>
            <span v-else-if="t.status === 'cancelled'">已取消</span>
            <span v-else>排队中</span>
          </div>
          <el-progress
            v-if="t.status === 'downloading' && t.size"
            :percentage="Math.round((t.loaded / t.size) * 100)"
            :stroke-width="4"
            :show-text="false"
            style="margin-top: 4px"
          />
        </div>
        <div class="dl-actions">
          <el-button v-if="t.status === 'downloading' || t.status === 'queued'" size="small" type="warning" @click="cancelTask(t.id)">取消</el-button>
          <el-button v-else size="small" @click="removeTask(t.id)">移除</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--el-bg-color-page);
}
.content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.booting {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
.tabbar {
  flex: 0 0 auto;
  height: 64px;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  background: var(--sl-surface);
  backdrop-filter: blur(var(--sl-surface-blur));
  -webkit-backdrop-filter: blur(var(--sl-surface-blur));
  box-shadow: 0 -1px 12px rgba(0, 0, 0, 0.04);
  border-top: none;
  padding: 0 4px;
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--el-text-color-secondary);
  text-decoration: none;
  font-size: 11px;
  transition: color var(--sl-transition-normal);
  position: relative;
}
.tab:hover {
  color: var(--sl-primary);
}
.tab .el-icon {
  padding: 5px 14px;
  border-radius: var(--sl-radius-pill);
  transition: background var(--sl-transition-normal), color var(--sl-transition-normal);
}
.tab.active {
  color: var(--sl-primary);
}
.tab.active .el-icon {
  background: var(--el-color-primary-light-9);
  color: var(--sl-primary);
}
.tab.active span {
  font-weight: 600;
}

/* Global search */
.gsearch-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.gsearch-results { max-height: 60vh; overflow-y: auto; }
.gsearch-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  cursor: pointer; border-radius: 6px; transition: background 0.15s;
}
.gsearch-item:hover { background: var(--el-fill-color-light); }
.gsearch-info { flex: 1; min-width: 0; }
.gsearch-name { font-size: 14px; font-weight: 500; color: var(--el-text-color-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gsearch-path { font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gsearch-empty { text-align: center; padding: 40px 0; color: var(--el-text-color-secondary); }

/* Download queue */
.dl-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
.dl-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.dl-info { flex: 1; min-width: 0; }
.dl-name { font-size: 14px; font-weight: 500; color: var(--el-text-color-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl-meta { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.dl-error { color: var(--el-color-danger); }
.dl-actions { flex-shrink: 0; }
</style>
