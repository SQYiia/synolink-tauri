# Synology Virtual Machine Manager API Guide

> 基于 Synology Virtual Machine Manager API Guide (2018-12-20) 整理，适用于 VMM 2.3.4+。

---

## 目录

1. [概述](#1-概述)
2. [SYNO.Virtualization.API.Task.Info](#2-synovirtualizationapitaskinfo)
3. [SYNO.Virtualization.API.Network](#3-synovirtualizationapinetwork)
4. [SYNO.Virtualization.API.Storage](#4-synovirtualizationapistorage)
5. [SYNO.Virtualization.API.Host](#5-synovirtualizationapihost)
6. [SYNO.Virtualization.API.Guest](#6-synovirtualizationapiguest)
7. [SYNO.Virtualization.API.Guest.Action](#7-synovirtualizationapiguestaction)
8. [SYNO.Virtualization.API.Guest.Image](#8-synovirtualizationapiguestimage)
9. [错误码](#9-错误码)

---

## 1. 概述

### 登录要求

VMM API 使用标准 SYNO.API.Auth 登录，session 名称可用 `dsm_info`：

```
GET /webapi/auth.cgi?api=SYNO.API.Auth&method=login&version=3&account=admin&passwd=xxx&format=sid&session=dsm_info
```

### 请求格式

所有 VMM API 统一使用 `/webapi/entry.cgi` 路径：

```
GET /webapi/entry.cgi?api=<API_NAME>&version=<VERSION>&method=<METHOD>[&<PARAMS>][&_sid=<SID>]
```

### 参数转义规则

- 逗号 `,` → 反斜杠逗号 `\/`
- 斜杠 `\` → 双反斜杠 `\\`
- 逗号用于分隔多个参数值
- 密码相关参数（`passwd`, `password`）不需要转义

---

## 2. SYNO.Virtualization.API.Task.Info

管理非阻塞操作的异步任务。

**版本**: 1  
**可用性**: VMM 2.3.4-9027+

### 2.1 list

列出所有任务。

```
GET /webapi/entry.cgi?_sid=xxx&api=SYNO.Virtualization.API.Task.Info&method=list&version=1
```

**响应**:
```json
{
  "data": {
    "task_ids": [
      "@administrators/virtualization_api_image_create5BAD9BFFF2889659",
      "@administrators/virtualization_api_image_create5BB19071A059F890"
    ]
  },
  "success": true
}
```

### 2.2 clear

清除指定任务。

| 参数 | 类型 | 说明 |
|------|------|------|
| task_id | String | 指定任务 ID |

### 2.3 get

获取任务信息。

| 参数 | 类型 | 说明 |
|------|------|------|
| task_id | String | 指定任务 ID |

**响应**:
```json
{
  "data": {
    "finish": true,
    "task_info": {
      "auto_clean_task": true,
      "image_id": "54383227-c541-4e60-9cac-5da98b2dd88a",
      "progress": 100,
      "status": "create"
    }
  },
  "success": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| finish | Boolean | 任务是否完成 |
| task_info | Object | 任务详情，结构取决于具体操作 |

---

## 3. SYNO.Virtualization.API.Network

网络组管理。

**版本**: 1

### 3.1 list

列出所有网络组。

```
GET /webapi/entry.cgi?_sid=xxx&api=SYNO.Virtualization.API.Network&method=list&version=1
```

**响应**:
```json
{
  "data": {
    "networks": [
      {
        "network_id": "bfffe844-3dee-46fd-a1cc-00d2cae7b767",
        "network_name": "Default VM Network"
      }
    ]
  },
  "success": true
}
```

---

## 4. SYNO.Virtualization.API.Storage

存储管理。

**版本**: 1

### 4.1 list

列出所有存储。

```
GET /webapi/entry.cgi?_sid=xxx&api=SYNO.Virtualization.API.Storage&method=list&version=1
```

**响应**:
```json
{
  "data": {
    "storages": [
      {
        "host_id": "08fdc48c-4b79-4647-bbb6-7b2f4c6f7aca",
        "host_name": "Synology",
        "size": 302227,
        "status": "online",
        "storage_id": "afb50893-8453-414c-b294-60e4cd2ffc93",
        "storage_name": "Synology – VM Storage 1",
        "used": 32276,
        "volume_path": "/volume1"
      }
    ]
  },
  "success": true
}
```

**Storage 对象字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| host_id | String | 存储所在主机 ID |
| host_name | String | 主机名 |
| size | Integer | 存储总大小 (MB)，主机不在线时不可用 |
| status | String | online/missing/unavailable/degraded/crashed/full/provision_warning |
| storage_id | String | 存储 ID |
| storage_name | String | 存储名称 |
| used | Integer | 已用大小 (MB)，主机不在线时不可用 |
| volume_path | String | 卷路径 |

---

## 5. SYNO.Virtualization.API.Host

主机管理。

**版本**: 1

### 5.1 list

列出所有主机。

```
GET /webapi/entry.cgi?_sid=xxx&api=SYNO.Virtualization.API.Host&method=list&version=1
```

**响应**:
```json
{
  "data": {
    "hosts": [
      {
        "free_cpu_core": 32,
        "free_ram_size": 6656,
        "host_id": "08fdc48c-4b79-4647-bbb6-7b2f4c6f7aca",
        "host_name": "Synology",
        "status": "running",
        "total_cpu_core": 32,
        "total_ram_size": 8192
      }
    ]
  },
  "success": true
}
```

**Host 对象字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| free_cpu_core | Integer | 可用 CPU 线程数 |
| free_ram_size | Integer | 可用内存 (MB) |
| host_id | String | 主机 ID |
| host_name | String | 主机名 |
| status | String | running/inaccessible/network_warn/control_unavail |
| total_cpu_core | Integer | 总 CPU 线程数 |
| total_ram_size | Integer | 总内存 (MB) |

---

## 6. SYNO.Virtualization.API.Guest

虚拟机管理（CRUD）。

**版本**: 1

### 6.1 list

列出所有虚拟机。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| additional | Boolean | false | 是否返回详细信息（vdisks/vnics 等） |

```
GET /webapi/entry.cgi?_sid=xxx&api=SYNO.Virtualization.API.Guest&method=list&version=1&additional=true
```

**Guest 对象字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| autorun | Integer | 0: off, 1: last state, 2: on |
| description | String | 描述 |
| guest_id | String | 虚拟机 ID |
| guest_name | String | 虚拟机名 |
| status | String | 见下表 |
| storage_id | String | 所在存储 ID |
| storage_name | String | 所在存储名 |
| vcpu_num | Integer | vCPU 数 |
| vdisks | Array | 虚拟磁盘列表 |
| vnics | Array | 虚拟网卡列表 |
| vram_size | Integer | 内存大小 (MB) |

**虚拟机状态**:

| 状态 | 说明 |
|------|------|
| running | 运行中 |
| shutdown | 已关机 |
| inaccessible | 不可访问 |
| booting | 启动中 |
| shutting_down | 关机中 |
| moving | 迁移中 |
| stor_migrating | 存储迁移中 |
| creating | 创建中 |
| importing | 导入中 |
| preparing | 准备中 |
| ha_standby | HA 待机 |
| unknown | 未知 |
| crashed | 已崩溃 |
| undefined | 未定义 |

**vdisk 对象**:

| 字段 | 类型 | 说明 |
|------|------|------|
| controller | Integer | 1: VirtIO, 2: IDE, 3: SATA |
| unmap | Boolean | 是否启用空间回收 |
| vdisk_id | String | 磁盘 ID |
| vdisk_size | Integer | 磁盘大小 (MB) |

**vnic 对象**:

| 字段 | 类型 | 说明 |
|------|------|------|
| mac | String | MAC 地址 |
| model | Integer | 1: VirtIO, 2: e1000, 3: rtl8139 |
| network_id | String | 连接的网络组 ID |
| network_name | String | 网络组名 |
| vnic_id | String | 网卡 ID |

### 6.2 get

获取指定虚拟机信息。

| 参数 | 类型 | 说明 |
|------|------|------|
| guest_id | String | 虚拟机 ID（与 guest_name 至少提供一个） |
| guest_name | String | 虚拟机名 |
| additional | Boolean | 是否返回详细信息 |

```
GET /webapi/entry.cgi?_sid=xxx&api=SYNO.Virtualization.API.Guest&method=get&version=1&guest_name=win10
```

### 6.3 set

修改虚拟机属性。

| 参数 | 类型 | 说明 |
|------|------|------|
| guest_id | String | 虚拟机 ID |
| guest_name | String | 虚拟机名 |
| autorun | Integer | 自动启动：0=off, 1=last state, 2=on |
| description | String | 描述 |
| new_guest_name | String | 新名称 |
| vcpu_num | Integer | vCPU 数量 |
| vram_size | Integer | 内存 (MB) |

```
GET /webapi/entry.cgi?_sid=xxx&api=SYNO.Virtualization.API.Guest&method=set&version=1&guest_name=syno&vcpu_num=2
```

### 6.4 delete

删除虚拟机。

| 参数 | 类型 | 说明 |
|------|------|------|
| guest_id | String | 虚拟机 ID |
| guest_name | String | 虚拟机名 |

### 6.5 create（非阻塞）

创建虚拟机。返回 `task_id`，通过 Task.Info/get 轮询结果。

| 参数 | 类型 | 说明 |
|------|------|------|
| guest_name | String | 虚拟机名 |
| storage_id | String | 存储 ID（与 storage_name 至少一个） |
| storage_name | String | 存储名称 |
| auto_clean_task | Boolean | 任务完成后自动清理（默认 true） |
| vnics | JSON Array | vnic 对象数组 |
| vdisks | JSON Array | vdisk 对象数组 |

**create 的 vdisk 参数**:

| 字段 | 类型 | 说明 |
|------|------|------|
| create_type | Integer | 0: 创建空磁盘，1: 克隆已有镜像 |
| vdisk_size | Integer | create_type=0 时必须，大小 (MB) |
| image_id | String | create_type=1 时，要克隆的镜像 ID |
| image_name | String | create_type=1 时，要克隆的镜像名（image 类型须为 disk） |

**create 的 vnic 参数**:

| 字段 | 类型 | 说明 |
|------|------|------|
| mac | String | MAC 地址（不指定则随机生成） |
| network_id | String | 网络组 ID（空字符串表示不连接） |
| network_name | String | 网络组名 |

**请求示例**:
```
GET /webapi/entry.cgi?_sid=xxx&api=SYNO.Virtualization.API.Guest&method=create&version=1
&guest_name=syno&storage_id=afb50893-8453-414c-b294-60e4cd2ffc93
&vdisks=[{"create_type":"0","vdisk_size":"10240"}]
&vnics=[{"network_id":""}]
```

**响应**:
```json
{
  "data": {
    "task_id": "@users/virtualization_api_guest_create5BB3389D4A406062"
  },
  "success": true
}
```

**task_info 结构（via Task.Info/get）**:

| 字段 | 类型 | 说明 |
|------|------|------|
| auto_clean_task | Boolean | 是否自动清理 |
| guest_id | String | 创建的虚拟机 ID |
| progress | Integer | 进度 (0-100) |
| status | String | 任务状态 |

---

## 7. SYNO.Virtualization.API.Guest.Action

虚拟机电源操作。

**版本**: 1

### 7.1 poweron

开机。

| 参数 | 类型 | 说明 |
|------|------|------|
| guest_id | String | 虚拟机 ID |
| guest_name | String | 虚拟机名（与 guest_id 至少一个） |
| host_id | String | 目标主机 ID（可选，不指定则自动选择） |
| host_name | String | 目标主机名（可选） |

```
GET /webapi/entry.cgi?_sid=xxx&api=SYNO.Virtualization.API.Guest.Action&method=poweron&version=1&guest_name=syno
```

### 7.2 poweroff

强制关机（相当于拔电源）。

| 参数 | 类型 | 说明 |
|------|------|------|
| guest_id | String | 虚拟机 ID |
| guest_name | String | 虚拟机名 |

### 7.3 shutdown

正常关机（通过 guest agent 通知操作系统关机）。

| 参数 | 类型 | 说明 |
|------|------|------|
| guest_id | String | 虚拟机 ID |
| guest_name | String | 虚拟机名 |

---

## 8. SYNO.Virtualization.API.Guest.Image

虚拟机镜像管理。

**版本**: 1

### 8.1 list

列出所有镜像。

```
GET /webapi/entry.cgi?_sid=xxx&api=SYNO.Virtualization.API.Guest.Image&method=list&version=1
```

**Image 对象字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| image_id | String | 镜像 ID |
| image_name | String | 镜像名 |
| storages | Array | 存储位置列表 |
| type | String | 镜像类型：disk / vdsm / iso |

**storages 子对象**:

| 字段 | 类型 | 说明 |
|------|------|------|
| status | String | online/missing/unavailable/degraded/crashed/full/provision_warning |
| storage_id | String | 存储 ID |
| storage_name | String | 存储名 |

**响应示例**:
```json
{
  "data": {
    "images": [
      {
        "image_id": "17f119ed-1294-408d-b8af-5d7ccd6bc22c",
        "image_name": "final",
        "storages": [
          {
            "status": "online",
            "storage_id": "afb50893-8453-414c-b294-60e4cd2ffc93",
            "storage_name": "Synology – VM Storage 1"
          }
        ],
        "type": "disk"
      }
    ]
  },
  "success": true
}
```

### 8.2 delete

删除镜像。

| 参数 | 类型 | 说明 |
|------|------|------|
| image_id | String | 镜像 ID（与 image_name 至少一个） |
| image_name | String | 镜像名 |

### 8.3 create（非阻塞）

创建镜像。返回 `task_id`。

> 注：文档标注 "Since version 1"，需要 VMM Pro。

---

## 9. 错误码

### 通用错误码

| Code | 描述 |
|------|------|
| 101 | No parameter of API, method or version |
| 102 | The requested API does not exist |
| 103 | The requested method does not exist |
| 104 | The requested version does not support the function |
| 105 | The login session does not have permission |
| 106 | Session timeout |

### VMM 特定错误码

| Code | 描述 |
|------|------|
| 401 | Bad parameter |
| 402 | Operation failed |
| 403 | Name conflict |
| 404 | iSCSI LUN 数量达到系统限制 |
| 500 | 集群被冻结，超过半数主机离线 |
| 501 | 集群不兼容模式，需升级 DSM |
| 600 | 集群未就绪 |
| 601 | 主机离线 |
| 700 | 存储无效 |
| 900 | 设置主机到虚拟机失败 |
| 901 | 虚拟机没有主机 |
| 902 | CPU 线程不足无法开机 |
| 903 | 内存不足无法开机 |
| 904 | 虚拟机状态为 online（不能重复开机） |
| 905 | MAC 地址冲突 |
| 906 | 创建失败：找不到指定镜像 |
| 907 | 虚拟机状态为 offline |
| 908 | CPU 预留线程不足 |
| 909 | 主机上无对应网络 |
| 910 | 只有 VirtIO 硬盘控制器可用于远程启动 |
| 911 | UEFI 虚拟机不能远程开机 |
| 1000 | 找不到 task_id |
| 1001 | 需要 Virtual Machine Manager Pro |
| 1400 | 镜像创建部分成功 |
| 1600 | 虚拟机编辑成功，但 HA 主机预留资源时出错 |

### Auth 错误码

| Code | 描述 |
|------|------|
| 400 | No such account or incorrect password |
| 401 | Account disabled |
| 402 | Permission denied |
| 403 | 2-step verification code required |
| 404 | Failed to authenticate 2-step verification code |
