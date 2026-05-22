<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { dsm, setSessionRecoverer } from '../api/dsm'
import { useAppStore } from '../stores/app'
import { downloadQueue, cancelTask, removeTask, clearCompleted, downloadDir, revealSavedFile } from '../composables/useDownloadQueue'
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
  { to: '/app/downloads', label: '下载站', icon: 'Connection' },
  { to: '/app/me', label: '我的', icon: 'User' },
]
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-nav">
        <RouterLink
          v-for="t in tabs"
          :key="t.to"
          :to="t.to"
          class="nav-item"
          active-class="active"
        >
          <el-icon :size="20">
            <component :is="t.icon" />
          </el-icon>
          <span>{{ t.label }}</span>
        </RouterLink>
      </div>
      <div class="sidebar-bottom">
        <a class="nav-item" @click="globalSearchOpen = true">
          <el-icon :size="20"><Search /></el-icon>
          <span>搜索</span>
        </a>
        <a class="nav-item" @click="downloadDrawerOpen = true">
          <el-icon :size="20"><Download /></el-icon>
          <span>下载</span>
        </a>
      </div>
    </aside>
    <main class="content">
      <div v-if="booting" class="booting">
        <el-icon class="is-loading" :size="20"><Loading /></el-icon>
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

    <!-- 全局搜索对话框 -->
    <el-dialog v-model="globalSearchOpen" title="全局搜索" width="560px" top="8vh" destroy-on-close>
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
    <el-drawer v-model="downloadDrawerOpen" title="下载队列" direction="rtl" size="360px">
      <div class="dl-savedir">
        <div class="dl-savedir-label">保存位置</div>
        <div class="dl-savedir-path" :title="downloadDir">{{ downloadDir || '默认 Downloads' }}</div>
        <el-button v-if="downloadDir" size="small" link @click="revealSavedFile(downloadDir)">打开</el-button>
      </div>
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
          <div v-if="t.status === 'done' && t.savePath" class="dl-savepath" :title="t.savePath">{{ t.savePath }}</div>
          <el-progress
            v-if="t.status === 'downloading' && t.size"
            :percentage="Math.round((t.loaded / t.size) * 100)"
            :stroke-width="3"
            :show-text="false"
            style="margin-top: 4px"
          />
        </div>
        <div class="dl-actions">
          <el-button v-if="t.status === 'downloading' || t.status === 'queued'" size="small" type="warning" @click="cancelTask(t.id)">取消</el-button>
          <template v-else>
            <el-button v-if="t.status === 'done' && t.savePath" size="small" type="primary" link @click="revealSavedFile(t.savePath)">打开</el-button>
            <el-button size="small" @click="removeTask(t.id)">移除</el-button>
          </template>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: row;
  height: 100vh;
  background: var(--el-bg-color-page);
}

/* Sidebar */
.sidebar {
  width: 56px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--sl-bg-card);
  border-right: var(--sl-border);
  padding: 8px 0;
}
.sidebar-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}
.sidebar-bottom {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  border-top: var(--sl-border);
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 8px 0;
  margin: 0 6px;
  border-radius: var(--sl-radius-sm);
  color: var(--el-text-color-secondary);
  text-decoration: none;
  font-size: 10px;
  cursor: pointer;
  transition: background var(--sl-transition-fast), color var(--sl-transition-fast);
  position: relative;
}
.nav-item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.nav-item.active {
  color: var(--sl-primary);
  background: var(--el-color-primary-light-9);
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--sl-primary);
}

/* Content */
.content {
  flex: 1;
  overflow: auto;
  min-width: 0;
}
.booting {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

/* Global search */
.gsearch-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.gsearch-results { max-height: 60vh; overflow-y: auto; }
.gsearch-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  cursor: pointer; border-radius: var(--sl-radius-sm); transition: background var(--sl-transition-fast);
}
.gsearch-item:hover { background: var(--el-fill-color-light); }
.gsearch-info { flex: 1; min-width: 0; }
.gsearch-name { font-size: 13px; font-weight: 500; color: var(--el-text-color-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gsearch-path { font-size: 11px; color: var(--el-text-color-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gsearch-empty { text-align: center; padding: 40px 0; color: var(--el-text-color-secondary); font-size: 13px; }

/* Download queue */
.dl-savedir {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; margin-bottom: 10px;
  background: var(--el-fill-color-light);
  border-radius: var(--sl-radius-sm);
}
.dl-savedir-label { font-size: 11px; color: var(--el-text-color-secondary); flex-shrink: 0; }
.dl-savedir-path {
  flex: 1; min-width: 0;
  font-size: 12px; color: var(--el-text-color-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  direction: rtl; text-align: left;
}
.dl-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
.dl-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: var(--sl-border); }
.dl-info { flex: 1; min-width: 0; }
.dl-name { font-size: 13px; font-weight: 500; color: var(--el-text-color-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl-meta { font-size: 11px; color: var(--el-text-color-secondary); margin-top: 2px; }
.dl-savepath {
  font-size: 11px; color: var(--el-text-color-secondary); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  direction: rtl; text-align: left;
}
.dl-error { color: var(--el-color-danger); }
.dl-actions { flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
</style>
