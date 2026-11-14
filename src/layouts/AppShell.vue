<script setup lang="ts">
import { onMounted as mountTransfer, onUnmounted as unmountTransfer } from 'vue'
import { invoke as invokeDelivery } from '@tauri-apps/api/core'
import { listen as listenBackup, type UnlistenFn as BackupUnlisten } from '@tauri-apps/api/event'
let backupUnlisten:BackupUnlisten|undefined
onUnmounted(()=>backupUnlisten?.())
import { isAndroid } from '../utils/platform'
async function deliver(id:string,share:boolean){try{await invokeDelivery('deliver_download',{taskId:id,share})}catch{alert('文件导出失败，请检查文件状态或存储权限')}}

import { onMounted, onUnmounted, watch, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { dsm, setSessionRecoverer } from '../api/dsm'
import { useAppStore } from '../stores/app'
import { downloadQueue, retryTask, cancelTask, removeTask, clearCompleted, downloadDir, revealSavedFile, chooseDownloadDir, resetDownloadDir, askEveryDownload, setAskEveryDownload, localPickerOpen, resolveLocalPicker } from '../composables/useDownloadQueue'
import FileOperations from '../components/FileOperations.vue'
import {identity,snapshotFileClient} from '../composables/useFileOperations'
import {searchSharedFolders} from '../utils/globalSearch'
import LocalFolderPicker from '../components/LocalFolderPicker.vue'
import { formatBytes } from '../utils/format'
import { useIsMobile } from '../composables/useIsMobile'
import { useInteractiveSwipeBack, swipeStyle, swipeClasses } from '../composables/useInteractiveSwipeBack'
import FolderIcon from '../components/FolderIcon.vue'

const route = useRoute()
const router = useRouter()
const app = useAppStore()
const booting = ref(true)
const isMobile = useIsMobile()

const globalSearchOpen = ref(false)
const globalSearchQuery = ref('')
const globalSearchResults = ref<any[]>([])
const globalSearching = ref(false)
const globalSearchError=ref('')
let globalSearchScope='',searchGeneration=0
let globalSearchController: AbortController | null = null
watch(globalSearchOpen, open => { if (!open){searchGeneration++;globalSearchController?.abort();globalSearching.value=false;globalSearchResults.value=[];globalSearchError.value=''} })
watch(()=>[app.currentServerId,app.currentAccountId],()=>{globalSearchController?.abort();globalSearchResults.value=[];globalSearchOpen.value=false})
onUnmounted(() => { globalSearchController?.abort(); setSessionRecoverer(null) })
const downloadDrawerOpen = ref(false)
const openTransfers=()=>{downloadDrawerOpen.value=true}
mountTransfer(()=>window.addEventListener('synolink-open-transfers',openTransfers))
unmountTransfer(()=>window.removeEventListener('synolink-open-transfers',openTransfers))

async function doGlobalSearch() {
  if (!globalSearchQuery.value.trim()) return
  globalSearchController?.abort()
  const controller = new AbortController()
  const generation=++searchGeneration,client=snapshotFileClient(),scope=identity(),sid=dsm.sid
  const valid=()=>generation===searchGeneration&&scope===identity()&&sid===dsm.sid&&!controller.signal.aborted
  globalSearchScope=scope;globalSearchError.value=''
  globalSearchController = controller
  globalSearching.value = true
  globalSearchResults.value = []
  try {
    const result=await searchSharedFolders(client,globalSearchQuery.value.trim(),controller.signal,valid)
    if(!valid())return
    globalSearchResults.value=result.files
    if(result.failed)globalSearchError.value=`${result.failed} 个共享文件夹未能完成搜索，请检查权限或连接。${result.files.length?'下方为已找到的结果。':''}`
    else if(!result.shares)globalSearchError.value='当前账号没有可搜索的共享文件夹'
  } catch (e: any) {
    if (valid()) globalSearchError.value=e.message ?? '搜索失败，请重试'
  } finally {
    if (globalSearchController === controller) globalSearching.value = false
  }
}

function goToResult(item: any) {
  if(globalSearchScope!==identity()){globalSearchOpen.value=false;return}
  globalSearchOpen.value = false
  const filePath = item.path as string
  const folder = filePath.substring(0, filePath.lastIndexOf('/')) || '/'
  router.push({ path: '/app/files', query: { open: item.isdir ? filePath : folder, selected: filePath } })
}

/** 根据当前保存的账户 重建 DSM 会话；返回是否成功。 */
async function reloginFromStore(): Promise<boolean> {
  const acc = app.accounts.find(a => a.id === app.currentAccountId)
  const srv = app.servers.find(s => s.id === app.currentServerId)
  if (!acc || !srv || !acc.password) return false
  dsm.baseUrl = `${srv.protocol}://${srv.host}:${srv.port}`
  dsm.allowInsecure = !!srv.allowInsecure
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
  setSessionRecoverer(async () => {
    const ok = await reloginFromStore()
    if (!ok) {
      ElMessage.warning('需要重新登录或完成两步验证')
      await router.replace(`/login/${app.currentServerId}`)
    }
    if(ok && isAndroid)void invokeDelivery("photo_backup_action",{action:"resume",config:null,sourceUrl:dsm.baseUrl,sourceAccount:dsm.account}).catch(()=>{})
    return ok
  })

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
  if(isAndroid){backupUnlisten=await listenBackup("photo-backup:open",()=>void router.push("/app/backups"));void invokeDelivery("photo_backup_action",{action:"resume",config:null,sourceUrl:dsm.baseUrl,sourceAccount:dsm.account}).catch(()=>{})}
})

