# GitHub Pages 静态版与 P2P 对战

本项目有两种独立构建。默认服务器版仍由 Node + WebSocket 运行权威战局；Pages 版只发布静态文件，由房主浏览器的 Worker 运行同一个 `Engine`，其他玩家通过 WebRTC 数据通道连接房主。

| 构建 | 开发 | 构建 | 输出 | 生产运行 |
| --- | --- | --- | --- | --- |
| 服务器版 | `npm run dev` | `npm run build` | `dist/`、`dist-server/` | `npm start` |
| Pages P2P 版 | `npm run dev:pages` | `npm run build:pages` | `dist-pages/` | GitHub Pages 或其他 HTTPS 静态托管 |

Pages 构建使用相对 `base`，封面、字体、图集、声音、动态模块和 Worker 均支持 `https://<owner>.github.io/<repo>/` 仓库子路径。不需要 `/ws`、后台 Node、手动交换 SDP 或在 GitHub Pages 内保存 TURN Secret。

## Metered 配置

使用已申请的 Metered Realtime app，在其后台创建 **Publishable key**，允许所需的 Subscribe、Publish、Presence、Send 权限，并启用 TURN 自动注入。若账号提供域名限制，应允许最终的 GitHub Pages 域名和本地测试来源。不要把 Secret key、管理 API Key 或长期 TURN 密码放入 Vite 环境变量。

```bash
npm ci
cp .env.pages.example .env.pages.local
```

在 `.env.pages.local` 中填入：

```dotenv
VITE_METERED_PUBLISHABLE_KEY=pk_live_你的浏览器公钥
VITE_P2P_RELAY_ONLY=false
```

`.env.pages.local` 已被 Git 忽略。公钥会编入浏览器产物并公开可见，这是 Publishable key 的用途。Provider 只接收入口显式传入的 `key` 与 `relayOnly`；不会读取环境变量。

```bash
npm run dev:pages       # http://localhost:4330
npm run build:pages     # dist-pages/
npm run preview:pages   # 预览构建产物
```

默认优先直连，无法打通 NAT 或防火墙时使用 SDK 注入的 TURN 中继。SDK 提供 TCP / TLS 中继候选时，客户端保留这些中继候选，避免本次跨网验证中 UDP 中继的快照停滞；STUN 和直连候选保持原样。若 SDK 只提供 UDP 中继，则保留其原始配置。只有验证中继时才设 `VITE_P2P_RELAY_ONLY=true` 并重新构建。战场状态栏显示选中的直连 / TURN 路径和 WebRTC RTT；它是当前连接的往返时间，不能拿某次 TURN 测试值推断其他两台机器的直连时延。

## 发布到 GitHub Pages

1. 将项目放入 GitHub 仓库。
2. 在 **Settings → Secrets and variables → Actions → Variables** 添加 `METERED_PUBLISHABLE_KEY`，值为上述 `pk_live_` 公钥。
3. 在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
4. 推送 `main`，或在 **Actions** 手动运行 **Deploy FudanCraft P2P to GitHub Pages**。

工作流源文件为 [game-pages.yml](../.github/workflows/game-pages.yml)，先拒绝缺失或 CI 占位公钥，再安装依赖、运行 `npm run check:release`、上传 `dist-pages/` 和部署。`main` 推送自动部署，其他分支只运行 CI。可选 Actions 变量 `P2P_RELAY_ONLY` 默认为 `false`，只有验证强制 TURN 中继时才设为 `true`。

此前的 **Deploy Metered example to GitHub Pages** 只发布通信示例。两个发布工作流使用同一个 Pages 站点，发布完整游戏时请选择游戏工作流。CI 会额外构建 Pages 产物，使用测试占位公钥，不访问 Metered。

## 联机操作与生命周期

房主点击「多人联机」，选择自由对战或合作模式并创建房间。作战室提供可选中复制的邀请链接；将其发送给朋友，朋友打开后会自动进入加入界面，确认代号并点击加入。房主选图后开始战役。自由对战支持 2–4 人，合作模式支持 1–2 位人类，两个朋友合作需选四人地图，队伍共享视野且各自管理经济。

邀请包含随机 12 位房间编号与 Metered 分配的房主 `peerId`。加入时需要完整邀请链接或 `编号:房主标识`，仅输入显示的短编号无法加入。客户端只接受邀请指定房主的数据，不根据先到消息推举房主。

其他玩家短暂断线时由 AI 接管，其席位保留 120 秒；连接恢复或刷新页面后自动凭当前标签页的 token 恢复。主动离开会释放席位。服务器版与 P2P 版使用不同的 `sessionStorage` 键，不会互相误用重连票据。

