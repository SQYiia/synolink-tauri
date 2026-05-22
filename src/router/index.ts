import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/servers' },
  { path: '/servers', component: () => import('../views/ServerList.vue') },
  { path: '/add-server', component: () => import('../views/AddServer.vue') },
  { path: '/login/:serverId', component: () => import('../views/Login.vue') },
  // 主 Shell：底部 tab 布局
  {
    path: '/app',
    component: () => import('../layouts/AppShell.vue'),
    children: [
      { path: '', redirect: '/app/files' },
      { path: 'files', component: () => import('../views/Files.vue') },
      { path: 'album', component: () => import('../views/Album.vue') },
      { path: 'videos', component: () => import('../views/Videos.vue') },
      { path: 'downloads', component: () => import('../views/Downloads.vue') },
      { path: 'me', component: () => import('../views/Me.vue') },
    ],
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
