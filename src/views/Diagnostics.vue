<script setup lang="ts">
import { onActivated, onDeactivated, onUnmounted, watch, ref } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { dsm } from '../api/dsm'
import { runDiagnostics, diagnosticReport, type DiagnosticResult } from '../utils/diagnostics'
import { readErrors, clearErrors, type ErrorRecord } from '../utils/errorHistory'
import { useAppStore } from '../stores/app'
import { version } from '../../package.json'
const exporting=ref(false)
const busy=ref(false), results=ref<DiagnosticResult[]>([]), report=ref(''), message=ref('')
const app=useAppStore()
const errors=ref<ErrorRecord[]>([])
const identity=()=>dsm.baseUrl+'\n'+dsm.account
const platform=/Android/.test(navigator.userAgent)?'Android':/Windows/.test(navigator.userAgent)?'Windows':'Other'
async function history(){const captured=identity();const rows=await readErrors(captured);if(captured===identity())errors.value=rows}
async function clear(){await clearErrors(identity());await history();report.value=''}
function cancel(){generation++;busy.value=false;report.value=''}
let generation=0
async function run(){
 const token=++generation, identity=dsm.baseUrl+'\n'+dsm.account
 busy.value=true;results.value=[];report.value='';message.value=''
 const stale=()=>token!==generation || identity!==dsm.baseUrl+'\n'+dsm.account
 try{const next=await runDiagnostics(dsm,stale,rows=>{if(!stale())results.value=rows});if(stale())return;results.value=next;await history();if(!stale())report.value=diagnosticReport(version,next,errors.value,platform)}finally{if(token===generation)busy.value=false}
}
async function exportReport(){
 if(exporting.value)return
 exporting.value=true
 try{if(platform==='Android'){const saved=await invoke('export_android_report',{report:report.value});if(saved)message.value='报告已保存';return}
 const path=await save({defaultPath:'SynoLink-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]});if(!path)return;await invoke('save_diagnostic_report',{path,report:report.value});message.value='报告已保存'}catch{message.value='保存失败，可先复制报告'}finally{exporting.value=false}
}
async function copy(){try{await navigator.clipboard.writeText(report.value);message.value='报告已复制'}catch{message.value='请在下方选中并复制报告'}}
onActivated(history);onDeactivated(cancel);onUnmounted(cancel)
watch(()=>[app.currentServerId,app.currentAccountId],()=>{cancel();results.value=[];errors.value=[];void history()})
</script>
<template>
<section class="diagnostics"><header><div><h1>连接诊断</h1><p>只读检查连接、权限与接口响应，不修改 NAS 设置。</p></div><el-button type="primary" :loading="busy" @click="run">开始检查</el-button></header>
<el-button v-if="busy" @click="cancel">取消检查</el-button>
<el-alert title="报告不包含服务器地址、账号、密码、会话令牌或文件路径。" type="info" :closable="false"/>
<p v-if="busy">正在检查，请稍候；单项请求可能需要约 30 秒。</p>
<article v-for="item in results" :key="item.name"><div><strong>{{item.name}}</strong><el-tag :type="item.status==='ok'?'success':item.status==='warning'?'warning':'danger'">{{item.status==='ok'?'通过':item.status==='warning'?'注意':'失败'}}</el-tag></div><p>{{item.detail}}</p><small>{{item.elapsed}} ms</small></article>
<h2>最近错误</h2><el-button @click="history">刷新记录</el-button><el-button @click="clear">清空记录</el-button><p v-if="!errors.length">暂无记录</p><article v-for="(item,index) in errors" :key="index"><strong>{{item.module}} · {{item.operation}}</strong><p>{{new Date(item.time).toLocaleString()}} · {{item.code ?? '请求异常'}} · {{item.elapsed}} ms · {{item.retry}}</p></article>
<template v-if="report"><h2>诊断报告</h2><el-button @click="copy">复制报告</el-button><el-button v-if="platform==='Windows'||platform==='Android'"  :loading="exporting" @click="exportReport">导出 JSON</el-button><span role="status">{{message}}</span><el-input v-model="report" type="textarea" :rows="12" readonly aria-label="脱敏诊断报告"/></template>
</section>
</template>
<style scoped>
.diagnostics{padding:24px;max-width:900px;margin:auto;height:100%;overflow:auto;box-sizing:border-box}header,article>div{display:flex;justify-content:space-between;align-items:center;gap:16px}h1{font-size:24px}p,small{color:var(--el-text-color-secondary)}article{padding:18px;margin:12px 0;border:1px solid var(--el-border-color);border-radius:12px}.el-textarea{margin-top:12px}h2{font-size:18px}@media(max-width:640px){.diagnostics{padding:16px}header{align-items:flex-start;flex-wrap:wrap}}
</style>
