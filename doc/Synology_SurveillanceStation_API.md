# Synology Surveillance Station Web API

> 基于 Synology Surveillance Station Web API ver 3.11 (2021-12-30) 整理。
> 此文档为 API 索引参考，完整参数请查阅原始 PDF（500+ 页）。

---

## 目录

1. [概述](#1-概述)
2. [API 列表](#2-api-列表)
3. [核心 API 详解](#3-核心-api-详解)
4. [通用错误码](#4-通用错误码)

---

## 1. 概述

### 登录要求

Surveillance Station 使用 `session=SurveillanceStation` 登录：

```
GET /webapi/auth.cgi?api=SYNO.API.Auth&method=login&version=6&account=admin&passwd=xxx&session=SurveillanceStation&format=sid
```

### 请求格式

所有 API 统一使用 `/webapi/entry.cgi`：

```
GET /webapi/entry.cgi?api=<API_NAME>&version=<VERSION>&method=<METHOD>&_sid=<SID>[&<PARAMS>]
```

### 操作流程

1. 登录 → 获取 SID
2. 调用 SYNO.SurveillanceStation.Info 获取版本信息
3. 调用业务 API
4. 登出

---

## 2. API 列表

Surveillance Station 提供超过 50 个 API，按功能分类如下：

### 基础信息

| API | 说明 |
|-----|------|
| SYNO.API.Info | API 发现 |
| SYNO.API.Auth | 认证登录/登出 |
| SYNO.SurveillanceStation.Info | SS 版本信息 |

### 摄像头管理

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Camera | 摄像头 CRUD、启用/禁用、快照、迁移 |
| SYNO.SurveillanceStation.Camera.Event | 音频/报警/篡改/移动侦测参数 |
| SYNO.SurveillanceStation.Camera.Group | 摄像头分组管理 |
| SYNO.SurveillanceStation.Camera.Import | 摄像头导入 |
| SYNO.SurveillanceStation.Camera.Wizard | 摄像头快速创建向导 |
| SYNO.SurveillanceStation.Camera.Search | 搜索局域网摄像头 |
| SYNO.SurveillanceStation.Camera.Status | 摄像头状态 |

### PTZ 控制

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.PTZ | 移动/缩放/对焦/归位/自动巡航/目标跟踪 |
| SYNO.SurveillanceStation.PTZ.Preset | 预置位管理 |
| SYNO.SurveillanceStation.PTZ.Patrol | 巡航路径管理 |

### 录像管理

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Recording | 列表/删除/下载/串流/锁定/导出 |
| SYNO.SurveillanceStation.Recording.Export | 录像导出管理 |
| SYNO.SurveillanceStation.Recording.Mount | 外部录像挂载 |
| SYNO.SurveillanceStation.Recording.Bookmark | 录像书签 |
| SYNO.SurveillanceStation.ExternalRecording | 外部录制控制 |

### 事件与告警

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Alert | 告警事件查看/清除/触发 |
| SYNO.SurveillanceStation.Alert.Setting | 告警设置 |
| SYNO.SurveillanceStation.ActionRule | 联动规则管理 |
| SYNO.SurveillanceStation.ExternalEvent | 外部事件触发 |

### 通知

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Notification | 推送通知设置 |
| SYNO.SurveillanceStation.Notification.Email | 邮件通知 |
| SYNO.SurveillanceStation.Notification.SMS | 短信通知 |
| SYNO.SurveillanceStation.Notification.SMS.ServiceProvider | 短信服务商 |
| SYNO.SurveillanceStation.Notification.PushService | 移动推送 |
| SYNO.SurveillanceStation.Notification.Filter | 通知过滤 |
| SYNO.SurveillanceStation.Notification.Schedule | 通知时间表 |

### 快照

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.SnapShot | 快照管理（拍摄/列表/删除/下载/锁定） |

### 串流

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Stream | 事件串流 |
| SYNO.SurveillanceStation.Streaming | 实时/事件串流 |

### 电子地图

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Emap | 电子地图列表/加载 |
| SYNO.SurveillanceStation.Emap.Image | 地图图片 |

### 日志

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Log | 日志查看/清除/分类统计/设置 |

### 许可证

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.License | 许可证管理 |

### VisualStation

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.VisualStation | VS 设备启用/配置/锁定 |
| SYNO.SurveillanceStation.VisualStation.Layout | VS 布局管理 |
| SYNO.SurveillanceStation.VisualStation.Search | VS 设备搜索 |

### CMS（中央管理服务器）

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.CMS | CMS 重定向/同步/配置 |
| SYNO.SurveillanceStation.CMS.GetDsStatus | CMS 状态管理 |
| SYNO.SurveillanceStation.CMS.SlavedsWizard | 从属服务器向导 |
| SYNO.SurveillanceStation.CMS.SlavedsList | 从属服务器列表 |

### 数字输出

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.DigitalOutput | 数字输出设备控制 |

### IO 模块

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.IOModule | IO 模块管理 |
| SYNO.SurveillanceStation.IOModule.Search | IO 模块搜索 |

### 门禁系统

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.AxisAcsCtrler | Axis 门禁控制器管理 |
| SYNO.SurveillanceStation.AxisAcsCtrler.Search | 门禁控制器搜索 |

### 家庭模式

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.HomeMode | 家庭模式切换/获取状态 |

### 事务

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Transactions.Device | 事务设备管理 |
| SYNO.SurveillanceStation.Transactions.Transaction | 事务记录管理 |

### 归档

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Archiving.Pull | 归档任务管理 |

### YouTube 直播

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.YoutubeLive | YouTube 直播管理 |

### 智能视频分析 (IVA)

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.IVA | IVA 任务管理 |
| SYNO.SurveillanceStation.IVA.Report | IVA 报告 |
| SYNO.SurveillanceStation.IVA.Recording | IVA 录像 |
| SYNO.SurveillanceStation.IVA.TaskGroup | IVA 任务组 |

### 人脸识别

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Face | 人脸识别任务/人脸组/注册人脸 |
| SYNO.SurveillanceStation.Face.Result | 人脸识别结果 |

### 插件

| API | 说明 |
|-----|------|
| SYNO.SurveillanceStation.Addons | 插件管理/更新 |

---

## 3. 核心 API 详解

### 3.1 SYNO.SurveillanceStation.Info

**方法**: GetInfo

获取 Surveillance Station 基础信息。

```
GET /webapi/entry.cgi?api=SYNO.SurveillanceStation.Info&method=GetInfo&version=8&_sid=xxx
```

**响应字段**:

| 字段 | 说明 |
|------|------|
| cameraNumber | 已添加摄像头数 |
| customizedPortHttp | 自定义 HTTP 端口 |
| customizedPortHttps | 自定义 HTTPS 端口 |
| enableVideoRelay | 是否启用视频中继 |
| hostname | 主机名 |
| liscenseNumber | 许可证数 |
| maxCameraSupport | 最大支持摄像头数 |
| path | Webapi 路径 |
| serial | 序列号 |
| version | 版本信息 |

### 3.2 SYNO.SurveillanceStation.Camera

**核心方法**:

| 方法 | 说明 |
|------|------|
| Save | 添加/编辑摄像头 |
| List | 列出摄像头 |
| GetInfo | 获取摄像头详细信息 |
| ListGroup | 列出分组 |
| GetSnapshot | 获取快照 |
| Enable | 启用摄像头 |
| Disable | 禁用摄像头 |
| GetCapabilityByCamId | 获取摄像头能力 |
| Delete | 删除摄像头 |
| GetLiveViewPath | 获取实时查看路径 |

**List 方法示例**:
```
GET /webapi/entry.cgi?api=SYNO.SurveillanceStation.Camera&method=List&version=9
&offset=0&limit=20&basic=true&_sid=xxx
```

**GetSnapshot 方法**:
```
GET /webapi/entry.cgi?api=SYNO.SurveillanceStation.Camera&method=GetSnapshot&version=9
&id=1&cameraId=1&_sid=xxx
```
返回 JPEG 图片二进制数据。

**GetLiveViewPath 方法**:
```
GET /webapi/entry.cgi?api=SYNO.SurveillanceStation.Camera&method=GetLiveViewPath&version=9
&idList=1&_sid=xxx
```
返回 RTSP/MJPEG 串流路径。

### 3.3 SYNO.SurveillanceStation.PTZ

**核心方法**:

| 方法 | 参数 | 说明 |
|------|------|------|
| Move | cameraId, direction, speed | 移动（上下左右等 8 方向 + Home） |
| Zoom | cameraId, control(in/out) | 缩放 |
| ListPreset | cameraId | 列出预置位 |
| GoPreset | cameraId, presetId | 跳转预置位 |
| ListPatrol | cameraId | 列出巡航路径 |
| RunPatrol | cameraId, patrolId | 执行巡航 |
| Focus | cameraId, control(in/out) | 调焦 |
| Iris | cameraId, control(open/close) | 光圈 |
| AutoFocus | cameraId | 自动对焦 |
| Home | cameraId | 归位 |
| AutoPan | cameraId | 自动巡视 |
| ObjTracking | cameraId | 目标追踪 |

### 3.4 SYNO.SurveillanceStation.Recording

**核心方法**:

| 方法 | 说明 |
|------|------|
| List | 列出录像（支持按时间/摄像头过滤） |
| Delete | 删除录像 |
| Download | 下载录像文件 |
| Stream | 串流播放录像 |
| Lock | 锁定录像（防止自动删除） |
| UnLock | 解锁录像 |

**List 方法示例**:
```
GET /webapi/entry.cgi?api=SYNO.SurveillanceStation.Recording&method=List&version=5
&offset=0&limit=20&cameraIds=1&_sid=xxx
```

### 3.5 SYNO.SurveillanceStation.HomeMode

**方法**:

| 方法 | 说明 |
|------|------|
| GetInfo | 获取当前家庭模式状态 |
| Switch | 切换家庭模式（on/off） |

```
GET /webapi/entry.cgi?api=SYNO.SurveillanceStation.HomeMode&method=Switch&version=1&on=true&_sid=xxx
```

### 3.6 SYNO.SurveillanceStation.ActionRule

**方法**:

| 方法 | 说明 |
|------|------|
| Save | 创建/编辑联动规则 |
| List | 列出所有联动规则 |
| Delete | 删除联动规则 |
| Enable | 启用联动规则 |
| Disable | 禁用联动规则 |

### 3.7 SYNO.SurveillanceStation.ExternalEvent

**方法**:

| 方法 | 说明 |
|------|------|
| Trigger | 触发外部事件（可触发联动规则） |

```
GET /webapi/entry.cgi?api=SYNO.SurveillanceStation.ExternalEvent&method=Trigger&version=1
&eventId=1&eventName=MyEvent&_sid=xxx
```

---

## 4. 通用错误码

### API 基础错误码

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
| 117 | Need manager rights |
| 119 | Missing SID |

### Auth 错误码

| Code | 描述 |
|------|------|
| 400 | No such account or incorrect password |
| 401 | Account disabled |
| 402 | Permission denied |
| 403 | 2-step verification code required |
| 404 | Failed to authenticate 2-step verification code |

### SS Info 错误码

| Code | 描述 |
|------|------|
| 400 | Execution failed |
| 401 | Parameter invalid |
| 402 | Camera disabled |

### SS Camera 错误码

| Code | 描述 |
|------|------|
| 400 | Execution failed |
| 401 | Parameter invalid |
| 402 | Camera disabled |
| 403 | Insufficient license |
| 404 | Codec activation failed |
| 405 | CMS server connection failed |
| 407 | CMS closed |
| 412 | Need to add license |
| 413 | Reach the maximum of shared cameras |

### SS Recording 错误码

| Code | 描述 |
|------|------|
| 400 | Execution failed |
| 401 | Parameter invalid |
| 402 | Camera disabled |
| 403 | Insufficient license |

---

## 附录：版本历史

| 版本 | 日期 | 主要变更 |
|------|------|---------|
| 1.0 | 2012/09/11 | 初始发布 |
| 2.0 | 2015/03/13 | 添加大量 API（Door, Emap, Event, Notification 等） |
| 2.5 | 2016/07/28 | Event→Recording, Analytics→Alert 重命名 |
| 3.0 | 2018/12/28 | SnapShot/Camera 修改 |
| 3.4 | 2020/03/17 | IVA 支持 |
| 3.7 | 2021/05/31 | 人脸识别 API |
| 3.11 | 2021/12/30 | Camera GetInfo/Save/GetLiveViewPath 更新 |
