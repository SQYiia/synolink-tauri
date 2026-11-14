# 镜像、Compose 与虚拟机快照（2026-11-14）

## 本批范围

- 镜像：本地列表、名称筛选、大小与标签、按仓库和标签拉取、重新拉取、确认后删除标签。没有 force 参数；使用中的镜像由 NAS 拒绝删除。拉取请求成功只提示提交，不假称下载完成，也不会自动更新正在运行的容器。
- Compose：已有项目列表、部署路径、状态、脱敏项目概要、启动、停止、构建。停止明确提示可能执行 compose down，移除项目容器和网络。套件项目禁用写操作。本批未加入 YAML 编辑、新建、删除项目和项目部署日志。
- VMM：详情页中的快照列表、描述、创建、确认删除及恢复。锁定快照禁用删除；恢复必须先关机且明确提示数据回退，不强制关机，不自动备份。返回 task_id 且具备任务接口时查询进度，否则保留提交提示并刷新列表。
- 两端共用响应式组件，列表每 5 秒刷新；页面失活或后台暂停调度。请求使用来源客户端快照，结果检查服务器、账号、会话与组件代次；写入不做界面层自动重试。
- 接口不存在时不提交请求；只显示原因。响应结构不能识别时不会误报为空列表。

## 接口依据与限制

公开 VMM API Guide 不涵盖此快照接口。方法和参数交叉核对开源 synology-api 的源实现：
- https://github.com/N4S4/synology-api/blob/master/synology_api/docker_api.py
- https://github.com/N4S4/synology-api/blob/master/synology_api/virtualization.py

套件功能语义参考 https://kb.synology.com/en-global/DSM/help/ContainerManager/docker_project 。上述实现不是所有 DSM 版本的稳定接口保证，仍需真实 NAS 验证；未访问用户 NAS 执行写操作。

## 验证

Node 测试覆盖能力缺失、参数编码、注册表端口、快照 ID、恢复参数、响应归一化、敏感字段排除。
`check-management-browser.mjs` 覆盖 1440/390 宽度、镜像拉取、删除取消、Compose 停止取消、脱敏详情、快照创建、恢复取消、运行中禁止恢复、权限失败。
生产类型检查、现有 HEIC/套件/容器/VMM 界面回归与 Windows NSIS 构建。

真实 NAS 的镜像使用冲突、拉取完成、Compose 实际目录／容器状态、快照恢复后的文件内容，及安卓真机交互均待验证。保持 0.1.19 预览版本，不发布 0.1.20。
