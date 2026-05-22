<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dsm } from '../api/dsm'
import { formatBytes, formatSpeed } from '../utils/format'
import { useDownloadStation, getStatusLabel, type DSTask } from '../composables/useDownloadStation'
import FolderPicker from '../components/FolderPicker.vue'

const { tasks, statistic, loading, available, startPolling, refresh, createTask, createTaskFile, pauseTasks, resumeTasks, deleteTasks } = useDownloadStation()

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

const selectedIds = computed(() => selected.value.map(t => t.id))

function progress(t: DSTask) {
  if (!t.size) return 0
  return Math.round((t.sizeDownloaded / t.size) * 100)
}

function progressColor(t: DSTask) {
  if (t.status === 'paused') return '#909399'
  if (t.status === 'seeding') return '#67c23a'
  if (t.status === 'error') return '#f56c6c'
  return '#409eff'
}

function taskSpeed(t: DSTask) {
  if (t.status === 'downloading') return formatSpeed(t.speedDownload)
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
    let ok = false
    if (createFile.value) {
      ok = await createTaskFile(createFile.value, createDest.value || undefined)
    } else {
      ok = await createTask(createUri.value.trim(), createDest.value || undefined)
    }
    if (ok) {
      ElMessage.success('任务已创建')
      createOpen.value = false
      createUri.value = ''
      createFile.value = null
      createDest.value = ''
    } else {
      ElMessage.error('创建失败')
    }
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
  await pauseTasks(selectedIds.value)
  selected.value = []
}

async function handleResume() {
  if (!selectedIds.value.length) return
  await resumeTasks(selectedIds.value)
  selected.value = []
}

async function handleDelete() {
  if (!selectedIds.value.length) return
  await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 个任务？`, '删除任务', { type: 'warning' })
  await deleteTasks(selectedIds.value)
  selected.value = []
}

async function handleDeleteOne(task: DSTask) {
  await ElMessageBox.confirm(`确定删除「${task.title}」？`, '删除任务', { type: 'warning' })
  await deleteTasks([task.id])
}

async function handlePauseOne(task: DSTask) {
  await pauseTasks([task.id])
}

async function handleResumeOne(task: DSTask) {
  await resumeTasks([task.id])
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
  const ok = await createTask(uri)
  if (ok) {
    ElMessage.success(`已添加：${item.title}`)
  } else {
    ElMessage.error('添加失败')
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
</script>

<template>
  <div class="ds-page">
    <!-- 未安装提示 -->
    <div v-if="!available" class="ds-unavailable">
      <el-icon :size="40"><Connection /></el-icon>
      <h3>Download Station 未安装</h3>
      <p>请在群晖套件中心安装 Download Station</p>
      <el-button @click="refresh">重试</el-button>
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
          <el-button type="primary" size="small" @click="createOpen = true">
            <el-icon><Plus /></el-icon>新建任务
          </el-button>
          <el-button size="small" @click="btSearchOpen = true">
            <el-icon><Search /></el-icon>BT搜索
          </el-button>
        </div>
      </div>

      <!-- 批量操作栏 -->
      <div v-if="selected.length" class="ds-batch">
        <span>已选 {{ selected.length }} 项</span>
        <el-button size="small" @click="handlePause">暂停</el-button>
        <el-button size="small" @click="handleResume">恢复</el-button>
        <el-button size="small" type="danger" @click="handleDelete">删除</el-button>
      </div>

      <!-- 任务表 -->
      <div class="ds-body">
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
          <el-table-column label="操作" width="120" align="center">
            <template #default="{ row }">
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

        <!-- 空状态 -->
        <div v-else class="ds-empty">
          <el-icon :size="36"><Download /></el-icon>
          <p>暂无下载任务</p>
          <el-button type="primary" @click="createOpen = true">新建任务</el-button>
        </div>
      </div>
    </template>

    <!-- 新建任务对话框 -->
    <el-dialog v-model="createOpen" title="新建下载任务" width="500px" destroy-on-close>
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
          >
            <el-button size="small">选择文件</el-button>
          </el-upload>
        </el-form-item>
        <el-form-item label="保存目录（可选）">
          <div style="display: flex; gap: 8px; width: 100%">
            <el-input v-model="createDest" placeholder="默认 Downloads 目录" readonly />
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
    <el-dialog v-model="btSearchOpen" title="BT 搜索" width="640px" @close="closeBTSearch" destroy-on-close>
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
  </div>
</template>

<style scoped>
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
</style>