const desktopTabs = [
  { to: '/app/dashboard', label: '概览', icon: 'HomeFilled', group: '工作区' },
  { to: '/app/applications', label: '应用中心', icon: 'Grid' },
  { to: '/app/files', label: '文件', icon: 'Folder' },
  { to: '/app/album', label: '相册', icon: 'Picture' },
  { to: '/app/videos', label: '视频', icon: 'VideoCamera' },
  { to: '/app/downloads', label: 'NAS 下载站', icon: 'Connection' },
  { to: '/app/monitor', label: '性能', icon: 'Odometer' },
  { to: '/app/vmm', label: '虚拟机', icon: 'Monitor' },
  { to: '/app/me', label: '设置', icon: 'User' },
]
const desktopGroups = [
  { label:'工作区', paths:['dashboard','files','drive','backups'] },
  { label:'媒体资料', paths:['album','videos'] },
  { label:'NAS 管理', paths:['applications','downloads','monitor','containers','vmm'] },
].map(group=>({...group,items:group.paths.map(path=>desktopTabs.find(tab=>tab.to==='/app/'+path)||({to:'/app/'+path,label:({drive:'Drive 文件',backups:'备份中心',containers:'容器管理'} as Record<string,string>)[path],icon:path==='drive'?'Folder':path==='backups'?'Connection':'Box'}))}))
const desktopServer = computed(()=>app.servers.find(server=>server.id===app.currentServerId)?.name || '当前 NAS')
const desktopAccount = computed(()=>app.accounts.find(account=>account.id===app.currentAccountId)?.account || dsm.account || '当前账号')
function desktopShortcut(event:KeyboardEvent){if(!isMobile.value&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();globalSearchOpen.value=true}}
onMounted(()=>window.addEventListener('keydown',desktopShortcut))
onUnmounted(()=>window.removeEventListener('keydown',desktopShortcut))

const mobileTabs = [
  { to: '/app/dashboard', label: '首页', icon: 'wap-home-o' },
  { to: '/app/files', label: '文件', icon: 'folder' },
  { to: '/app/album', label: '相册', icon: 'photo-o' },
  { to: '/app/monitor', label: '性能', icon: 'bar-chart-o' },
  { to: '/app/me', label: '设置', icon: 'setting-o' },
]

const activeTabIndex = computed(() => {
  const i = mobileTabs.findIndex(t => route.path.startsWith(t.to))
  return i === -1 ? 0 : i
})

// 全局边缘左滑返回：交互式跟手动画（仅移动端）
// canSwipe 决定能不能激活；fallback 决定无 BackHandler 时 router.back 是否合适
import { hasBackHandler } from '../composables/useInteractiveSwipeBack'
useInteractiveSwipeBack({
  canSwipe: () => {
    // 1. 页面级 BackHandler 自己说能（Files 深目录、Album 预览开着 等）
    if (hasBackHandler()) return true
    // 2. 不在 tab 根 且 history 有上一项可退 → 走 router.back 路径
    if (!route.meta?.tab && window.history.length > 1) return true
    return false
  },
  fallback: () => {
    if (route.meta?.tab) return false
    if (window.history.length > 1) router.back()
    return true
  },
})

