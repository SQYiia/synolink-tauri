<script setup lang="ts">
defineProps<{title:string;description?:string}>()
</script>
<template><header class="workspace-page-header"><div><h1>{{title}}</h1><p v-if="description">{{description}}</p></div><div v-if="$slots.default" class="workspace-page-actions"><slot/></div></header></template>
<style scoped>
.workspace-page-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:26px}.workspace-page-header h1{margin:0;font-size:26px;font-weight:650;letter-spacing:-.6px;line-height:1.4}.workspace-page-header p{margin:8px 0 0;font-size:13px;color:var(--el-text-color-secondary);line-height:1.7;max-width:65ch}.workspace-page-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex-shrink:0}.workspace-page-actions :deep(.el-button){margin:0}@media(max-width:850px){.workspace-page-header{align-items:flex-start;flex-wrap:wrap}.workspace-page-header h1{font-size:23px}}
</style>
