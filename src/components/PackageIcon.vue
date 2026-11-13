<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue'
import {fetch} from '@tauri-apps/plugin-http'
import {dsm} from '../api/dsm'
import {packageIconSource} from '../utils/packageIcon'
const props=defineProps<{pkg:any}>()
const image=ref('')
let controller:AbortController|undefined
function clear(){controller?.abort();if(image.value)URL.revokeObjectURL(image.value);image.value=''}
watch(()=>[props.pkg,dsm.baseUrl,dsm.account],async()=>{
 clear();const source=packageIconSource(props.pkg,dsm.baseUrl);if(!source)return
 const pending=new AbortController();controller=pending
 const scope=JSON.stringify([dsm.baseUrl,dsm.account])
 try{
  const sameOrigin=new URL(source).origin===new URL(dsm.baseUrl).origin
  const response=await fetch(source,{signal:pending.signal,credentials:'omit',maxRedirections:0,connectTimeout:5000,danger:sameOrigin&&dsm.allowInsecure?{acceptInvalidCerts:true,acceptInvalidHostnames:true}:undefined})
  if(!response.ok||Number(response.headers.get('content-length'))>1024*1024)return
  const blob=await response.blob()
  if(blob.size>1024*1024||!/^image\/(png|jpeg|webp|gif)$/i.test(blob.type))return
  if(!pending.signal.aborted&&scope===JSON.stringify([dsm.baseUrl,dsm.account]))image.value=URL.createObjectURL(blob)
 }catch{/* Keep the readable fallback when a package has no reachable icon. */}
},{immediate:true})
onBeforeUnmount(clear)
</script>
<template><span class="package-icon"><img v-if="image" :src="image" alt="" @error="clear"><span v-else aria-hidden="true">{{String(pkg.name||pkg.dname||pkg.id||'?').slice(0,1).toUpperCase()}}</span></span></template>
<style scoped>.package-icon{width:44px;height:44px;flex:0 0 44px;display:grid;place-items:center;border-radius:12px;background:var(--el-color-primary-light-9);color:var(--el-color-primary);font-size:22px;font-weight:650;overflow:hidden}.package-icon img{width:100%;height:100%;object-fit:contain}</style>
