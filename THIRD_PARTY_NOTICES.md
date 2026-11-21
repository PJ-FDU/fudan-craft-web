# 来源与许可

FudanCraft Web 的原创代码及项目生成的美术和录音在权利人可授权范围内按 [Apache-2.0](LICENSE) 提供。下列上游数据、字体和依赖分别适用各自的许可。

## 上游 FudanCraft

原版由朱灵均、赵凌丰、潘健共同开发，原版版权归三人共同拥有。此 Web 重制参考了原版用户手册以及 `Classes/BattleScene.cpp`、`Classes/Unit.cpp`、`Classes/AdvancedUnit.cpp`、`Classes/Buliding.cpp` 和 `Classes/GridMap.cpp` 中的玩法与规则。上游许可原文保存在 [docs/ORIGINAL_LICENSE](docs/ORIGINAL_LICENSE)。

- [参考提交 `d277e41c731202996598c1e475dbf63ac4a54671`](https://github.com/PJ-FDU/fudancraft/tree/d277e41c731202996598c1e475dbf63ac4a54671)
- [上游用户手册与版权声明](https://github.com/PJ-FDU/fudancraft/blob/d277e41c731202996598c1e475dbf63ac4a54671/documents/UserManual.md)
- [上游地图 `Resources/Map/LostTemple.tmx`](https://github.com/PJ-FDU/fudancraft/blob/d277e41c731202996598c1e475dbf63ac4a54671/Resources/Map/LostTemple.tmx)

`src/game/map.ts` 通过 [导入脚本](scripts/import-assets.mjs) 将上述 TMX 的地形和出生点提取成 TypeScript。三位原作者已确认这份地图数据可按 Apache-2.0 随本项目发布。

另外四张参考经典布局的地图通过手工锚点和程序化地形实现。外部预览图保留为 [来源链接](docs/FOUR_MAPS.md#经典地图的布局锚点)。Web 版发布包只包含本项目生成的贴图、配乐、音效与录音，以及下列字体。

## 美术与音频

- `public/assets/generated/` 包含为本项目生成的图集、材质和首页封面。生成记录见 [生成美术](docs/GENERATED_ART.md)、[八方向素材](docs/DIRECTIONAL_ART.md) 和 [序列帧与地表素材](docs/ANIMATION_ART.md)。
- `public/assets/audio/` 包含项目脚本合成的配乐和音效，以及用 [Qwen3-TTS VoiceDesign 的 MLX 转换模型](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit)（Apache-2.0）离线生成的中英文配音。生成工具及步骤见 [声音文档](docs/audio.md#qwen3-tts-中英文配音)。
- `public/assets/audio/factions-v1/` 包含项目脚本合成的四族音效和循环。其 `voice-qwen3-v1/` 子目录中的中英文配音由 [Qwen3-TTS VoiceDesign 1.7B 的 MLX 4-bit 转换](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit/tree/5c390979e4b93af5f2932f90742ca99c7dd04687)（Apache-2.0）离线生成。生成步骤见 [声音文档](docs/audio.md#重新生成四族素材)。

## 字体与依赖

- Barlow Condensed 和 IBM Plex Mono 随游戏从同源加载，适用 SIL Open Font License 1.1。两份许可证及版权声明位于 `public/assets/fonts/`，见 [字体来源](docs/FONTS.md)。
- 运行依赖为 Three.js（MIT）、`ws`（MIT）和 Pages 对战使用的 `@metered-ca/realtime`（MIT）。开发依赖包含 TypeScript（Apache-2.0）、Vite（MIT）和 tsx（MIT）。各依赖包附带自己的许可证。
