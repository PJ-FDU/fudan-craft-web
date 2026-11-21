(function () {
  "use strict";
  const jump = document.querySelector("#chapter-jump");
  if (jump) jump.addEventListener("change", function () {
    const target = document.getElementById(jump.value);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const print = document.querySelector("#print-report");
  if (print) print.addEventListener("click", function () { window.print(); });

  const sections = [...document.querySelectorAll(".chapter[id]")];
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(function (entries) {
      entries.filter(entry => entry.isIntersecting).forEach(function (entry) {
        document.querySelectorAll(".sidebar nav a").forEach(function (link) {
          link.classList.toggle("active", link.getAttribute("href") === "#" + entry.target.id);
        });
      });
    }, { rootMargin: "-5% 0px -75% 0px" });
    sections.forEach(section => observer.observe(section));
  }

  if (window.mermaid) {
    const vars = getComputedStyle(document.documentElement);
    mermaid.initialize({
      startOnLoad: true,
      theme: "base",
      securityLevel: "strict",
      themeVariables: {
        fontFamily: vars.getPropertyValue("--font").trim(),
        primaryColor: vars.getPropertyValue("--soft").trim(),
        primaryTextColor: vars.getPropertyValue("--ink").trim(),
        primaryBorderColor: vars.getPropertyValue("--accent").trim(),
        lineColor: vars.getPropertyValue("--muted").trim(),
        secondaryColor: vars.getPropertyValue("--bg2").trim(),
        tertiaryColor: vars.getPropertyValue("--tint").trim()
      },
      flowchart: { htmlLabels: false, curve: "basis", padding: 16, useMaxWidth: true }
    });
  }

  const demo = document.querySelector("#cast-demo");
  if (!demo) return;
  const scenario = demo.querySelector("#demo-scenario");
  const output = name => demo.querySelector('[data-output="' + name + '"]');
  const action = name => demo.querySelector('[data-action="' + name + '"]');
  let state;
  function reset() {
    const choice = scenario.value;
    state = {
      choice,
      phase: "idle",
      energy: choice === "energy" ? 20 : 50,
      cooldown: choice === "cooldown" ? 5 : 0,
      target: choice === "clean" ? "目标没有负面状态" : "目标被定身",
      message: "先点击「选择应急净化」，再选择目标。本示例按步骤推进，不模拟时间流逝与自然恢复。",
      blocked: false
    };
    render();
  }
  function render() {
    const phases = { idle: "待命", targeting: "选择目标", windup: "前摇中", complete: "已释放", interrupted: "已打断" };
    output("energy").textContent = state.energy + " / 100";
    output("cooldown").textContent = state.cooldown + " 秒";
    output("phase").textContent = phases[state.phase];
    output("target").textContent = state.target;
    output("message").textContent = state.message;
    output("message").dataset.kind = state.blocked ? "blocked" : "normal";
    action("select").disabled = state.phase === "windup" || state.phase === "targeting";
    action("target").disabled = state.phase !== "targeting";
    action("release").disabled = state.phase !== "windup";
    action("interrupt").disabled = state.phase !== "windup";
    action("cancel").disabled = state.phase !== "targeting" && state.phase !== "windup";
  }
  scenario.addEventListener("change", reset);
  demo.addEventListener("click", function (event) {
    const button = event.target.closest("[data-action]");
    if (!button || !demo.contains(button) || button.disabled) return;
    const operation = button.dataset.action;
    state.blocked = false;
    if (operation === "reset") return reset();
    if (operation === "select") {
      state.phase = "targeting";
      state.message = "目标预览已打开。尚未起手，不扣能量，也不启动冷却。";
    } else if (operation === "target") {
      let error = "";
      if (state.choice === "silenced") error = "自身被沉默：无法起手主动技能。";
      else if (state.cooldown > 0) error = "技能冷却中：剩余 " + state.cooldown + " 秒。";
      else if (state.energy < 25) error = "能量不足：需要 25，当前 " + state.energy + "。";
      else if (state.choice === "range") error = "射程不足：先移动到 240 世界单位射程内再施法。";
      else if (state.choice === "clean") error = "无效目标：没有可净化的负面状态。";
      if (error) {
        state.blocked = true;
        state.message = error + " 本次没有扣费，仍处于目标模式。";
      } else {
        state.energy -= 25;
        state.cooldown = 12;
        state.phase = "windup";
        state.message = "起手成功：扣除 25 能量，启动 12 秒冷却，进入 0.25 秒前摇。点击「结算前摇」或「模拟打断」。";
      }
    } else if (operation === "release") {
      state.phase = "complete";
      state.target = "定身已解除 · 获得 3 秒定身抗性";
      state.message = "净化成功：移除 1 个负面状态。示例冻结时间，冷却仍显示起手值；实际游戏会随游戏时间递减。";
    } else if (operation === "interrupt" || operation === "cancel" && state.phase === "windup") {
      state.phase = "interrupted";
      state.blocked = true;
      state.message = "前摇被打断：净化未生效，目标仍被定身；25 能量不退，冷却继续。";
    } else if (operation === "cancel") {
      state.phase = "idle";
      state.message = "已退出目标模式：未起手，没有能量或冷却损失。";
    }
    render();
  });
  reset();
})();
