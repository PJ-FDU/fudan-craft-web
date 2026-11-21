/** 网页保持固定比例；画布内的捏合和滚轮仍交给 BattleControls 缩放战场相机。 */
export function lockPageZoom(){
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&(['+','=','-','_','0'].includes(e.key)||['NumpadAdd','NumpadSubtract','Numpad0'].includes(e.code)))e.preventDefault();
  },{capture:true});
  document.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)e.preventDefault();},{passive:false,capture:true});
  for(const name of ['gesturestart','gesturechange','gestureend'])
    document.addEventListener(name,e=>e.preventDefault(),{passive:false});
}
