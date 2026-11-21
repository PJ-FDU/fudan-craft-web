# FudanCraft Web 2.3.0 发布前检查

检查日期：2026-11-21。环境：macOS、Node.js 22.18.0、npm 10.9.3、两个独立的本机 Chrome 浏览器会话。

**本地发布前检查通过。GitHub 仓库发布与 Pages 线上部署尚未执行。** GitHub 插件授权成功后，授权工具返回要求在新会话中使用授权；本次未重试远程操作。项目当前没有远程仓库，因此没有可确认的线上网址或 GitHub Actions 运行结果。

## 可复现检查

先按 [Pages 配置](GITHUB_PAGES.md) 在被 Git 忽略的 `.env.pages.local` 中配置 Metered 浏览器公钥，然后执行：

```bash
npm ci
npm run check:release
npm audit --omit=dev
npm run preview:pages -- --host 127.0.0.1 --base /fudancraft-web/ --strictPort
```

| 检查 | 结果与证据 |
| --- | --- |
| 干净依赖安装 | `npm ci` 成功，锁文件与项目版本一致 |
| 全量测试 | 181 项通过，0 失败、0 跳过；覆盖游戏规则、WebSocket 服务、P2P 权限、席位恢复、分片、背压及快照生命周期 |
| 服务器构建 | TypeScript 检查、Vite 构建与服务端编译通过 |
| Pages 构建 | TypeScript 检查与静态构建通过，包含 WebRTC 模块和房主 Worker |
| 产物完整性 | 896 份公共素材 SHA-256 一致，Pages 产物约 92.4 MiB |
| 生产依赖审计 | npm 返回 0 项已知漏洞 |
| 工作流 | 三份工作流 YAML 解析通过；线上执行尚未验证 |
| Git 发布范围 | 本地环境文件、依赖、构建缓存和 `.DS_Store` 被忽略；无超过 50 MiB 的待发布文件 |
| 文本格式 | 自有源码与文档的 `git diff --cached --check` 通过；随附的第三方字体许可和压缩 JS 保留原文格式 |
| 凭据检查 | 待发布文本文件未命中可识别的 GitHub token、Metered Secret key 或私钥格式 |
| 仓库子路径 | `/fudancraft-web/` 首页、JS、CSS、封面、WebRTC 模块和 Worker 请求均为 HTTP 200，MIME 类型正确 |
| 手机首页 | 390 × 844 视口下主菜单可见，无横向溢出，无加载失败的图片 |

Vite 对约 1.18 MB 的主游戏模块给出分包大小提示，构建成功。该提示仍保留。

## 本次 WebRTC 浏览器验证

使用真实 Metered 信令和 WebRTC 数据通道，通过游戏界面操作，未替换网络 Provider 或模拟连接。

1. 房主创建自由对战房间，来宾通过完整邀请链接自动进入加入界面。
2. 来宾加入后，房主开始失落神庙双人对战；双方战场时钟推进。
3. 来宾状态栏显示 `P2P 直连 · RTT 1 ms`。来宾训练工程采集车后，工人数从 3 增至 4，人口从 7 增至 8；00:32 时生产完成。
4. 来宾点击修正后的首页链接，整页重新加载，网址仍在 `/fudancraft-web/`；自动恢复同一房间、原席位及已生产的单位，时钟继续到 01:01。
5. 房主关闭浏览器后，来宾回到主菜单并显示「房主已离开，房间结束」。

该结果来自同一台电脑的两个独立浏览器会话，本次未重新验证跨设备、跨运营商网络或强制 TURN 路径。TURN 候选选择、席位恢复和传输边界由现有 P2P 测试覆盖。

![来宾通过 WebRTC 完成采集车生产](release-checks/battle.png)

![手机首页](release-checks/mobile.png)

## 本次发布准备修改

- 战场首页链接由 `/` 改为 `./`，保留 GitHub Pages 仓库子路径。
- 新增 `npm run check:release`，串联测试、两种构建及静态产物检查。
- 完整游戏 Pages 工作流支持 `main` 推送和手动部署；部署前拒绝缺失公钥与 CI 占位公钥。
- 补齐 Pages 配置读取权限和可选 `P2P_RELAY_ONLY` 变量，统一工作流依赖版本。
- 补充 Metered Realtime 依赖许可说明及发布文档。

远程发布时仍需创建或确定目标 GitHub 仓库、设置真实 `METERED_PUBLISHABLE_KEY` Actions 变量、启用 GitHub Actions Pages、推送代码，并检查部署工作流和实际 HTTPS 站点。具体操作与运行边界见 [GitHub Pages 文档](GITHUB_PAGES.md)。
