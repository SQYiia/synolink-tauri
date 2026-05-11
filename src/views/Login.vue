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
  <el-container class="page">
    <el-header>
      <div class="header">
        <el-button :icon="'ArrowLeft'" @click="back">返回</el-button>
        <h2>{{ server?.name || server?.host || '登录' }}</h2>
        <div style="width: 70px" />
      </div>
    </el-header>
    <el-main>
      <el-card class="form-card">
        <div class="url">{{ server?.protocol }}://{{ server?.host }}:{{ server?.port }}</div>
        <el-form label-width="80px" style="margin-top: 20px;">
          <el-form-item label="账号">
            <el-input v-model="form.account" autocomplete="username" placeholder="DSM 账号" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="form.passwd" type="password" show-password autocomplete="current-password" placeholder="DSM 密码" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="loading" style="width: 100%" @click="submit">登录</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </el-main>
  </el-container>
</template>

<style scoped>
.page { height: 100vh; }
.header { display: flex; align-items: center; justify-content: space-between; height: 60px; }
.form-card { max-width: 480px; margin: 40px auto; }
.url { color: #888; font-size: 12px; text-align: center; }
</style>
