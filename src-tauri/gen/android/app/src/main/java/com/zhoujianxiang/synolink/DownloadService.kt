package com.zhoujianxiang.synolink
import android.app.*
import android.content.Intent
import android.os.*
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
class DownloadService:Service(){
 companion object { var callback:Channel?=null;var current:DownloadService?=null;const val CHANNEL="synolink-downloads";const val ID=201 }
 private var notification:Notification.Builder?=null
 fun progress(percent:Int){val builder=notification?:return;builder.setContentText("总体进度 $percent%").setProgress(100,percent,false);getSystemService(NotificationManager::class.java).notify(ID,builder.build())}
 private var wake:PowerManager.WakeLock?=null
 override fun onBind(intent:Intent?)=null
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
  if(intent?.action=="cancel"){callback?.send(JSObject().put("reason","cancel"));stopSelf();return START_NOT_STICKY}
  val manager=getSystemService(NotificationManager::class.java)
  if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(NotificationChannel(CHANNEL,"后台下载",NotificationManager.IMPORTANCE_LOW))
  val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java).putExtra("synolink_transfers",true),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val cancel=PendingIntent.getService(this,1,Intent(this,DownloadService::class.java).setAction("cancel"),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val builder=if(Build.VERSION.SDK_INT>=26)Notification.Builder(this,CHANNEL)else Notification.Builder(this)
  current=this;notification=builder
  startForeground(ID,builder.setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("SynoLink 正在下载").setContentText("点击返回应用查看进度").setContentIntent(open).setOngoing(true).addAction(android.R.drawable.ic_menu_close_clear_cancel,"取消全部",cancel).build())
  if(wake==null){wake=(getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"SynoLink:download");wake?.acquire(6*60*60*1000L)}
  return START_NOT_STICKY
 }
 override fun onTimeout(startId:Int,fgsType:Int){callback?.send(JSObject().put("reason","timeout"));stopSelf()}
 override fun onDestroy(){current=null;wake?.let{if(it.isHeld)it.release()};wake=null;super.onDestroy()}
}
