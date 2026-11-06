<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { enqueueImage } from '../utils/imageQueue'
import { dsm, MediaError } from '../api/dsm'

const props = withDefaults(defineProps<{
  src: string
  fallbackSrc?: string
  alt?: string
  aspectRatio?: string
  rootMargin?: string
  fit?: 'contain' | 'cover'
  eager?: boolean
  retryable?: boolean
}>(), { alt: '', fallbackSrc: '', aspectRatio: '1/1', rootMargin: '400px', fit: 'cover', eager: false, retryable: true })
const root = ref<HTMLElement | null>(null)
const actualSrc = ref('')
const errorMessage = ref('')
let observer: IntersectionObserver | null = null
let cancel: (() => void) | null = null
let controller: AbortController | null = null
let loader: HTMLImageElement | null = null
let generation = 0

function reset() {
  generation++
  observer?.disconnect()
  observer = null
  controller?.abort()
  controller = null
  if (loader) { loader.src = ''; loader = null }
  cancel?.()
  cancel = null
  if (actualSrc.value) URL.revokeObjectURL(actualSrc.value)
  actualSrc.value = ''
}
async function load() {
  if (cancel) return
  observer?.disconnect()
  const version = generation
  // A disk-cache hit must not wait behind remote downloads or video decoders.
  cancel = () => {}
  const cached = await dsm.cachedMediaImageBlob(props.src)
  if (version !== generation) return
  if (cached) {
    const url = URL.createObjectURL(cached)
    try {
      const image = new Image(); loader = image; image.src = url
      await image.decode()
      if (version !== generation) { URL.revokeObjectURL(url); return }
      actualSrc.value = url
      return
    } catch { URL.revokeObjectURL(url) }
  }
  if (version !== generation) return
  cancel = enqueueImage(done => {
    const abort = new AbortController()
    controller = abort
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; abort.abort() }, 45000)
    void (async () => {
      let lastError: unknown
      try {
        for (const source of [props.src, props.fallbackSrc].filter(Boolean)) {
          if (version !== generation) return
          let objectUrl = ''
          try {
            const blob = await dsm.mediaImageBlob(source, abort.signal)
            if (version !== generation) return
            objectUrl = URL.createObjectURL(blob)
            const image = new Image()
            loader = image
            image.src = objectUrl
            await image.decode()
            if (version !== generation) { URL.revokeObjectURL(objectUrl); return }
            actualSrc.value = objectUrl
            errorMessage.value = ''
            return
          } catch (error) {
            if (objectUrl) URL.revokeObjectURL(objectUrl)
            lastError = error
            if (abort.signal.aborted || (error instanceof MediaError && [105, 106, 107, 119].includes(error.code ?? 0))) break
          }
        }
        if (version === generation) {
          errorMessage.value = timedOut ? '图片加载超时' : lastError instanceof MediaError ? lastError.message : '图片格式无法显示或读取失败'
        }
      } finally { clearTimeout(timeout); done() }
    })()
  })
}
function start() {
  reset()
  errorMessage.value = ''
  if (!root.value || !props.src) return
  if (props.eager || typeof IntersectionObserver === 'undefined') { load(); return }
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) load()
  }, { rootMargin: props.rootMargin })
  observer.observe(root.value)
}
onMounted(start)
watch(() => [props.src, props.fallbackSrc], start)
onBeforeUnmount(reset)
function retry(event: MouseEvent) {
  if (!props.retryable) return
  event.stopPropagation()
  start()
}
</script>

<template>
  <div ref="root" class="lazy-thumb" :style="{ aspectRatio: props.aspectRatio }">
    <img v-if="actualSrc" :src="actualSrc" :alt="alt" class="img" decoding="async" />
    <component :is="retryable ? 'button' : 'div'" v-else-if="errorMessage" class="fallback retry" :type="retryable ? 'button' : undefined" @click="retry" :aria-label="retryable ? '重新加载 ' + alt : undefined" :title="errorMessage">
      <slot name="fallback"><span>图片加载失败</span></slot>
      <span class="error-reason">{{ errorMessage }}</span>
      <span v-if="retryable">点击重新请求</span>
    </component>
    <div v-else class="placeholder"><slot name="placeholder">加载中…</slot></div>
  </div>
</template>

<style scoped>
.lazy-thumb {
  width: 100%;
  position: relative;
  background: var(--el-fill-color);
  overflow: hidden;
  border-radius: inherit;
}
.img {
  width: 100%;
  height: 100%;
  object-fit: v-bind(fit);
  display: block;
  transition: opacity var(--sl-transition-normal, 0.25s);
}
.error-reason { max-width: 95%; overflow-wrap: anywhere; padding: 0 6px; }
.retry { border: 0; background: transparent; flex-direction: column; gap: 6px; cursor: pointer; font-size: 11px; }
.fallback,
.placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
}
</style>