房主保持固定，不支持迁移、房主刷新恢复、服务器持久化或房主关闭后的继续对战。房主离开或刷新页面后房间结束，所有玩家需要新建房间。电脑休眠、浏览器冻结页面或网络长期中断也会影响房主模拟；开局后应保持设备唤醒。

## 源码锚点与验证

| 功能 | 源码 |
| --- | --- |
| 模式、base、公钥构建校验、服务器版排除 P2P Worker | `vite.config.ts` |
| 游戏入口传递显式配置、通用消息处理 | `src/main.ts` |
| 固定房主邀请、独立席位键与 TCP / TLS 中继候选选择 | `src/network/config.ts` |
| Metered 信令、ICE 策略、DataChannel 与连接 RTT | `src/network/p2p-connection.ts` |
| 席位、选图、模式、指令限流、AI 接管、重连和再战 | `src/network/host-room.ts` |
| 20 Hz 模拟、10 Hz 按玩家视野的快照 | `src/network/host-worker.ts` |
| gzip、16 KiB 分片、乱序拼装 / 有界解压 | `src/network/snapshot-codec.ts` |
| 独立指令 / 快照通道、合并旧快照、背压 | `src/network/data-link.ts` |
| 两种权威节点共用的指令边界校验 | `src/game/command-validation.ts` |
| 通用资源路径 | `src/game/assets.ts` |

只向玩家发送 `Engine.view(side)`，不发送完整战局存档；敌方经济和战争迷雾沿用服务器版规则。指令与房间控制使用可靠有序通道，战场快照使用独立的可靠无序通道。每位玩家同时只传一份快照，完成拼装与解压后通过控制通道确认，再发送等待中的最新状态；高 RTT 下会降低实际快照频率，避免旧状态排队或多份分片互相挤占。确认超过 15 秒会关闭数据通道并进入既有恢复流程。快照压缩上限为 2 MiB，解压上限为 8 MiB，单片最多 16 KiB；拼装允许片段乱序并拒绝重复及旧序号。发送和解压只保留最新待处理快照，快照发送缓冲目标为 32 KiB，可靠控制队列最多 32 条、64 KiB。新局或恢复席位时废弃旧的待发快照，已发送状态仍等待确认；每次新局递增 `epoch`，接收方拒绝跨局晚到的快照。

这是房主可信的朋友对战模式。房主控制权威模拟，不能作为对房主也防作弊的竞技服务器。

```bash
npm run check:release
```

`scripts/check-pages-build.mjs` 验证 Pages 入口没有根路径资源或导航引用、所有公共素材按 SHA-256 原样复制、P2P 模块与房主 Worker 存在、服务器产物排除这两个模块，并检查 Pages 包大小和本地配置泄漏。完整命令需本地有效格式的公钥；CI 使用占位公钥仅验证构建，不访问 Metered，部署工作流拒绝使用该占位值。

`tests/p2p.test.ts` 覆盖邀请固定房主、中继候选选择、权限、战争迷雾、指令归属、合作容量、席位保留 / 恢复 / 到期、房主席位保护、再战 epoch、真实 Engine 快照压缩、乱序分片与丢包后的新快照还原，以及慢快照不会阻塞指令。`tests/network.test.ts` 继续验证默认 WebSocket 服务器。

实际浏览器验证使用同一台电脑上两个独立 Chrome 上下文，通过完整游戏界面建立双人合作房间、选择环形山谷并开局。直连时来宾生产队列从 0 变为 1，单位数量从 6 增为 7；双方时钟推进到 00:18 时没有积压。来宾刷新后恢复原席位与已有单位，房主关闭页面后，来宾返回主菜单。该本机结果不能代表跨设备、跨运营商或 TURN 中继的时延。

最终构建的强制 TURN 路径也通过了房间、指令、生产、持续推进、来宾刷新恢复和房主关闭验证，使用正式代码中的 TCP / TLS 候选策略，未注入测试策略。房主推进到 00:22 时，来宾为 00:21；观测 RTT 约 1.1–2.0 秒。UDP 中继在本次环境中能开局与生产，但快照随后停滞，因此最终采用上述 TCP / TLS 候选策略。中继时延仍明显高于本机直连，不适合据此保证其他网络的体验。

流量以 Metered 当前后台套餐及实际中继路径为准。该 app 此前显示 500 MB/月，不能套用其他套餐的免费额度。TURN 承载游戏快照时消耗中继流量，长时间对战前应查看剩余额度。
