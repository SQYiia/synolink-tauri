<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '../stores/app'
import { dsm } from '../api/dsm'

const route = useRoute()
const router = useRouter()
const app = useAppStore()

const serverId = route.params.serverId as string
const server = computed(() => app.servers.find(s => s.id === serverId))

const form = reactive({ account: '', passwd: '', otp_code: '' })
const loading = ref(false)

onMounted(async () => {
  await app.load()
  if (!server.value) {
    ElMessage.error('服务器不存在')
    router.replace('/servers')
    return
  }
  // 初始化全局 dsm 客户端
  dsm.baseUrl = `${server.value.protocol}://${server.value.host}:${server.value.port}`
  dsm.synoToken = ''
  dsm.sid = ''
  try {
    await dsm.loadApiInfo()
  } catch (e: any) {
    ElMessage.error(`无法连接服务器：${e?.message ?? e}`)
  }

  // 自动填充上次账号
  const last = app.accounts.filter(a => a.serverId === serverId).sort((a, b) => (b.lastLoginTime ?? 0) - (a.lastLoginTime ?? 0))[0]
  if (last) {
    form.account = last.account
    form.passwd = last.password
  }
})

async function submit() {
  if (!form.account || !form.passwd) {
    ElMessage.warning('请填写账号和密码')
    return
  }
  loading.value = true
  try {
    const res = await dsm.login({ account: form.account, passwd: form.passwd, otp_code: form.otp_code })
    if (res.success) {
      // 保存账号
      const existed = app.accounts.find(a => a.serverId === serverId && a.account === form.account)
      if (existed) {
        existed.password = form.passwd
        existed.lastLoginTime = Date.now()
        await app.saveAccounts()
        await app.setCurrent(serverId, existed.id)
      } else {
        const acc = await app.addAccount({
          serverId,
          account: form.account,
          password: form.passwd,
          lastLoginTime: Date.now(),
        })
        await app.setCurrent(serverId, acc.id)
      }
      ElMessage.success('登录成功')
      router.replace('/app/files')
    } else {
      const code = res.error?.code
      if (code === 400) ElMessage.error('账号或密码错误')
      else if (code === 403 || code === 404) {
        const otp = await ElMessageBox.prompt('需要两步验证，请输入 OTP 验证码', '验证', { inputPattern: /^\d+$/, inputErrorMessage: '请输入数字' })
        form.otp_code = otp.value
        await submit()
      } else ElMessage.error(`登录失败：code=${code}`)
    }
  } catch (e: any) {
    ElMessage.error(`请求异常：${e?.message ?? e}`)
  } finally {
    loading.value = false
  }
}

function back() {
  router.replace('/servers')
}
</script>

<template>
  <div class="page">
    <div class="login-wrapper">
      <el-button class="back-btn" @click="back" circle>
        <el-icon><ArrowLeft /></el-icon>
      </el-button>

      <div class="login-card">
        <div class="card-avatar">
          <el-icon :size="32"><Monitor /></el-icon>
        </div>
        <h2 class="card-title">{{ server?.name || server?.host || '登录' }}</h2>
        <p class="card-url">{{ server?.protocol }}://{{ server?.host }}:{{ server?.port }}</p>

        <el-form label-position="top" style="margin-top: 24px; width: 100%;">
          <el-form-item label="账号">
            <el-input v-model="form.account" autocomplete="username" placeholder="DSM 账号" size="large" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="form.passwd" type="password" show-password autocomplete="current-password" placeholder="DSM 密码" size="large" />
          </el-form-item>
          <el-button type="primary" :loading="loading" size="large" round style="width: 100%; margin-top: 8px;" @click="submit">登录</el-button>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-bg-color-page);
  position: relative;
}
.back-btn {
  position: absolute;
  top: 20px;
  left: 20px;
}
.login-wrapper {
  width: 100%;
  max-width: 420px;
  padding: 0 24px;
}
.login-card {
  background: var(--sl-bg-card);
  border-radius: var(--sl-radius-lg);
  box-shadow: var(--sl-shadow-lg);
  padding: 40px 32px 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.card-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--sl-gradient-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}
.card-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.card-url {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
