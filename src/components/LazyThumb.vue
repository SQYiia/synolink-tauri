<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * 可视区懒加载缩略图：进入视口才加载真实 src，离开不销毁已加载图片。
 *
 * 关键性能优化：
 * 1. 所有实例共享一个全局 IntersectionObserver（而非每个组件 new 一个），
 *    对包含几千个卡片的场景，能把 IO 实例从 N 个降到 1 个。
 * 2. 全局并发队列：缩略图请求最多 MAX_CONCURRENT 个同时加载，避免一次性
 *    发出几十上百个请求堆压 dsm:// 代理导致干脱或超时。
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

// ---- 全局缩略图并发队列 ----
// 限制同时加载的缩略图数量，避免大量图片同时请求 dsm:// 代理导致
// 网络拥塞与浏览器资源竟争。
const MAX_CONCURRENT = 6
let activeCount = 0
type QueueTask = { run: () => void; cancelled: boolean }
const queue: QueueTask[] = []

function schedule(task: QueueTask) {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++
    task.run()
  } else {
    queue.push(task)
  }
}
function releaseSlot() {
  activeCount = Math.max(0, activeCount - 1)
  while (activeCount < MAX_CONCURRENT && queue.length) {
    const next = queue.shift()!
    if (next.cancelled) continue
    activeCount++
    next.run()
  }
}
function cancelTask(task: QueueTask | null) {
  if (!task) return
  task.cancelled = true
}

// ---- 组件自身 ----
const root = ref<HTMLElement | null>(null)
const actualSrc = ref('')
const failed = ref(false)
let currentTask: QueueTask | null = null
let slotHeld = false

function loadNow() {
  slotHeld = true
  actualSrc.value = props.src
}

function start() {
  if (!root.value) return
  watchElement(root.value, () => {
    const task: QueueTask = { cancelled: false, run: loadNow }
    currentTask = task
    schedule(task)
  }, props.rootMargin)
}

function releaseIfHeld() {
  if (slotHeld) {
    slotHeld = false
    releaseSlot()
  }
}

onMounted(() => { start() })

// 若 props.src 发生变化（例如从空变成真正的 URL），重置状态再观察。
// 注意：不清空已加载的 actualSrc，让旧缩略图保持可见，直到新图加载
// 完成才被浏览器替换，避免滚动时的"闪烁到 placeholder"现象。
watch(() => props.src, (n, o) => {
  if (n === o) return
  failed.value = false
  cancelTask(currentTask)
  currentTask = null
  releaseIfHeld()
  if (root.value) unwatchElement(root.value)
  start()
})

onBeforeUnmount(() => {
  if (root.value) unwatchElement(root.value)
  cancelTask(currentTask)
  currentTask = null
  releaseIfHeld()
})

function onLoad() { releaseIfHeld() }
function onError() { failed.value = true; releaseIfHeld() }
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
      @load="onLoad"
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
  border-radius: inherit;
}
.img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: opacity var(--sl-transition-normal, 0.25s);
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
