<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dsm } from '../api/dsm'

interface Node {
  name: string
  path: string
  leaf?: boolean
}

const props = defineProps<{
  modelValue: boolean
  // 初始选中路径（可选）
  initial?: string
  title?: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', path: string): void
}>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, (v) => (visible.value = v))
watch(visible, (v) => emit('update:modelValue', v))

const selected = ref<string>(props.initial ?? '')

const treeProps = {
  label: 'name',
  children: 'children',
  isLeaf: 'leaf',
}

async function loadNode(node: any, resolve: (data: Node[]) => void) {
  try {
    // 根节点：拉共享文件夹
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
    // 子目录
    const data = node.data as Node
    const res: any = await dsm.listFolders(data.path)
    if (!res.success) {
      ElMessage.error('加载子目录失败: ' + (res.error?.code ?? ''))
      return resolve([])
    }
    const files: any[] = res.data?.files ?? []
    const folders: Node[] = files
      .filter((f) => f.isdir)
      .map((f) => ({
        name: f.name,
        path: f.path,
        leaf: false,
      }))
    resolve(folders)
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e?.message ?? e))
    resolve([])
  }
}

function onNodeClick(data: Node) {
  selected.value = data.path
}

function confirm() {
  if (!selected.value) {
    ElMessage.warning('请先选择一个目录')
    return
  }
  emit('confirm', selected.value)
  visible.value = false
}
</script>

<template>
  <el-dialog v-model="visible" :title="title ?? '选择目录'" width="560px" append-to-body>
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
      <el-button type="primary" @click="confirm">确定</el-button>
    </template>
  </el-dialog>
</template>
