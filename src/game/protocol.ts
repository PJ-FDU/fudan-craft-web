// One bit per fog cell. Released map grids are byte-aligned.
export function packFog(cells:ArrayLike<number>):Uint8Array {const bytes=new Uint8Array(Math.ceil(cells.length/8));for(let i=0;i<cells.length;i++)if(cells[i])bytes[i>>3]|=1<<(i&7);return bytes;}
export function unpackFog(bytes:Uint8Array,length=bytes.length*8):number[]{
  const cells=new Array<number>(length);
  for(let i=0;i<length;i++)cells[i]=(bytes[i>>3]>>(i&7))&1;
  return cells;
}
