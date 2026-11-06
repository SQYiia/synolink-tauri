<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { ActionSheetAction } from 'vant'
import { dsm } from '../api/dsm'
import { formatBytes, formatSpeed } from '../utils/format'
import { useDownloadStation, getStatusLabel, getTaskHint, type DSTask } from '../composables/useDownloadStation'
import FolderPicker from '../components/FolderPicker.vue'
import DownloadSettings from '../components/DownloadSettings.vue'
import { useIsMobile } from '../composables/useIsMobile'
import { confirm } from '../utils/feedback'

const { tasks, statistic, loading, available, reason, lastUpdate, startPolling, retry, refresh: dsRefresh, createTask, createTaskFile, pauseTasks, resumeTasks, deleteTasks } = useDownloadStation()

const detailOpen = ref(false)
const detailId = ref('')
const detailTask = computed(() => tasks.value.find(task => task.id === detailId.value))
function showDetails(task: DSTask) { detailId.value = task.id; detailOpen.value = true }
async function runAction(action: () => Promise<void>) {
  try { await action(); return true }
  catch (error: any) { ElMessage.error(error?.message || '操作失败，请刷新后重试'); return false }
}
const selected = ref<DSTask[]>([])
const createOpen = ref(false)
const createUri = ref('')
const createDest = ref('')
const createFile = ref<File | null>(null)
const creating = ref(false)
const destPickerOpen = ref(false)

const btSearchOpen = ref(false)
const btKeyword = ref('')
const btSearching = ref(false)
const btResults = ref<any[]>([])
const btTaskId = ref('')
const btFinished = ref(false)

const isMobile = useIsMobile()
const dialogWidth = computed(() => isMobile.value ? '92%' : '500px')
const dialogWidthLg = computed(() => isMobile.value ? '95%' : '640px')
const selectedIds = computed(() => selected.value.map(t => t.id))

// 移动端任务操作 sheet
const sheetOpen = ref(false)
const sheetActions = ref<ActionSheetAction[]>([])
function openTaskActions(task: DSTask) {
  const actions: ActionSheetAction[] = [{ name: '任务详情', callback: () => showDetails(task) } as any]
  if (task.status === 'downloading' || task.status === 'waiting' || task.status === 'seeding') {
    actions.push({ name: '暂停', callback: () => handlePauseOne(task) } as any)
  }
  if (task.status === 'paused') {
    actions.push({ name: '恢复', callback: () => handleResumeOne(task) } as any)
  }
  actions.push({ name: '删除', color: '#EF4444', callback: () => handleDeleteOne(task) } as any)
  sheetActions.value = actions
  sheetOpen.value = true
}
function onSheetSelect(action: ActionSheetAction) {
  sheetOpen.value = false
  ;(action as any).callback?.()
}

function progress(t: DSTask) {
  if (!t.size) return 0
  return Math.max(0, Math.min(100, Math.round((t.sizeDownloaded / t.size) * 100)))
}

function progressColor(t: DSTask) {
  if (t.status === 'paused') return '#909399'
  if (t.status === 'seeding') return '#67c23a'
  if (t.status === 'error') return '#f56c6c'
  return '#409eff'
}

function taskSpeed(t: DSTask) {
  if (t.status === 'downloading') return t.speedKnown ? formatSpeed(t.speedDownload) : '未返回'
  if (t.status === 'seeding') return '↑ ' + formatSpeed(t.speedUpload)
  return ''
}

function typeIcon(type: string) {
  if (type === 'bt') return '🧲'
  if (type === 'ftp') return '📁'
  if (type === 'nzb') return '📰'
  return '🔗'
}

async function handleCreate() {
  if (!createUri.value.trim() && !createFile.value) {
    ElMessage.warning('请输入下载链接或选择种子文件')
    return
  }
  creating.value = true
  try {
    let res: { ok: boolean; error?: string }
    if (createFile.value) {
      res = await createTaskFile(createFile.value, createDest.value || undefined)
    } else {
      res = await createTask(createUri.value.trim(), createDest.value || undefined)
    }
    if (res.ok) {
      ElMessage.success('任务已创建')
      createOpen.value = false
      createUri.value = ''
      createFile.value = null
      createDest.value = ''
    } else {
      ElMessage({
        type: 'error',
        message: '创建失败：' + (res.error ?? ''),
        duration: 8000,
        showClose: true,
      })
    }
  } catch {
    ElMessage.error('未能确认任务是否创建成功，请先刷新任务列表，避免重复提交')
  } finally {
    creating.value = false
  }
}

