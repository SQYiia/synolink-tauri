<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps<{ open: boolean; x: number; y: number; title: string; items: Array<{ id: string; label: string; disabled?: boolean; danger?: boolean; shortcut?: string }> }>()
const emit = defineEmits<{ close: []; select: [id: string] }>()
const menu = ref<HTMLElement | null>(null)
const position = ref({ left: '0px', top: '0px' })
let previous: HTMLElement | null = null
function close() { emit('close') }
function outside(event: Event) { if (!menu.value?.contains(event.target as Node)) close() }
function keys(event: KeyboardEvent) {
  const buttons = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
  if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); close(); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
function detach() { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); window.removeEventListener('wheel', outside, true) }
watch(() => [props.open, props.x, props.y] as const, async ([open], old) => {
  detach()
  if (!open) { previous?.focus({ preventScroll: true }); return }
  if (!old?.[0]) previous = document.activeElement as HTMLElement
  await nextTick()
  if (!props.open || !menu.value) return
  const rect = menu.value.getBoundingClientRect()
  position.value = { left: Math.max(8, Math.min(props.x, innerWidth - rect.width - 8)) + 'px', top: Math.max(8, Math.min(props.y, innerHeight - rect.height - 8)) + 'px' }
  await nextTick()
  if (!props.open || !menu.value) return
  menu.value.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  // Programmatic scrolling when a dialog returns focus must not dismiss a newly opened menu.
  window.addEventListener('pointerdown', outside); window.addEventListener('resize', close); window.addEventListener('wheel', outside, {capture:true,passive:true})
})
onBeforeUnmount(detach)
</script>
<template>
  <Teleport to="body"><div v-if="open" ref="menu" class="file-context-menu" :style="position" role="menu" aria-label="文件操作" @keydown="keys" @contextmenu.prevent>
    <div class="context-title" :title="title">{{ title }}</div>
    <button v-for="item in items" :key="item.id" role="menuitem" :disabled="item.disabled" :class="{ danger: item.danger }" @click="emit('select', item.id)"><span>{{ item.label }}</span><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd></button>
  </div></Teleport>
</template>
<style scoped>
.file-context-menu { position: fixed; z-index: 4000; width: 220px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto; padding: 6px; box-sizing: border-box; border-radius: 12px; border: 1px solid hsl(var(--border)); background: hsl(var(--popover)); color: hsl(var(--foreground)); box-shadow: 0 12px 36px #0002; }
.context-title { font-size: 11px; color: hsl(var(--muted-foreground)); padding: 9px 10px 12px; margin-bottom: 4px; border-bottom: 1px solid hsl(var(--border)); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
button { display: flex; justify-content: space-between; align-items: center; width: 100%; border: 0; background: transparent; color: inherit; padding: 10px; border-radius: 7px; font: inherit; font-size: 12px; cursor: pointer; text-align: left; }
button:hover:not(:disabled),button:focus-visible { background: hsl(var(--muted)); outline: none; } button:disabled { opacity: .35; cursor: default; } button.danger { color: hsl(var(--destructive)); margin-top: 4px; }kbd { font: inherit; color: hsl(var(--muted-foreground)); font-size: 10px; }
</style>
