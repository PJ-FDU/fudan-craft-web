# 自定义地图联机与版本锁定

在地图编辑器保存地图后，创建房间时可选择本地草稿；房主也可在作战室更换地图。下载过的缓存版本同样可以用于建房。以下行为以源码为准。

- **VERSION-LOCK**：创建/选图时冻结序列化地图快照。版本由地图 ID、schemaVersion=1 和内容 SHA-256 指纹标识；对象键排序后计算指纹，数组顺序保留。名称、地形、资源和出生点修改都会产生新指纹。编辑器另存新版不会修改已建立房间。
- **SYNC-BEFORE-START**：作战室只广播版本描述。每位玩家先查本地缓存；未命中则向房间请求完整快照，校验指纹、实体与地形、注册世界并尝试缓存，最后确认 map-ready。服务器和房主 Worker 都拒绝在有人未同步时开局。
- **STALE-REPLY**：切换地图重置玩家就绪状态；旧地图的请求和确认无效。客户端用异步任务代数隔离切图、离开及断线前的缓存读取/写入。重新选择相同内容版本保留已就绪状态。
- **RECONNECT**：自定义地图对局重连后重新确认当前版本；确认前由 AI 接管，不发送战局状态也不接受该席位的对局指令。缓存命中仍需校验。
- **DRAFT-ISOLATION**：编辑器草稿保留在 localStorage 的 `fudancraft-custom-maps-v1`；下载版本存入 IndexedDB 的 `fudancraft-map-versions-v1/versions`，键为 `mapId@contentHash`。不覆盖接收方的草稿，保留旧版本。持久存储不可用时使用本次页面内存缓存并明确显示提示；重新打开可能需要再下载。
- **SAVE-SNAPSHOT**：自定义战役存档内嵌地图指纹和完整快照，可在原草稿删除或更新后恢复；逐帧视野仅携带指纹，不重复传整张地图。服务器房间持久化也包含锁定快照；内置地图旧存档继续兼容。

服务器版从服务器保留的房间快照下载；Pages 版从 A 的房主 Worker 经可靠有序 WebRTC 控制通道下载。Pages 房主离开或刷新仍会结束房间。

协议入口为 `create/select-map {mapId,mapSnapshot}`、`map-request/map-ready {mapId,contentHash}`、`map-data {snapshot}`。地图尺寸范围 48–192，出生点必须使用连续的 1–N 阵营（2–4 人）且地形合法、陆路连通。地图文档上限为 2 MiB−4 KiB，装饰最多 3000 个，资源点最多 512 个，塔最多 128 个。普通消息维持 16 KiB 上限；P2P 大地图采用最多 16 KiB 的分片，有界重组与发送队列。同步下载超时 30 秒，可在作战室重试或离开。

实现入口：

- `src/game/map-versions.ts`：快照标准化、指纹、结构及地形校验。
- `src/game/map-version-cache.ts`、`src/network/map-sync.ts`：版本缓存、同步与旧任务隔离。
- `src/network/host-room.ts`、`server/index.ts`、`server/rooms.ts`：房间锁定、开局与重连门槛、服务器恢复。
- `tests/map-versions.test.ts`、`tests/map-network.test.ts`：篡改、旧回复、双版本隔离、存档、传输及服务器重启回归。
