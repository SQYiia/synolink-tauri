<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { showDialog, showToast, showFailToast, showSuccessToast } from 'vant'
import { useAppStore } from '../stores/app'
import { dsm } from '../api/dsm'
import { useIsMobile } from '../composables/useIsMobile'

const route = useRoute()
const router = useRouter()
const app = useAppStore()
const isMobile = useIsMobile()

const serverId = route.params.serverId as string
const server = computed(() => app.servers.find(s => s.id === serverId))

const form = reactive({ account: '', passwd: '', otp_code: '' })
const loading = ref(false)

onMounted(async () => {
  await app.load()
  if (!server.value) {
    if (isMobile.value) showFailToast('服务器不存在')
    else ElMessage.error('服务器不存在')
    router.replace('/servers')
    return
  }
  dsm.baseUrl = `${server.value.protocol}://${server.value.host}:${server.value.port}`
  dsm.synoToken = ''
  dsm.sid = ''
  try {
    await dsm.loadApiInfo()
  } catch (e: any) {
    if (isMobile.value) showFailToast(`无法连接服务器：${e?.message ?? e}`)
    else ElMessage.error(`无法连接服务器：${e?.message ?? e}`)
  }

  const last = app.accounts.filter(a => a.serverId === serverId).sort((a, b) => (b.lastLoginTime ?? 0) - (a.lastLoginTime ?? 0))[0]
  if (last) {
    form.account = last.account
    form.passwd = last.password
  }
})

async function promptOtp(): Promise<string | null> {
  if (isMobile.value) {
    // iOS WebView 原生 prompt 体验最佳
    const v = window.prompt('请输入两步验证 OTP 码', '')
    if (!v) return null
    if (!/^\d+$/.test(v)) {
      showFailToast('请输入数字')
      return null
    }
    return v
  }
  try {
    const otp = await ElMessageBox.prompt('需要两步验证，请输入 OTP 验证码', '验证', { inputPattern: /^\d+$/, inputErrorMessage: '请输入数字' })
    return otp.value
  } catch {
    return null
  }
}

async function submit() {
  if (!form.account || !form.passwd) {
    if (isMobile.value) showToast('请填写账号和密码')
    else ElMessage.warning('请填写账号和密码')
    return
  }
  loading.value = true
  try {
    let needOtp = true
    while (needOtp) {
      needOtp = false
      const res = await dsm.login({ account: form.account, passwd: form.passwd, otp_code: form.otp_code })
      if (res.success) {
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
        if (isMobile.value) showSuccessToast('登录成功')
        else ElMessage.success('登录成功')
        router.replace('/app/files')
      } else {
        const code = res.error?.code
        if (code === 400) {
          if (isMobile.value) showFailToast('账号或密码错误')
          else ElMessage.error('账号或密码错误')
        } else if (code === 403 || code === 404) {
          const otp = await promptOtp()
          if (otp === null) break
          form.otp_code = otp
          needOtp = true
        } else {
          if (isMobile.value) showFailToast(`登录失败：code=${code}`)
          else ElMessage.error(`登录失败：code=${code}`)
        }
      }
    }
  } catch (e: any) {
    if ((e as any) !== 'cancel') {
      if (isMobile.value) showFailToast(`请求异常：${e?.message ?? e}`)
      else ElMessage.error(`请求异常：${e?.message ?? e}`)
    }
  } finally {
    loading.value = false
  }
  void showDialog // 触发 import 保留
}

function back() {
  router.replace('/servers')
}
</script>

<template>
  <!-- 桌面端 -->
  <div v-if="!isMobile" class="page">
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
          <el-button type="primary" :loading="loading" size="large" style="width: 100%; margin-top: 8px;" @click="submit">登录</el-button>
        </el-form>
      </div>
    </div>
  </div>

  <!-- 移动端 -->
  <div v-else class="m-login">
    <van-nav-bar left-arrow :title="server?.name || server?.host || '登录'" fixed placeholder safe-area-inset-top @click-left="back" />
    <div class="m-login-body">
      <div class="m-login-avatar">
        <van-icon name="cluster-o" size="44" color="var(--sl-primary)" />
      </div>
      <div class="m-login-url">{{ server?.protocol }}://{{ server?.host }}:{{ server?.port }}</div>

      <van-cell-group inset style="margin-top: 24px">
        <van-field
          v-model="form.account"
          label="账号"
          placeholder="DSM 账号"
          autocomplete="username"
          clearable
        />
        <van-field
          v-model="form.passwd"
          type="password"
          label="密码"
          placeholder="DSM 密码"
          autocomplete="current-password"
        />
      </van-cell-group>

      <div class="m-login-actions">
        <van-button type="primary" block round :loading="loading" @click="submit">登录</van-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: var(--el-bg-color-page);
  position: relative;
}
.back-btn { position: absolute; top: 20px; left: 20px; }
.login-wrapper { width: 100%; max-width: 400px; padding: 0 24px; }
.login-card {
  background: var(--sl-bg-card);
  border-radius: var(--sl-radius-md);
  border: var(--sl-border);
  padding: 36px 28px 32px;
  display: flex; flex-direction: column; align-items: center;
}
.card-avatar {
  width: 48px; height: 48px;
  border-radius: var(--sl-radius-sm);
  background: var(--el-color-primary-light-9);
  color: var(--sl-primary);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 14px;
}
.card-title { margin: 0; font-size: 18px; font-weight: 600; color: var(--el-text-color-primary); }
.card-url { margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }

/* Mobile */
.m-login {
  min-height: 100vh;
  background: var(--sl-bg-page);
}
.m-login-body {
  padding: 24px 0;
  display: flex; flex-direction: column; align-items: center;
}
.m-login-avatar {
  width: 80px; height: 80px;
  background: var(--el-color-primary-light-9);
  border-radius: 20px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 10px;
}
.m-login-url {
  font-size: 13px; color: var(--el-text-color-secondary);
}
.m-login-actions {
  padding: 24px 16px;
  width: 100%; box-sizing: border-box;
}
</style>
