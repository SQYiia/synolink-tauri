<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useAppStore } from '../stores/app'

const router = useRouter()
const app = useAppStore()

onMounted(() => app.load())

const list = computed(() => app.servers)

function add() {
  router.push('/add-server')
}

function pick(serverId: string) {
  router.push(`/login/${serverId}`)
}

async function remove(id: string) {
  await ElMessageBox.confirm('确认删除该服务器？对应账号也会一并删除', '提示', { type: 'warning' })
  await app.removeServer(id)
}
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="hero-text">
        <h1>SynoLink</h1>
        <p>选择一台服务器开始</p>
      </div>
      <el-button type="primary" round @click="add">
        <el-icon style="margin-right: 4px"><Plus /></el-icon>
        添加服务器
      </el-button>
    </header>

    <main class="body">
      <div v-if="list.length === 0" class="empty">
        <div class="empty-icon">
          <el-icon :size="56"><Monitor /></el-icon>
        </div>
        <p class="empty-title">还没有服务器</p>
        <p class="empty-sub">添加一台群晖 NAS 开始使用</p>
        <el-button type="primary" round @click="add" style="margin-top: 16px">
          <el-icon style="margin-right: 4px"><Plus /></el-icon>
          添加服务器
        </el-button>
      </div>

      <div v-for="s in list" :key="s.id" class="server-card" @click="pick(s.id)">
        <div class="card-icon">
          <el-icon :size="24"><Monitor /></el-icon>
        </div>
        <div class="card-info">
          <div class="card-name">{{ s.name || s.host }}</div>
          <div class="card-url">{{ s.protocol }}://{{ s.host }}:{{ s.port }}</div>
          <div class="card-remark" v-if="s.remark">{{ s.remark }}</div>
        </div>
        <div class="card-actions">
          <el-button type="primary" size="small" round @click.stop="pick(s.id)">连接</el-button>
          <el-button size="small" circle @click.stop="remove(s.id)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page {
  height: 100vh;
  padding: 0 24px;
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32px 0 24px;
}
.hero-text h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.hero-text p {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}
.body {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 24px;
}
.empty {
  text-align: center;
  padding: 80px 0;
}
.empty-icon {
  width: 96px;
  height: 96px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: var(--el-color-primary-light-9);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sl-primary);
}
.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
}
.empty-sub {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin: 6px 0 0;
}
.server-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  background: var(--sl-bg-card);
  border-radius: var(--sl-radius-md);
  box-shadow: var(--sl-shadow-sm);
  margin-bottom: 12px;
  cursor: pointer;
  transition: transform var(--sl-transition-normal), box-shadow var(--sl-transition-normal);
}
.server-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--sl-shadow-md);
}
.server-card:active {
  transform: scale(0.98);
}
.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--sl-gradient-info);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.card-info {
  flex: 1;
  min-width: 0;
}
.card-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.card-url {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 3px;
}
.card-remark {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: 2px;
}
.card-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
</style>
