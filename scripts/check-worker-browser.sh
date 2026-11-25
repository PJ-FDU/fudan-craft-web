#!/bin/sh
# 同一浏览器会话内完成图鉴及实战检查，退出时关闭独立验证会话。
set -eu
browser() { sh .cache/sculpt-browser.sh "$@"; }
trap 'browser close' EXIT
choose() {
  browser find role combobox click --name "$1" --exact
  browser find role option click --name "$2" --exact
}
browser open http://127.0.0.1:4321/
browser set viewport 1440 1100
browser find role button click --name "战术档案"
browser find role button click --name "种族模型图鉴"
browser wait "#model-preview" --state visible
browser wait --load networkidle
browser find role button click --name "暂停动作" --exact
browser screenshot artifacts/worker-hero/game-worker-idle.png
choose "动作" "移动"
browser find role button click --name "下一帧" --exact
browser find role button click --name "下一帧" --exact
browser screenshot artifacts/worker-hero/game-worker-move.png
choose "动作" "采集 / 施工"
browser find role button click --name "下一帧" --exact
browser find role button click --name "下一帧" --exact
browser find role button click --name "下一帧" --exact
browser screenshot artifacts/worker-hero/game-worker-gather.png
browser eval '({kind:document.querySelector("#model-preview")?.dataset.kind,time:document.querySelector("#model-preview")?.dataset.time,state:document.querySelector("#model-state")?.value})'
choose "玩家颜色" "赤红"
browser screenshot artifacts/worker-hero/game-worker-red.png
browser errors
browser find role button click --name "关闭" --exact
browser open http://127.0.0.1:4321/
browser find role button click --name "新的战役"
browser find role button click --name "选择战场"
browser find role button click --name "开始部署"
browser wait "#battle-loading" --state hidden
browser wait --load networkidle
browser wait "#battle-3d" --state visible
browser screenshot artifacts/worker-hero/game-battle.png
browser eval '({canvas:!!document.querySelector("#battle-3d"),workerAssets:performance.getEntriesByType("resource").filter(e=>e.name.includes("/blender-sculpt-v2/worker")).map(e=>e.name.split("/").pop())})'
browser errors
