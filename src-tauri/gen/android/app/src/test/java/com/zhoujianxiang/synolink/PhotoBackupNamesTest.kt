package com.zhoujianxiang.synolink
import org.junit.Assert.*
import org.junit.Test
class PhotoBackupNamesTest {
 @Test fun sameContentAndNameAreStableButDifferentContentNeverCollides(){
  val a="a".repeat(64);val b="b".repeat(64)
  assertEquals(PhotoBackupNames.fileName("IMG_0001.HEIC",a),PhotoBackupNames.fileName("IMG_0001.HEIC",a))
  assertNotEquals(PhotoBackupNames.fileName("IMG_0001.HEIC",a),PhotoBackupNames.fileName("IMG_0001.HEIC",b))
  assertTrue(PhotoBackupNames.fileName("IMG_0001.HEIC",a).endsWith(".heic"))
 }
 @Test fun filenamesCannotInjectMultipartHeadersOrPaths(){
  val name=PhotoBackupNames.fileName("../x\"\r\nContent-Disposition: evil/照片.heic","c".repeat(64))
  assertFalse(name.contains('/'));assertFalse(name.contains('\\'));assertFalse(name.contains('"'));assertFalse(name.contains('\n'));assertFalse(name.contains('\r'))
 }
 @Test fun longUnicodeNamesFitNasFilenameLimit(){
  val name=PhotoBackupNames.fileName("旅行照片".repeat(100)+".JPG","d".repeat(64))
  assertTrue(name.toByteArray(Charsets.UTF_8).size<255)
 }
 @Test fun identityBoundariesCannotCollide(){assertNotEquals(hashText("[\"https://nas\",\"alice\"]"),hashText("[\"https://nas\",\"bob\"]"))}
}
