<script setup lang="ts">
import { onDeactivated, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { dsm } from '../api/dsm'
import { apiError } from '../utils/packages'
const open = ref(false), loading = ref(false), saving = ref(false), error = ref(''), ready = ref(false)
const labels: Record<string, string> = { bt_max_download: 'BT 下载', bt_max_upload: 'BT 上传', http_max_download: 'HTTP 下载', ftp_max_download: 'FTP 下载' }
const form = reactive<Record<string, string | number>>({})
let original: Record<string, string | number> = {}, context = '', generation = 0
function current() { return JSON.stringify([dsm.baseUrl, dsm.account]) }
async function load() {
  open.value = true; loading.value = true; error.value = ''; ready.value = false
  const token = ++generation; context = current()
  try {
    const result = await dsm.dsConfig()
    if (token !== generation || context !== current()) return
    if (!result.success) throw new Error(apiError(result.error?.code))
    for (const key of Object.keys(form)) delete form[key]
    for (const key of Object.keys(labels)) {
      if (result.data?.[key] != null && Number.isFinite(Number(result.data[key]))) form[key] = Number(result.data[key])
    }
    if (typeof result.data?.default_destination === 'string') form.default_destination = result.data.default_destination
    original = { ...form }; ready.value = true
  } catch (e: any) { if (token === generation) error.value = e.message || '设置加载失败' }
  finally { if (token === generation) loading.value = false }
}
async function save() {
  if (!ready.value || saving.value || context !== current()) return
  const captured = context, token = generation, changes: Record<string, string | number> = {}
  for (const key of Object.keys(form)) {
    if (form[key] === original[key]) continue
    if (key !== 'default_destination' && (!Number.isInteger(form[key]) || Number(form[key]) < 0)) { ElMessage.warning('限速必须是大于或等于 0 的整数'); return }
    if (key === 'default_destination') {
      const path = String(form[key]).trim().replace(/^\/+/, '').replace(/^volume\d+\//, '')
      if (!path || path.split('/').includes('..')) { ElMessage.warning('请填写有效的共享文件夹路径，例如 Downloads'); return }
      changes[key] = path
    } else changes[key] = form[key]
  }
  if (!Object.keys(changes).length) { open.value = false; return }
  saving.value = true; error.value = ''
  try {
    const result = await dsm.dsSetConfig(changes)
    if (token !== generation || captured !== current()) return
    if (!result.success) throw new Error(apiError(result.error?.code))
    ElMessage.success('下载站设置已保存'); open.value = false
  } catch (e: any) { if (token === generation) error.value = e.message || '保存失败，请重新读取设置确认结果' }
  finally { saving.value = false }
}
onDeactivated(() => { generation++; open.value = false; ready.value = false; loading.value = false })
</script>
<template>
  <el-button size="small" @click="load">下载设置</el-button>
  <el-dialog v-model="open" title="下载站设置" width="min(560px, 94vw)" :close-on-click-modal="false" :show-close="!saving" :close-on-press-escape="!saving">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <p>限速单位为 KB/s，0 表示不限速。设置会影响 NAS 上的下载任务。</p>
    <el-form label-position="top" :disabled="loading || saving || !ready">
      <template v-for="(label, key) in labels" :key="key"><el-form-item v-if="form[key] != null" :label="label"><el-input-number v-model="(form[key] as number)" :min="0" :precision="0" /></el-form-item></template>
      <el-form-item v-if="form.default_destination != null" label="默认保存目录"><el-input v-model="form.default_destination" placeholder="共享文件夹路径，例如 Downloads" /></el-form-item>
    </el-form>
    <template #footer><el-button :disabled="saving" :loading="loading" @click="load">重新读取</el-button><el-button type="primary" :disabled="!ready || loading" :loading="saving" @click="save">保存设置</el-button></template>
  </el-dialog>
</template>
<style scoped>p { color:var(--el-text-color-secondary); font-size:12px; line-height:1.8; }.el-input-number { width:100%; }</style>
