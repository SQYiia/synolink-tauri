export interface NasPackage { icon?: string; id: string; name: string; version: string; status: string; description: string; maintainer: string; dependencies: any; startable: boolean; operations: string[]; uninstallPages: boolean }
export function mapPackage(raw: any): NasPackage {
  return { icon: raw.icon ?? raw.icon_256 ?? raw.package_icon_256 ?? raw.additional?.icon ?? raw.additional?.icon_256, id: String(raw.id ?? ''), name: String(raw.name ?? raw.id ?? ''), version: String(raw.version ?? '未知'), status: String(raw.additional?.status ?? raw.status ?? 'unknown'), description: String(raw.additional?.description ?? ''), maintainer: String(raw.additional?.maintainer ?? raw.additional?.distributor ?? ''), dependencies: raw.additional?.dependent_packages ?? [], startable: raw.additional?.startable === true, uninstallPages: [true, 1, 'true', '1'].includes(raw.additional?.is_uninstall_pages), operations: Array.isArray(raw.additional?.available_operation) ? raw.additional.available_operation : [] }
}
export const integrations: Record<string, { path: string; label: string; api: string }> = {
  SynologyDrive: { path: '/app/drive', label: 'Drive 文件', api: 'SYNO.SynologyDrive.Files' },
  HyperBackup: { path: '/app/backups', label: '备份任务', api: 'SYNO.Backup.Task' },
  ActiveBackup: { path: '/app/backups', label: '备份任务', api: 'SYNO.ActiveBackup.Task' },
  FileStation: { path: '/app/files', label: '文件管理', api: 'SYNO.FileStation.List' },
  DownloadStation: { path: '/app/downloads', label: '下载任务', api: 'SYNO.DownloadStation.Task' },
  Virtualization: { path: '/app/vmm', label: '虚拟机', api: 'SYNO.Virtualization.API.Guest' },
  Docker: { path: '/app/containers', label: '容器管理', api: 'SYNO.Docker.Container' },
  ContainerManager: { path: '/app/containers', label: '容器管理', api: 'SYNO.Docker.Container' },
}
export function packageState(status: string) {
  return ({ running: '运行中', stopped: '已停止', stop: '已停止', installing: '安装中', upgrading: '升级中' } as Record<string, string>)[status] || (status === 'unknown' ? '状态未知' : status)
}
export function apiError(code?: number) {
  return ({ 102: '当前 NAS 未提供此接口，请检查套件是否已安装并启用', 103: '当前套件版本不支持此操作', 104: '当前套件接口版本不兼容', 105: '当前账号没有访问权限', 106: '登录已过期，请重新登录', 119: '登录已过期，请重新登录' } as Record<number, string>)[code ?? -1] || `NAS 请求失败（code=${code ?? '未知'}）`
}
export function mapContainers(data: any) {
  if (!Array.isArray(data?.containers)) throw new Error('无法识别容器列表响应，请检查套件版本')
  return data.containers.map((raw: any) => ({ id: String(raw.id ?? raw.name), name: String(raw.name ?? ''), image: String(raw.image ?? ''), status: String(raw.status ?? raw.state ?? 'unknown').toLowerCase() }))
}