const navTitle = computed(() => (route.meta?.title as string) || 'SynoLink')
const showNavBack = computed(() => !route.meta?.tab)
function navBack() {
  if (window.history.length > 1) router.back()
  else router.replace('/app/dashboard')
}
function onTabChange(i: number) {
  router.replace(mobileTabs[i].to)
}
</script>

<template>

  <div v-if="!isMobile" class="app-shell">
    <aside class="sidebar">
      <RouterLink class="sidebar-brand" to="/app/dashboard" aria-label="SynoLink 首页"><img class="brand-mark" src="/synolink-icon.svg" alt=""/><strong>SynoLink</strong></RouterLink>
      <RouterLink class="desktop-server" to="/servers" title="管理服务器"><el-icon><Monitor /></el-icon><span><strong>{{desktopServer}}</strong><small>{{desktopAccount}}</small></span><el-icon class="server-chevron"><ArrowRight /></el-icon></RouterLink>
      <nav class="sidebar-nav" aria-label="主导航">
       <section v-for="group in desktopGroups" :key="group.label" class="nav-group"><h2>{{group.label}}</h2>
        <RouterLink
          v-for="t in group.items"
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
       </section>
      </nav>
      <div class="sidebar-bottom">
        <button class="nav-item" @click="globalSearchOpen = true">
          <el-icon :size="20"><Search /></el-icon>
          <span>搜索</span>
        </button>
        <button class="nav-item" @click="downloadDrawerOpen = true">
          <el-icon :size="20"><Download /></el-icon>
          <span>传输中心</span>
        </button>
        <RouterLink class="nav-item" active-class="active" to="/app/me"><el-icon :size="20"><User /></el-icon><span>设置</span></RouterLink>
      </div>
    </aside>
    <main class="content">
      <header class="desktop-topbar"><div><span>{{desktopServer}}</span><el-icon><ArrowRight /></el-icon><strong>{{navTitle}}</strong></div><button class="desktop-search" @click="globalSearchOpen=true"><el-icon><Search /></el-icon><span>搜索 NAS 文件</span><kbd>Ctrl K</kbd></button></header>
      <div v-if="booting" class="booting">
        <el-icon class="is-loading" :size="20"><Loading /></el-icon>
        <span>正在恢复会话…</span>
      </div>
      <RouterView v-else v-slot="{ Component }">
        <keep-alive :max="3">
          <component :is="Component" :key="$route.path" />
        </keep-alive>
      </RouterView>
    </main>


    <el-dialog v-model="globalSearchOpen" title="全局搜索" width="560px" top="8vh" destroy-on-close>
      <div class="gsearch-bar">
        <el-input
          v-model="globalSearchQuery"
          placeholder="输入关键词，搜索所有文件夹"
          clearable
          @keyup.enter="doGlobalSearch"
        />
        <el-button type="primary" :loading="globalSearching" @click="doGlobalSearch">搜索</el-button><el-button v-if="globalSearching" @click="globalSearchController?.abort();globalSearching=false;globalSearchError='搜索已取消'">取消</el-button>
      </div>
      <el-alert v-if="globalSearchError" :title="globalSearchError" type="warning" :closable="false" style="margin-top:12px"/>
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
      <div v-else-if="!globalSearching && globalSearchQuery && !globalSearchError" class="gsearch-empty">
        暂无结果
      </div>
    </el-dialog>


    <el-drawer v-model="downloadDrawerOpen" title="传输中心" direction="rtl" size="360px">
      <div class="dl-savedir">
        <div class="dl-savedir-label">保存位置</div>
        <div class="dl-savedir-path" :title="downloadDir">{{ downloadDir || '默认 Downloads' }}</div>
        <div class="dl-savedir-actions">
          <el-button size="small" link @click="chooseDownloadDir">修改</el-button>
          <el-button v-if="downloadDir" size="small" link @click="revealSavedFile(downloadDir)">打开</el-button>
          <el-button v-if="downloadDir" size="small" link type="info" @click="resetDownloadDir">默认</el-button>
        </div>
      </div>
      <div class="dl-ask-row">
        <el-checkbox
          :model-value="askEveryDownload"
          @change="(v: boolean | string | number) => setAskEveryDownload(!!v)"
          size="small"
        >
          每次下载前询问保存目录
        </el-checkbox>
      </div>
      <div class="dl-toolbar" v-if="downloadQueue.length">
        <el-button size="small" @click="clearCompleted">清除已完成</el-button>
      </div>
      <div v-if="!downloadQueue.length" class="gsearch-empty">暂无下载任务</div>
      <div v-for="t in downloadQueue" :key="t.id" class="dl-item">
        <div class="dl-info">
          <div class="dl-name">{{ t.name }}</div>
          <div class="dl-meta">
            <span v-if="t.status === 'downloading'">{{ formatBytes(t.loaded) }} / {{ t.size ? formatBytes(t.size) : '未知' }} · {{ formatBytes(t.speed || 0) }}/s<span v-if="t.speed && t.size > t.loaded"> · 剩余约 {{ Math.ceil((t.size - t.loaded) / t.speed) }} 秒</span></span>
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
            <el-button v-if="t.status === 'error' || t.status === 'cancelled'" size="small" @click="retryTask(t.id)">继续 / 重试</el-button>
            <el-button size="small" @click="removeTask(t.id)">移除</el-button>
          </template>
        </div>
      </div>
      <FileOperations />
    </el-drawer>
  </div>


  <div v-else class="m-shell-container">
  <div class="m-shell" :style="swipeStyle" :class="swipeClasses">
    <van-nav-bar
      :title="navTitle"
      :left-arrow="showNavBack"
      fixed
      placeholder
      safe-area-inset-top
    >
      <template #left>
        <van-icon v-if="showNavBack" name="arrow-left" size="20" @click="navBack" />
      </template>
      <template #right>
        <div class="m-navbar-actions">
          <button class="m-navbar-btn" @click="globalSearchOpen = true" aria-label="搜索">
            <van-icon name="search" size="20" />
          </button>
          <button class="m-navbar-btn" @click="downloadDrawerOpen = true" aria-label="下载">
            <van-icon name="down" size="20" />
          </button>
        </div>
      </template>
    </van-nav-bar>

    <main class="m-content">
      <div v-if="booting" class="m-booting">
        <van-loading size="24" />
        <span>正在恢复会话…</span>
      </div>
      <RouterView v-else v-slot="{ Component }">
        <keep-alive :max="3">
          <component :is="Component" :key="$route.path" />
        </keep-alive>
      </RouterView>
    </main>

    <van-tabbar
      :model-value="activeTabIndex"
      fixed
      safe-area-inset-bottom
      placeholder
      active-color="#6366F1"
      inactive-color="#909399"
      @change="onTabChange"
    >
      <van-tabbar-item v-for="t in mobileTabs" :key="t.to">
        <span>{{ t.label }}</span>
        <template #icon>
          <FolderIcon v-if="t.icon === 'folder'" :size="22" />
          <van-icon v-else :name="t.icon" size="22" />
        </template>
      </van-tabbar-item>
    </van-tabbar>


    <van-popup v-model:show="globalSearchOpen" position="top" round :style="{ height: '85vh', paddingTop: 'var(--sl-safe-top)' }">
      <div class="m-search-head">
        <van-search
          v-model="globalSearchQuery"
          placeholder="搜索所有文件夹"
          show-action
          @search="doGlobalSearch"
        >
          <template #action>
            <div @click="globalSearchOpen = false">取消</div>
          </template>
        </van-search>
      </div>
      <van-loading v-if="globalSearching" style="text-align: center; padding: 40px 0" />
      <van-empty v-else-if="!globalSearchResults.length && globalSearchQuery" description="暂无结果" />
      <van-cell-group v-else inset>
        <van-cell
          v-for="r in globalSearchResults"
          :key="r.path"
          :title="r.name"
          :label="r.path"
          is-link
          @click="goToResult(r)"
        />
      </van-cell-group>
      <FileOperations />
    </van-popup>


    <van-popup
      v-model:show="downloadDrawerOpen"
      position="bottom"
      round
      :style="{ height: '75vh', paddingBottom: 'var(--sl-safe-bottom)' }"
    >
      <div class="m-dl-head">
        <div class="m-dl-title">下载队列</div>
        <van-button v-if="downloadQueue.length" size="mini" plain @click="clearCompleted">清除已完成</van-button>
      </div>
      <div class="m-dl-savedir">
        <div class="m-dl-savedir-label">保存位置</div>
        <div class="m-dl-savedir-path">{{ downloadDir || '默认 Documents/Downloads' }}</div>
        <van-button size="mini" plain @click="chooseDownloadDir">修改</van-button>
      </div>
      <div class="m-dl-ask">
        <van-checkbox
          :model-value="askEveryDownload"
          @update:model-value="(v: boolean) => setAskEveryDownload(v)"
          shape="square"
        >
          每次下载前询问保存目录
        </van-checkbox>
      </div>
      <van-empty v-if="!downloadQueue.length" description="暂无下载任务" />
      <van-cell-group v-else inset>
        <van-cell v-for="t in downloadQueue" :key="t.id">
          <template #title>
            <div class="m-dl-name">{{ t.name }}</div>
            <div class="m-dl-meta">
              <span v-if="t.status === 'downloading'">{{ formatBytes(t.loaded) }} / {{ t.size ? formatBytes(t.size) : '未知' }}</span>
              <span v-else-if="t.status === 'done'">已完成</span>
              <span v-else-if="t.status === 'error'" class="m-dl-error">失败: {{ t.error }}</span>
              <span v-else-if="t.status === 'cancelled'">已取消</span>
              <span v-else>排队中</span>
            </div>
            <van-progress
              v-if="t.status === 'downloading' && t.size"
              :percentage="Math.round((t.loaded / t.size) * 100)"
              :show-pivot="false"
              stroke-width="3"
              style="margin-top: 4px"
            />
          </template>
          <template #value>
            <van-button v-if="t.status === 'downloading' || t.status === 'queued'" size="mini" type="warning" @click="cancelTask(t.id)">取消</van-button>
            <template v-else>
              <van-button v-if="isAndroid && t.status==='done'" size="mini" @click="deliver(t.id,false)">保存到手机</van-button><van-button v-if="isAndroid && t.status==='done'" size="mini" @click="deliver(t.id,true)">分享</van-button>
              <van-button v-if="t.status === 'done' && t.savePath" size="mini" type="primary" plain @click="revealSavedFile(t.savePath)">打开</van-button>
              <van-button v-if="t.status === 'error' || t.status === 'cancelled'" size="mini" plain @click="retryTask(t.id)">继续 / 重试</van-button>
              <van-button size="mini" plain @click="removeTask(t.id)">移除</van-button>
            </template>
          </template>
        </van-cell>
      </van-cell-group>
    </van-popup>


    <LocalFolderPicker
      v-model="localPickerOpen"
      title="选择下载目录"
      @confirm="resolveLocalPicker($event)"
      @update:model-value="(v: boolean) => { if (!v) resolveLocalPicker(null) }"
    />
  </div>
  </div>
