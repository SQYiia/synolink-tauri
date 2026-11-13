package com.zhoujianxiang.synolink

import android.content.*
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.net.*
import android.os.Build
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import javax.net.ssl.*

internal class BackupMediaChanged:Exception()
internal class BackupTimedOut:Exception()
internal class BackupFailure(val label:String, val retryable:Boolean=false):IOException(label)
internal fun hashText(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
internal data class BackupMedia(val uri:Uri,val album:String,val name:String,val size:Long,val revision:String)
internal class BackupReceipts(context:Context):SQLiteOpenHelper(context,"photo-backup.db",null,1){
 override fun onCreate(db:SQLiteDatabase){db.execSQL("CREATE TABLE receipts(scope TEXT, media TEXT, revision TEXT, digest TEXT, remote TEXT, size INTEGER, PRIMARY KEY(scope,media))");db.execSQL("CREATE INDEX content ON receipts(scope,digest)")}
 override fun onUpgrade(db:SQLiteDatabase,old:Int,next:Int){}
 fun known(scope:String,media:BackupMedia)=readableDatabase.rawQuery("SELECT 1 FROM receipts WHERE scope=? AND media=? AND revision=?",arrayOf(scope,media.uri.toString(),media.revision)).use{it.moveToFirst()}
 fun remote(scope:String,digest:String):String?=readableDatabase.rawQuery("SELECT remote FROM receipts WHERE scope=? AND digest=? LIMIT 1",arrayOf(scope,digest)).use{if(it.moveToFirst())it.getString(0)else null}
 fun save(scope:String,media:BackupMedia,digest:String,remote:String){writableDatabase.insertWithOnConflict("receipts",null,ContentValues().apply{put("scope",scope);put("media",media.uri.toString());put("revision",media.revision);put("digest",digest);put("remote",remote);put("size",media.size)},SQLiteDatabase.CONFLICT_REPLACE)}
 fun count(scope:String)=readableDatabase.rawQuery("SELECT count(*) FROM receipts WHERE scope=?",arrayOf(scope)).use{it.moveToFirst();it.getInt(0)}
 fun reset(scope:String){writableDatabase.delete("receipts","scope=?",arrayOf(scope))}
}
internal object BackupLibrary {
 fun access(context:Context):String {
  fun granted(p:String)=context.checkSelfPermission(p)==android.content.pm.PackageManager.PERMISSION_GRANTED
  if(Build.VERSION.SDK_INT<33)return if(granted("android.permission.READ_EXTERNAL_STORAGE"))"full" else "denied"
  if(granted("android.permission.READ_MEDIA_IMAGES")&&granted("android.permission.READ_MEDIA_VIDEO"))return "full"
  if(granted("android.permission.READ_MEDIA_IMAGES"))return "photos"
  if(granted("android.permission.READ_MEDIA_VIDEO"))return "videos"
  if(Build.VERSION.SDK_INT>=34&&granted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED"))return "partial"
  return "denied"
 }
 fun page(context:Context,video:Boolean,after:Long,albums:Set<String>?=null):List<Pair<Long,BackupMedia>> {
  val collection=if(video)MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
  val columns=mutableListOf("_id","bucket_id","bucket_display_name","_display_name","_size","date_modified")
  if(Build.VERSION.SDK_INT>=29)columns.add("volume_name")
  if(Build.VERSION.SDK_INT>=30)columns.add("generation_modified")
  var selection="_id > ?"
  if(Build.VERSION.SDK_INT>=29)selection+=" AND is_pending = 0"
  if(Build.VERSION.SDK_INT>=30)selection+=" AND is_trashed = 0"
  val result=mutableListOf<Pair<Long,BackupMedia>>()
  context.contentResolver.query(collection,columns.toTypedArray(),selection,arrayOf(after.toString()),"_id ASC")?.use{cursor->
   while(result.size<200&&cursor.moveToNext()){
    val id=cursor.getLong(0);val volume=if(Build.VERSION.SDK_INT>=29)cursor.getString(6)else "external"
    val album=volume+":"+cursor.getString(1);val base=if(Build.VERSION.SDK_INT>=29){if(video)MediaStore.Video.Media.getContentUri(volume)else MediaStore.Images.Media.getContentUri(volume)}else collection
    val size=cursor.getLong(4);val revision="$size:${cursor.getLong(5)}:"+(if(Build.VERSION.SDK_INT>=30)cursor.getLong(7)else 0)
    // Include non-selected rows for the pagination cursor; callers filter before opening any media.
    result.add(id to BackupMedia(ContentUris.withAppendedId(base,id),album,cursor.getString(3)?:"media",size,revision))
   }
  }
  return result
 }
 fun albums(context:Context):JSONArray {
  val rows=linkedMapOf<String,JSONObject>()
  for(video in listOf(false,true)){
   val collection=if(video)MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
   val columns=mutableListOf("bucket_id","bucket_display_name");if(Build.VERSION.SDK_INT>=29)columns.add("volume_name")
   try{context.contentResolver.query(collection,columns.toTypedArray(),null,null,null)?.use{cursor->while(cursor.moveToNext()){
    val volume=if(Build.VERSION.SDK_INT>=29)cursor.getString(2)else "external";val id=volume+":"+cursor.getString(0)
    val row=rows.getOrPut(id){JSONObject().put("id",id).put("name",cursor.getString(1)?:"未命名相册").put("count",0)};row.put("count",row.getInt("count")+1)
   }}}catch(_:SecurityException){}
  }
  return JSONArray(rows.values.toList())
 }
 fun unchanged(context:Context,media:BackupMedia):Boolean {
  val columns=mutableListOf("_size","date_modified");if(Build.VERSION.SDK_INT>=30)columns.add("generation_modified")
  return context.contentResolver.query(media.uri,columns.toTypedArray(),null,null,null)?.use{c->c.moveToFirst()&&"${c.getLong(0)}:${c.getLong(1)}:"+(if(Build.VERSION.SDK_INT>=30)c.getLong(2)else 0)==media.revision}?:false
 }
}
internal class BackupHttp(private val context:Context,private val config:JSONObject,private val alive:()->Unit){
 @Volatile var active:HttpURLConnection?=null
 private val apis=HashMap<String,Pair<String,Int>>()
 private fun connection(path:String):HttpURLConnection {
  alive();val base=config.getString("baseUrl").trimEnd('/');val url=URL(base+"/webapi/"+path)
  val manager=context.getSystemService(ConnectivityManager::class.java);val network=manager.activeNetwork
  val connection=if(config.optBoolean("wifiOnly",true)){if(network==null||manager.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)!=true)throw BackupFailure("等待 Wi-Fi 或网络恢复",true);network.openConnection(url)}else url.openConnection()
  val conn=connection as HttpURLConnection;conn.instanceFollowRedirects=false;conn.connectTimeout=15000;conn.readTimeout=45000
  if(conn is HttpsURLConnection&&config.optBoolean("allowInsecure")){
   val trust=arrayOf<javax.net.ssl.TrustManager>(object:X509TrustManager{override fun getAcceptedIssuers()=emptyArray<java.security.cert.X509Certificate>();override fun checkClientTrusted(chain:Array<java.security.cert.X509Certificate>,authType:String){};override fun checkServerTrusted(chain:Array<java.security.cert.X509Certificate>,authType:String){}})
   val ssl=SSLContext.getInstance("TLS");ssl.init(null,trust,null);conn.sslSocketFactory=ssl.socketFactory;conn.hostnameVerifier=HostnameVerifier{_,_->true}
  }
  val token=config.optString("synoToken");if(token.isNotEmpty())conn.setRequestProperty("X-SYNO-TOKEN",token)
  active=conn;return conn
 }
 private fun result(conn:HttpURLConnection):JSONObject {
  val code=conn.responseCode
  if(code !in 200..299)throw BackupFailure(if(code==401||code==403)"会话或权限失效，请返回应用处理" else "NAS 请求失败（HTTP $code）",code>=500||code==408||code==429)
  val bytes=conn.inputStream.use{input->val output=ByteArrayOutputStream();val buffer=ByteArray(8192);while(true){val n=input.read(buffer);if(n<0)break;if(output.size()+n>1024*1024)throw BackupFailure("NAS 响应过大");output.write(buffer,0,n)};output.toByteArray()}
  return try{JSONObject(String(bytes,Charsets.UTF_8))}catch(_:Exception){throw BackupFailure("NAS 返回无效响应")}
 }
 private fun send(cgi:String,params:Map<String,String>):JSONObject {
  val conn=connection(cgi)
  try{conn.requestMethod="POST";conn.doOutput=true;conn.setRequestProperty("Content-Type","application/x-www-form-urlencoded")
   val body=(params+mapOf("_sid" to config.getString("sid"))).entries.joinToString("&"){URLEncoder.encode(it.key,"UTF-8")+"="+URLEncoder.encode(it.value,"UTF-8")}.toByteArray()
   conn.setFixedLengthStreamingMode(body.size);conn.outputStream.use{it.write(body)};return result(conn)
  }finally{conn.disconnect();active=null}
 }
 fun discover(){
  val response=send("query.cgi",mapOf("api" to "SYNO.API.Info","version" to "1","method" to "query","query" to "SYNO.FileStation.Upload,SYNO.FileStation.List,SYNO.FileStation.MD5"))
  if(!response.optBoolean("success"))throw BackupFailure("无法查询备份接口")
  for((api,version)in mapOf("SYNO.FileStation.Upload" to 3,"SYNO.FileStation.List" to 2,"SYNO.FileStation.MD5" to 2)){
   val info=response.getJSONObject("data").optJSONObject(api)?:throw BackupFailure("NAS 缺少上传或校验接口")
   val path=info.getString("path");if(!Regex("[A-Za-z0-9_./-]+").matches(path)||path.contains("..")||path.startsWith('/'))throw BackupFailure("NAS 接口路径无效")
   if(info.optInt("minVersion",99)>version||info.optInt("maxVersion")<version)throw BackupFailure("NAS 备份接口版本不兼容")
   apis[api]=path to version
  }
 }
 fun request(api:String,method:String,params:Map<String,String> = emptyMap()):JSONObject {
  val endpoint=apis[api]?:throw BackupFailure("NAS 接口尚未确认")
  val response=send(endpoint.first,params+mapOf("api" to api,"version" to endpoint.second.toString(),"method" to method))
  if(!response.optBoolean("success")){
   val code=response.optJSONObject("error")?.optInt("code")?:0
   throw BackupFailure(when(code){105,106,107,119,403,407->"会话或权限失效，请返回应用处理";415,416->"NAS 空间或配额不足";408->"目标文件不存在";else->"NAS 操作失败（$code）"})
  }
  return response.optJSONObject("data")?:JSONObject()
 }
 fun verify(path:String,size:Long,md5:String):Boolean {
  val info=try{request("SYNO.FileStation.List","getinfo",mapOf("path" to JSONArray(listOf(path)).toString(),"additional" to "[\"size\"]"))}catch(e:BackupFailure){if(e.label=="目标文件不存在")return false;throw e}
  val row=info.optJSONArray("files")?.optJSONObject(0)?:return false
  if(row.optJSONObject("error")?.optInt("code")==408)return false
  if(row.optJSONObject("additional")?.optLong("size",-1)!=size)throw BackupFailure("NAS 同名文件内容冲突，已停止，未覆盖")
  val id=request("SYNO.FileStation.MD5","start",mapOf("file_path" to JSONObject.quote(path))).getString("taskid")
  try{repeat(90){alive();val data=request("SYNO.FileStation.MD5","status",mapOf("taskid" to JSONObject.quote(id)));if(data.optBoolean("finished")){if(!data.optString("md5").equals(md5,true))throw BackupFailure("NAS 文件校验不一致，未标记完成");return true};Thread.sleep(1000)};throw BackupFailure("NAS 文件校验超时，可重试",true)}
  finally{try{request("SYNO.FileStation.MD5","stop",mapOf("taskid" to JSONObject.quote(id)))}catch(_:Exception){}}
 }
 fun upload(file:File,name:String,onBytes:(Long)->Unit){
  val endpoint=apis["SYNO.FileStation.Upload"]?:throw BackupFailure("上传接口不可用")
  val boundary="SynoLink"+java.util.UUID.randomUUID().toString().replace("-","")
  val fields=mapOf("api" to "SYNO.FileStation.Upload","version" to endpoint.second.toString(),"method" to "upload","path" to config.getString("destination"),"create_parents" to "false","overwrite" to "skip","_sid" to config.getString("sid"))
  val prefix=(fields.entries.joinToString(""){"--$boundary\r\nContent-Disposition: form-data; name=\"${it.key}\"\r\n\r\n${it.value}\r\n"}+"--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$name\"\r\nContent-Type: application/octet-stream\r\n\r\n").toByteArray()
  val suffix="\r\n--$boundary--\r\n".toByteArray();val conn=connection(endpoint.first)
  try{conn.requestMethod="POST";conn.doOutput=true;conn.setRequestProperty("Content-Type","multipart/form-data; boundary=$boundary");conn.setFixedLengthStreamingMode(prefix.size+file.length()+suffix.size)
   conn.outputStream.use{out->out.write(prefix);file.inputStream().use{input->val buffer=ByteArray(64*1024);var sent=0L;while(true){alive();val n=input.read(buffer);if(n<0)break;out.write(buffer,0,n);sent+=n;onBytes(sent)}};out.write(suffix)}
   val response=result(conn);if(!response.optBoolean("success")){val code=response.optJSONObject("error")?.optInt("code");throw BackupFailure(when(code){105,106,107,119,403,407->"会话或权限失效，请返回应用处理";415,416->"NAS 空间或配额不足";else->"上传失败（$code）"})}
  }finally{conn.disconnect();active=null}
 }
}
