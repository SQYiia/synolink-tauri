import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/servers' },
  { path: '/servers', component: () => import('../views/ServerList.vue'), meta: { title: '服务器' } },
  { path: '/add-server', component: () => import('../views/AddServer.vue'), meta: { title: '新增服务器', back: '/servers' } },
  { path: '/login/:serverId', component: () => import('../views/Login.vue'), meta: { title: '登录', back: '/servers' } },
  {
    path: '/app',
    component: () => import('../layouts/AppShell.vue'),
    children: [
      { path: '', redirect: '/app/dashboard' },
      { path: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '首页', tab: true } },
      { path: 'files', component: () => import('../views/Files.vue'), meta: { title: '文件', tab: true } },
      { path: 'album', component: () => import('../views/Album.vue'), meta: { title: '相册', tab: true } },
      { path: 'videos', component: () => import('../views/Videos.vue'), meta: { title: '视频' } },
      { path: 'downloads', component: () => import('../views/Downloads.vue'), meta: { title: '下载', tab: true } },
      { path: 'monitor', component: () => import('../views/Monitor.vue'), meta: { title: '性能', tab: true } },
      { path: 'vmm', component: () => import('../views/Vmm.vue'), meta: { title: '虚拟机' } },
      { path: 'me', component: () => import('../views/Me.vue'), meta: { title: '设置', tab: true } },
    ],
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
