# 工业联邦重甲突击步兵

三维图鉴和战场共用 `public/assets/blender-sculpt-v2/rifleman.glb`，配套独立的 2048² Albedo、切线法线和 ORM 纹理，烘焙记录见 [烘焙报告](../artifacts/rifleman/rifleman-bake.json)。

模型由 [scripts/build-rifleman.py](../scripts/build-rifleman.py) 在 Blender 中按工业联邦重甲画风独立雕塑高低模并投射烘焙，与战地医疗兵、幽影狙击手、工程采集车及战场 HUD 头像保持一致的陶瓷白／钢灰厚重动力装甲比例：

- **挺拔重甲轮廓**：厚实弧面陶瓷胸甲、三段钢灰腹甲、双层圆弧肩甲（挂载于躯干肩穹顶，举枪瞄射不翻转露底）、全封闭宽幅蓝青护目面罩头盔与紧凑动力背包；双肩、胸甲 IFF 与头盔顶脊均设独立阵营色材质槽，俯视角识别清晰。
- **16 骨双手 IK 步枪契约**：独立 `rifle` 骨骼挂载重型脉冲突击步枪（含陶瓷侧护板、通孔枪管、双腔制退器、弧形弹匣、全息瞄具与发光弹药条）；运行时由 [src/game/unit-rig.ts](../src/game/unit-rig.ts) 的 `riflemanGrip` 解析双骨 IK 实现待机／行军胸前低枪戒备与攻击抵肩平射后坐。
- **全刚性骨骼实时光追**：所有网格均按单骨刚性绑定，图鉴勾选「高清实时光追」后可在播放待机／移动／攻击动作与 360° 旋转时以 TLAS 方式全程实时追踪。

- [可编辑 Blender 工程](../artifacts/rifleman/rifleman.blend)
- [三视图渲染：正面](../artifacts/rifleman/front.png) · [侧面](../artifacts/rifleman/side.png) · [背面](../artifacts/rifleman/rear.png)

```sh
npm run assets:rifleman
npm run check:blender -- artifacts/blender-sculpt/verification.json
```
