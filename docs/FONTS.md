# 界面字体

`src/fonts.css` 声明字体，`src/style.css` 导入该文件；字体文件位于 `public/assets/fonts/`，随 Vite 构建复制到 `dist/assets/fonts/`。开发和生产环境均从同源地址加载，不请求 Google Fonts 样式表或字体 CDN。`font-display: swap` 保留系统字体回退，中文继续使用系统中文字体。

| 字体 | 本地字重 | 来源 |
| --- | --- | --- |
| Barlow Condensed | 500、600、700 | `@fontsource/barlow-condensed@5.3.0`，Google Fonts v13 |
| IBM Plex Mono | 400、500、600 | `@fontsource/ibm-plex-mono@5.3.0`，Google Fonts v20 |

六个文件均为原包的 `files/*-latin-*-normal.woff2`，采用 Latin 子集；未添加项目运行时依赖。来源为 [Fontsource Barlow Condensed](https://fontsource.org/fonts/barlow-condensed) 和 [Fontsource IBM Plex Mono](https://fontsource.org/fonts/ibm-plex-mono)，上游为 [Google Fonts](https://github.com/google/fonts)。

字体使用 SIL Open Font License 1.1。原包许可证及版权信息随字体保存为 `barlow-condensed-LICENSE.txt` 和 `ibm-plex-mono-LICENSE.txt`。字体文件、声明字重和生产 MIME 类型分别以 `public/assets/fonts/`、`src/fonts.css` 和 `server/index.ts` 为准。
