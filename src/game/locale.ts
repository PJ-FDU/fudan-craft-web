import { ENGLISH } from './locale-dictionary.js';
export type Language='zh'|'en';
export const LANGUAGE_KEY='fudancraft-language-v1';
let language:Language='zh';
try{if(localStorage.getItem(LANGUAGE_KEY)==='en')language='en';}catch{/* 无存储时默认为中文。 */}
const listeners=new Set<()=>void>();
export const getLanguage=()=>language;
export const presetText=(value:readonly [string,string])=>value[language==='en'?1:0];
export function setLanguage(value:Language){
  if(value===language)return;
  language=value;
  try{localStorage.setItem(LANGUAGE_KEY,value);}catch{/* 当前会话仍可切换。 */}
  for(const listener of listeners)listener();
}
export function onLanguageChange(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);}
const phrasePattern=new RegExp(Object.keys(ENGLISH).sort((a,b)=>b.length-a.length).map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
export function translate(value:string,locale:Language):string{
  if(locale==='zh')return value;
  const exact=ENGLISH[value.trim()];
  if(exact)return value.replace(value.trim(),exact);
  return value
    .replace(/已(?:选中|选择)\s*(\d+)\s*个单位/g,(_match,count)=>`${count} ${count==='1'?'unit':'units'} selected`)
    .replace(/(\d+)\s*张地图，(\d+)\s*支军团。/g,'$1 maps, $2 armies.')
    // 先匹配最长原句，再给相邻中文片段补英文词间空格；提前拆前缀会破坏完整提示。
    .replace(phrasePattern,(phrase,offset:number,source:string)=>{
      const next=source[offset+phrase.length];
      return ENGLISH[phrase]+(next&&/\p{Script=Han}/u.test(next)?' ':'');
    });
}
export const t=(value:string)=>translate(value,language);

/** 原文缓存只存在于 DOM 显示边界；不修改 Engine、存档、命令或玩家输入。
 * MutationObserver 同步新生成的菜单/提示，缓存原文使往返切换不会丢失中文。
 */
export function localizeDocument(root:HTMLElement=document.documentElement){
  const texts=new WeakMap<Text,{original:string;rendered:string}>();
  const attributes=new WeakMap<Element,Map<string,{original:string;rendered:string}>>();
  const names=['title','aria-label','placeholder','data-reason','content'];
  const ignored=(element:Element|null)=>!element||!!element.closest('script,style,[data-i18n-ignore]');
  function text(node:Text){
    if(ignored(node.parentElement))return;
    const old=texts.get(node),original=old?.rendered===node.data?old.original:node.data,rendered=t(original);
    texts.set(node,{original,rendered});if(node.data!==rendered)node.data=rendered;
  }
  function element(node:Element){
    if(ignored(node))return;
    let cache=attributes.get(node);if(!cache){cache=new Map();attributes.set(node,cache);}
    for(const name of names){
      const current=node.getAttribute(name);if(current===null)continue;
      const old=cache.get(name),original=old?.rendered===current?old.original:current,rendered=t(original);
      cache.set(name,{original,rendered});if(current!==rendered)node.setAttribute(name,rendered);
    }
  }
  function tree(node:Node){
    if(node instanceof Text){text(node);return;}
    if(!(node instanceof Element)||ignored(node))return;
    element(node);const walker=document.createTreeWalker(node,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){const item=walker.currentNode;if(item instanceof Text)text(item);else element(item as Element);}
  }
  const observer=new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='characterData')text(record.target as Text);
      else if(record.type==='attributes')element(record.target as Element);
      else for(const node of record.addedNodes)tree(node);
    }
  });
  const refresh=()=>{root.lang=language==='en'?'en':'zh-CN';tree(root);};
  refresh();observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:names});
  const unsubscribe=onLanguageChange(refresh);
  return()=>{observer.disconnect();unsubscribe();};
}
