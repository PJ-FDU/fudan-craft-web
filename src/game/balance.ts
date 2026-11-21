/** 共享规则：本地模拟、联机服务器和界面均从这里读取，不按难度修改资源或伤害。 */
export const BALANCE = {
  repairHpPerSecond:24,
  repairCostFraction:.5,
  repairWorkerWeights:[1,.6,.4] as readonly number[],
  medicHeal:10,
  splashMinimum:.35,
} as const;
