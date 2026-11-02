import express from 'express';
import {createServer} from 'node:http';
import {randomBytes, randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {Server} from 'socket.io';
import {GameState,Player,canContinue,canDefend,immediateWinner,initialize,settleDecline,settleNormal,applyJokerPenalty} from './game.js';

import {Bucket,validate,expired,Lifetime} from './security.js';
const app=express();
app.disable('x-powered-by');
app.use((_,res,next)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 next();
});
const http=createServer(app);
const handshakes=new Bucket(100,10);
const creation=new Bucket(30,0.5);
const io=new Server(http,{
 maxHttpBufferSize:4096,
 connectTimeout:10000,
 allowRequest:(_,done)=>done(null,handshakes.take())
});
io.use((_,next)=>next(io.of('/').sockets.size>=200?new Error('在线人数已满，请稍后再试'):undefined));
const lifetime=new Map<string,Lifetime>();
function touch(g:GameState){
 const now=Date.now(),meta=lifetime.get(g.roomId)??{created:now,activity:now};
 meta.activity=now;
 if(g.phase==='GAME_OVER'&&meta.finished===undefined)meta.finished=now;
 lifetime.set(g.roomId,meta);
}
const rooms=new Map<string,GameState>();
const credentials=new Map<string,{roomId:string,playerId:string}>();
const active=new Map<string,string>();
const revisions=new Map<string,number>();
const notices=new Map<string,string>();
function publicState(g:GameState,viewer:string) {
 return {roomId:g.roomId,viewerId:viewer,revision:revisions.get(g.roomId)||0,
 players:Object.fromEntries(Object.values(g.players).map(p=>[p.id,{id:p.id,nickname:p.nickname,connected:p.connected,handCount:p.hand.length,...(p.id===viewer?{hand:p.hand}:{})}])),
 drawPileCount:g.drawPile.length,discardPileCount:g.discardPile.length,tableCards:g.tableCards,
 trumpSuit:g.trumpSuit,trumpIndicatorCard:g.trumpIndicatorCard,leaderId:g.leaderId,followerId:g.followerId,
 phase:g.phase,winnerId:g.winnerId,notice:notices.get(g.roomId)};
}
function emit(g:GameState){Object.values(g.players).forEach(p=>{const sid=active.get(p.id);if(sid)io.to(sid).emit('game_state_updated',publicState(g,p.id));});}
function changed(g:GameState,message:string){revisions.set(g.roomId,(revisions.get(g.roomId)||0)+1);notices.set(g.roomId,message);emit(g);}
function removeRoom(rid:string){
 const g=rooms.get(rid);if(!g)return;
 rooms.delete(rid);lifetime.delete(rid);revisions.delete(rid);notices.delete(rid);
 for(const [token,m] of credentials)if(m.roomId===rid)credentials.delete(token);
 for(const p of Object.values(g.players)){
 const sid=active.get(p.id);active.delete(p.id);
 if(sid){const s=io.sockets.sockets.get(sid);if(s){delete s.data.member;s.emit('room_expired','房间已过期，请重新创建或加入');}}
 }
}
function cleanup(){for(const [rid,meta] of lifetime){const g=rooms.get(rid);if(g&&expired(meta,g.phase))removeRoom(rid);}}
setInterval(cleanup,60000).unref();
io.on('connection',socket=>{
 const events=new Bucket(40,10),joins=new Bucket(12,0.2),renames=new Bucket(8,0.5);
 let violations=0;
 socket.use((packet,next)=>{
 if(events.take()){next();return;}
 violations++;
 // Do not reflect every rejected event back to the sender.
 if(violations===1)socket.emit('game_error','操作太频繁，请稍后再试');
 if(violations>=5)socket.disconnect(true);
 });
 const idle=setTimeout(()=>{if(!socket.data.member)socket.disconnect(true);},60000);
 idle.unref();
 socket.once('disconnect',()=>clearTimeout(idle));
 function attach(roomId:string,playerId:string){const old=active.get(playerId);active.set(playerId,socket.id);socket.data.member={roomId,playerId};if(old&&old!==socket.id)io.sockets.sockets.get(old)?.disconnect(true);rooms.get(roomId)!.players[playerId].connected=true;}
 function register(event:string,handler:(data:any)=>unknown){
 socket.on(event,(data:unknown,ack?:Function)=>{try{
 validate(event,data);
 if(['create_room','join_room','reconnect_game'].includes(event)&&!joins.take())throw Error('加入或恢复房间太频繁，请稍后再试');
 if(event==='update_nickname'&&!renames.take())throw Error('修改昵称太频繁，请稍后再试');
 const result=handler(data);if(typeof ack==='function')ack({ok:true,...(result||{})});
 }catch(error){const message=error instanceof Error?error.message:'操作失败';socket.emit('game_error',message);if(typeof ack==='function')ack({ok:false,error:message});}});
 }
 function nickname(data:any){if(typeof data.nickname!=='string'||!data.nickname.trim())throw new Error('请输入昵称');const name=data.nickname.trim();if(name.length>20)throw new Error('昵称最多20个字符');return name;}
 function member(data:any,action=false){const m=socket.data.member;const g=rooms.get(data.roomId);
 if(!m||m.roomId!==data.roomId||!g||active.get(m.playerId)!==socket.id)throw new Error('请先加入房间');
 if(action){if(g.phase==='GAME_OVER'||g.phase==='WAITING_FOR_PLAYERS')throw new Error('当前不能操作');if(Object.values(g.players).some(p=>!p.connected))throw new Error('对方断线，等待重连');if(data.revision!==revisions.get(g.roomId))throw new Error('牌局已更新，请重新操作');}
 if(expired(lifetime.get(g.roomId)!,g.phase)){removeRoom(g.roomId);throw Error('房间已过期');}
 return {g,p:g.players[m.playerId]};
 }
 register('create_room',data=>{
 if(socket.data.member)throw new Error('你已在房间中');
 cleanup();if(rooms.size>=500)throw Error('房间数量已满，请稍后再试');if(!creation.take())throw Error('创建房间太频繁，请稍后再试');
 const name=data.nickname===undefined?'player1':nickname(data);let rid:string;do{rid=randomBytes(4).toString('hex').toUpperCase();}while(rooms.has(rid));
 const pid=randomUUID(),token=randomBytes(32).toString('hex');
 const p:Player={id:pid,nickname:name,connected:true,hand:[]};
 const g:GameState={roomId:rid,players:{[pid]:p},drawPile:[],discardPile:[],tableCards:[],trumpSuit:'spade',trumpIndicatorCard:{id:'',type:'joker',name:'枪毙'},leaderId:'',followerId:'',phase:'WAITING_FOR_PLAYERS'};
 rooms.set(rid,g);touch(g);credentials.set(token,{roomId:rid,playerId:pid});attach(rid,pid);changed(g,'等待好友加入');
 return {roomId:rid,token};
 });
 register('join_room',data=>{
 if(socket.data.member)throw new Error('你已在房间中，请在第二个页面加入');
 const name=data.nickname===undefined?'player2':nickname(data),rid=String(data.roomId||'').trim().toUpperCase(),g=rooms.get(rid);
 if(!g)throw new Error('房间不存在，服务器重启后需重新创建');
 if(expired(lifetime.get(rid)!,g.phase)){removeRoom(rid);throw Error('房间已过期');}
 if(g.phase==='GAME_OVER')throw new Error('该局已结束');
 if(Object.keys(g.players).length>=2)throw new Error('房间已满');
 const pid=randomUUID(),token=randomBytes(32).toString('hex');
 g.players[pid]={id:pid,nickname:name,connected:true,hand:[]};
 credentials.set(token,{roomId:rid,playerId:pid});attach(rid,pid);
 const fresh=initialize(rid,g.players);rooms.set(rid,fresh);touch(fresh);changed(fresh,'双方已就位，开始出牌');
 return {roomId:rid,token};
 });
 register('reconnect_game',data=>{
 const m=credentials.get(data.token);if(!m||m.roomId!==data.roomId||!rooms.has(m.roomId))throw new Error('恢复失败，房间可能已失效，请重新创建或加入');
 if(expired(lifetime.get(m.roomId)!,rooms.get(m.roomId)!.phase)){removeRoom(m.roomId);throw Error('房间已过期');}
 if(socket.data.member&&socket.data.member.playerId!==m.playerId)throw new Error('当前已使用其他身份');
 attach(m.roomId,m.playerId);changed(rooms.get(m.roomId)!,'玩家已恢复连接');
 });
 register('request_game_state',data=>{const {g,p}=member(data);socket.emit('game_state_updated',publicState(g,p.id));});
 register('update_nickname',data=>{
 const {g,p}=member(data);
 p.nickname=nickname(data);
 // Profile edits do not change the game revision or invalidate an in-flight move.
 emit(g);
 });
 register('play_card',data=>{
 const {g,p}=member(data,true);const leader=p.id===g.leaderId;
 if((leader&&g.phase!=='LEADER_PLAYING')||(!leader&&g.phase!=='FOLLOWER_RESPONDING'))throw new Error('还没轮到你');
 const i=p.hand.findIndex(c=>c.id===data.cardId);if(i<0)throw new Error('这张牌不在你的手中');const card=p.hand[i];
 if(leader&&(card.type==='joker'||(g.tableCards.length>0&&!canContinue(card,g.tableCards))))throw new Error('先手只能出普通牌，续牌需匹配桌面点数');
 if(!leader){const attack=g.tableCards.at(-1)?.card;if(!attack||attack.type!=='normal'||(card.type==='normal'&&!canDefend(attack,card,g.trumpSuit)))throw new Error('这张牌不能压住对方');}
 p.hand.splice(i,1);g.tableCards.push({card,ownerId:p.id,playedOrder:g.tableCards.length+1,role:leader?'leader':'follower'});
 touch(g);
 if(immediateWinner(g)){touch(g);changed(g,p.nickname+'打空手牌，获胜！');return;}
 applyJokerPenalty(g,p.id);
 let message=p.nickname+'已出牌';
 if(leader){g.pendingAttackCardId=card.id;g.phase='FOLLOWER_RESPONDING';}
 else if(card.type==='joker'){settleNormal(g);message='枪毙！本回合结束，双方补牌';}
 else{g.pendingAttackCardId=undefined;g.phase='LEADER_PLAYING';}
 changed(g,message);
 });
 register('end_leader_turn',data=>{const {g,p}=member(data,true);if(p.id!==g.leaderId||g.phase!=='LEADER_PLAYING'||!g.tableCards.length||g.pendingAttackCardId)throw new Error('当前不能结束出牌');settleNormal(g);touch(g);changed(g,'本回合结束，双方补牌，交换先后手');});
 register('decline_to_defend',data=>{const {g,p}=member(data,true);if(p.id!==g.followerId||g.phase!=='FOLLOWER_RESPONDING')throw new Error('当前不能收牌');settleDecline(g);touch(g);changed(g,'后手收走桌面牌，双方补牌，原先手继续');});
 socket.on('disconnect',()=>{const m=socket.data.member;if(!m||active.get(m.playerId)!==socket.id)return;active.delete(m.playerId);const g=rooms.get(m.roomId);if(g){g.players[m.playerId].connected=false;changed(g,'玩家断线，暂停操作等待重连');}});
});
app.get('/health',(_,res)=>res.json({ok:true}));
app.use(express.static(resolve('client/dist')));
app.get('*',(_,res)=>res.sendFile(resolve('client/dist/index.html')));
const port=Number(process.env.PORT)||3001;
http.listen(port,()=>console.log('server listening on '+port));
