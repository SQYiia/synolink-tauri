<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { dsm, setSessionRecoverer } from '../api/dsm'
import { useAppStore } from '../stores/app'

const router = useRouter()
const app = useAppStore()
const booting = ref(true)

/** 根据当前保存的账户 重建 DSM 会话；返回是否成功。 */
async function reloginFromStore(): Promise<boolean> {
  const acc = app.accounts.find(a => a.id === app.currentAccountId)
  const srv = app.servers.find(s => s.id === app.currentServerId)
  if (!acc || !srv) return false
  dsm.baseUrl = `${srv.protocol}://${srv.host}:${srv.port}`
  try {
    if (!Object.keys(dsm.apiInfo).length) {
      await dsm.loadApiInfo()
    }
    const res = await dsm.login({ account: acc.account, passwd: acc.password })
    return !!res.success
  } catch {
    return false
  }
}

onMounted(async () => {
  await app.load()
  // 注册全局会话恢复器：dsm.request 遇到 code=119 会自动回调
  setSessionRecoverer(reloginFromStore)

  // 刷新 / 重启后单例被重置，自动重建会话
  if (!dsm.sid) {
    if (!app.currentAccountId || !app.currentServerId) {
      router.replace('/servers')
      return
    }
    const ok = await reloginFromStore()
    if (!ok) {
      ElMessage.warning('会话已过期，请重新登录')
      router.replace(`/login/${app.currentServerId}`)
      return
    }
  }
  booting.value = false
})

const tabs = [
  { to: '/app/files', label: '文件', icon: 'Folder' },
  { to: '/app/album', label: '相册', icon: 'Picture' },
  { to: '/app/videos', label: '视频', icon: 'VideoCamera' },
  { to: '/app/me', label: '我的', icon: 'User' },
]
</script>

<template>
  <div class="app-shell">
    <main class="content">
      <div v-if="booting" class="booting">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>正在恢复会话…</span>
      </div>
      <RouterView v-else v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </RouterView>
    </main>
    <nav class="tabbar">
      <RouterLink
        v-for="t in tabs"
        :key="t.to"
        :to="t.to"
        class="tab"
        active-class="active"
      >
        <el-icon :size="22">
          <component :is="t.icon" />
        </el-icon>
        <span>{{ t.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--el-bg-color-page);
}
.content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.booting {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
.tabbar {
  flex: 0 0 auto;
  height: 58px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  box-shadow: 0 -1px 4px rgba(0, 0, 0, 0.03);
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--el-text-color-secondary);
  text-decoration: none;
  font-size: 11px;
  transition: color 0.15s;
}
.tab:hover {
  color: var(--el-color-primary);
}
.tab.active {
  color: var(--el-color-primary);
}
.tab.active span {
  font-weight: 600;
}
</style>
