import {createApp,h} from 'vue'
import {createRouter,createMemoryHistory,RouterView} from 'vue-router'
import {createPinia} from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import Vant from 'vant'
import * as icons from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'vant/lib/index.css'
import Login from '../src/views/Login.vue'
import {useAppStore} from '../src/stores/app'
import {dsm} from '../src/api/dsm'
export async function mount(mode:string){
 (window as any).__TAURI_INTERNALS__={invoke:async()=>null}
 const calls:any[]=[]
 dsm.loadApiInfo=async()=>{}
 dsm.login=async()=>{calls.push('login');return mode==='fail'?{success:false,error:{code:400}}:mode==='otp'?{success:false,error:{code:403}}:{success:true}}
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/login/:serverId',component:Login},{path:'/app/files',component:{render:()=>h('p','已进入文件页')}},{path:'/servers',component:{render:()=>h('p','服务器列表')}}]})
 const app=createApp({render:()=>h(RouterView)});app.use(createPinia());const store=useAppStore();store.loaded=true;store.servers=[{id:'nas',name:'NAS',host:'fixture',port:5001,protocol:'https',createTime:0}];store.accounts=[{id:'alice',serverId:'nas',account:'alice',password:mode==='empty'?'':'fixture-password',rememberPassword:mode!=='manual'}]
 store.saveCredential=async()=>{};store.saveAccounts=async()=>{};store.setCurrent=async()=>{}
 app.use(router);app.use(ElementPlus,{locale:zhCn});app.use(Vant);for(const [name,icon] of Object.entries(icons))app.component(name,icon)
 await router.push('/login/nas'+(mode==='expired'?'':'?auto=1'));await router.isReady();app.mount('#app');return {calls,close:()=>app.unmount()}
}
