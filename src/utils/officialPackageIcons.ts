/** Exact DSM package IDs only: never match a third-party package by display name. */
export const officialPackageIcons:Record<string,string>={
 ContainerManager:'container_manager',
 ActiveBackup:'active_backup_for_business',ActiveBackupforBusiness:'active_backup_for_business',
 ActiveBackupforGSuite:'active_backup_for_google_workspace',ActiveBackupforOffice365:'active_backup_for_microsoft_365',
 ActiveInsight:'active_insight',CodecPack:'advanced_media_extensions',AntiVirus:'antivirus_essential',
 AudioStation:'audio_station',Calendar:'calendar',SynologyCalendar:'calendar',CardDAVServer:'carddav_server',
 Chat:'chatplus',CloudSync:'cloud_sync',CMS:'cms',SynologyContacts:'contacts',DHCPServer:'dhcp_server',
 DirectoryServerForWindowsDomain:'directory_server',DNSServer:'dns_server',DocumentViewer:'document_viewer',
 DownloadStation:'download_station',SynologyDrive:'drive',FileStation:'file_station',
 HighAvailability:'high_availability',HybridShare:'hybrid_share',HyperBackup:'hyper_backup',HyperBackupVault:'hyper_backup_vault',
 iTunesServer:'itunes_server',DirectoryServer:'ldap_server',LogCenter:'log_center',
 MailPlus:'mailplus',MailPlusServer:'mailplus_server',MediaServer:'media_server',MigrationAssistant:'migration_assistant',
 NoteStation:'note_station',OAuthService:'oauth_service',SynologyOffice:'office',
 ProxyServer:'proxy_server',RADIUSServer:'radius_server',ReplicationService:'replication_service',
 ScsiTarget:'san_manager',SecureSignIn:'secure_signin_service',SMBService:'smb_service',
 SnapshotReplication:'snapshot_replication',SSOServer:'sso_server',StorageAnalyzer:'storage_analyzer',
 SurveillanceStation:'surveillance_station',SynologyApplicationService:'synology_application_service',
 SynologyPhotos:'synology_photos',TextEditor:'text_editor',SynoFinder:'universal_search',USBCopy:'usb_copy',
 VideoStation:'video_station',Virtualization:'virtual_machine_manager',VPNCenter:'vpn_server',
 WebStation:'web_station',WebDAVServer:'webdav',GlacierBackup:'glacier_backup',exFAT:'exfat',
}
export function officialPackageIcon(raw:any):string{
 if(raw.sourceKind==='community')return ''
 const key=Object.prototype.hasOwnProperty.call(officialPackageIcons,raw.id)?officialPackageIcons[raw.id]:undefined
 return key?`/package-icons/${key}.png`:''
}
