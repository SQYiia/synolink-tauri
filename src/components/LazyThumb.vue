<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * 可视区懒加载缩略图：进入视口才加载真实 src，离开不销毁已加载图片。
 *
 * 关键性能优化：所有实例共享一个全局 IntersectionObserver（而非每个组件 new 一个）。
 * 对包含几千个卡片的场景，这能把 IO 实例从 N 个降到 1 个，避免主线程被大量 observer 调度压垮。
 */
const props = withDefaults(
  defineProps<{
    src: string
    alt?: string
    aspectRatio?: string
    /** 预加载余量：距视口 ? 像素时开始加载 */
    rootMargin?: string
  }>(),
  { alt: '', aspectRatio: '1/1', rootMargin: '400px' },
)

// ---- 全局共享 observer ----
type Handler = () => void
const handlers = new WeakMap<Element, Handler>()
let sharedObserver: IntersectionObserver | null = null

function getObserver(rootMargin: string): IntersectionObserver {
  if (sharedObserver) return sharedObserver
  if (typeof IntersectionObserver === 'undefined') return null as any
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const h = handlers.get(e.target)
          if (h) {
            handlers.delete(e.target)
            sharedObserver!.unobserve(e.target)
            h()
          }
        }
      }
    },
    { rootMargin, threshold: 0 },
  )
  return sharedObserver
}

function watchElement(el: Element, onEnter: Handler, rootMargin: string) {
  const ob = getObserver(rootMargin)
  if (!ob) { onEnter(); return }
  handlers.set(el, onEnter)
  ob.observe(el)
}
function unwatchElement(el: Element) {
  if (!sharedObserver) return
  if (handlers.has(el)) {
    handlers.delete(el)
    sharedObserver.unobserve(el)
  }
}

// ---- 组件自身 ----
const root = ref<HTMLElement | null>(null)
const actualSrc = ref('')
const failed = ref(false)

function start() {
  if (!root.value) return
  watchElement(root.value, () => {
    actualSrc.value = props.src
  }, props.rootMargin)
}

onMounted(() => { start() })

// 若 props.src 发生变化（例如从空变成真正的 URL），重置状态再观察
watch(() => props.src, () => {
  actualSrc.value = ''
  failed.value = false
  if (root.value) unwatchElement(root.value)
  start()
})

onBeforeUnmount(() => {
  if (root.value) unwatchElement(root.value)
})

function onError() { failed.value = true }
</script>

<template>
  <div
    ref="root"
    class="lazy-thumb"
    :style="{ aspectRatio: props.aspectRatio }"
  >
    <img
      v-if="actualSrc && !failed"
      :src="actualSrc"
      :alt="alt"
      class="img"
      decoding="async"
      @error="onError"
    />
    <div v-else-if="failed" class="fallback">
      <slot name="fallback">
        <el-icon :size="28"><Picture /></el-icon>
      </slot>
    </div>
    <div v-else class="placeholder">
      <slot name="placeholder" />
    </div>
  </div>
</template>

<style scoped>
.lazy-thumb {
  width: 100%;
  position: relative;
  background: var(--el-fill-color);
  overflow: hidden;
}
.img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
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
