<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { DsmClient } from '../api/dsm'
import { useIsMobile } from '../composables/useIsMobile'
import { toast } from '../utils/feedback'

const router = useRouter()
const app = useAppStore()
const isMobile = useIsMobile()

const form = reactive({
  name: '',
  protocol: 'http' as 'http' | 'https',
  host: '',
  port: 5000,
  remark: '',
})

const loading = ref(false)

const baseUrl = computed(() => `${form.protocol}://${form.host}:${form.port}`)

async function submit() {
  if (!form.host) {
    toast('请输入 IP / 域名', 'warning')
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
    })
    toast('服务器已保存', 'success')
    router.replace(`/login/${server.id}`)
  } catch (e: any) {
    toast(`连接失败：${e?.message ?? e}`, 'error')
  } finally {
    loading.value = false
  }
}

function back() {
  router.back()
}

function onProtocolChange(v: string | number | boolean | undefined) {
  form.protocol = v as 'http' | 'https'
  form.port = form.protocol === 'https' ? 5001 : 5000
}
</script>

<template>
  <!-- 桌面端 -->
  <div v-if="!isMobile" class="page">
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
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="可选备注信息" />
          </el-form-item>
          <el-button type="primary" :loading="loading" @click="submit" size="large" style="width: 100%; margin-top: 8px;">保存并测试连接</el-button>
        </el-form>
      </div>
    </div>
  </div>

  <!-- 移动端 -->
  <div v-else class="m-add">
    <van-nav-bar title="添加服务器" left-arrow fixed placeholder safe-area-inset-top @click-left="back" />

    <van-cell-group inset style="margin-top: 12px">
      <van-field
        v-model="form.name"
        label="备注名称"
        placeholder="家里的 NAS（选填）"
      />
      <van-cell title="协议">
        <template #value>
          <van-radio-group
            :model-value="form.protocol"
            direction="horizontal"
            @update:model-value="onProtocolChange"
          >
            <van-radio name="http">HTTP</van-radio>
            <van-radio name="https">HTTPS</van-radio>
          </van-radio-group>
        </template>
      </van-cell>
      <van-field
        v-model="form.host"
        label="主机 / IP"
        placeholder="192.168.1.100 或 example.com"
      />
      <van-field
        v-model.number="form.port"
        type="digit"
        label="端口"
        placeholder="5000"
      />
      <van-field
        v-model="form.remark"
        label="备注"
        type="textarea"
        :rows="2"
        autosize
        placeholder="可选备注信息"
      />
    </van-cell-group>

    <div class="m-actions">
      <van-button type="primary" block round :loading="loading" @click="submit">保存并测试连接</van-button>
    </div>
  </div>
</template>

<style scoped>
.page {
  height: 100vh;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 60px;
  background: var(--el-bg-color-page);
  position: relative; overflow-y: auto;
}
.back-btn { position: absolute; top: 20px; left: 20px; }
.form-wrapper { width: 100%; max-width: 460px; padding: 0 24px 40px; }
.form-card {
  background: var(--sl-bg-card); border-radius: var(--sl-radius-md);
  border: var(--sl-border); padding: 32px 28px 28px;
  display: flex; flex-direction: column; align-items: center;
}
.card-avatar {
  width: 44px; height: 44px; border-radius: var(--sl-radius-sm);
  background: var(--el-color-primary-light-9); color: var(--sl-primary);
  display: flex; align-items: center; justify-content: center; margin-bottom: 12px;
}
.card-title { margin: 0; font-size: 18px; font-weight: 600; color: var(--el-text-color-primary); }
.card-sub { margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }

/* Mobile */
.m-add { min-height: 100vh; background: var(--sl-bg-page); }
.m-actions { padding: 24px 16px; }
</style>
