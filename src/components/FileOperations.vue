<script setup lang="ts">
import { fileOperations, refreshOperation, removeOperation } from '../composables/useFileOperations'
const labels = { upload: '上传', copy: '复制', move: '移动' }
const statuses = { running: '进行中', waiting: '待确认', done: '已完成', error: '失败' }
</script>

<template>
  <section v-if="fileOperations.length" class="operations">
    <h3>上传与 NAS 文件任务</h3>
    <article v-for="task in fileOperations" :key="task.id">
      <strong>{{ labels[task.kind] }} · {{ task.name }}</strong>
      <small>{{ task.sourceUrl }} · {{ statuses[task.status] }}</small>
      <progress v-if="task.kind !== 'upload' || task.status === 'done'" :value="task.progress" max="100" />
      <p v-if="task.error">{{ task.error }}</p>
      <p v-else-if="task.kind === 'upload' && task.status === 'waiting'">上传被中断，请重新选择文件重试。</p>
      <button v-if="task.taskid && task.status !== 'running' && task.status !== 'done'" @click="refreshOperation(task)">重新查询</button>
      <button v-if="task.status !== 'running'" @click="removeOperation(task)">移除记录</button>
    </article>
  </section>
</template>

<style scoped>
.operations { padding: 12px; }
h3 { font-size: 14px; }
article { padding: 12px 0; border-bottom: 1px solid var(--el-border-color); overflow-wrap: anywhere; }
strong, small { display: block; margin-bottom: 6px; }
strong, p { font-size: 12px; }
small { color: var(--el-text-color-secondary); }
progress { width: 100%; }
button { margin-right: 8px; padding: 5px 10px; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-bg-color); color: var(--el-text-color-primary); cursor: pointer; }
</style>
