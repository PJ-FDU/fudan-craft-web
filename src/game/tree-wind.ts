/** A calm, continuous breeze; atlas poses are illustrations, not coherent motion frames. */
export const WIND_PERIOD=12;
const TAU=Math.PI*2;
const AMPLITUDE=[.006,.009,.012,.005] as const;

export function windDisplacement(time:number,x:number,y:number,size:number,species:number){
  // Nearby trees share the breeze, with a gentle spatial delay rather than unrelated twitching.
  const phase=time/WIND_PERIOD*TAU+x*.0012+y*.0007;
  return size*(AMPLITUDE[species]??AMPLITUDE[1])*(.85*Math.sin(phase)+.15*Math.sin(phase*2));
}

export function canopyBend(height:number,displacement:number){
  // Keep the bottom quarter, including roots and lower trunk, perfectly still.
  const crown=Math.max(0,Math.min(1,(height-.25)/.75));
  return crown===0?0:displacement*crown*crown;
}
