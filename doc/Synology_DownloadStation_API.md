# Synology Download Station Official API

> 基于 Synology Download Station Official API 文档整理，适用于 DSM 6/7。

---

## 目录

1. [概述](#1-概述)
2. [SYNO.DownloadStation.Info](#2-synodownloadstationinfo)
3. [SYNO.DownloadStation.Schedule](#3-synodownloadstationschedule)
4. [SYNO.DownloadStation.Task](#4-synodownloadstationtask)
5. [SYNO.DownloadStation.Statistic](#5-synodownloadstationstatistic)
6. [SYNO.DownloadStation.RSS.Site](#6-synodownloadstationrsssite)
7. [SYNO.DownloadStation.RSS.Feed](#7-synodownloadstationrssfeed)
8. [SYNO.DownloadStation.BTSearch](#8-synodownloadstationbtsearch)
9. [错误码](#9-错误码)

---

## 1. 概述

### 登录要求

Download Station API 必须使用 `session=DownloadStation` 登录：

```
POST /webapi/auth.cgi
api=SYNO.API.Auth&version=2&method=login&account=admin&passwd=xxx&session=DownloadStation&format=sid
```

### API 发现

```
GET /webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.DownloadStation.Task,SYNO.DownloadStation.Info
```

### 通用错误码

| Code | 描述 |
|------|------|
| 100 | Unknown error |
| 101 | Invalid parameter |
| 102 | API does not exist |
| 103 | Method does not exist |
| 104 | This API version is not supported |
| 105 | Insufficient user privilege |
| 106 | Connection time out |
| 107 | Multiple login detected |

---

## 2. SYNO.DownloadStation.Info

获取和设置 Download Station 基本信息及配置。

**API 路径**: `DownloadStation/info.cgi`  
**版本**: 1

### 2.1 getinfo

获取 Download Station 版本信息。

**请求**:
```
GET /webapi/DownloadStation/info.cgi?api=SYNO.DownloadStation.Info&version=1&method=getinfo&_sid=xxx
```

**响应**:
```json
{
  "success": true,
  "data": {
    "is_manager": true,
    "version": 2483,
    "version_string": "3.4-2483"
  }
}
```

### 2.2 getconfig

获取 Download Station 配置。

**请求**:
```
GET /webapi/DownloadStation/info.cgi?api=SYNO.DownloadStation.Info&version=1&method=getconfig&_sid=xxx
```

**响应**:
```json
{
  "success": true,
  "data": {
    "bt_max_download": 0,
    "bt_max_upload": 0,
    "emule_max_download": 0,
    "emule_max_upload": 0,
    "nzb_max_download": 0,
    "http_max_download": 0,
    "ftp_max_download": 0,
    "emule_enabled": false,
    "unzip_service_enabled": false,
    "default_destination": "Downloads",
    "emule_default_destination": ""
  }
}
```

### 2.3 setserverconfig

设置 Download Station 配置。

**请求** (POST):
```
POST /webapi/DownloadStation/info.cgi
api=SYNO.DownloadStation.Info&version=1&method=setserverconfig&_sid=xxx
&bt_max_download=100&bt_max_upload=50&default_destination=Downloads
```

**参数** (均为可选):

| 参数 | 类型 | 说明 |
|------|------|------|
| bt_max_download | integer | BT 最大下载速度 (KB/s)，0=无限 |
| bt_max_upload | integer | BT 最大上传速度 (KB/s)，0=无限 |
| emule_max_download | integer | eMule 最大下载速度 |
| emule_max_upload | integer | eMule 最大上传速度 |
| nzb_max_download | integer | NZB 最大下载速度 |
| http_max_download | integer | HTTP 最大下载速度 |
| ftp_max_download | integer | FTP 最大下载速度 |
| emule_enabled | boolean | 启用 eMule |
| unzip_service_enabled | boolean | 下载完成后自动解压 |
| default_destination | string | 默认下载目标文件夹 |
| emule_default_destination | string | eMule 默认下载目标文件夹 |

---

## 3. SYNO.DownloadStation.Schedule

管理下载计划（限速调度）。

**API 路径**: `DownloadStation/schedule.cgi`  
**版本**: 1

### 3.1 getconfig

获取当前计划配置。

**响应**:
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "emule_enabled": true
  }
}
```

### 3.2 setconfig

设置计划配置。

**参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| enabled | boolean | 启用计划 |
| emule_enabled | boolean | 启用 eMule 计划 |

---

## 4. SYNO.DownloadStation.Task

核心 API，管理下载任务的创建、查询、控制。

**API 路径**: `DownloadStation/task.cgi`  
**版本**: 1

### 4.1 list

列出下载任务。

**请求**:
```
GET /webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task&version=1&method=list
&offset=0&limit=10&additional=detail,transfer,file&_sid=xxx
```

**参数**:

| 参数 | 必须 | 类型 | 说明 |
|------|------|------|------|
| offset | 否 | integer | 偏移量，默认 0 |
| limit | 否 | integer | 返回数量，默认 -1（全部） |
| additional | 否 | string | 附加信息，逗号分隔：`detail`, `transfer`, `file`, `tracker`, `peer` |

**响应**:
```json
{
  "success": true,
  "data": {
    "total": 2,
    "offset": 0,
    "tasks": [
      {
        "id": "dbid_001",
        "type": "bt",
        "username": "admin",
        "title": "Ubuntu 22.04.iso",
        "size": 3654952960,
        "status": "downloading",
        "status_extra": null,
        "additional": {
          "detail": {
            "destination": "Downloads",
            "uri": "magnet:?xt=...",
            "create_time": "1680000000",
            "priority": "auto",
            "total_peers": 50,
            "connected_seeders": 12,
            "connected_leechers": 5
          },
          "transfer": {
            "size_downloaded": 1073741824,
            "size_uploaded": 536870912,
            "speed_download": 5242880,
            "speed_upload": 1048576
          },
          "file": [
            {
              "filename": "ubuntu-22.04-desktop-amd64.iso",
              "size": 3654952960,
              "size_downloaded": 1073741824,
              "priority": "normal"
            }
          ]
        }
      }
    ]
  }
}
```

### 任务状态

| 状态 | 说明 |
|------|------|
| waiting | 等待开始 |
| downloading | 正在下载 |
| paused | 已暂停 |
| finishing | 正在完成 |
| finished | 已完成 |
| hash_checking | 正在校验哈希 |
| seeding | 正在做种 |
| filehosting_waiting | 等待文件托管 |
| extracting | 正在解压 |
| error | 错误 |

### 任务类型

`bt`, `nzb`, `http`, `ftp`, `eMule`

### 4.2 getinfo

获取指定任务详细信息。

**请求**:
```
GET /webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task&version=1&method=getinfo
&id=dbid_001,dbid_002&additional=detail,transfer,file&_sid=xxx
```

**参数**:

| 参数 | 必须 | 类型 | 说明 |
|------|------|------|------|
| id | 是 | string | 任务 ID，多个以逗号分隔 |
| additional | 否 | string | 附加信息 |

### 4.3 create

创建下载任务。**必须使用 POST**。

**方式一：URL 下载**
```
POST /webapi/DownloadStation/task.cgi
Content-Type: application/x-www-form-urlencoded

api=SYNO.DownloadStation.Task&version=1&method=create&_sid=xxx
&uri=http://example.com/file.zip,magnet:?xt=...
&destination=Downloads/subfolder
&username=user&password=pass
```

**方式二：文件上传**（torrent/nzb 文件）
```
POST /webapi/DownloadStation/task.cgi
Content-Type: multipart/form-data

api=SYNO.DownloadStation.Task
version=1
method=create
_sid=xxx
file=@/path/to/file.torrent
destination=Downloads
```

**参数**:

| 参数 | 必须 | 类型 | 说明 |
|------|------|------|------|
| uri | 条件 | string | 下载 URL，多个以逗号分隔。支持 http/ftp/magnet/ed2k |
| file | 条件 | file | torrent 或 nzb 文件（multipart 上传） |
| username | 否 | string | HTTP/FTP 认证用户名 |
| password | 否 | string | HTTP/FTP 认证密码 |
| unzip_password | 否 | string | 压缩包解压密码 |
| destination | 否 | string | 目标共享文件夹路径（相对于根共享） |

> `uri` 和 `file` 至少提供一个。

### 4.4 delete

删除任务。

**请求**:
```
GET /webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task&version=1&method=delete
&id=dbid_001,dbid_002&force_complete=false&_sid=xxx
```

**参数**:

| 参数 | 必须 | 类型 | 说明 |
|------|------|------|------|
| id | 是 | string | 任务 ID，逗号分隔 |
| force_complete | 否 | boolean | 强制删除已完成任务并删除文件 |

**响应**:
```json
{
  "success": true,
  "data": [
    { "id": "dbid_001", "error": 0 },
    { "id": "dbid_002", "error": 0 }
  ]
}
```

### 4.5 pause

暂停任务。

```
GET /webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task&version=1&method=pause
&id=dbid_001,dbid_002&_sid=xxx
```

**响应格式同 delete**。

### 4.6 resume

恢复任务。

```
GET /webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task&version=1&method=resume
&id=dbid_001,dbid_002&_sid=xxx
```

### 4.7 edit

编辑任务目标文件夹。

```
GET /webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task&version=1&method=edit
&id=dbid_001&destination=NewFolder&_sid=xxx
```

**参数**:

| 参数 | 必须 | 类型 | 说明 |
|------|------|------|------|
| id | 是 | string | 任务 ID，逗号分隔 |
| destination | 否 | string | 新的目标文件夹 |

---

## 5. SYNO.DownloadStation.Statistic

获取下载速度统计。

**API 路径**: `DownloadStation/statistic.cgi`  
**版本**: 1

### 5.1 getinfo

```
GET /webapi/DownloadStation/statistic.cgi?api=SYNO.DownloadStation.Statistic&version=1&method=getinfo&_sid=xxx
```

**响应**:
```json
{
  "success": true,
  "data": {
    "speed_download": 5242880,
    "speed_upload": 1048576,
    "emule_speed_download": 0,
    "emule_speed_upload": 0
  }
}
```

---

## 6. SYNO.DownloadStation.RSS.Site

管理 RSS 订阅源。

**API 路径**: `DownloadStation/RSSsite.cgi`  
**版本**: 1

### 6.1 list

列出所有 RSS 站点。

```
GET /webapi/DownloadStation/RSSsite.cgi?api=SYNO.DownloadStation.RSS.Site&version=1&method=list
&offset=0&limit=-1&_sid=xxx
```

**响应**:
```json
{
  "success": true,
  "data": {
    "total": 1,
    "offset": 0,
    "sites": [
      {
        "id": 1,
        "is_updating": false,
        "title": "Example RSS",
        "url": "http://example.com/rss"
      }
    ]
  }
}
```

### 6.2 refresh

刷新指定 RSS 站点。

```
GET /webapi/DownloadStation/RSSsite.cgi?api=SYNO.DownloadStation.RSS.Site&version=1&method=refresh
&id=0,1&_sid=xxx
```

**参数**:

| 参数 | 必须 | 类型 | 说明 |
|------|------|------|------|
| id | 是 | string | RSS 站点 ID，逗号分隔 |

---

## 7. SYNO.DownloadStation.RSS.Feed

获取 RSS Feed 内容。

**API 路径**: `DownloadStation/RSSfeed.cgi`  
**版本**: 1

### 7.1 list

列出指定站点的 feed 项。

```
GET /webapi/DownloadStation/RSSfeed.cgi?api=SYNO.DownloadStation.RSS.Feed&version=1&method=list
&id=0&offset=0&limit=-1&_sid=xxx
```

**参数**:

| 参数 | 必须 | 类型 | 说明 |
|------|------|------|------|
| id | 是 | integer | RSS 站点 ID |
| offset | 否 | integer | 偏移量 |
| limit | 否 | integer | 数量限制 |

**响应**:
```json
{
  "success": true,
  "data": {
    "total": 5,
    "offset": 0,
    "items": [
      {
        "title": "File Name",
        "url": "http://example.com/file.torrent",
        "size": 0,
        "download_uri": "http://example.com/file.torrent"
      }
    ]
  }
}
```

---

## 8. SYNO.DownloadStation.BTSearch

BT 搜索功能。

**API 路径**: `DownloadStation/btsearch.cgi`  
**版本**: 1

### 8.1 start

启动 BT 搜索。

```
GET /webapi/DownloadStation/btsearch.cgi?api=SYNO.DownloadStation.BTSearch&version=1&method=start
&keyword=ubuntu&module=all&_sid=xxx
```

**参数**:

| 参数 | 必须 | 类型 | 说明 |
|------|------|------|------|
| keyword | 是 | string | 搜索关键词 |
| module | 是 | string | 搜索模块名称，`all` 表示所有已启用模块 |

**响应**:
```json
{
  "success": true,
  "data": {
    "taskid": "dsm_btsearch_xxxxx"
  }
}
```

### 8.2 list

获取搜索结果。

```
GET /webapi/DownloadStation/btsearch.cgi?api=SYNO.DownloadStation.BTSearch&version=1&method=list
&taskid=dsm_btsearch_xxxxx&offset=0&limit=50&sort_by=seeds&sort_direction=desc&_sid=xxx
```

**参数**:

| 参数 | 必须 | 类型 | 说明 |
|------|------|------|------|
| taskid | 是 | string | 搜索任务 ID |
| offset | 否 | integer | 偏移量 |
| limit | 否 | integer | 数量限制 |
| sort_by | 否 | string | 排序字段：`title`, `size`, `date`, `seeds`, `peers`, `category`, `module` |
| sort_direction | 否 | string | `asc` 或 `desc` |
| filter_category | 否 | string | 按分类过滤 |
| filter_module | 否 | string | 按模块过滤 |

**响应**:
```json
{
  "success": true,
  "data": {
    "total": 100,
    "offset": 0,
    "finished": false,
    "items": [
      {
        "title": "Ubuntu 22.04 LTS",
        "size": "3.6 GB",
        "date": "2022-04-21",
        "seeds": 1500,
        "peers": 200,
        "category": "Applications",
        "download_uri": "magnet:?xt=...",
        "module": "thepiratebay"
      }
    ]
  }
}
```

### 8.3 getCategory

获取搜索可用分类。

```
GET /webapi/DownloadStation/btsearch.cgi?api=SYNO.DownloadStation.BTSearch&version=1&method=getCategory
&taskid=dsm_btsearch_xxxxx&_sid=xxx
```

### 8.4 clean

清除搜索任务。

```
GET /webapi/DownloadStation/btsearch.cgi?api=SYNO.DownloadStation.BTSearch&version=1&method=clean
&taskid=dsm_btsearch_xxxxx&_sid=xxx
```

### 8.5 getModule

获取已安装的搜索模块列表。

```
GET /webapi/DownloadStation/btsearch.cgi?api=SYNO.DownloadStation.BTSearch&version=1&method=getModule&_sid=xxx
```

**响应**:
```json
{
  "success": true,
  "data": {
    "total": 3,
    "modules": [
      { "name": "thepiratebay", "enabled": true },
      { "name": "kickass", "enabled": true },
      { "name": "rarbg", "enabled": false }
    ]
  }
}
```

---

## 9. 错误码

### Download Station Task 错误码

| Code | 描述 |
|------|------|
| 400 | File upload failed |
| 401 | Max number of tasks reached |
| 402 | Destination denied |
| 403 | Destination does not exist |
| 404 | Invalid task id |
| 405 | Invalid task action |
| 406 | No default destination |
| 407 | Set destination failed |
| 408 | File does not exist |

### BT Search 错误码

| Code | 描述 |
|------|------|
| 400 | Unknown error |
| 401 | Invalid parameter |
| 402 | Parse the user setting failed |
| 403 | Get category failed |
| 404 | Get the search result from DB failed |
| 405 | Get user setting failed |

---

## 附录：参数格式注意

- Download Station API 的 `id` 参数使用**逗号分隔字符串**（非 JSON 数组），与 FileStation 不同。
- `destination` 是相对于共享文件夹的路径，例如 `Downloads/subfolder`，不带前导 `/`。
- 创建任务时 `uri` 支持多个 URL，以逗号分隔。
- BT 搜索采用异步模式：`start` → 轮询 `list`（直到 `finished=true`）→ `clean`。
