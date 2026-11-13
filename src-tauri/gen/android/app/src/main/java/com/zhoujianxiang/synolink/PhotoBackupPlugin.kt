package com.zhoujianxiang.synolink
import android.app.Activity
import android.content.Intent
import android.os.Build
import app.tauri.annotation.*
import app.tauri.plugin.*
import org.json.JSONObject

@InvokeArg
class PhotoArgs { var action:String="snapshot";var payload:String="{}";var callback:Channel?=null }
@TauriPlugin(permissions=[
 Permission(strings=["android.permission.READ_EXTERNAL_STORAGE"],alias="legacy"),
 Permission(strings=["android.permission.READ_MEDIA_IMAGES","android.permission.READ_MEDIA_VIDEO"],alias="media"),
 Permission(strings=["android.permission.READ_MEDIA_VISUAL_USER_SELECTED"],alias="selected"),
 Permission(strings=["android.permission.POST_NOTIFICATIONS"],alias="notifications")
])
class PhotoBackupPlugin(private val activity:Activity):Plugin(activity){
 companion object {var callback:Channel?=null}
 @Command fun execute(invoke:Invoke){
  try{
   val args=invoke.parseArgs(PhotoArgs::class.java);val payload=JSONObject(args.payload);val identity=payload.optString("identity");if(args.callback!=null){callback=args.callback;if(activity.intent.getBooleanExtra("synolink_photo_backup",false)){activity.intent.removeExtra("synolink_photo_backup");callback?.send(JSObject().put("reason","open"))}}
   when(args.action){
    "requestLibrary"->{val aliases=if(Build.VERSION.SDK_INT>=34)arrayOf("media","selected","notifications")else if(Build.VERSION.SDK_INT>=33)arrayOf("media","notifications")else arrayOf("legacy");requestPermissionForAliases(aliases,invoke,"permissionDone")}
    "albums"->Thread{try{invoke.resolve(JSObject().put("albums",BackupLibrary.albums(activity)).put("access",BackupLibrary.access(activity)))}catch(_:Exception){invoke.reject("无法读取相册，请检查照片权限")}}.start()
    "snapshot"->invoke.resolve(JSObject(PhotoBackupStore.snapshot(activity,identity).toString()))
    "pause"->{if(PhotoBackupService.current?.identity==identity)PhotoBackupService.stop(activity);PhotoBackupStore.save(activity,identity,JSONObject().put("enabled",false).put("status","paused").put("message","备份已暂停"));invoke.resolve()}
    "invalidate"->{PhotoBackupService.stop(activity,"waitingLogin");invoke.resolve()}
    "start","resume"->{
     if(PhotoBackupService.pending!=null){invoke.reject("备份正在启动，请稍候");return};if(PhotoBackupService.current!=null){if(PhotoBackupService.current?.identity==identity&&PhotoBackupService.current?.isRunning==true){invoke.resolve();return};invoke.reject("原备份任务仍在停止，请稍后重试");return}
     if(args.action=="resume"){
      val saved=PhotoBackupStore.snapshot(activity,identity);if(!saved.optBoolean("enabled")){invoke.resolve();return}
      val config=saved.optJSONObject("config")?:run{invoke.resolve();return};config.keys().forEach{payload.put(it,config.get(it))}
     }
     if(BackupLibrary.access(activity)=="denied"){invoke.reject("请先授权访问照片");return}
     val destination=payload.optString("destination");val albums=payload.optJSONArray("albums")
     if(!destination.startsWith('/')||destination.split('/').any{it==".."||it=="."}||destination.any{it<' '||it=='\\'}||albums==null||albums.length()==0||albums.length()>100){invoke.reject("请选择有效的相册与 NAS 目录");return}
     PhotoBackupService.pending=payload
     val intent=Intent(activity,PhotoBackupService::class.java)
     try{if(Build.VERSION.SDK_INT>=26)activity.startForegroundService(intent)else activity.startService(intent);invoke.resolve()}catch(_:Exception){PhotoBackupService.pending=null;invoke.reject("无法启动后台备份，请返回前台后重试")}
    }
    "recheck"->{if(PhotoBackupService.current!=null){invoke.reject("请先暂停备份，再重新校验");return};val saved=PhotoBackupStore.snapshot(activity,identity);val config=saved.optJSONObject("config")?:run{invoke.resolve();return};Thread{try{BackupReceipts(activity).use{it.reset(hashText(identity+"\n"+config.getString("destination")))};invoke.resolve()}catch(_:Exception){invoke.reject("无法重置校验记录")}}.start()}
    else->invoke.reject("未知备份操作")
   }
  }catch(_:Exception){invoke.reject("备份操作失败，请检查权限和设置")}
 }
 @PermissionCallback fun permissionDone(invoke:Invoke){invoke.resolve(JSObject().put("access",BackupLibrary.access(activity)))}
}
