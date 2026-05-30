<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useIsMobile } from '../composables/useIsMobile'
import { useBackHandler } from '../composables/useEdgeSwipeBack'
import { toast, prompt } from '../utils/feedback'
import FolderIcon from './FolderIcon.vue'

interface LocalEntry {
  name: string
  path: string
  is_dir: boolean
}

const props = defineProps<{
  modelValue: boolean
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

const rootDir = ref<string>('')
const currentDir = ref<string>('')
const folders = ref<LocalEntry[]>([])
const loading = ref(false)

const relPath = computed(() => {
  if (!rootDir.value || !currentDir.value) return ''
  if (currentDir.value === rootDir.value) return ''
  if (currentDir.value.startsWith(rootDir.value + '/')) {
    return currentDir.value.slice(rootDir.value.length + 1)
  }
  return currentDir.value
})

const crumbs = computed(() => relPath.value ? relPath.value.split('/').filter(Boolean) : [])

async function load(dir: string) {
  loading.value = true
  try {
    folders.value = await invoke<LocalEntry[]>('list_local_subdirs', { parent: dir })
    currentDir.value = dir
  } catch (e: any) {
    toast('加载失败：' + (e?.message ?? e), 'error')
    folders.value = []
  } finally {
    loading.value = false
  }
}

async function loadRoot() {
  try {
    const r = await invoke<string>('get_local_root_dir')
    rootDir.value = r
    await load(r)
  } catch (e: any) {
    toast('无法访问本地目录：' + (e?.message ?? e), 'error')
  }
}

async function enter(folder: LocalEntry) {
  await load(folder.path)
}

async function goUp() {
  if (currentDir.value === rootDir.value) return
  const parts = relPath.value.split('/').filter(Boolean)
  parts.pop()
  const next = parts.length ? `${rootDir.value}/${parts.join('/')}` : rootDir.value
  await load(next)
}

async function crumbJump(idx: number) {
  const parts = crumbs.value.slice(0, idx + 1)
  await load(`${rootDir.value}/${parts.join('/')}`)
}

async function mkdir() {
  const name = await prompt('新文件夹名称', '新建文件夹', {
    pattern: /^[^/\\:*?"<>|]{1,200}$/,
    patternError: '名称不合法',
  })
  if (!name) return
  try {
    const created = await invoke<string>('create_local_subdir', {
      parent: currentDir.value,
      name,
    })
    toast('已创建', 'success')
    await load(currentDir.value)
    // 自动进入新建的目录
    await load(created)
  } catch (e: any) {
    toast('创建失败：' + (e?.message ?? e), 'error')
  }
}

function pick() {
  emit('confirm', currentDir.value)
  visible.value = false
}

watch(visible, async (v) => {
  if (v) {
    if (!rootDir.value) await loadRoot()
    else await load(rootDir.value)
  }
})

useBackHandler(() => {
  if (!visible.value) return false
  if (currentDir.value !== rootDir.value) { void goUp(); return true }
  visible.value = false
  return true
})
</script>

<template>
  <!-- 桌面端：弹窗 -->
  <el-dialog
    v-if="!isMobile"
    v-model="visible"
    :title="title ?? '选择本地目录'"
    width="500px"
    append-to-body
  >
    <div class="lfp-d-bar">
      <el-button size="small" :disabled="currentDir === rootDir" @click="goUp">
        <el-icon><ArrowLeft /></el-icon> 上级
      </el-button>
      <el-button size="small" type="primary" plain @click="mkdir">
        <el-icon><Plus /></el-icon> 新建文件夹
      </el-button>
      <span class="lfp-d-path">{{ relPath || '(根)' }}</span>
    </div>
    <div class="lfp-d-list" v-loading="loading">
      <div v-for="f in folders" :key="f.path" class="lfp-d-row" @dblclick="enter(f)" @click="enter(f)">
        <el-icon><Folder /></el-icon>
        <span>{{ f.name }}</span>
      </div>
      <div v-if="!folders.length && !loading" class="lfp-d-empty">此目录为空</div>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="pick">选择此目录</el-button>
    </template>
  </el-dialog>

  <!-- 移动端：全屏 popup -->
  <van-popup
    v-else
    v-model:show="visible"
    position="bottom"
    :style="{ height: '100%' }"
    teleport="body"
  >
    <div class="lfp-shell">
      <van-nav-bar
        :title="title ?? '选择本地目录'"
        :left-arrow="currentDir !== rootDir"
        right-text="取消"
        fixed
        placeholder
        safe-area-inset-top
        @click-left="goUp"
        @click-right="visible = false"
      />

      <!-- 面包屑 -->
      <div class="lfp-crumbs-wrap">
        <div class="lfp-crumbs">
          <span class="lfp-crumb" @click="load(rootDir)">
            <van-icon name="wap-home-o" size="14" />
            App 内
          </span>
          <template v-for="(c, i) in crumbs" :key="i + c">
            <span class="lfp-sep">/</span>
            <span class="lfp-crumb" :class="{ active: i === crumbs.length - 1 }" @click="crumbJump(i)">{{ c }}</span>
          </template>
        </div>
      </div>

      <!-- 新建按钮 -->
      <div class="lfp-actions">
        <van-button size="small" plain icon="plus" @click="mkdir">新建文件夹</van-button>
      </div>

      <!-- 列表 -->
      <div class="lfp-body">
        <van-loading v-if="loading" style="text-align: center; padding: 40px 0" />
        <van-empty v-else-if="!folders.length" description="此目录为空" />
        <div v-else class="lfp-list">
          <div
            v-for="f in folders"
            :key="f.path"
            class="lfp-row"
            @click="enter(f)"
          >
            <FolderIcon :size="32" color="hsl(217 91% 60%)" />
            <div class="lfp-row-name">{{ f.name }}</div>
            <van-icon name="arrow" size="14" color="hsl(var(--muted-foreground))" />
          </div>
        </div>
      </div>

      <!-- 底部确认 -->
      <div class="lfp-foot">
        <div class="lfp-foot-path">{{ relPath ? `App 内/${relPath}` : 'App 内根目录' }}</div>
        <van-button type="primary" block round @click="pick">选择此目录</van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
/* Desktop */
.lfp-d-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.lfp-d-path { font-size: 12px; color: hsl(var(--muted-foreground)); margin-left: 8px; }
.lfp-d-list { height: 360px; overflow-y: auto; border: 1px solid hsl(var(--border)); border-radius: 6px; padding: 4px; }
.lfp-d-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; border-radius: 4px; font-size: 13px; }
.lfp-d-row:hover { background: hsl(var(--muted)); }
.lfp-d-empty { text-align: center; padding: 40px 0; color: hsl(var(--muted-foreground)); font-size: 13px; }

/* Mobile */
.lfp-shell {
  height: 100%;
  display: flex; flex-direction: column;
  background: hsl(var(--background));
}
.lfp-crumbs-wrap {
  background: hsl(var(--card));
  border-bottom: 1px solid hsl(var(--border));
  padding: 8px 0;
  flex-shrink: 0;
}
.lfp-crumbs {
  display: flex; align-items: center; gap: 4px;
  padding: 0 16px;
  font-size: 13px; color: hsl(var(--muted-foreground));
  overflow-x: auto; white-space: nowrap;
  scrollbar-width: none;
}
.lfp-crumbs::-webkit-scrollbar { display: none; }
.lfp-crumb {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 6px; border-radius: 6px;
  cursor: pointer; flex-shrink: 0;
}
.lfp-crumb.active { color: hsl(var(--foreground)); font-weight: 500; background: hsl(var(--muted)); }
.lfp-sep { color: hsl(var(--muted-foreground) / 0.5); flex-shrink: 0; }

.lfp-actions {
  padding: 10px 12px;
  display: flex; justify-content: flex-end;
  background: hsl(var(--background));
  border-bottom: 1px solid hsl(var(--border));
}

.lfp-body {
  flex: 1; overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 16px;
}
.lfp-list {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  margin: 12px;
  overflow: hidden;
}
.lfp-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid hsl(var(--border));
  cursor: pointer;
  min-width: 0;
}
.lfp-row:last-child { border-bottom: none; }
.lfp-row:active { background: hsl(var(--muted)); }
.lfp-row-name {
  flex: 1; min-width: 0;
  font-size: 14px; font-weight: 500;
  color: hsl(var(--foreground));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.lfp-foot {
  flex-shrink: 0;
  background: hsl(var(--card));
  border-top: 1px solid hsl(var(--border));
  padding: 12px 16px calc(12px + var(--sl-safe-bottom));
}
.lfp-foot-path {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  margin-bottom: 10px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  direction: rtl; text-align: left;
}
</style>
