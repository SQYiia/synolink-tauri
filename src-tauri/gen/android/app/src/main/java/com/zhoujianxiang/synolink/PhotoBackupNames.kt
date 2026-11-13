package com.zhoujianxiang.synolink
internal object PhotoBackupNames {
 fun fileName(original:String,digest:String):String {
  require(Regex("[0-9a-f]{64}").matches(digest))
  val extension=original.substringAfterLast('.',"").lowercase().filter{it.isLetterOrDigit()}.take(10)
  val stem=original.substringBeforeLast('.',original).replace(Regex("[\\\\/\":*?<>|\r\n\u0000-\u001f]"),"_").take(40).ifBlank{"photo"}
  return stem+"--"+digest+(if(extension.isBlank())"" else ".$extension")
 }
}
