package com.zhoujianxiang.synolink

import android.app.*
import android.content.*
import android.database.ContentObserver
import android.net.*
import android.os.*
import android.provider.MediaStore
import org.json.*
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

internal object PhotoBackupStore {
 fun prefs(c:Context)=c.getSharedPreferences("photo-backup",Context.MODE_PRIVATE)
 fun publicConfig(config:JSONObject)=JSONObject().put("destination",config.getString("destination")).put("albums",config.getJSONArray("albums")).put("wifiOnly",config.optBoolean("wifiOnly",true)).put("includeVideos",config.optBoolean("includeVideos",false))
 fun snapshot(c:Context,identity:String):JSONObject {
  val data=JSONObject(prefs(c).getString(identity,"{}")?:"{}")
  if(PhotoBackupService.current?.identity!=identity&&data.optBoolean("enabled")&&data.optString("status") !in listOf("error","timeout"))data.put("status","waitingLogin").put("message","等待恢复，请登录来源账号后启动备份")
  return data.put("running",PhotoBackupService.current?.identity==identity&&PhotoBackupService.current?.isRunning==true).put("access",BackupLibrary.access(c))
 }
 @Synchronized fun save(c:Context,identity:String,values:JSONObject){val old=JSONObject(prefs(c).getString(identity,"{}")?:"{}");values.keys().forEach{old.put(it,values.get(it))};prefs(c).edit().putString(identity,old.toString()).commit()}
}
class PhotoBackupService:Service(){
 companion object {
  @Volatile internal var pending:JSONObject?=null
  @Volatile var current:PhotoBackupService?=null
  const val CHANNEL="synolink-photo-backup";const val ID=203
  fun stop(context:Context,reason:String="paused"){pending=null;current?.halt(reason);context.stopService(Intent(context,PhotoBackupService::class.java))}
 }
 var identity="";private set
 private var scope=""
 private var config=JSONObject()
 private val worker=Executors.newSingleThreadScheduledExecutor()
 private val rescanQueued=java.util.concurrent.atomic.AtomicBoolean(false)
 val isRunning:Boolean get()=!stopped
 @Volatile private var stopped=false
 private var http:BackupHttp?=null
 private var receipts:BackupReceipts?=null
 private var cleaned=false
 private var observer:ContentObserver?=null
 private var networkCallback:ConnectivityManager.NetworkCallback?=null
 @Volatile private var networkChecked=0L
 @Volatile private var networkReady=false
 private var wake:PowerManager.WakeLock?=null
 private var started=0L
 private var lastNotification=0L
 private var copied=0
 private var skipped=0
 private var deferred=0
 private var status="starting"
 private fun publish(next:String,message:String="",bytes:Long=0,total:Long=0){
  if(stopped&&next!="paused"&&next!="timeout"&&next!="error"&&next!="waitingLogin")return
  val now=SystemClock.elapsedRealtime();if(bytes>0&&now-lastNotification<1000)return;lastNotification=now
  status=next
  PhotoBackupStore.save(this,identity,JSONObject().put("status",next).put("message",message).put("copied",copied).put("skipped",skipped).put("bytes",bytes).put("total",total).put("updated",System.currentTimeMillis()))
  val manager=getSystemService(NotificationManager::class.java)
  val open=PendingIntent.getActivity(this,203,Intent(this,MainActivity::class.java).putExtra("synolink_photo_backup",true),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val pause=PendingIntent.getService(this,204,Intent(this,PhotoBackupService::class.java).setAction("pause"),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val builder=if(Build.VERSION.SDK_INT>=26)Notification.Builder(this,CHANNEL)else Notification.Builder(this)
  val notification=builder.setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("SynoLink 相册备份").setContentText(message.ifBlank{"本轮已备份 $copied 项 · 已处理 $skipped 项"}).setContentIntent(open).setOngoing(true).addAction(android.R.drawable.ic_media_pause,"暂停备份",pause).build()
  if(next=="starting")startForeground(ID,notification)else manager.notify(ID,notification)
 }
 override fun onBind(intent:Intent?)=null
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
  if(intent?.action=="pause"){halt("paused");stopSelf();return START_NOT_STICKY}
  if(current===this)return START_NOT_STICKY
  val selected=pending;pending=null;if(selected==null){stopSelf();return START_NOT_STICKY}
  config=selected;identity=config.getString("identity");scope=hashText(identity+"\n"+config.getString("destination"));current=this;started=SystemClock.elapsedRealtime()
  if(Build.VERSION.SDK_INT>=26)getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"相册自动备份",NotificationManager.IMPORTANCE_LOW))
  PhotoBackupStore.save(this,identity,JSONObject().put("config",PhotoBackupStore.publicConfig(config)).put("enabled",true))
  publish("starting","正在扫描已选相册")
  receipts=BackupReceipts(this);wake=(getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"SynoLink:photo-backup")
  observer=object:ContentObserver(Handler(Looper.getMainLooper())){override fun onChange(selfChange:Boolean){requestScan(3)}}
  contentResolver.registerContentObserver(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,true,observer!!)
  if(config.optBoolean("includeVideos"))contentResolver.registerContentObserver(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,true,observer!!)
  networkCallback=object:ConnectivityManager.NetworkCallback(){
   override fun onAvailable(network:Network){networkChecked=0;requestScan(0)}
   override fun onCapabilitiesChanged(network:Network,capabilities:NetworkCapabilities){networkChecked=0;if(status=="waitingNetwork")requestScan(0)}
   override fun onLost(network:Network){networkChecked=0}
  }
  getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(networkCallback!!)
  worker.scheduleWithFixedDelay({scan()},0,60,TimeUnit.SECONDS)
  return START_NOT_STICKY
 }
 private fun requestScan(delay:Long){if(!stopped&&rescanQueued.compareAndSet(false,true))try{worker.schedule({rescanQueued.set(false);scan()},delay,TimeUnit.SECONDS)}catch(_:Exception){rescanQueued.set(false)}}
 private fun wifiReady():Boolean {
  val now=SystemClock.elapsedRealtime();if(now-networkChecked<500)return networkReady;networkChecked=now
  val manager=getSystemService(ConnectivityManager::class.java);val caps=manager.getNetworkCapabilities(manager.activeNetwork)
  networkReady=caps!=null&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)&&(!config.optBoolean("wifiOnly",true)||caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))
  return networkReady
 }
 private fun alive(){if(SystemClock.elapsedRealtime()-started>5*60*60*1000L)throw BackupTimedOut();if(stopped||Thread.currentThread().isInterrupted)throw InterruptedException();if(!wifiReady())throw BackupFailure("等待 Wi-Fi 或网络恢复",true)}
 private fun scan(){
  if(stopped)return
  if(SystemClock.elapsedRealtime()-started>5*60*60*1000L){halt("timeout");stopSelf();return}
  if(!wifiReady()){publish("waitingNetwork","等待 Wi-Fi 或网络恢复");return}
  if(BackupLibrary.access(this)=="denied"){halt("error","照片访问权限已失效，请返回应用授权");stopSelf();return}
  try{
   // Bound the lock by the service deadline; release it whenever a scan finishes.
   wake?.acquire(5*60*60*1000L)
   if(!cleaned){File(cacheDir,"photo-backup").listFiles()?.filter{it.isFile&&it.name.endsWith(".part")}?.forEach{it.delete()};cleaned=true}
   if(http==null){http=BackupHttp(this,config){alive()};http!!.discover()}
   val selected=config.getJSONArray("albums");val albums=(0 until selected.length()).map{selected.getString(it)}.toSet()
   copied=0;skipped=0;deferred=0;publish("scanning","正在扫描已选相册")
   for(video in if(config.optBoolean("includeVideos"))listOf(false,true)else listOf(false)){
    var after=0L
    while(!stopped){alive();val page=BackupLibrary.page(this,video,after);if(page.isEmpty())break;after=page.last().first
     for((_,media) in page){alive();if(media.album !in albums||media.size<=0)continue
      if(receipts!!.known(scope,media)){skipped++;continue}
      try{backup(media)}catch(_:BackupMediaChanged){deferred++}catch(_:java.io.FileNotFoundException){deferred++}
     }
    }
   }
   publish("watching",if(deferred>0)"部分照片正在变化，将在下次扫描重试" else if(BackupLibrary.access(this)=="partial")"已扫描授权照片；部分权限无法覆盖全部相册" else "已扫描完成，正在等待新增照片")
  }catch(_:BackupTimedOut){halt("timeout");stopSelf()}catch(_:InterruptedException){}
  catch(e:BackupFailure){if(!stopped){if(e.retryable&&!wifiReady()){http=null;publish("waitingNetwork",e.label)}else{halt("error",e.label);stopSelf()}}}
  catch(_:SecurityException){halt("error","照片权限已变化，请返回应用重新授权");stopSelf()}
  catch(_:javax.net.ssl.SSLException){halt("error","HTTPS 证书或连接校验失败，请返回应用处理");stopSelf()}
  catch(_:java.io.IOException){if(!stopped){http=null;if(!wifiReady())publish("waitingNetwork","等待 Wi-Fi 或网络恢复")else{halt("error","读取照片或网络失败，请暂停后重新启动备份");stopSelf()}}}
  catch(_:Exception){if(!stopped){halt("error","备份失败，请返回应用检查目录、权限及存储空间");stopSelf()}}
  finally{wake?.let{if(it.isHeld)it.release()}}
 }
 private fun backup(media:BackupMedia){
  val dir=File(cacheDir,"photo-backup");dir.mkdirs();if(dir.usableSpace<media.size+32L*1024*1024)throw BackupFailure("手机缓存空间不足，请清理后重试")
  val temp=File(dir,java.util.UUID.randomUUID().toString()+".part")
  try{
   publish("preparing","正在读取原文件")
   val sha=MessageDigest.getInstance("SHA-256");val md5=MessageDigest.getInstance("MD5");var size=0L
   contentResolver.openInputStream(media.uri).use{input->if(input==null)throw BackupFailure("照片已删除或无法读取");temp.outputStream().use{out->val buffer=ByteArray(64*1024);while(true){alive();val n=input.read(buffer);if(n<0)break;size+=n;if(size>media.size)throw BackupMediaChanged();sha.update(buffer,0,n);md5.update(buffer,0,n);out.write(buffer,0,n)}}}
   if(size!=media.size||!BackupLibrary.unchanged(this,media))throw BackupMediaChanged()
   val digest=sha.digest().joinToString(""){"%02x".format(it)};val checksum=md5.digest().joinToString(""){"%02x".format(it)}
   val filename=PhotoBackupNames.fileName(media.name,digest)
   val remote=receipts!!.remote(scope,digest)?:config.getString("destination").trimEnd('/')+"/"+filename
   var verified=false
   for(attempt in 0..2){
    try{
     publish("verifying","正在检查 NAS 文件")
     if(!http!!.verify(remote,size,checksum)){
      // A receipt with a missing remote file uses its existing name when repairing the backup.
      http!!.upload(temp,remote.substringAfterLast('/')){bytes->if(bytes==size||bytes%(1024*1024)<64*1024)publish("uploading","正在上传原文件",bytes,size)}
      publish("verifying","正在校验 NAS 文件内容")
      if(!http!!.verify(remote,size,checksum))throw BackupFailure("上传结果尚未确认",true)
     }
     verified=true;break
    }catch(e:javax.net.ssl.SSLException){throw e}
    catch(e:BackupFailure){if(!e.retryable||attempt==2)throw e;Thread.sleep((attempt+1)*2000L)}
    catch(e:java.io.IOException){if(attempt==2)throw e;Thread.sleep((attempt+1)*2000L)}
   }
   alive();if(verified){receipts!!.save(scope,media,digest,remote);copied++}
  }finally{temp.delete()}
 }
 fun halt(reason:String,message:String=""){
  if(stopped)return
  stopped=true;val connection=http?.active;Thread{connection?.disconnect()}.start();worker.shutdownNow()
  publish(reason,message.ifBlank{if(reason=="timeout")"后台运行时限已到，请返回应用继续" else "备份已暂停"})
  PhotoBackupStore.save(this,identity,JSONObject().put("enabled",reason!="paused"))
 }
 override fun onTimeout(startId:Int,fgsType:Int){halt("timeout");stopSelf()}
 override fun onDestroy(){if(!stopped)halt("waitingLogin");observer?.let{contentResolver.unregisterContentObserver(it)};networkCallback?.let{getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it)};wake?.let{if(it.isHeld)it.release()};if(current===this)current=null;stopForeground(STOP_FOREGROUND_REMOVE);config=JSONObject();Thread{worker.awaitTermination(60,TimeUnit.SECONDS);if(worker.isTerminated)receipts?.close()}.start();super.onDestroy()}
}
