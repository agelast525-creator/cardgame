export class Bucket {
 private tokens:number;
 private updated:number;
 constructor(private capacity:number,private perSecond:number,now=Date.now()){this.tokens=capacity;this.updated=now;}
 take(now=Date.now()){
  this.tokens=Math.min(this.capacity,this.tokens+Math.max(0,now-this.updated)*this.perSecond/1000);
  this.updated=now;
  if(this.tokens<1)return false;
  this.tokens--;return true;
 }
}
const fields:Record<string,string[]>={
 create_room:['nickname'],join_room:['nickname'],reconnect_game:['token'],
 request_game_state:[],update_nickname:['nickname'],play_card:['cardId'],
 end_leader_turn:[],decline_to_defend:[]
};
export function validate(event:string,data:unknown):asserts data is Record<string,unknown>{
 if(!Object.hasOwn(fields,event)||!data||typeof data!=='object'||Array.isArray(data)||Object.getPrototypeOf(data)!==Object.prototype)throw Error('请求格式错误');
 const d=data as Record<string,unknown>;
 const allowed=new Set(['roomId','revision',...fields[event]]);
 if(Object.keys(d).some(k=>!allowed.has(k)))throw Error('请求包含不支持的字段');
 if(event==='create_room'){
  if(d.roomId!==undefined&&(typeof d.roomId!=='string'||d.roomId.length>32))throw Error('房间号格式错误');
 }else if(typeof d.roomId!=='string'||! /^[A-Fa-f0-9]{8}$/.test(d.roomId))throw Error('房间号格式错误');
 if(d.revision!==undefined&&(!Number.isSafeInteger(d.revision)||Number(d.revision)<0))throw Error('牌局版本错误');
 if(['play_card','end_leader_turn','decline_to_defend'].includes(event)&&d.revision===undefined)throw Error('缺少牌局版本');
 if(d.nickname!==undefined&&(typeof d.nickname!=='string'||!d.nickname.trim()||d.nickname.length>20||/[\u0000-\u001f\u007f]/.test(d.nickname)))throw Error('昵称须为1–20个字符，不能包含控制字符');
 if(event==='update_nickname'&&d.nickname===undefined)throw Error('请输入昵称');
 if(event==='reconnect_game'&&(typeof d.token!=='string'||! /^[a-f0-9]{64}$/.test(d.token)))throw Error('身份凭证格式错误');
 if(event==='play_card'&&(typeof d.cardId!=='string'||! /^[a-f0-9-]{36}$/.test(d.cardId)))throw Error('牌编号格式错误');
}
export type Lifetime={created:number;activity:number;finished?:number};
export function expired(meta:Lifetime,phase:string,now=Date.now()){
 if(now-meta.created>=24*60*60*1000)return true;
 if(phase==='GAME_OVER')return now-(meta.finished??meta.activity)>=30*60*1000;
 return now-meta.activity>=(phase==='WAITING_FOR_PLAYERS'?30*60*1000:2*60*60*1000);
}
