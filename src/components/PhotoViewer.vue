<script setup lang="ts">
import LazyThumb from './LazyThumb.vue'
import { Close, Download, Delete, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
defineProps<{ modelValue: boolean; src: string; name: string; index: number; total: number; size: string; date: string }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  prev: []; next: []; download: []; delete: []
}>()
</script>

<template>
  <el-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)"
    class="sl-photo-dialog" fullscreen :show-close="false" :close-on-click-modal="false"
    :title="name" destroy-on-close append-to-body>
    <template #header>
      <header class="photo-toolbar">
        <div class="photo-heading">
          <span class="photo-format">{{ name.split('.').pop()?.toUpperCase() }}</span>
          <div class="photo-title"><span class="photo-eyebrow">相册 / 照片预览</span><h2 :title="name">{{ name }}</h2></div>
        </div>
        <button class="photo-icon close" aria-label="关闭预览" title="关闭（Esc）" @click="emit('update:modelValue', false)">
          <el-icon><Close /></el-icon>
        </button>
      </header>
    </template>
    <div class="photo-stage">
      <LazyThumb v-if="src" :src="src" :alt="name" class="photo-image" fit="contain" aspect-ratio="auto" eager />
      <button class="photo-icon photo-nav previous" aria-label="上一张" title="上一张（←）" :disabled="index === 0" @click="emit('prev')"><el-icon><ArrowLeft /></el-icon></button>
      <button class="photo-icon photo-nav following" aria-label="下一张" title="下一张（→）" :disabled="index >= total - 1" @click="emit('next')"><el-icon><ArrowRight /></el-icon></button>
    </div>
    <footer class="photo-footer">
      <div class="photo-details"><span>{{ date || '未记录拍摄时间' }}</span><span v-if="size" class="photo-filesize">{{ size }}</span></div>
      <div class="photo-position"><strong>{{ index + 1 }}</strong><span>/ {{ total }}</span><small>← → 切换照片</small></div>
      <div class="photo-actions">
        <button class="photo-download" @click="emit('download')"><el-icon><Download /></el-icon><span>下载原图</span></button>
        <button class="photo-icon photo-delete" aria-label="删除照片" title="删除照片" @click="emit('delete')"><el-icon><Delete /></el-icon></button>
      </div>
    </footer>
  </el-dialog>
</template>

<style>
.el-dialog.sl-photo-dialog { padding: 0; margin: 0; background: #101114; color: #f3f3f4; display: flex; flex-direction: column; height: 100dvh; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; --el-text-color-primary: #f3f3f4; }
.sl-photo-dialog .el-dialog__header { padding: 0; margin: 0; flex-shrink: 0; }
.sl-photo-dialog .el-dialog__body { padding: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; color: #f3f3f4; }
</style>
<style scoped>
.photo-toolbar { height: 80px; padding: 0 28px; display: flex; align-items: center; justify-content: space-between; gap: 24px; border-bottom: 1px solid #ffffff0d; }
.photo-heading { display: flex; align-items: center; gap: 14px; min-width: 0; }
.photo-format { border: 1px solid #ffffff20; color: #c1c3ca; border-radius: 9px; padding: 9px 8px; font-size: 11px; letter-spacing: .08em; }
.photo-title { min-width: 0; }
.photo-eyebrow { font-size: 10px; letter-spacing: .12em; color: #888b96; }
h2 { margin: 5px 0 0; font-size: 15px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button { font: inherit; cursor: pointer; transition: background .18s, color .18s; }
button:focus-visible { outline: 2px solid #a9c9ff; outline-offset: 4px; }
.photo-icon { width: 40px; height: 40px; border-radius: 50%; border: 1px solid #ffffff16; background: #ffffff06; color: #c8cad2; display: inline-flex; justify-content: center; align-items: center; font-size: 20px; flex-shrink: 0; }
.photo-icon:hover:not(:disabled) { color: white; background: #ffffff18; }
.photo-stage { position: relative; flex: 1; min-height: 0; padding: 22px 84px; background: radial-gradient(ellipse at center, #22252c 0%, #101114 75%); display: flex; }
.photo-image { height: 100%; min-height: 0; background: transparent; border-radius: 4px; }
.photo-image :deep(.img) { object-fit: contain; }
.photo-image :deep(.placeholder), .photo-image :deep(.fallback) { color: #a7abb7; }
.photo-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; background: #24262cdd; z-index: 2; }
.previous { left: 22px; }.following { right: 22px; }
.photo-nav:disabled { opacity: .22; cursor: default; }
.photo-footer { min-height: 84px; padding: 12px 28px; box-sizing: border-box; display: grid; grid-template-columns: 1fr auto 1fr; gap: 24px; align-items: center; border-top: 1px solid #ffffff0d; }
.photo-details { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #babdc7; }
.photo-filesize { font-size: 11px; color: #777d8b; }
.photo-position { display: flex; align-items: baseline; justify-content: center; flex-wrap: wrap; width: 130px; gap: 6px; font-size: 12px; color: #868b98; font-variant-numeric: tabular-nums; }
.photo-position strong { font-weight: 500; color: #f2f3f5; font-size: 16px; }
.photo-position small { width: 100%; text-align: center; color: #656b78; font-size: 10px; margin-top: 3px; }
.photo-actions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
.photo-download { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #ffffff25; background: #ffffff0c; color: #eceef4; border-radius: 9px; padding: 10px 14px; font-size: 12px; }
.photo-download:hover { background: #ffffff20; }
.photo-delete { border-color: transparent; background: transparent; font-size: 17px; }
.photo-delete:hover { color: #ff9b9b !important; background: #f5656518 !important; }
@media (max-width: 760px) { .photo-toolbar { height: 64px; padding: 0 16px; }.photo-stage { padding: 12px 48px; }.previous { left: 6px; }.following { right: 6px; }.photo-nav { width: 34px; height: 34px; }.photo-footer { padding: 12px 16px; gap: 8px; }.photo-position { width: 65px; }.photo-position small { display: none; }.photo-download span { display: none; }.photo-details { font-size: 10px; } }
</style>
