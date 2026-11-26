export const PINGS={attack:['进攻这里','Attack here'],danger:['这里危险','Danger here'],rally:['在此集合','Rally here'],support:['需要支援','Need support']} as const;
export const QUICK_MESSAGES={resources:['资源不足，请支援','Low resources, please help'],attack:['准备进攻','Preparing to attack'],defend:['请防守基地','Please defend the base'],ready:['准备好了','Ready'],wait:['请等一下','Please wait'],thanks:['谢谢队友','Thanks, team']} as const;
export type PingKind=keyof typeof PINGS;
export type QuickMessage=keyof typeof QUICK_MESSAGES;
