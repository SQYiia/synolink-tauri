import { defineStore } from 'pinia'
import { LazyStore } from '@tauri-apps/plugin-store'
import { encodePassword, decodePassword } from '../utils/crypto'

export interface ServerConfig {
  id: string
  name: string
  protocol: 'http' | 'https'
  host: string
  port: number
  remark?: string
  createTime: number
  skipTlsVerify?: boolean
}

export interface AccountConfig {
  id: string
  serverId: string
  account: string
  /** 编码后的密码（非明文） */
  password: string
  isDefault?: boolean
  lastLoginTime?: number
}

const store = new LazyStore('synolink.json')

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
      this.servers = (await store.get<ServerConfig[]>('servers')) ?? []
      this.accounts = (await store.get<AccountConfig[]>('accounts')) ?? []
      this.currentServerId = (await store.get<string>('currentServerId')) ?? ''
      this.currentAccountId = (await store.get<string>('currentAccountId')) ?? ''
      this.loaded = true
    },
    async saveServers() {
      await store.set('servers', this.servers)
      await store.save()
    },
    async saveAccounts() {
      await store.set('accounts', this.accounts)
      await store.save()
    },
    async addServer(s: Omit<ServerConfig, 'id' | 'createTime'>) {
      const id = crypto.randomUUID()
      const server: ServerConfig = { ...s, id, createTime: Date.now() }
      this.servers.push(server)
      await this.saveServers()
      return server
    },
    async removeServer(id: string) {
      this.servers = this.servers.filter(s => s.id !== id)
      this.accounts = this.accounts.filter(a => a.serverId !== id)
      await this.saveServers()
      await this.saveAccounts()
    },
    async addAccount(a: Omit<AccountConfig, 'id'> & { rawPassword: string }) {
      const id = crypto.randomUUID()
      const acc: AccountConfig = {
        id,
        serverId: a.serverId,
        account: a.account,
        password: encodePassword(a.rawPassword, a.serverId),
        isDefault: a.isDefault,
        lastLoginTime: a.lastLoginTime,
      }
      this.accounts.push(acc)
      await this.saveAccounts()
      return acc
    },
    /** 获取解码后的明文密码 */
    getPassword(account: AccountConfig): string {
      return decodePassword(account.password, account.serverId)
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