function onFileChange(uploadFile: any) {
  createFile.value = uploadFile?.raw ?? null
}

function onDestPicked(path: string) {
  createDest.value = path
  destPickerOpen.value = false
}

async function handlePause() {
  if (!selectedIds.value.length) return
  if (await runAction(() => pauseTasks(selectedIds.value))) selected.value = []
}

async function handleResume() {
  if (!selectedIds.value.length) return
  if (await runAction(() => resumeTasks(selectedIds.value))) selected.value = []
}

async function handleDelete() {
  if (!selectedIds.value.length) return
  const ok = await confirm(`确定删除选中的 ${selectedIds.value.length} 个任务？`, '删除任务', { danger: true, confirmText: '删除' })
  if (!ok) return
  if (await runAction(() => deleteTasks(selectedIds.value))) selected.value = []
}

async function handleDeleteOne(task: DSTask) {
  const ok = await confirm(`确定删除「${task.title}」？`, '删除任务', { danger: true, confirmText: '删除' })
  if (!ok) return
  await runAction(() => deleteTasks([task.id]))
}

async function handlePauseOne(task: DSTask) {
  await runAction(() => pauseTasks([task.id]))
}

async function handleResumeOne(task: DSTask) {
  await runAction(() => resumeTasks([task.id]))
}

// BT Search
async function doBTSearch() {
  if (!btKeyword.value.trim()) return
  btSearching.value = true
  btResults.value = []
  btFinished.value = false
  try {
    if (btTaskId.value) {
      await dsm.dsBTSearchClean(btTaskId.value).catch(() => {})
    }
    const start = await dsm.dsBTSearchStart(btKeyword.value.trim())
    if (!start.success || !start.data?.taskid) {
      ElMessage.error('搜索启动失败')
      return
    }
    btTaskId.value = start.data.taskid
    const MAX_WAIT = 20000
    const POLL = 1000
    const t0 = Date.now()
    while (Date.now() - t0 < MAX_WAIT) {
      await new Promise(r => setTimeout(r, POLL))
      const list = await dsm.dsBTSearchList(btTaskId.value, { limit: 100 })
      if (list.success && list.data) {
        btResults.value = (list.data as any).items ?? []
        if ((list.data as any).finished) {
          btFinished.value = true
          break
        }
      }
    }
    if (!btResults.value.length) ElMessage.info('未找到结果')
  } finally {
    btSearching.value = false
  }
}

async function btAddDownload(item: any) {
  const uri = item.download_uri || item.url
  if (!uri) {
    ElMessage.warning('无下载链接')
    return
  }
  const res = await createTask(uri)
  if (res.ok) {
    ElMessage.success(`已添加：${item.title}`)
  } else {
    ElMessage({ type: 'error', message: '添加失败：' + (res.error ?? ''), duration: 8000, showClose: true })
  }
}

function closeBTSearch() {
  btSearchOpen.value = false
  if (btTaskId.value) {
    dsm.dsBTSearchClean(btTaskId.value).catch(() => {})
    btTaskId.value = ''
  }
}

onMounted(() => {
  startPolling(3000)
})

const refreshing = ref(false)
async function onPullRefresh() {
  refreshing.value = true
  try { await dsRefresh() } finally { refreshing.value = false }
}
</script>

