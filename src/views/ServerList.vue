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
  <el-container class="page">
    <el-header>
      <div class="header">
        <h2>SynoLink · 选择服务器</h2>
        <el-button type="primary" :icon="'Plus'" @click="add">添加服务器</el-button>
      </div>
    </el-header>
    <el-main>
      <el-empty v-if="list.length === 0" description="还没有服务器，点右上角添加一台吧" />
      <el-card v-for="s in list" :key="s.id" class="card" shadow="hover">
        <div class="card-row">
          <div class="info" @click="pick(s.id)">
            <div class="name">{{ s.name || s.host }}</div>
            <div class="url">{{ s.protocol }}://{{ s.host }}:{{ s.port }}</div>
            <div class="remark" v-if="s.remark">{{ s.remark }}</div>
          </div>
          <div class="actions">
            <el-button type="primary" @click="pick(s.id)">登录</el-button>
            <el-button type="danger" :icon="'Delete'" @click="remove(s.id)" />
          </div>
        </div>
      </el-card>
    </el-main>
  </el-container>
</template>

<style scoped>
.page { height: 100vh; }
.header { display: flex; align-items: center; justify-content: space-between; height: 60px; }
.card { margin-bottom: 12px; cursor: pointer; }
.card-row { display: flex; align-items: center; justify-content: space-between; }
.info { flex: 1; }
.name { font-size: 16px; font-weight: 600; }
.url { color: #888; font-size: 12px; margin-top: 4px; }
.remark { color: #888; font-size: 12px; margin-top: 2px; }
.actions { display: flex; gap: 8px; }
</style>
