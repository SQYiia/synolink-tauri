import { invoke } from '@tauri-apps/api/core'
import { defineStore } from 'pinia'
import { LazyStore } from '@tauri-apps/plugin-store'

export interface ServerConfig {
  id: string
  name: string
  protocol: 'http' | 'https'
  host: string
  port: number
  allowInsecure?: boolean
  remark?: string
  createTime: number
}

export interface AccountConfig {
  id: string
  serverId: string
  account: string
  password: string
  rememberPassword?: boolean
  isDefault?: boolean
  lastLoginTime?: number
}

const store = new LazyStore('synolink.json')
let loadInFlight: Promise<void> | null = null

export const useAppStore = defineStore('app', {
  state: () => ({
    servers: [] as ServerConfig[],
    accounts: [] as AccountConfig[],
    currentServerId: '' as string,
    currentAccountId: '' as string,
    loaded: false,
  }),
  actions: {
    async load() {
      if (this.loaded) return
      if (loadInFlight) return loadInFlight
      loadInFlight = (async () => {
        this.servers = (await store.get<ServerConfig[]>('servers')) ?? []
        this.accounts = (await store.get<AccountConfig[]>('accounts')) ?? []
        for (const account of this.accounts) {
          account.password ??= ''
          if (account.password) {
            try {
              await invoke('save_password', { accountId: account.id, password: account.password })
              account.rememberPassword = true
            } catch { account.rememberPassword = false }
          } else if (account.rememberPassword) {
            account.password = await invoke<string | null>('read_password', { accountId: account.id }).catch(() => null) ?? ''
          }
        }
        await this.saveAccounts()
        this.currentServerId = (await store.get<string>('currentServerId')) ?? ''
        this.currentAccountId = (await store.get<string>('currentAccountId')) ?? ''
        this.loaded = true
      })().finally(() => { loadInFlight = null })
      return loadInFlight
    },
    async saveServers() {
      await store.set('servers', this.servers)
      await store.save()
    },
    async saveAccounts() {
      await store.set('accounts', this.accounts.map(({ password, ...account }) => account))
      await store.save()
    },
    async addServer(s: Omit<ServerConfig, 'id' | 'createTime'>) {
      const id = crypto.randomUUID()
      const server: ServerConfig = { ...s, id, createTime: Date.now() }
      this.servers.push(server)
      await this.saveServers()
      return server
    },
    async saveCredential(account: AccountConfig, password: string, remember: boolean) {
      if (remember) await invoke('save_password', { accountId: account.id, password })
      else if (account.rememberPassword) await invoke('delete_password', { accountId: account.id })
      account.password = password
      account.rememberPassword = remember
      await this.saveAccounts()
    },
    async forgetPasswords() {
      for (const account of this.accounts) {
        if (account.rememberPassword) await invoke('delete_password', { accountId: account.id })
        account.password = ''
        account.rememberPassword = false
      }
      await this.saveAccounts()
    },
    async removeServer(id: string) {
      for (const account of this.accounts.filter(a => a.serverId === id && a.rememberPassword)) {
        await invoke('delete_password', { accountId: account.id })
      }
      this.servers = this.servers.filter(s => s.id !== id)
      this.accounts = this.accounts.filter(a => a.serverId !== id)
      await this.saveServers()
      await this.saveAccounts()
    },
    async addAccount(a: Omit<AccountConfig, 'id'>) {
      const id = crypto.randomUUID()
      const acc: AccountConfig = { ...a, id }
      this.accounts.push(acc)
      await this.saveAccounts()
      return acc
    },
    async setCurrent(serverId: string, accountId: string) {
      this.currentServerId = serverId
      this.currentAccountId = accountId
      await store.set('currentServerId', serverId)
      await store.set('currentAccountId', accountId)
      await store.save()
    },
  },
  getters: {
    currentServer(state): ServerConfig | undefined {
      return state.servers.find(s => s.id === state.currentServerId)
    },
    serverBaseUrl(): (s: ServerConfig) => string {
      return (s: ServerConfig) => `${s.protocol}://${s.host}:${s.port}`
    },
  },
})
