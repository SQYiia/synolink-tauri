<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAppStore } from '../stores/app'
import { DsmClient } from '../api/dsm'

const router = useRouter()
const app = useAppStore()

const form = reactive({
  name: '',
  protocol: 'http' as 'http' | 'https',
  host: '',
  port: 5000,
  remark: '',
  skipTlsVerify: true,
})

const loading = ref(false)

const baseUrl = computed(() => `${form.protocol}://${form.host}:${form.port}`)

async function submit() {
  if (!form.host) {
    ElMessage.warning('请输入 IP / 域名')
    return
  }
  loading.value = true
  try {
    const probe = new DsmClient(baseUrl.value)
    const info = await probe.loadApiInfo()
    if (!info['SYNO.API.Auth']) throw new Error('未返回有效 API 信息')
    const server = await app.addServer({
      name: form.name || form.host,
      protocol: form.protocol,
      host: form.host,
      port: Number(form.port),
      remark: form.remark,
      skipTlsVerify: form.skipTlsVerify,
    })
    ElMessage.success('服务器已保存')
    router.replace(`/login/${server.id}`)
  } catch (e: any) {
    ElMessage.error(`连接失败：${e?.message ?? e}`)
  } finally {
    loading.value = false
  }
}

function back() {
  router.back()
}
</script>

<template>
  <div class="page">
    <div class="form-wrapper">
      <el-button class="back-btn" @click="back" circle>
        <el-icon><ArrowLeft /></el-icon>
      </el-button>

      <div class="form-card">
        <div class="card-avatar">
          <el-icon :size="28"><Plus /></el-icon>
        </div>
        <h2 class="card-title">添加服务器</h2>
        <p class="card-sub">输入群晖 NAS 的连接信息</p>

        <el-form label-position="top" style="margin-top: 24px; width: 100%;">
          <el-form-item label="备注名称">
            <el-input v-model="form.name" placeholder="家里的 NAS（选填）" size="large" />
          </el-form-item>
          <el-form-item label="协议">
            <el-radio-group v-model="form.protocol" @change="form.port = form.protocol === 'https' ? 5001 : 5000" size="large">
              <el-radio-button label="http">HTTP</el-radio-button>
              <el-radio-button label="https">HTTPS</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="主机 / IP">
            <el-input v-model="form.host" placeholder="192.168.1.100 或 example.com" size="large" />
          </el-form-item>
          <el-form-item label="端口">
            <el-input-number v-model="form.port" :min="1" :max="65535" size="large" style="width: 100%" />
          </el-form-item>
          <el-form-item v-if="form.protocol === 'https'">
            <el-checkbox v-model="form.skipTlsVerify">跳过 TLS 证书验证（自签名证书）</el-checkbox>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="可选备注信息" />
          </el-form-item>
          <el-button type="primary" :loading="loading" @click="submit" size="large" style="width: 100%; margin-top: 8px;">保存并测试连接</el-button>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 60px;
  background: var(--el-bg-color-page);
  position: relative;
  overflow-y: auto;
}
.back-btn {
  position: absolute;
  top: 20px;
  left: 20px;
}
.form-wrapper {
  width: 100%;
  max-width: 460px;
  padding: 0 24px 40px;
}
.form-card {
  background: var(--sl-bg-card);
  border-radius: var(--sl-radius-md);
  border: var(--sl-border);
  padding: 32px 28px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.card-avatar {
  width: 44px;
  height: 44px;
  border-radius: var(--sl-radius-sm);
  background: var(--el-color-primary-light-9);
  color: var(--sl-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}
.card-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.card-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
