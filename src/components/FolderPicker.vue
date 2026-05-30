<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { dsm } from '../api/dsm'
import { useIsMobile } from '../composables/useIsMobile'
import { toast } from '../utils/feedback'
import FileTypeIcon from './FileTypeIcon.vue'

interface Node {
  name: string
  path: string
  leaf?: boolean
}

const props = defineProps<{
  modelValue: boolean
  initial?: string
  title?: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', path: string): void
}>()

const isMobile = useIsMobile()
const visible = ref(props.modelValue)
watch(() => props.modelValue, (v) => (visible.value = v))
watch(visible, (v) => emit('update:modelValue', v))

const selected = ref<string>(props.initial ?? '')

// ======== Desktop tree ========
const treeProps = {
  label: 'name',
  children: 'children',
  isLeaf: 'leaf',
}

async function loadNode(node: any, resolve: (data: Node[]) => void) {
  try {
    if (node.level === 0) {
      const res: any = await dsm.listShare()
      if (!res.success) {
        ElMessage.error('加载共享目录失败: ' + (res.error?.code ?? ''))
        return resolve([])
      }
      const shares: Node[] = (res.data?.shares ?? []).map((s: any) => ({
        name: s.name,
        path: s.path,
        leaf: false,
      }))
      return resolve(shares)
    }
    const data = node.data as Node
    const res: any = await dsm.listFolders(data.path)
    if (!res.success) {
      ElMessage.error('加载子目录失败: ' + (res.error?.code ?? ''))
      return resolve([])
    }
    const files: any[] = res.data?.files ?? []
    const folders: Node[] = files
      .filter((f) => f.isdir)
      .map((f) => ({ name: f.name, path: f.path, leaf: false }))
    resolve(folders)
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e?.message ?? e))
    resolve([])
  }
}

function onNodeClick(data: Node) {
  selected.value = data.path
}

function confirmSel() {
  if (!selected.value) {
    if (isMobile.value) toast('请先选择一个目录', 'warning')
    else ElMessage.warning('请先选择一个目录')
    return
  }
  emit('confirm', selected.value)
  visible.value = false
}

// ======== Mobile cascading nav ========
const mLoading = ref(false)
const mCurrent = ref<string>('') // 当前所处目录（'' 表示在共享根）
const mFolders = ref<Node[]>([])
const mCrumbs = computed(() => {
  if (!mCurrent.value) return [] as string[]
  return mCurrent.value.split('/').filter(Boolean)
})

async function mLoadShares() {
  mLoading.value = true
  try {
    const res: any = await dsm.listShare()
    if (!res.success) {
      toast('加载共享目录失败', 'error')
      mFolders.value = []
      return
    }
    mFolders.value = (res.data?.shares ?? []).map((s: any) => ({ name: s.name, path: s.path }))
    mCurrent.value = ''
    selected.value = ''
  } finally {
    mLoading.value = false
  }
}

async function mEnter(folder: Node) {
  mLoading.value = true
  try {
    const res: any = await dsm.listFolders(folder.path)
    if (!res.success) {
      toast('加载子目录失败', 'error')
      return
    }
    const files: any[] = res.data?.files ?? []
    mFolders.value = files.filter((f) => f.isdir).map((f) => ({ name: f.name, path: f.path }))
    mCurrent.value = folder.path
    selected.value = folder.path
  } finally {
    mLoading.value = false
  }
}

async function mBack() {
  if (!mCurrent.value) return
  const parts = mCurrent.value.split('/').filter(Boolean)
  parts.pop()
  if (!parts.length) {
    await mLoadShares()
  } else {
    await mEnter({ name: parts[parts.length - 1], path: '/' + parts.join('/') })
  }
}

async function mCrumbJump(idx: number) {
  const parts = mCurrent.value.split('/').filter(Boolean).slice(0, idx + 1)
  await mEnter({ name: parts[parts.length - 1], path: '/' + parts.join('/') })
}

function mPickCurrent() {
  if (!mCurrent.value) {
    toast('请进入一个共享文件夹后再选择', 'warning')
    return
  }
  emit('confirm', mCurrent.value)
  visible.value = false
}

watch(visible, async (v) => {
  if (v && isMobile.value) {
    // 每次打开时重置到共享根
    selected.value = ''
    await mLoadShares()
  }
})
</script>

