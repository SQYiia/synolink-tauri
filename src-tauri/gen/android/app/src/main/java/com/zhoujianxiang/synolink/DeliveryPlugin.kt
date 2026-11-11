package com.zhoujianxiang.synolink
import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.*
import app.tauri.plugin.*
import java.io.File

@InvokeArg
class DeliveryArgs { lateinit var path:String; var share:Boolean=false }
@InvokeArg
class DownloadArgs { lateinit var callback:Channel }
@InvokeArg
class ProgressArgs { var percent:Int=0 }
@TauriPlugin
class DeliveryPlugin(private val activity:Activity):Plugin(activity){
 @Command
 fun startDownloads(invoke:Invoke){try{if(android.os.Build.VERSION.SDK_INT>=33){val preferences=activity.getSharedPreferences("download-permissions",0);if(!preferences.getBoolean("asked",false)){preferences.edit().putBoolean("asked",true).apply();activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),201)}};DownloadService.callback=invoke.parseArgs(DownloadArgs::class.java).callback;val intent=Intent(activity,DownloadService::class.java);if(android.os.Build.VERSION.SDK_INT>=26)activity.startForegroundService(intent)else activity.startService(intent);invoke.resolve()}catch(e:Exception){invoke.reject("无法启动后台服务")}}
 @Command
 fun updateDownloads(invoke:Invoke){DownloadService.current?.progress(invoke.parseArgs(ProgressArgs::class.java).percent.coerceIn(0,100));invoke.resolve()}
 @Command
 fun stopDownloads(invoke:Invoke){activity.stopService(Intent(activity,DownloadService::class.java));invoke.resolve()}
 private var pending:File?=null
 @Command
 fun deliver(invoke:Invoke){
  if(pending!=null){invoke.reject("已有文件导出正在进行");return}
  try{
   val args=invoke.parseArgs(DeliveryArgs::class.java)
   val source=File(args.path).canonicalFile
   if(!source.isFile || !source.toPath().startsWith(activity.filesDir.canonicalFile.toPath())){invoke.reject("文件不可访问");return}
   if(args.share){
    val dir=File(activity.cacheDir,"shared-downloads");dir.mkdirs()
    val target=File(dir,java.util.UUID.randomUUID().toString()+"-"+source.name)
    Thread{try{source.copyTo(target,true);val uri=FileProvider.getUriForFile(activity,activity.packageName+".fileprovider",target)
     activity.runOnUiThread{val intent=Intent(Intent.ACTION_SEND).setType("application/octet-stream").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);activity.startActivity(Intent.createChooser(intent,"分享文件"));invoke.resolve(JSObject().put("saved",true))}
    }catch(e:Exception){invoke.reject("无法分享文件")}}.start()
   }else{pending=source;val intent=Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,source.name);startActivityForResult(invoke,intent,"saved")}
  }catch(e:Exception){pending=null;invoke.reject("无法打开文件操作")}
 }
 @ActivityCallback
 fun saved(invoke:Invoke,result:ActivityResult){
  val source=pending;pending=null;val uri=result.data?.data
  if(result.resultCode!=Activity.RESULT_OK||uri==null||source==null){invoke.resolve(JSObject().put("saved",false));return}
  Thread{try{activity.contentResolver.openOutputStream(uri,"w").use{out->if(out==null)throw Exception();source.inputStream().use{it.copyTo(out)}};invoke.resolve(JSObject().put("saved",true))}catch(e:Exception){invoke.reject("保存失败，请检查目标空间或权限")}}.start()
 }
}
