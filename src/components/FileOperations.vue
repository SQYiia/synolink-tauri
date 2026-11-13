<script setup lang="ts">
import { computed } from 'vue'
import { fileOperations, operationScope, refreshOperation, removeOperation, cancelOperation, isOperationQuerying } from '../composables/useFileOperations'
import { confirm } from '../utils/feedback'
const visible = computed(() => fileOperations.filter(t => JSON.stringify([t.sourceUrl,t.account]) === operationScope.value))
const labels = { upload:'上传',copy:'复制',move:'移动',compress:'压缩',extract:'解压' }
const statuses = { running:'进行中',waiting:'等待查询',done:'已完成',error:'失败',cancelling:'正在取消',cancelled:'已取消' }
async function cancel(task:typeof fileOperations[number]){if(await confirm('取消不会回滚已完成的文件操作，确定停止 NAS 任务？','取消文件任务',{danger:true,confirmText:'停止任务'}))await cancelOperation(task)}
</script>
<template>
<section v-if="visible.length" class="operations"><h3>上传与 NAS 文件任务</h3>
 <article v-for="task in visible" :key="task.id"><strong>{{labels[task.kind]}} · {{task.name}}</strong><small>{{statuses[task.status]}}</small>
 <progress v-if="task.progress!=null" :value="task.progress" max="100"/><small v-else-if="task.status==='running'">处理中，NAS 未返回进度</small>
 <p v-if="task.error">{{task.error}}</p><p v-else-if="task.kind==='upload'&&task.status==='waiting'">上传被中断，请重新选择文件重试。</p>
 <button v-if="task.taskid&&['waiting','error'].includes(task.status)" :disabled="isOperationQuerying(task)" @click="refreshOperation(task)">{{isOperationQuerying(task)?'等待上次查询结束':'重新查询'}}</button>
 <button v-if="task.taskid&&['running','waiting'].includes(task.status)" @click="cancel(task)">取消任务</button>
 <button v-if="!['running','cancelling'].includes(task.status)" @click="removeOperation(task)">移除记录</button>
 </article><small>移除记录不会停止 NAS 任务。</small>
</section>
</template>
<style scoped>
.operations{padding:12px}h3{font-size:14px}article{padding:14px 0;border-bottom:1px solid var(--el-border-color);overflow-wrap:anywhere}strong,small{display:block;margin-bottom:6px}strong,p{font-size:12px}small{color:var(--el-text-color-secondary)}progress{width:100%}button:disabled{opacity:.5;cursor:wait}button{margin:4px 8px 4px 0;padding:7px 12px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--el-bg-color);color:var(--el-text-color-primary);cursor:pointer}
</style>