<template>
  <div class="ds-page">
    <van-pull-refresh v-model="refreshing" @refresh="onPullRefresh" :disabled="!isMobile">
    <!-- 未安装提示 -->
    <div v-if="!available" class="ds-unavailable">
      <el-icon :size="40"><Connection /></el-icon>
      <h3>Download Station 不可用</h3>
      <p>可能原因：未在群晖套件中心安装 Download Station，或当前账号无访问权限</p>
      <pre v-if="reason" class="ds-reason">{{ reason }}</pre>
      <el-button @click="retry" :loading="loading">重试</el-button>
    </div>

    <template v-else>
      <!-- 顶部栏 -->
      <div class="ds-header">
        <div class="ds-header-left">
          <h3 class="ds-title">下载站</h3>
          <div class="ds-speed" v-if="statistic.speedDownload || statistic.speedUpload">
            <span class="ds-speed-down">↓ {{ formatSpeed(statistic.speedDownload) }}</span>
            <span class="ds-speed-up">↑ {{ formatSpeed(statistic.speedUpload) }}</span>
          </div>
          <el-icon v-if="loading" class="is-loading" :size="14"><Loading /></el-icon>
        </div>
        <div class="ds-header-right">
          <DownloadSettings />
          <el-button type="primary" size="small" @click="createOpen = true">
            <el-icon><Plus /></el-icon>新建任务
          </el-button>
          <el-button size="small" @click="btSearchOpen = true">
            <el-icon><Search /></el-icon>BT搜索
          </el-button>
        </div>
      </div>

      <el-alert v-if="reason" :title="reason + '；当前数据可能不是最新状态'" type="warning" :closable="false" show-icon />
      <div class="ds-refresh-status"><span>{{ lastUpdate ? '最后更新 ' + lastUpdate : '尚未获取任务状态' }}</span><el-button link :loading="loading" @click="dsRefresh()">刷新状态</el-button></div>
      <!-- 批量操作栏 -->
      <div v-if="selected.length" class="ds-batch">
        <span>已选 {{ selected.length }} 项</span>
        <el-button size="small" @click="handlePause">暂停</el-button>
        <el-button size="small" @click="handleResume">恢复</el-button>
        <el-button size="small" type="danger" @click="handleDelete">删除</el-button>
      </div>

      <!-- 任务表（桌面） -->
      <div v-if="!isMobile" class="ds-body">
        <el-table
          v-if="tasks.length"
          :data="tasks"
          @selection-change="(val: DSTask[]) => selected = val"
          size="small"
          stripe
          style="width: 100%"
        >
          <el-table-column type="selection" width="36" />
          <el-table-column label="名称" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="ds-type-icon">{{ typeIcon(row.type) }}</span>
              {{ row.title }}
              <div v-if="getTaskHint(row)" class="ds-task-hint">{{ getTaskHint(row) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="大小" width="90" align="right">
            <template #default="{ row }">{{ row.size ? formatBytes(row.size) : '-' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="getStatusLabel(row.status).type as any" size="small" disable-transitions>
                {{ getStatusLabel(row.status).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="进度" width="130">
            <template #default="{ row }">
              <el-progress
                :percentage="progress(row)"
                :stroke-width="6"
                :color="progressColor(row)"
                :show-text="row.size > 0"
              />
            </template>
          </el-table-column>
          <el-table-column label="速度" width="100" align="right">
            <template #default="{ row }">
              <span class="ds-speed-cell">{{ taskSpeed(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" align="center">
            <template #default="{ row }">
              <el-button size="small" link @click="showDetails(row)">详情</el-button>
              <el-button
                v-if="row.status === 'downloading' || row.status === 'waiting' || row.status === 'seeding'"
                size="small" link type="warning" @click="handlePauseOne(row)"
              >暂停</el-button>
              <el-button
                v-if="row.status === 'paused'"
                size="small" link type="primary" @click="handleResumeOne(row)"
              >恢复</el-button>
              <el-button size="small" link type="danger" @click="handleDeleteOne(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-else class="ds-empty">
          <el-icon :size="36"><Download /></el-icon>
          <p>暂无下载任务</p>
          <el-button type="primary" @click="createOpen = true">新建任务</el-button>
        </div>
      </div>

      <!-- 任务列表（移动端） -->
      <div v-else class="ds-body">
        <van-empty v-if="!tasks.length" description="暂无下载任务">
          <van-button round type="primary" @click="createOpen = true">新建任务</van-button>
        </van-empty>
        <van-cell-group v-else inset>
          <van-swipe-cell v-for="t in tasks" :key="t.id">
            <van-cell @click="openTaskActions(t)">
              <template #title>
                <div class="m-task-title">
                  <span>{{ typeIcon(t.type) }}</span>
                  <span class="m-task-name">{{ t.title }}</span>
                </div>
                <div class="m-task-meta">
                  <van-tag :type="getStatusLabel(t.status).type as any" size="medium" plain>
                    {{ getStatusLabel(t.status).label }}
                  </van-tag>
                  <span v-if="t.size">{{ formatBytes(t.size) }}</span>
                  <span v-if="taskSpeed(t)">{{ taskSpeed(t) }}</span>
                </div>
                <div v-if="getTaskHint(t)" class="ds-task-hint">{{ getTaskHint(t) }}</div>
                <van-progress
                  v-if="t.size"
                  :percentage="progress(t)"
                  :color="progressColor(t)"
                  :show-pivot="false"
                  stroke-width="4"
                  style="margin-top: 6px"
                />
              </template>
            </van-cell>
            <template #right>
              <van-button square type="danger" text="删除" style="height: 100%" @click="handleDeleteOne(t)" />
            </template>
          </van-swipe-cell>
        </van-cell-group>
      </div>

      <van-action-sheet
        v-if="isMobile"
        v-model:show="sheetOpen"
        :actions="sheetActions"
        cancel-text="取消"
        close-on-click-action
        @select="onSheetSelect"
      />
    </template>

    <el-dialog v-model="detailOpen" title="任务详情" :width="dialogWidthLg">
      <template v-if="detailTask">
        <h3 class="ds-detail-title">{{ detailTask.title }}</h3>
        <el-alert v-if="getTaskHint(detailTask)" :title="getTaskHint(detailTask)" :closable="false" type="info" show-icon />
        <el-descriptions :column="1" border class="ds-details">
          <el-descriptions-item label="状态">{{ getStatusLabel(detailTask.status).label }}</el-descriptions-item>
          <el-descriptions-item label="下载速度">{{ detailTask.speedKnown ? formatSpeed(detailTask.speedDownload) : 'NAS 未返回' }}</el-descriptions-item>
          <el-descriptions-item label="已下载 / 总大小">{{ formatBytes(detailTask.sizeDownloaded) }} / {{ detailTask.size ? formatBytes(detailTask.size) : '未知' }}</el-descriptions-item>
          <el-descriptions-item v-if="detailTask.type === 'bt'" label="已连接种子 / 下载节点">{{ detailTask.seeders ?? '未返回' }} / {{ detailTask.peers ?? '未返回' }}</el-descriptions-item>
          <el-descriptions-item label="保存目录">{{ detailTask.destination || 'NAS 未返回' }}</el-descriptions-item>
          <el-descriptions-item label="最后更新">{{ lastUpdate || '尚未更新' }}</el-descriptions-item>
        </el-descriptions>
        <p class="ds-task-hint">若速度持续为零，可对照群晖网页版 Download Station 中同一个任务的状态。</p>
      </template>
      <el-empty v-else description="任务已不存在，请刷新列表" />
      <template #footer><el-button :loading="loading" @click="dsRefresh()">刷新状态</el-button><el-button @click="detailOpen = false">关闭</el-button></template>
    </el-dialog>
    <!-- 新建任务对话框 -->
    <el-dialog v-model="createOpen" title="新建下载任务" :width="dialogWidth" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="下载链接">
          <el-input
            v-model="createUri"
            type="textarea"
            :rows="3"
            placeholder="输入 HTTP/FTP/磁力链接，多个用换行或逗号分隔"
          />
        </el-form-item>
        <el-form-item label="或上传种子文件">
          <el-upload
            :auto-upload="false"
            :limit="1"
            accept=".torrent,.nzb"
            @change="onFileChange"
            @remove="createFile = null"
          >
            <el-button size="small">选择文件</el-button>
          </el-upload>
        </el-form-item>
        <el-form-item label="保存目录（可选）">
          <div style="display: flex; gap: 8px; width: 100%">
            <el-input v-model="createDest" placeholder="使用 NAS 下载站设置的默认目录" readonly />
            <el-button @click="destPickerOpen = true">选择</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- BT搜索对话框 -->
    <el-dialog v-model="btSearchOpen" title="BT 搜索" :width="dialogWidthLg" @close="closeBTSearch" destroy-on-close>
      <div class="bt-search-bar">
        <el-input
          v-model="btKeyword"
          placeholder="输入关键词搜索"
          clearable
          @keyup.enter="doBTSearch"
        />
        <el-button type="primary" :loading="btSearching" @click="doBTSearch">搜索</el-button>
      </div>
      <div v-if="btResults.length" class="bt-results">
        <el-table :data="btResults" size="small" max-height="400">
          <el-table-column label="名称" min-width="200" show-overflow-tooltip prop="title" />
          <el-table-column label="大小" width="80" prop="size" />
          <el-table-column label="种子" width="60" align="center" prop="seeds" />
          <el-table-column label="下载" width="60" align="center" prop="peers" />
          <el-table-column label="操作" width="70" align="center">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="btAddDownload(row)">添加</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!btFinished && !btSearching" class="bt-loading-hint">
          <el-button size="small" link @click="doBTSearch">继续搜索</el-button>
        </div>
      </div>
      <div v-else-if="!btSearching && btKeyword" class="ds-empty" style="padding: 40px 0">
        暂无结果
      </div>
    </el-dialog>

    <!-- 目录选择器 -->
    <FolderPicker v-model="destPickerOpen" @confirm="onDestPicked" />
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.ds-refresh-status { display:flex; align-items:center; justify-content:space-between; margin:12px 0; font-size:12px; color:var(--el-text-color-secondary); }
.ds-task-hint { font-size:12px; line-height:1.6; margin-top:6px; color:var(--el-text-color-secondary); white-space:normal; }
.ds-detail-title { overflow-wrap:anywhere; margin-top:0; }
.ds-details { margin-top:16px; }

.ds-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px;
  gap: 12px;
}
.ds-unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--el-text-color-secondary);
}
.ds-unavailable h3 { margin: 8px 0 0; font-size: 16px; color: var(--el-text-color-primary); }
.ds-unavailable p { margin: 4px 0 16px; font-size: 13px; }
.ds-reason {
  max-width: 80%;
  margin: 0 0 16px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: var(--sl-radius-sm);
  font-size: 12px;
  color: var(--el-color-danger);
  white-space: pre-wrap;
  word-break: break-all;
  text-align: left;
}

.ds-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.ds-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ds-header-right {
  display: flex;
  gap: 8px;
}
.ds-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.ds-speed {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.ds-speed-down { color: var(--el-color-primary); }
.ds-speed-up { color: var(--el-color-success); }

.ds-batch {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--el-color-primary-light-9);
  border-radius: var(--sl-radius-sm);
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.ds-body {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.ds-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 80px 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.ds-type-icon { margin-right: 4px; }
.ds-speed-cell { font-size: 12px; color: var(--el-text-color-secondary); }

.bt-search-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.bt-results { max-height: 450px; overflow-y: auto; }
.bt-loading-hint { text-align: center; padding: 8px 0; }

/* Mobile */
.m-task-title { display: flex; align-items: center; gap: 6px; }
.m-task-name {
  font-size: 14px; font-weight: 500; color: var(--el-text-color-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex: 1; min-width: 0;
}
.m-task-meta {
  display: flex; align-items: center; gap: 8px;
  margin-top: 4px;
  font-size: 12px; color: var(--el-text-color-secondary);
}

@media (max-width: 640px) {
  .ds-page {
    padding: 12px 12px;
    gap: 8px;
  }
  .ds-header {
    flex-wrap: wrap;
    gap: 8px;
  }
  .ds-header-left {
    gap: 8px;
  }
  .ds-header-right {
    width: 100%;
    justify-content: flex-end;
  }
  .ds-batch {
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
    font-size: 12px;
  }
}
</style>
