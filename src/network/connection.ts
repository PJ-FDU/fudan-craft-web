/** 与 WebSocket 共用事件入口，使两种构建保留同一套战场 UI。 */
export interface GameConnection {
  readonly readyState:number;
  onopen:((event:Event)=>void)|null;
  onerror:((event:Event)=>void)|null;
  onmessage:((event:MessageEvent<string>)=>void)|null;
  onclose:((event:CloseEvent)=>void)|null;
  send(data:string):void;
  close():void;
}
