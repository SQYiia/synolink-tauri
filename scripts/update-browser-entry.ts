import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import AppUpdateDialog from '../src/components/AppUpdateDialog.vue'
export * from '../src/composables/useAppUpdate'
export { downloadQueue } from '../src/composables/useDownloadQueue'
export function mount() { createApp(AppUpdateDialog).use(ElementPlus).mount(document.body.appendChild(document.createElement('div'))) }
