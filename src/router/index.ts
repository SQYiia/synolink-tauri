import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/servers' },
  { path: '/servers', component: () => import('../views/ServerList.vue') },
  { path: '/add-server', component: () => import('../views/AddServer.vue') },
  { path: '/login/:serverId', component: () => import('../views/Login.vue') },
  { path: '/home', component: () => import('../views/Home.vue') },
  { path: '/files', component: () => import('../views/Files.vue') },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
