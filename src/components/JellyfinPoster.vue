<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { enqueueImage } from '../utils/imageQueue'
import type { JellyfinClient } from '../api/jellyfin'
const props = defineProps<{ client: JellyfinClient; item: any }>()
const el = ref<HTMLElement>(); const src = ref(''); const failed = ref(false)
let cancel: (()=>void) | undefined
function schedule() { cancel?.(); cancel = enqueueImage(done => { void load().finally(done) }) }
let observer: IntersectionObserver | undefined; let disposed = false
async function load() {
 failed.value = false
 if (!props.item.ImageTags?.Primary) return
 try { const blob = await props.client.poster(props.item.Id, props.item.ImageTags.Primary); if (!disposed) { if(src.value) URL.revokeObjectURL(src.value); src.value = URL.createObjectURL(blob) } } catch { if(!disposed) failed.value = true }
}
onMounted(() => { observer = new IntersectionObserver(entries => { if(entries.some(e => e.isIntersecting)) { observer?.disconnect(); schedule() } }, { rootMargin: '100px' }); if(el.value) observer.observe(el.value) })
onBeforeUnmount(() => { disposed = true; cancel?.(); observer?.disconnect(); if(src.value) URL.revokeObjectURL(src.value) })
</script>
<template><div ref="el" class="jf-poster"><img v-if="src" :src="src" :alt="item.Name"><span v-else>{{ failed ? '海报加载失败' : '暂无海报' }}</span><button v-if="failed" @click.stop="schedule">重试</button></div></template>
<style scoped>.jf-poster{aspect-ratio:2/3;background:linear-gradient(145deg,#29364c,#111722);border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#a3afc2;font-size:12px}.jf-poster img{width:100%;height:100%;object-fit:cover}.jf-poster button{margin-top:12px}</style>
