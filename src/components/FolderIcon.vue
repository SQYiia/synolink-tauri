<script setup lang="ts">
defineProps<{
  size?: number | string
  color?: string
  /** outline (默认) 或 filled */
  filled?: boolean
}>()
</script>

<template>
  <svg
    :width="size || 22"
    :height="size || 22"
    viewBox="0 0 24 24"
    fill="none"
    :stroke="filled ? 'none' : (color || 'currentColor')"
    :fill-opacity="filled ? 1 : 0"
    stroke-width="1.8"
    stroke-linejoin="round"
    stroke-linecap="round"
    style="display: inline-block; vertical-align: middle;"
  >
    <path
      v-if="!filled"
      d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
    />
    <path
      v-else
      :fill="color || 'currentColor'"
      d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
    />
  </svg>
</template>
