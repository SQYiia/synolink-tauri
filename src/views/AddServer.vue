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
  <el-container class="page">
    <el-header>
      <div class="header">
        <el-button :icon="'ArrowLeft'" @click="back">返回</el-button>
        <h2>添加服务器</h2>
        <div style="width: 70px" />
      </div>
    </el-header>
    <el-main>
      <el-form label-width="110px" style="max-width: 560px; margin: 0 auto;">
        <el-form-item label="备注名称">
          <el-input v-model="form.name" placeholder="家里的 NAS（选填）" />
        </el-form-item>
        <el-form-item label="协议">
          <el-radio-group v-model="form.protocol" @change="form.port = form.protocol === 'https' ? 5001 : 5000">
            <el-radio-button label="http">HTTP</el-radio-button>
            <el-radio-button label="https">HTTPS</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="主机 / IP">
          <el-input v-model="form.host" placeholder="192.168.1.100 或 example.com" />
        </el-form-item>
        <el-form-item label="端口">
          <el-input-number v-model="form.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="submit" style="width: 100%">保存并测试连接</el-button>
        </el-form-item>
      </el-form>
    </el-main>
  </el-container>
</template>

<style scoped>
.page { height: 100vh; }
.header { display: flex; align-items: center; justify-content: space-between; height: 60px; }
</style>