</template>

<style scoped>
/* ========== Desktop ========== */
.app-shell {
  display: flex;
  flex-direction: row;
  height: 100vh;
  background: var(--el-bg-color-page);
}

.sidebar {
  width: 56px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--sl-bg-card);
  border-right: var(--sl-border);
  padding: 8px 0;
}
.sidebar-nav { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 4px 0; }
.sidebar-bottom { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; border-top: var(--sl-border); }
.nav-item {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; padding: 8px 0; margin: 0 6px;
  border-radius: var(--sl-radius-sm);
  color: var(--el-text-color-secondary); text-decoration: none;
  font-size: 10px; cursor: pointer;
  transition: background var(--sl-transition-fast), color var(--sl-transition-fast);
  position: relative;
}
.nav-item:hover { background: var(--el-fill-color-light); color: var(--el-text-color-primary); }
.nav-item.active { color: var(--sl-primary); background: var(--el-color-primary-light-9); }
.nav-item.active::before {
  content: ''; position: absolute; left: -6px; top: 8px; bottom: 8px;
  width: 3px; border-radius: 0 2px 2px 0; background: var(--sl-primary);
}

.content { flex: 1; overflow: auto; min-width: 0; }
.booting {
  display: flex; align-items: center; justify-content: center;
  gap: 8px; height: 100%; color: var(--el-text-color-secondary); font-size: 13px;
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
  background: var(--el-fill-color-light); border-radius: var(--sl-radius-sm);
}
.dl-savedir-label { font-size: 11px; color: var(--el-text-color-secondary); flex-shrink: 0; }
.dl-savedir-path {
  flex: 1; min-width: 0;
  font-size: 12px; color: var(--el-text-color-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  direction: rtl; text-align: left;
}
.dl-savedir-actions { display: flex; gap: 2px; flex-shrink: 0; }
.dl-ask-row { margin: 0 0 10px; font-size: 12px; color: var(--el-text-color-secondary); }
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

/* ========== Mobile (shadcn-style) ========== */
.m-shell-container {
  position: fixed;
  inset: 0;
  background: hsl(var(--background));
  overflow: hidden;
  z-index: 0;
}
.m-shell {
  position: relative;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: hsl(var(--background));
  overflow: hidden;
  transform: translateX(var(--swipe-tx, 0));
  will-change: transform;
  z-index: 1;
  /* 永久允许竖向滚动 + 拒绝浏览器/系统默认横滑（让我们的边缘手势独占横向） */
  touch-action: pan-y;
}
.m-shell.m-swipe-transition {
  transition: transform 0.32s cubic-bezier(0.25, 0.1, 0.25, 1);
}
.m-shell.m-swiping::after {
  content: '';
  position: absolute;
  top: 0;
  left: -12px;
  width: 12px;
  height: 100%;
  background: linear-gradient(to right, rgba(0,0,0,0.18), transparent);
  pointer-events: none;
  z-index: 100;
}
.m-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}
.m-booting {
  display: flex; align-items: center; justify-content: center;
  gap: 10px; height: 60vh;
  color: hsl(var(--muted-foreground)); font-size: 14px;
}
.m-search-head { padding-top: 4px; }

