# Synology File Station Official API Reference

> 基于 Synology File Station Official API 文档整理，供 synolink-tauri 项目开发参考。

## 目录

- [1. 概述](#1-概述)
- [2. 通用错误码](#2-通用错误码)
- [3. SYNO.API.Info](#3-synoapiinfo)
- [4. SYNO.API.Auth](#4-synoapiauth)
- [5. SYNO.FileStation.Info](#5-synofilestationinfo)
- [6. SYNO.FileStation.List](#6-synofilestationlist)
- [7. SYNO.FileStation.Search](#7-synofilestationsearch)
- [8. SYNO.FileStation.VirtualFolder](#8-synofilestationvirtualfolder)
- [9. SYNO.FileStation.Favorite](#9-synofilestationfavorite)
- [10. SYNO.FileStation.Thumb](#10-synofilestationthumb)
- [11. SYNO.FileStation.DirSize](#11-synofilestationdirsize)
- [12. SYNO.FileStation.MD5](#12-synofilestationmd5)
- [13. SYNO.FileStation.CheckPermission](#13-synofilestationcheckpermission)
- [14. SYNO.FileStation.Upload](#14-synofilestationupload)
- [15. SYNO.FileStation.Download](#15-synofilestationdownload)
- [16. SYNO.FileStation.Sharing](#16-synofilestationsharing)
- [17. SYNO.FileStation.CreateFolder](#17-synofilestationcreatefolder)
- [18. SYNO.FileStation.Rename](#18-synofilestationrename)
- [19. SYNO.FileStation.CopyMove](#19-synofilestationcopymove)
- [20. SYNO.FileStation.Delete](#20-synofilestationdelete)
- [21. SYNO.FileStation.Extract](#21-synofilestationextract)
- [22. SYNO.FileStation.Compress](#22-synofilestationcompress)
- [23. SYNO.FileStation.BackgroundTask](#23-synofilestationbackgroundtask)

---

## 1. 概述

### 请求格式

```
GET /webapi/<CGI_PATH>?api=<API_NAME>&version=<VERSION>&method=<METHOD>[&<PARAMS>][&_sid=<SID>]
```

- **CGI_PATH**: 通过 `SYNO.API.Info` 查询获得，DSM 6.0+ 统一使用 `entry.cgi`
- **API_NAME**: API 名称，如 `SYNO.FileStation.List`
- **VERSION**: API 版本号（介于 minVersion 和 maxVersion 之间）
- **METHOD**: 方法名
- **_sid**: 登录后获得的 Session ID

### 响应格式

```json
{
  "success": true,
  "data": { ... }
}
```

失败时：
```json
{
  "success": false,
  "error": {
    "code": 119,
    "errors": { ... }
  }
}
```

### 重要：参数编码规则

- 数组类参数（如 `path`）必须使用 **JSON 数组** 格式：`["/path/to/file"]`
- 字符串枚举参数（如 `mode`）必须使用 **JSON 字符串** 格式：`"open"`
- 布尔型参数使用字符串 `"true"` / `"false"`
- 多值列表使用逗号分隔（如 `additional`）或 JSON 数组

### 非阻塞任务模式

Search、DirSize、MD5、CopyMove、Delete(start) 等长耗时操作采用非阻塞模式：

1. 调用 `start` 方法 → 返回 `taskid`
2. 轮询 `status` 方法 → 检查 `finished` 字段
3. 完成后调用 `stop` / `clean` 释放任务资源

---

## 2. 通用错误码

### 所有 API 共用

| Code | 描述 |
|------|------|
| 100 | Unknown error |
| 101 | No parameter of API, method, or version |
| 102 | The requested API does not exist |
| 103 | The requested method does not exist |
| 104 | The requested version does not support the functionality |
| 105 | The logged in session does not have permission |
| 106 | Session timeout |
| 107 | Session interrupted by duplicate login |
| 119 | SID not found (需重新登录) |

### FileStation 通用错误码 (400-421)

| Code | 描述 |
|------|------|
| 400 | Invalid parameter of file operation |
| 401 | Unknown error of file operation |
| 402 | System is too busy |
| 403 | Invalid user does this file operation |
| 404 | Invalid group does this file operation |
| 405 | Invalid user and group does this file operation |
| 406 | Can't get user/group information from the account server |
| 407 | Operation not permitted |
| 408 | No such file or directory |
| 409 | Non-supported file system |
| 410 | Failed to connect internet-based file system (ex: CIFS) |
| 411 | Read-only file system |
| 412 | Filename too long in the non-encrypted file system |
| 413 | Filename too long in the encrypted file system |
| 414 | File already exists |
| 415 | Disk quota exceeded |
| 416 | No space left on device |
| 417 | Input/output error |
| 418 | Illegal name or path |
| 419 | Illegal file name |
| 420 | Illegal file name on FAT file system |
| 421 | Device or resource busy |

---

## 3. SYNO.API.Info

查询 DSM 上可用的 API 列表及其 CGI 路径、版本范围。

| 属性 | 值 |
|------|-----|
| API | SYNO.API.Info |
| Version | 1 |
| Path | query.cgi |
| Method | query |
| 需要登录 | 否 |

### 请求

```
GET /webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=all
```

| 参数 | 必填 | 说明 |
|------|------|------|
| query | 是 | 要查询的 API 列表，逗号分隔。`all` 返回所有。 |

### 响应

```json
{
  "success": true,
  "data": {
    "SYNO.API.Auth": {
      "path": "entry.cgi",
      "minVersion": 1,
      "maxVersion": 7,
      "requestFormat": "JSON"
    },
    "SYNO.FileStation.List": {
      "path": "entry.cgi",
      "minVersion": 1,
      "maxVersion": 2
    }
  }
}
```

---

## 4. SYNO.API.Auth

身份认证（登录/登出）。

| 属性 | 值 |
|------|-----|
| API | SYNO.API.Auth |
| Version | 1-7 (推荐 ≥3) |
| Path | entry.cgi (DSM 6+) |
| 需要登录 | 否（login）/ 是（logout） |

### 4.1 login

```
POST /webapi/entry.cgi
Content-Type: application/x-www-form-urlencoded

api=SYNO.API.Auth&version=3&method=login&session=FileStation&format=sid
&account=admin&passwd=xxx&enable_syno_token=yes
```

| 参数 | 必填 | 说明 |
|------|------|------|
| account | 是 | 用户名 |
| passwd | 是 | 密码 |
| session | 是 | 会话名，建议 `FileStation` |
| format | 否 | `cookie` 或 `sid`（推荐 `sid`） |
| otp_code | 否 | 两步验证 OTP |
| enable_syno_token | 否 | `yes` 返回 synotoken（用于 CSRF 保护） |
| enable_device_token | 否 | `yes` 返回 device token（记住设备） |
| device_name | 否 | 设备名称 |
| device_id | 否 | 之前获取的 device token（跳过 OTP） |

### 响应

```json
{
  "success": true,
  "data": {
    "sid": "ohNoSid123",
    "synotoken": "someTokenHere",
    "did": "deviceId123",
    "is_portal_port": false
  }
}
```

### 4.2 logout

```
GET /webapi/entry.cgi?api=SYNO.API.Auth&version=3&method=logout&session=FileStation&_sid=xxx
```

### Auth 特有错误码

| Code | 描述 |
|------|------|
| 400 | No such account or incorrect password |
| 401 | Account disabled |
| 402 | Permission denied |
| 403 | 2-step verification code required |
| 404 | Failed to authenticate 2-step verification code |

---

## 5. SYNO.FileStation.Info

获取 File Station 基本信息。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Method | get |

### 请求

```
GET /webapi/entry.cgi?api=SYNO.FileStation.Info&version=2&method=get&_sid=xxx
```

### 响应

```json
{
  "success": true,
  "data": {
    "is_manager": true,
    "support_sharing": true,
    "hostname": "DiskStation"
  }
}
```

---

## 6. SYNO.FileStation.List

列出共享文件夹和文件。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Methods | list_share, list, getinfo |

### 6.1 list_share — 列出共享文件夹

```
GET /webapi/entry.cgi?api=SYNO.FileStation.List&version=2&method=list_share
&offset=0&limit=0&additional=["real_path","owner","time","perm","volume_status"]&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| offset | 否 | 起始偏移量，默认 0 |
| limit | 否 | 返回条数，0=全部 |
| sort_by | 否 | name, user, group, mtime, atime, ctime, crtime, posix |
| sort_direction | 否 | asc / desc |
| onlywritable | 否 | true=只返回可写的 |
| additional | 否 | 额外信息：real_path, size, owner, time, perm, mount_point_type, volume_status |

### 响应

```json
{
  "success": true,
  "data": {
    "total": 3,
    "offset": 0,
    "shares": [
      {
        "isdir": true,
        "name": "photo",
        "path": "/photo",
        "additional": {
          "real_path": "/volume1/photo",
          "owner": { "user": "admin", "group": "administrators", "uid": 1024, "gid": 101 },
          "time": { "atime": 1369964337, "mtime": 1369964337, "ctime": 1369964337, "crtime": 1369964337 },
          "perm": { "posix": 777, "is_acl_mode": true, "acl": { "append": true, "del": true, "exec": true, "read": true, "write": true } },
          "volume_status": { "freespace": 12345678, "totalspace": 98765432, "readonly": false }
        }
      }
    ]
  }
}
```

### 6.2 list — 列出文件/目录

```
GET /webapi/entry.cgi?api=SYNO.FileStation.List&version=2&method=list
&folder_path="/photo"&offset=0&limit=100
&additional=["real_path","size","owner","time","perm","type"]
&filetype=all&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| folder_path | 是 | 目录路径（JSON string） |
| offset | 否 | 偏移 |
| limit | 否 | 条数，0=全部 |
| sort_by | 否 | name, size, user, group, mtime, atime, ctime, crtime, type, posix |
| sort_direction | 否 | asc / desc |
| pattern | 否 | 文件名过滤 glob（如 `*.jpg`） |
| filetype | 否 | all / file / dir |
| goto_path | 否 | 定位到某文件，自动计算 offset |
| additional | 否 | real_path, size, owner, time, perm, type, mount_point_type |

### 响应

```json
{
  "success": true,
  "data": {
    "total": 42,
    "offset": 0,
    "files": [
      {
        "isdir": false,
        "name": "test.jpg",
        "path": "/photo/test.jpg",
        "additional": {
          "size": 1024567,
          "time": { "atime": 1369964337, "mtime": 1369964337, "ctime": 1369964337, "crtime": 1369964337 },
          "type": "jpg"
        }
      }
    ]
  }
}
```

### 6.3 getinfo — 获取指定文件/文件夹信息

```
GET /webapi/entry.cgi?api=SYNO.FileStation.List&version=2&method=getinfo
&path=["/photo/test.jpg"]&additional=["real_path","size","owner","time","perm","type"]&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | JSON 数组，可含多个路径 |
| additional | 否 | 同 list |

### List 特有错误码

| Code | 描述 |
|------|------|
| 408 | No such file or directory |
| 900 | Unknown error |

---

## 7. SYNO.FileStation.Search

文件搜索（非阻塞任务模式）。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Methods | start, list, stop, clean |

### 7.1 start — 启动搜索

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Search&version=2&method=start
&folder_path="/volume1"&pattern="*.mp4"&recursive=true&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| folder_path | 是 | 搜索根目录 |
| recursive | 否 | 是否递归子目录，默认 true |
| pattern | 否 | 文件名 glob 匹配 |
| extension | 否 | 扩展名过滤（如 `jpg,png`） |
| filetype | 否 | file / dir / all |
| size_from | 否 | 最小文件大小(bytes) |
| size_to | 否 | 最大文件大小(bytes) |
| mtime_from | 否 | 最早修改时间(Unix timestamp) |
| mtime_to | 否 | 最晚修改时间(Unix timestamp) |
| crtime_from | 否 | 最早创建时间 |
| crtime_to | 否 | 最晚创建时间 |
| atime_from | 否 | 最早访问时间 |
| atime_to | 否 | 最晚访问时间 |
| owner | 否 | 文件所有者 |
| group | 否 | 文件所属组 |

### 响应

```json
{
  "success": true,
  "data": { "taskid": "FileStation_5F4EE2D1234" }
}
```

### 7.2 list — 获取搜索结果

```
GET /webapi/entry.cgi?api=SYNO.FileStation.Search&version=2&method=list
&taskid=FileStation_5F4EE2D1234&offset=0&limit=100
&additional=["real_path","size","time","type","perm"]&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| taskid | 是 | start 返回的任务ID |
| offset | 否 | 偏移 |
| limit | 否 | 条数（默认100） |
| sort_by | 否 | 排序字段 |
| sort_direction | 否 | asc / desc |
| pattern | 否 | 二次过滤 |
| filetype | 否 | file / dir / all |
| additional | 否 | 附加信息 |

### 响应

```json
{
  "success": true,
  "data": {
    "total": 5,
    "offset": 0,
    "finished": true,
    "files": [ ... ]
  }
}
```

### 7.3 stop — 停止搜索任务

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Search&version=2&method=stop&taskid=xxx&_sid=xxx
```

### 7.4 clean — 清理已停止任务

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Search&version=2&method=clean&taskid=xxx&_sid=xxx
```

### Search 特有错误码

| Code | 描述 |
|------|------|
| 800 | Search task not found |
| 801 | Search folder does not exist |
| 802 | Search task running, cannot start another |

---

## 8. SYNO.FileStation.VirtualFolder

列出远程文件夹和虚拟文件系统挂载点。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Method | list |

### 请求

```
GET /webapi/entry.cgi?api=SYNO.FileStation.VirtualFolder&version=2&method=list
&type=cifs&offset=0&limit=0&additional=["real_path","owner","time","perm","volume_status"]&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| type | 是 | cifs / iso / all |
| offset | 否 | 偏移 |
| limit | 否 | 条数 |
| sort_by | 否 | 排序 |
| sort_direction | 否 | asc / desc |
| additional | 否 | 附加信息 |

---

## 9. SYNO.FileStation.Favorite

管理用户收藏夹。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Methods | list, add, delete, clear_broken, edit, replace_all |

### 9.1 list

```
GET /webapi/entry.cgi?api=SYNO.FileStation.Favorite&version=2&method=list
&offset=0&limit=0&additional=["real_path","owner","time"]&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| offset | 否 | 偏移 |
| limit | 否 | 条数 |
| status_filter | 否 | valid / broken / all |
| additional | 否 | 附加信息 |

### 9.2 add

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Favorite&version=2&method=add
&path="/photo/vacation"&name="假期照片"&index=0&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | 目录路径 |
| name | 是 | 收藏名称 |
| index | 否 | 位置索引 |

### 9.3 delete

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Favorite&version=2&method=delete
&path="/photo/vacation"&_sid=xxx
```

### 9.4 clear_broken

清除所有失效的收藏。

### 9.5 edit

修改收藏名称。

### 9.6 replace_all

用新列表完全替换所有收藏。

---

## 10. SYNO.FileStation.Thumb

获取文件缩略图。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Method | get |

### 请求

```
GET /webapi/entry.cgi?api=SYNO.FileStation.Thumb&version=2&method=get
&path="/photo/test.jpg"&size=medium&rotate=0&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | 文件路径 |
| size | 是 | small (64px) / medium (256px) / large (1024px) / original |
| rotate | 否 | 旋转角度 0/90/180/270 |

### 响应

成功时直接返回 JPEG 二进制数据（`Content-Type: image/jpeg`）。

### 支持的文件类型

- 图片：jpg, jpeg, jpe, bmp, png, tif, tiff, gif, arw, srf, sr2, dcr, k25, kdc, cr2, crw, nef, mrw, ptx, pef, raf, 3fr, erf, mef, mos, orf, rw2, dng, x3f, raw
- 视频：3gp, 3g2, asf, dat, divx, dvr-ms, m2t, m2ts, m4v, mkv, mp4, mts, mov, qt, tp, trp, ts, vob, wmv, xvid, ac3, avi, flv, f4v, mpeg, mpg, rm, rmvb, ifo, webm

### Thumb 特有错误码

| Code | 描述 |
|------|------|
| 800 | File not found |
| 801 | Cannot generate thumbnail |

---

## 11. SYNO.FileStation.DirSize

计算目录大小（非阻塞任务模式）。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Methods | start, status, stop |

### 11.1 start

```
POST /webapi/entry.cgi
api=SYNO.FileStation.DirSize&version=2&method=start
&path=["/photo","/video"]&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | JSON 数组，目录路径列表 |

### 11.2 status

```
GET /webapi/entry.cgi?api=SYNO.FileStation.DirSize&version=2&method=status
&taskid=xxx&_sid=xxx
```

### 响应

```json
{
  "success": true,
  "data": {
    "finished": true,
    "num_dir": 15,
    "num_file": 230,
    "total_size": 1073741824
  }
}
```

### 11.3 stop

```
POST /webapi/entry.cgi
api=SYNO.FileStation.DirSize&version=2&method=stop&taskid=xxx&_sid=xxx
```

---

## 12. SYNO.FileStation.MD5

计算文件 MD5 值（非阻塞任务模式）。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Methods | start, status, stop |

### 12.1 start

```
POST /webapi/entry.cgi
api=SYNO.FileStation.MD5&version=2&method=start
&file_path="/photo/test.jpg"&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| file_path | 是 | 文件路径 |

### 12.2 status

```
GET /webapi/entry.cgi?api=SYNO.FileStation.MD5&version=2&method=status
&taskid=xxx&_sid=xxx
```

### 响应

```json
{
  "success": true,
  "data": {
    "finished": true,
    "md5": "d41d8cd98f00b204e9800998ecf8427e"
  }
}
```

---

## 13. SYNO.FileStation.CheckPermission

检查文件/目录权限。

| 属性 | 值 |
|------|-----|
| Version | 1-3 |
| Method | write |

### 请求

```
GET /webapi/entry.cgi?api=SYNO.FileStation.CheckPermission&version=3&method=write
&path="/photo"&filename="test.txt"&overwrite=false&create_only=false&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | 目录路径 |
| filename | 是 | 文件名 |
| overwrite | 否 | 是否覆盖检查 |
| create_only | 否 | 仅检查创建权限 |

成功返回 `{"success": true}`，失败返回对应错误码。

---

## 14. SYNO.FileStation.Upload

文件上传（multipart/form-data）。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Method | upload |

### 请求

```
POST /webapi/entry.cgi
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="api"
SYNO.FileStation.Upload
--boundary
Content-Disposition: form-data; name="version"
2
--boundary
Content-Disposition: form-data; name="method"
upload
--boundary
Content-Disposition: form-data; name="path"
/photo
--boundary
Content-Disposition: form-data; name="create_parents"
true
--boundary
Content-Disposition: form-data; name="overwrite"
true
--boundary
Content-Disposition: form-data; name="_sid"
xxx
--boundary
Content-Disposition: form-data; name="file"; filename="test.jpg"
Content-Type: image/jpeg

<binary data>
--boundary--
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | 上传目标目录 |
| create_parents | 否 | 自动创建父目录 |
| overwrite | 否 | true=覆盖同名文件, false=跳过 |
| mtime | 否 | 自定义修改时间(Unix timestamp) |
| crtime | 否 | 自定义创建时间 |
| atime | 否 | 自定义访问时间 |
| file | 是 | 上传文件（multipart file field） |

**注意**：`file` 字段必须放在最后。

### Upload 特有错误码

| Code | 描述 |
|------|------|
| 1800 | There is no Content-Length information in the HTTP header |
| 1801 | Not enough space to upload |
| 1802 | Quota exceeded |
| 1803 | File too large to upload |

---

## 15. SYNO.FileStation.Download

文件下载。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Method | download |

### 请求

```
GET /webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download
&path=%5B%22%2Fphoto%2Ftest.jpg%22%5D&mode=%22open%22&_sid=xxx
```

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| path | 是 | JSON array | 文件路径数组，如 `["/photo/test.jpg"]` |
| mode | 是 | JSON string | `"open"` = 浏览器打开；`"download"` = 下载（设 Content-Disposition） |

### 重要编码说明

- **path** 参数必须是 JSON 数组格式：`["/path/to/file"]`
  - URL 编码后为：`%5B%22%2Fphoto%2Ftest.jpg%22%5D`
- **mode** 参数必须是 JSON 字符串格式：`"open"` 或 `"download"`
  - URL 编码后为：`%22open%22` 或 `%22download%22`

### 响应

成功时直接返回文件二进制数据，Content-Type 为对应 MIME 类型。

多文件下载时返回 zip 压缩包。

### Download 特有错误码

| Code | 描述 |
|------|------|
| 900 | Unknown error |

---

## 16. SYNO.FileStation.Sharing

文件共享链接管理。

| 属性 | 值 |
|------|-----|
| Version | 1-3 |
| Methods | getinfo, list, create, delete, clear_invalid, edit |

### 16.1 list — 列出共享链接

```
GET /webapi/entry.cgi?api=SYNO.FileStation.Sharing&version=3&method=list
&offset=0&limit=0&sort_by=name&sort_direction=asc&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| offset | 否 | 偏移 |
| limit | 否 | 条数 |
| sort_by | 否 | id, name, isFolder, path, date_expired, date_available, status, has_password, url, link_owner |
| sort_direction | 否 | asc / desc |
| force_clean | 否 | true=清除无效链接 |

### 响应

```json
{
  "success": true,
  "data": {
    "total": 2,
    "offset": 0,
    "links": [
      {
        "id": "abc123",
        "url": "https://nas.example.com/sharing/abc123",
        "link_owner": "admin",
        "path": "/photo/test.jpg",
        "isFolder": false,
        "has_password": false,
        "date_expired": "0",
        "date_available": "0",
        "status": "valid",
        "name": "test.jpg"
      }
    ]
  }
}
```

### 16.2 getinfo

```
GET /webapi/entry.cgi?api=SYNO.FileStation.Sharing&version=3&method=getinfo
&id="abc123"&_sid=xxx
```

### 16.3 create — 创建共享链接

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Sharing&version=3&method=create
&path="/photo/test.jpg"&password="123"&date_expired="2025-12-31"&date_available="2025-01-01"&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | 文件/目录路径 |
| password | 否 | 访问密码 |
| date_expired | 否 | 过期日期 (yyyy-MM-dd) |
| date_available | 否 | 生效日期 |

### 响应

```json
{
  "success": true,
  "data": {
    "links": [
      {
        "id": "newLink123",
        "url": "https://nas.example.com/sharing/newLink123",
        "path": "/photo/test.jpg"
      }
    ]
  }
}
```

### 16.4 delete

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Sharing&version=3&method=delete&id="abc123"&_sid=xxx
```

### 16.5 clear_invalid

清除所有无效的共享链接。

### 16.6 edit

修改共享链接属性（密码、有效期等）。

### Sharing 特有错误码

| Code | 描述 |
|------|------|
| 2000 | Sharing link does not exist |
| 2001 | Cannot generate sharing link because too many links exist |
| 2002 | Failed to access sharing links |

---

## 17. SYNO.FileStation.CreateFolder

创建新文件夹。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Method | create |

### 请求

```
POST /webapi/entry.cgi
api=SYNO.FileStation.CreateFolder&version=2&method=create
&folder_path=["/photo"]&name=["new_album"]&force_parent=false&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| folder_path | 是 | 父目录路径（JSON 数组，可批量） |
| name | 是 | 新文件夹名（JSON 数组，与 folder_path 一一对应） |
| force_parent | 否 | true=自动创建中间目录 |

### 响应

```json
{
  "success": true,
  "data": {
    "folders": [
      {
        "isdir": true,
        "name": "new_album",
        "path": "/photo/new_album"
      }
    ]
  }
}
```

### CreateFolder 特有错误码

| Code | 描述 |
|------|------|
| 1100 | Failed to create a folder. More information in <errors> object |
| 1101 | The number of folders to the parent folder would exceed the system limitation |

---

## 18. SYNO.FileStation.Rename

重命名文件/文件夹。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Method | rename |

### 请求

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Rename&version=2&method=rename
&path=["/photo/old_name"]&name=["new_name"]&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | 原路径（JSON 数组，可批量） |
| name | 是 | 新名称（JSON 数组，与 path 一一对应） |
| additional | 否 | 附加信息 |

### 响应

```json
{
  "success": true,
  "data": {
    "files": [
      {
        "isdir": true,
        "name": "new_name",
        "path": "/photo/new_name"
      }
    ]
  }
}
```

### Rename 特有错误码

| Code | 描述 |
|------|------|
| 1200 | Failed to rename it. More information in <errors> object |

---

## 19. SYNO.FileStation.CopyMove

复制或移动文件/文件夹（非阻塞任务模式）。

| 属性 | 值 |
|------|-----|
| Version | 1-3 |
| Methods | start, status, stop |

### 19.1 start

```
POST /webapi/entry.cgi
api=SYNO.FileStation.CopyMove&version=3&method=start
&path=["/photo/a.jpg","/photo/b.jpg"]&dest_folder_path="/backup"
&overwrite=false&remove_src=false&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | 源路径（JSON 数组或逗号分隔） |
| dest_folder_path | 是 | 目标目录 |
| overwrite | 否 | true=覆盖同名文件（默认 false=跳过并报错） |
| remove_src | 否 | true=移动（删除源）；false=复制 |
| accurate_progress | 否 | true=精确进度（较慢）；false=粗略进度 |
| search_taskid | 否 | 从搜索结果中复制/移动 |

### 响应

```json
{
  "success": true,
  "data": { "taskid": "FileStation_5F4EE2D1234" }
}
```

### 19.2 status

```
GET /webapi/entry.cgi?api=SYNO.FileStation.CopyMove&version=3&method=status
&taskid=FileStation_5F4EE2D1234&_sid=xxx
```

### 响应

```json
{
  "success": true,
  "data": {
    "finished": false,
    "progress": 0.45,
    "processed_size": 50000000,
    "total": 110000000,
    "path": "/photo/a.jpg",
    "dest_folder_path": "/backup"
  }
}
```

### 19.3 stop

```
POST /webapi/entry.cgi
api=SYNO.FileStation.CopyMove&version=3&method=stop&taskid=xxx&_sid=xxx
```

### CopyMove 特有错误码

| Code | 描述 |
|------|------|
| 1000 | Failed to copy files/folders. More info in <errors> |
| 1001 | Failed to move files/folders. More info in <errors> |
| 1002 | An error occurred at the destination. More info in <errors> |
| 1003 | Cannot overwrite or skip the existing file because no overwrite parameter is given |
| 1004 | File cannot overwrite a folder with the same name, or vice versa |
| 1006 | Cannot copy/move file/folder with special characters to a FAT32 file system |
| 1007 | Cannot copy/move a root shared folder |

---

## 20. SYNO.FileStation.Delete

删除文件/文件夹。支持阻塞和非阻塞两种模式。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Methods | start, status, stop, delete |

### 20.1 delete — 阻塞删除（推荐少量文件时使用）

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Delete&version=2&method=delete
&path=["/photo/test.jpg"]&recursive=true&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | 路径（JSON 数组或逗号分隔） |
| recursive | 否 | true=递归删除目录内容 |
| search_taskid | 否 | 从搜索结果中删除 |

### 20.2 start — 非阻塞删除

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Delete&version=2&method=start
&path=["/video/large_folder"]&recursive=true&accurate_progress=true&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | 路径 |
| recursive | 否 | 递归 |
| accurate_progress | 否 | 精确进度 |

### 20.3 status

```
GET /webapi/entry.cgi?api=SYNO.FileStation.Delete&version=2&method=status
&taskid=xxx&_sid=xxx
```

### 20.4 stop

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Delete&version=2&method=stop&taskid=xxx&_sid=xxx
```

### Delete 特有错误码

| Code | 描述 |
|------|------|
| 900 | Failed to delete file(s)/folder(s). More info in <errors> |

---

## 21. SYNO.FileStation.Extract

解压缩归档文件（非阻塞任务模式）。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Methods | start, status, stop, list |

### 21.1 start

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Extract&version=2&method=start
&file_path="/backup/archive.zip"&dest_folder_path="/extracted"
&overwrite=false&keep_dir=true&create_subfolder=false&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| file_path | 是 | 归档文件路径 |
| dest_folder_path | 是 | 解压目标目录 |
| overwrite | 否 | 覆盖同名文件 |
| keep_dir | 否 | 保持目录结构 |
| create_subfolder | 否 | 创建与压缩包同名的子文件夹 |
| codepage | 否 | 文件名编码(如 `chs`=简体中文) |
| password | 否 | 解压密码 |
| item_id | 否 | 仅解压指定条目 |

### 21.2 list — 列出归档内容

```
GET /webapi/entry.cgi?api=SYNO.FileStation.Extract&version=2&method=list
&file_path="/backup/archive.zip"&offset=0&limit=100&_sid=xxx
```

### 21.3 status / stop

同其他非阻塞 API。

### Extract 特有错误码

| Code | 描述 |
|------|------|
| 1400 | Failed to extract files |
| 1401 | Cannot open the file as archive |
| 1402 | Failed to read archive data error |
| 1403 | Wrong password |
| 1404 | Failed to get the file and dir list in an archive |
| 1405 | Failed to find the item id in an archive file |

---

## 22. SYNO.FileStation.Compress

压缩文件/文件夹为归档（非阻塞任务模式）。

| 属性 | 值 |
|------|-----|
| Version | 1-2 |
| Methods | start, status, stop |

### 22.1 start

```
POST /webapi/entry.cgi
api=SYNO.FileStation.Compress&version=2&method=start
&path=["/photo/album1","/photo/album2"]&dest_file_path="/backup/photos.zip"
&level="best"&mode="add"&format="zip"&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| path | 是 | 源文件/目录（JSON 数组） |
| dest_file_path | 是 | 目标归档文件路径 |
| level | 否 | 压缩级别：store / fastest / fast / normal / good / best |
| mode | 否 | add=添加, update=更新已有, refreshen=刷新, synchronize=同步 |
| format | 否 | zip / 7z |
| password | 否 | 加密密码 |

### Compress 特有错误码

| Code | 描述 |
|------|------|
| 1300 | Failed to compress files/folders |
| 1301 | Cannot archive the file because the given archive name is too long |

---

## 23. SYNO.FileStation.BackgroundTask

管理后台任务。

| 属性 | 值 |
|------|-----|
| Version | 1-3 |
| Methods | list, clear_finished |

### 23.1 list

```
GET /webapi/entry.cgi?api=SYNO.FileStation.BackgroundTask&version=3&method=list
&offset=0&limit=0&sort_by=crtime&sort_direction=asc&api_filter=all&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| offset | 否 | 偏移 |
| limit | 否 | 条数 |
| sort_by | 否 | crtime, finished |
| sort_direction | 否 | asc / desc |
| api_filter | 否 | 过滤特定 API 的任务，all=全部 |

### 响应

```json
{
  "success": true,
  "data": {
    "total": 1,
    "offset": 0,
    "tasks": [
      {
        "api": "SYNO.FileStation.CopyMove",
        "version": 3,
        "method": "start",
        "taskid": "FileStation_5F4EE2D1234",
        "finished": true,
        "params": { ... },
        "path": "/photo/a.jpg",
        "processed_size": 1048576,
        "progress": 1.0,
        "total": 1048576
      }
    ]
  }
}
```

### 23.2 clear_finished

```
POST /webapi/entry.cgi
api=SYNO.FileStation.BackgroundTask&version=3&method=clear_finished
&taskid=xxx&_sid=xxx
```

| 参数 | 必填 | 说明 |
|------|------|------|
| taskid | 否 | 指定任务ID，不传则清除所有已完成任务 |

---

## 附录 A：additional 参数可选值

用于 List、Search 等 API 的 `additional` 参数：

| 值 | 说明 |
|-----|------|
| real_path | 真实文件系统路径 |
| size | 文件大小(bytes) |
| owner | 所有者信息 (user, group, uid, gid) |
| time | 时间信息 (atime, mtime, ctime, crtime) |
| perm | 权限信息 (posix, acl) |
| type | 文件类型/扩展名 |
| mount_point_type | 挂载点类型 (remote/USB) |
| volume_status | 卷状态 (freespace, totalspace, readonly) |

**格式**：JSON 数组字符串，如 `["real_path","size","time"]`，或逗号分隔如 `real_path,size,time`。

---

## 附录 B：非阻塞任务轮询模式

```
┌─────────┐     taskid      ┌──────────┐
│  start  │ ──────────────> │  status  │ ──┐
└─────────┘                 └──────────┘   │ finished=false
                                  ▲        │
                                  └────────┘ (poll every 500ms~2s)
                                  │
                            finished=true
                                  │
                                  ▼
                            ┌──────────┐
                            │   stop   │ (释放资源)
                            └──────────┘
```

适用 API：Search, DirSize, MD5, CopyMove, Delete(start), Extract, Compress

---

## 附录 C：本项目中的使用注意事项

1. **会话管理**：登录使用 `session=FileStation`，获取 `sid` 后所有请求带 `_sid` 参数
2. **CSRF Token**：登录时 `enable_syno_token=yes`，后续请求 Header 带 `X-SYNO-TOKEN`
3. **自签名证书**：Rust 端 reqwest 配置 `danger_accept_invalid_certs(true)`
4. **下载参数编码**：`path` 必须为 JSON 数组 `["/path"]`，`mode` 必须为 JSON 字符串 `"open"`
5. **会话恢复**：code 105/106/107/119 均表示会话失效，应自动重登
6. **DSM 自定义协议**：通过 `dsm://` scheme 代理请求，Rust 端转发到 NAS 并绕过证书问题
