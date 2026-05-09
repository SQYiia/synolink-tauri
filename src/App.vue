<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from './stores/app'

const app = useAppStore()
onMounted(() => app.load())
</script>

<template>
  <router-view />
</template>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
</style>
