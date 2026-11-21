/** Vite 的相对 base 支持仓库子路径；Node 中仍使用根路径，供共享规则和测试读取。 */
export const assetPath=(path:string)=>`${(import.meta as ImportMeta & {env?:{BASE_URL?:string}}).env?.BASE_URL??'/'}assets/${path}`;
