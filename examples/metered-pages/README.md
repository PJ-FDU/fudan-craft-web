# Metered + GitHub Pages：完整 WebRTC DataChannel 示例

独立于 FudanCraft 游戏的连接示例，使用 **Vite + TypeScript + `@metered-ca/realtime` 1.2.1**。无需自建 Node.js 服务，无需摄像头或麦克风；网页通过 Metered 托管信令发现房间内玩家，SDK 自动注入 Open Relay TURN 凭据。连接数据在真正的 WebRTC DataChannel 中传输。

本例提供创建房间、邀请链接、加入/离开、重连、文字消息、10 Hz 位置同步、直连/TURN 路径和 RTT 显示。它验证通信链路，不包含 FudanCraft 的完整战局模拟、房主迁移或对局存档。

## 1. 获取正确的 Metered 密钥

1. 从 [Open Relay 注册入口](https://dashboard.metered.ca/signup?tool=turnserver) 创建账户。
2. 打开 **Realtime Messaging → API Keys / Keys**。首次进入时，按 **Multiplayer game → Enable Realtime Messaging** 开通免费信令，再点击 **Create key**。
3. 选择 **Publishable**，取得 `pk_live_…`。
4. 启用 **Subscribe、Publish、Presence、Send**。官方默认没有启用 `Send`；缺少它时，能加入信令房间却无法完成 WebRTC 协商。
5. 保持 **Auto-inject TURN credentials** 开启，让 SDK 获取 Metered 提供的 TURN 配置。
6. 双方使用同一账户下可访问同一房间的配置。最简单的办法是两边使用同一 Publishable key。

这是浏览器可公开的密钥。**不要**把账户管理 Secret Key 或 TURN REST API Key 写进 `VITE_*`、源码或 GitHub Pages。不要用长期私密 API Key 替换示例的 `pk_live_…`。

官方 Open Relay 页面目前标注 20 GB/月，普通 Metered TURN 产品的免费档另为 500 MB/月；注册后请核对实际账户额度。信令免费档目前为 100 个峰值并发连接、每月 100,000 条消息。官方政策核对日期：2026-11-20。

本工作区的实际接入：`fudancraft`，app ID `6b0032633b1841d565363323`。2026-11-20 控制台显示 **TURN Trial · 500 MB/月 · $0/月**，下次续期为 2026-12-20；不能按 Open Relay 宣传页的 20 GB 估算本账户可用流量。已创建名为 `fudancraft-pages-example` 的 Publishable key，上述四项信令权限和 TURN 自动注入均已开启。本地 `.env.local` 已配置该公开密钥，并被 Git 忽略；下载 ZIP 不包含此文件。

## 2. 本地运行

从本仓库根目录运行：

```bash
cd examples/metered-pages
npm ci
cp .env.example .env.local
```

编辑 `.env.local`：

```dotenv
VITE_METERED_PUBLISHABLE_KEY=pk_live_你的公开密钥
```

然后运行：

```bash
npm run dev
```

打开 Vite 输出的地址。也可以不创建 `.env.local`，直接在页面「连接配置」里填写 Publishable key；本例不会将它写入本地存储或邀请链接。

一端创建房间、复制邀请链接；另一端打开链接后点击「加入房间」。等待两端都显示「通道已就绪」，再发送消息、点击绿色位置区域或使用方向键。两个标签页可以验证基本通信；不同家宽、手机流量上的两台设备才可以验证真实公网路径。

构建和预览：

```bash
npm test
npm run build
npm run preview
```

`dist/` 只有静态资源。Vite 使用 `base: './'`，邀请信息放在 URL hash，适用于 GitHub Pages 的 `/仓库名/` 子路径，刷新邀请链接不会触发 SPA 404。

## 3. 发布到 GitHub Pages

本仓库已经包含工作流：[`.github/workflows/metered-pages.yml`](../../.github/workflows/metered-pages.yml)。它只在手动触发时发布。

1. 将源码上传 GitHub，保留 `examples/metered-pages/` 和根目录 `.github/workflows/metered-pages.yml` 的路径。
2. 在仓库 **Settings → Secrets and variables → Actions → Variables** 中创建：

   | Name | Value |
   |---|---|
   | `METERED_PUBLISHABLE_KEY` | `pk_live_…` |

   它是公开配置，放在 Repository variable 即可；构建会把值写入浏览器 JS。
3. 在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
4. 打开 **Actions → Deploy Metered example to GitHub Pages → Run workflow**。
5. 工作流依次校验密钥、安装锁定依赖、测试、构建、上传静态资源并部署。打开工作流输出的 Pages 地址。
6. 更换 Repository variable 后需要重新运行工作流，已经部署的 JS 不会自动变化。

一个仓库通常只有一个 Pages 站点；运行这个工作流会把该仓库的 Pages 内容发布为本例。如果想同时保留游戏站点，请为示例使用独立仓库，并保留上面的目录结构。下载包就是这个结构。

## 4. 为什么不使用 `peer.send()` 传游戏数据

Metered 的 `peer.send()`、`peer.sendTo()`、`remote.send()` 都是**经信令服务器转发**的 API，会消耗信令消息额度。示例没有使用它们传聊天和位置数据。

[`src/metered-room.ts`](src/metered-room.ts) 在 `peer-joined` 时创建两个通道：

```ts
if (!remote.polite) {
  remote.pc.createDataChannel('pages-control-v1', { ordered: true });
  remote.pc.createDataChannel('pages-updates-v1', {
    ordered: false,
    maxRetransmits: 0,
  });
}
```

可靠、有序的 `control` 用于名字和聊天，可以扩展为玩家操作指令；不重传、无序的 `updates` 用于可被下一帧覆盖的位置快照。实际完整代码会为两个通道注册接收、打开、关闭处理器。

`remote.polite` 只决定每对浏览器由谁创建通道，**不是**游戏房主标记。另一端通过 `data-channel` 接收这两个通道；不能双方都创建又不监听接收，也不能等 `connected` 后才创建数据通道——数据应用需要创建通道来触发第一次协商。

## 5. 重连、校验和缓冲区处理

- SDK 默认处理信令重连、ICE 重启和 TURN 注入。
- SDK 重建底层 PeerConnection 后会触发 `connection-reset`（要求 SDK 1.2.0+）；本例关闭旧通道，并由创建端重新创建两条通道。
- 回调检查当前连接和通道身份，旧通道的晚到事件不会写入新会话。
- 位置包有 `seq`，拒绝无序通道里晚到的旧快照。
- 接收端验证协议版本、类型、名称/消息长度、坐标边界和最大 4 KiB 包大小。
- 发送前检查 `bufferedAmount`，64 KiB 缓冲区上限；超出时跳过快照，聊天则明确报告没有可用通道，不创建无界队列。
- 隐藏标签页时暂停 10 Hz 位置发送。退出时关闭 SDK、数据通道和统计计时器。
- 房间码和玩家名字只是这个演示的产品约定，不是服务端身份认证。正式对战的加入权限和房主身份应另行定义；公开密钥本身不提供每个房间的私有授权。

## 6. 实测 TURN

1. 加入前，在两端「连接配置」里勾选「强制使用 TURN 中继」。
2. 创建/加入同一房间，等待「通道已就绪」。
3. 观察连接行显示 **TURN 中继**，发送消息并验证位置同步。
4. 取消勾选后重新加入，浏览器允许优先选择直连。

该开关在创建 `RTCPeerConnection` 时设置 `iceTransportPolicy: 'relay'`，仍保留 SDK 提供的 `iceServers`。界面用 `getStats()` 读取**实际被选中的 candidate pair**；发现候选地址里有 relay 并不等于当前正在走 TURN。

RTT 来自选中候选对的 `currentRoundTripTime`，是连接诊断指标，不代表完整游戏的输入到画面延迟。

常见问题：

| 现象 | 检查 |
|---|---|
| 能加入房间，数据通道一直不就绪 | Publishable key 的 `Send` 权限、两端账户配置、同一个房间码 |
| 强制 TURN 后连接失败 | 当前账户是否有 TURN 凭据与剩余额度；当前网络能否访问服务 |
| 改了 `.env.local` 仍是旧值 | 重启 Vite 开发服务 |
| 改了 GitHub variable 仍是旧值 | 重新运行发布工作流 |
| 邀请链接没自动加入 | 本例预填房间码，朋友仍需点击「加入房间」 |
| 手机切网后暂时断开 | 等 SDK 恢复；等待较久时点击「重新连接」 |

## 7. 将通信接入 FudanCraft

本例的 UI 只同步各端自己的光点，不做房主权威模拟。接入游戏时，可以继续沿用现有“指令上行、视野过滤状态下行”的结构：

1. 房主浏览器运行现有 `Engine`，接收其他玩家可靠通道里的操作指令。
2. 房主执行身份/席位检查后调用 `engine.command(side, command)`，统一推进 `engine.step(.05)`。
3. 房主为每位玩家生成 `engine.view(side)`，通过该玩家的数据通道发送快照。
4. 其他玩家只渲染收到的状态，恢复连接后重新发送完整初始化状态。
5. 本例固定 4 KiB 的小包适合位置/指令示范；完整地图、雾图与单位状态需要另外实现分块重组、完整初始化和快照序列处理，不能直接塞进本例的位置包。

房主迁移、后台标签页的模拟调度、断线 AI 接管、完整存档及对局公平性都属于游戏层工作，并不由 TURN 或 SDK 自动提供。

## 文件与官方参考

```text
.github/workflows/metered-pages.yml      GitHub Pages 手动发布
examples/metered-pages/
  .env.example                          公开配置模板
  package.json / package-lock.json       锁定 SDK 和工具链
  vite.config.ts / tsconfig.json         子路径构建和类型检查
  index.html                            页面入口
  src/main.ts                           房间、邀请与位置 UI
  src/metered-room.ts                    通道、重连、路径统计
  src/protocol.ts                        输入和数据包校验
  src/style.css                         响应式界面
  tests/transport.test.ts                传输边界回归
```

官方参考：

- [Metered Publishable key / 无后端接入](https://www.metered.ca/docs/realtime-messaging/quickstart-webrtc/)
- [DataChannel、创建端角色和重连处理](https://www.metered.ca/docs/realtime-messaging/sdk-javascript/guides/data-channel-low-latency/)
- [重连生命周期](https://www.metered.ca/docs/realtime-messaging/sdk-javascript/guides/reconnect-best-practices/)
- [托管信令与免费额度](https://www.metered.ca/tools/openrelay/webrtc-signaling-server)
- [Open Relay TURN](https://www.metered.ca/tools/openrelay/)

本地回归使用模拟的 SDK 事件和 DataChannel，验证创建时机、重建、消息校验与背压；模拟回归本身不证明真实 Metered 服务或公网 TURN 可用。

本次交付验证：5 项回归通过，TypeScript 检查与 Vite 生产构建通过；浏览器验证了邀请 hash 预填、无效密钥提示、未连接时禁用发送，以及点击移动光点。

2026-11-20 使用上述账户进行了真实服务验证：本机两个浏览器页面通过 Metered 信令加入同一房间，直连与两端强制 TURN 均成功建立 DataChannel；两种路径的双向文字消息和位置同步均通过，退出后发送按钮恢复禁用。选中候选对的 RTT 在直连时约 1 ms，在 TURN 时约 620 ms；这是当前测试网络下的观测值，TURN 延迟对实时对战偏高，需要继续用不同家宽或手机网络上的两台设备评估。测试结束已关闭双方连接。

GitHub Pages 在线发布和两台设备跨网络测试尚未执行。GitHub 发布仍需按第 3 节设置 Repository variable 并运行工作流。