.m-navbar-actions {
  display: flex; align-items: center; gap: 2px;
}
.m-navbar-btn {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none;
  color: hsl(var(--foreground));
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.m-navbar-btn:active { background: hsl(var(--muted)); }

.m-dl-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 16px 10px;
}
.m-dl-title {
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground));
  letter-spacing: -0.01em;
}
.m-dl-savedir {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; margin: 0 12px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}
.m-shell :deep(.van-button--plain.van-button--default) {
  color: hsl(var(--foreground));
  border-color: hsl(var(--border));
  background: hsl(var(--background));
}
.m-shell :deep(.van-button--plain.van-button--default:active) {
  background: hsl(var(--muted));
}
.m-dl-savedir-ios {
  font-size: 12px; color: hsl(var(--muted-foreground));
  padding: 10px 14px;
  display: flex; align-items: center; gap: 6px;
}
.m-dl-savedir-label { font-size: 11px; color: hsl(var(--muted-foreground)); flex-shrink: 0; }
.m-dl-savedir-path {
  flex: 1; min-width: 0;
  font-size: 12px; color: hsl(var(--foreground));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  direction: rtl; text-align: left;
}
.m-dl-ask {
  padding: 10px 16px;
  font-size: 13px;
  color: hsl(var(--foreground));
}
.m-dl-name {
  font-size: 14px; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: hsl(var(--foreground));
}
.m-dl-meta { font-size: 12px; color: hsl(var(--muted-foreground)); margin-top: 2px; }
.m-dl-error { color: hsl(var(--destructive)); }

.m-shell :deep(.van-tabbar-item__icon) { padding: 2px 13px; border-radius: 14px; margin-bottom: 2px; }
.m-shell :deep(.van-tabbar-item--active .van-tabbar-item__icon) { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.m-shell :deep(.van-tabbar-item--active .van-tabbar-item__text) { color: var(--el-color-primary); font-weight: 600; }
.m-navbar-actions { gap: 6px; }
.m-navbar-btn { border-radius: 12px; background: var(--el-fill-color-light); }
</style>