<template>
  <!-- 桌面端 -->
  <el-dialog v-if="!isMobile" v-model="visible" :title="title ?? '选择目录'" width="560px" append-to-body>
    <div style="height: 420px; overflow: auto; border: 1px solid var(--el-border-color-lighter); border-radius: 4px; padding: 6px">
      <el-tree
        lazy
        :load="loadNode"
        :props="treeProps"
        node-key="path"
        highlight-current
        @node-click="onNodeClick"
      >
        <template #default="{ data }">
          <span>
            <el-icon style="vertical-align: middle; margin-right: 4px"><Folder /></el-icon>
            {{ data.name }}
          </span>
        </template>
      </el-tree>
    </div>
    <div style="margin-top: 10px; font-size: 12px; color: #888">
      当前选择：<span style="color: #409eff">{{ selected || '（未选择）' }}</span>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="confirmSel">确定</el-button>
    </template>
  </el-dialog>

  <!-- 移动端：全屏 popup + 级联导航 -->
  <van-popup
    v-else
    v-model:show="visible"
    position="bottom"
    :style="{ height: '100%' }"
    teleport="body"
  >
    <div class="m-fp-shell">
      <van-nav-bar
        :title="title ?? '选择目录'"
        :left-arrow="!!mCurrent"
        right-text="取消"
        fixed
        placeholder
        safe-area-inset-top
        @click-left="mBack"
        @click-right="visible = false"
      />

      <!-- 面包屑（横滑） -->
      <div class="m-fp-crumbs-wrap">
        <div class="m-fp-crumbs">
          <span class="m-fp-crumb-item" @click="mLoadShares">
            <van-icon name="wap-home-o" size="14" />
            共享
          </span>
          <template v-for="(c, i) in mCrumbs" :key="i + c">
            <span class="m-fp-sep">/</span>
            <span class="m-fp-crumb-item" :class="{ active: i === mCrumbs.length - 1 }" @click="mCrumbJump(i)">{{ c }}</span>
          </template>
        </div>
      </div>

      <!-- 列表区 -->
      <div class="m-fp-body">
        <van-loading v-if="mLoading" style="text-align: center; padding: 40px 0" />
        <van-empty v-else-if="!mFolders.length" description="此目录下没有子文件夹" />
        <div v-else class="m-fp-list">
          <div
            v-for="f in mFolders"
            :key="f.path"
            class="m-fp-row"
            @click="mEnter(f)"
          >
            <FileTypeIcon :name="f.name" is-dir :size="36" />
            <div class="m-fp-row-name">{{ f.name }}</div>
            <van-icon name="arrow" size="14" color="#c0c4cc" />
          </div>
        </div>
      </div>

      <!-- 底部固定操作栏 -->
      <div class="m-fp-actions">
        <div class="m-fp-current">
          <span class="m-fp-current-label">当前</span>
          <span class="m-fp-current-path">{{ mCurrent || '请进入一个文件夹' }}</span>
        </div>
        <van-button type="primary" block round :disabled="!mCurrent" @click="mPickCurrent">
          选择此目录
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.m-fp-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--sl-bg-page);
  max-width: 100vw;
  overflow-x: hidden;
}
.m-fp-crumbs-wrap {
  position: relative;
  padding: 10px 0;
  background: var(--sl-bg-card);
  border-bottom: var(--sl-border);
  flex-shrink: 0;
}
.m-fp-crumbs-wrap::before,
.m-fp-crumbs-wrap::after {
  content: '';
  position: absolute; top: 0; bottom: 0;
  width: 16px;
  pointer-events: none;
}
.m-fp-crumbs-wrap::before {
  left: 0;
  background: linear-gradient(to right, var(--sl-bg-card), transparent);
}
.m-fp-crumbs-wrap::after {
  right: 0;
  background: linear-gradient(to left, var(--sl-bg-card), transparent);
}
.m-fp-crumbs {
  display: flex; align-items: center; gap: 6px;
  padding: 0 16px;
  font-size: 14px; color: var(--el-text-color-regular);
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}
.m-fp-crumbs::-webkit-scrollbar { display: none; }
.m-fp-crumb-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
}
.m-fp-crumb-item.active { color: var(--sl-primary); font-weight: 600; }
.m-fp-sep { color: var(--el-text-color-placeholder); flex-shrink: 0; }

.m-fp-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 16px;
}
.m-fp-list {
  background: var(--sl-bg-card);
  border-radius: 12px;
  margin: 12px;
  overflow: hidden;
}
.m-fp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  min-width: 0;
}
.m-fp-row:last-child { border-bottom: none; }
.m-fp-row:active { background: var(--el-fill-color-light); }
.m-fp-row-name {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.m-fp-actions {
  flex-shrink: 0;
  background: var(--sl-bg-card);
  border-top: var(--sl-border);
  padding: 12px 16px calc(12px + var(--sl-safe-bottom));
}
.m-fp-current {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 10px;
  min-width: 0;
}
.m-fp-current-label { flex-shrink: 0; }
.m-fp-current-path {
  flex: 1;
  min-width: 0;
  color: var(--sl-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
</style>
