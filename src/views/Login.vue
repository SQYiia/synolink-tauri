<script setup lang="ts">
import { isAndroid } from '../utils/platform'
import { invoke } from '@tauri-apps/api/core'
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { showDialog, showToast, showFailToast, showSuccessToast } from 'vant'
import { useAppStore } from '../stores/app'
import { dsm } from '../api/dsm'
import { useIsMobile } from '../composables/useIsMobile'
import { markNetworkSuccess, markNetworkFailure, iosNetworkBlocked } from '../composables/useIOSNetworkPermission'

const route = useRoute()
const router = useRouter()
const app = useAppStore()
const isMobile = useIsMobile()

const serverId = route.params.serverId as string
const server = computed(() => app.servers.find(s => s.id === serverId))

const form = reactive({ account: '', passwd: '', otp_code: '' })
const loading = ref(false)
const rememberPassword = ref(false)
const initializing=ref(true)
const autoConnecting=ref(route.query.auto==='1')
let active=true
let authenticated=false
onBeforeRouteLeave(()=>!loading.value||authenticated)
onUnmounted(()=>{active=false})

onMounted(async () => {
 try {
  await app.load()
  if(!active)return
  if (!server.value) {
    if (isMobile.value) showFailToast('服务器不存在')
    else ElMessage.error('服务器不存在')
    router.replace('/servers')
    return
  }
  await invoke('clear_session')
  if(!active)return
  dsm.baseUrl = `${server.value.protocol}://${server.value.host}:${server.value.port}`
  dsm.allowInsecure = !!server.value.allowInsecure
  dsm.apiInfo = {}
  dsm.dsSid = ''
  dsm.account = ''
  dsm.synoToken = ''
  dsm.sid = ''
  const last = app.accounts.filter(a => a.serverId === serverId).sort((a,b)=>(b.lastLoginTime??0)-(a.lastLoginTime??0))[0]
  if(last){form.account=last.account;form.passwd=last.password;rememberPassword.value=!isAndroid&&!!last.rememberPassword}
  let connected=false
  try {
    await dsm.loadApiInfo()
    if(!active)return
    connected=true
    markNetworkSuccess()
  } catch (e: any) {
    markNetworkFailure()
    // 如果检测到是本地网络权限问题，由全局阻断弹窗处理，这里不再 toast
    if (!iosNetworkBlocked.value) {
      if (isMobile.value) showFailToast(`无法连接服务器：${e?.message ?? e}`)
      else ElMessage.error(`无法连接服务器：${e?.message ?? e}`)
    }
  }

  initializing.value=false
  if(active&&connected&&autoConnecting.value&&last?.rememberPassword&&last.password)await submit()
 }catch{if(active)ElMessage.error('无法初始化连接，请返回服务器列表重试')}
 finally{initializing.value=false;autoConnecting.value=false}
})

async function promptOtp(): Promise<string | null> {
  if (isMobile.value) {
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
  if(loading.value||initializing.value||!active)return
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
      if(!active)return
      markNetworkSuccess()
      if (res.success) {
        const existed = app.accounts.find(a => a.serverId === serverId && a.account === form.account)
        if (existed) {
          await app.saveCredential(existed, form.passwd, rememberPassword.value)
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
          await app.saveCredential(acc, form.passwd, rememberPassword.value)
          await app.setCurrent(serverId, acc.id)
        }
        if (isMobile.value) showSuccessToast('登录成功')
        else ElMessage.success('登录成功')
        authenticated=true
        router.replace('/app/files')
      } else {
        const code = res.error?.code
        if (code === 400) {
          if (isMobile.value) showFailToast('账号或密码错误')
          else ElMessage.error('账号或密码错误')
        } else if (code === 403 || code === 404) {
          const otp = await promptOtp()
          if(!active)return
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
      markNetworkFailure()
      if (!iosNetworkBlocked.value) {
        if (isMobile.value) showFailToast(`请求异常：${e?.message ?? e}`)
        else ElMessage.error(`请求异常：${e?.message ?? e}`)
      }
    }
  } finally {
    loading.value = false
    form.otp_code=''
  }
  void showDialog
}

function back() {
  router.replace('/servers')
}
</script>

<template>

  <div v-if="autoConnecting" class="page ui-login"><div class="login-card" role="status"><el-icon class="is-loading" :size="28"><Loading /></el-icon><h2>{{server?.name || '连接服务器'}}</h2><p>正在使用已保存的密码登录…</p></div></div>
  <div v-else-if="!isMobile" class="page ui-login">
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

        <el-form :disabled="loading||initializing" label-position="top" style="margin-top: 24px; width: 100%;">
          <el-form-item label="账号">
            <el-input v-model="form.account" autocomplete="username" placeholder="DSM 账号" size="large" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="form.passwd" type="password" show-password autocomplete="current-password" placeholder="DSM 密码" size="large" />
          </el-form-item>
          <el-checkbox v-if="!isAndroid" v-model="rememberPassword">在系统凭据库保存密码</el-checkbox>
          <el-button type="primary" :loading="loading" size="large" style="width: 100%; margin-top: 8px;" @click="submit">登录</el-button>
        </el-form>
      </div>
    </div>
  </div>


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

      <van-checkbox v-if="!isAndroid" v-model="rememberPassword" style="margin-top: 16px">安全保存密码</van-checkbox>
      <p v-if="isAndroid" style="font-size:12px;color:var(--van-text-color-2)">安卓版当前仅在本次运行期间保留密码。</p>
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

/* Mobile (shadcn-style) */
.m-login {
  min-height: 100vh;
  background: hsl(var(--background));
}
.m-login-body {
  padding: 32px 0 16px;
  display: flex; flex-direction: column; align-items: center;
}
.m-login-avatar {
  width: 64px; height: 64px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 12px;
  color: hsl(var(--foreground));
}
.m-login-avatar :deep(.van-icon) {
  color: hsl(var(--foreground)) !important;
}
.m-login-url {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  font-variant-numeric: tabular-nums;
}
.m-login-actions {
  padding: 24px 16px;
  width: 100%; box-sizing: border-box;
}
</style>
