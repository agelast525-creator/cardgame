import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
const server=spawn(process.execPath,['server/dist/index.js'],{env:{...process.env,PORT:'3109'}});
const clients=[];
const views=new Map();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await wait(20);}throw Error('timeout');}
async function connect(){const s=io('http://localhost:3109',{autoConnect:false});clients.push(s);s.on('game_state_updated',g=>views.set(s,g));s.connect();await until(()=>s.connected);return s;}
const request=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(err,r)=>err?reject(err):resolve(r)));
try{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',()=>reject(Error('server failed')));});
 const a=await connect(),b=await connect(),outsider=await connect();
 const created=await request(a,'create_room',{});assert.ok(created.ok);
 const rid=created.roomId;
 assert.equal((await request(a,'create_room',{})).ok,false);
 assert.equal((await request(a,'join_room',{roomId:rid,nickname:'A'})).ok,false);
 assert.equal((await request(b,'join_room',{roomId:rid})).ok,true);
 await until(()=>views.get(a)?.phase==='LEADER_PLAYING');
 let g=views.get(a);const aId=g.viewerId;
 assert.equal(g.players[aId].nickname,'player1');
 assert.equal(Object.values(g.players).find(p=>p.id!==aId).nickname,'player2');
 const rev=g.revision;
 assert.equal((await request(a,'update_nickname',{roomId:rid,nickname:'  红桃玩家  '})).ok,true);
 await until(()=>views.get(b).players[aId].nickname==='红桃玩家');
 assert.equal(views.get(b).revision,rev);
 assert.equal(Object.values(views.get(b).players).find(p=>p.id!==aId).nickname,'player2');
 for(const nickname of ['', '   ', 'x'.repeat(21), null]){
 assert.equal((await request(a,'update_nickname',{roomId:rid,nickname})).ok,false);
 }
 assert.equal((await request(outsider,'update_nickname',{roomId:rid,nickname:'伪造'})).ok,false);
 assert.equal((await request(a,'update_nickname',{roomId:'other-room',nickname:'伪造'})).ok,false);
 assert.equal(g.players[aId].hand.length,8);assert.equal(g.drawPileCount,38);
 assert.equal(g.drawPile,undefined);assert.equal(g.discardPile,undefined);
 assert.equal(Object.values(g.players).find(p=>p.id!==aId).hand,undefined);
 assert.equal((await request(outsider,'end_leader_turn',{roomId:rid,revision:g.revision})).ok,false);
 const follower=g.leaderId===aId?b:a;
 assert.equal((await request(follower,'end_leader_turn',{roomId:rid,revision:g.revision})).ok,false);
 assert.equal((await request(outsider,'reconnect_game',{roomId:rid,token:'fake'})).ok,false);
 a.disconnect();await until(()=>Object.values(views.get(b).players).some(p=>!p.connected));
 g=views.get(b);
 assert.equal((await request(b,'play_card',{roomId:rid,revision:g.revision,cardId:'fake'})).ok,false);
 const resumed=await connect();
 assert.equal((await request(resumed,'reconnect_game',{roomId:rid,token:created.token})).ok,true);
 await until(()=>views.get(resumed)?.viewerId===aId);
 assert.equal(views.get(resumed).players[aId].hand.length,8);
 assert.equal(views.get(resumed).players[aId].nickname,'红桃玩家');
 const playing=[resumed,b];
 for(let n=0;n<500;n++){
 g=views.get(resumed);if(g.phase==='GAME_OVER')break;
 const actor=playing.find(s=>views.get(s).viewerId===(g.phase==='FOLLOWER_RESPONDING'?g.followerId:g.leaderId));
 const v=views.get(actor),hand=v.players[v.viewerId].hand;
 const attack=g.tableCards.at(-1)?.card;
 const legal=hand.filter(c=>{
 if(g.phase==='LEADER_PLAYING')return c.type==='normal'&&(!g.tableCards.length||g.tableCards.some(t=>t.card.type==='normal'&&t.card.rank===c.rank));
 return c.type==='joker'||(c.suit===attack.suit&&c.rank>attack.rank)||(c.suit===g.trumpSuit&&attack.suit!==g.trumpSuit);
 });
 const event=legal.length?'play_card':g.phase==='FOLLOWER_RESPONDING'?'decline_to_defend':'end_leader_turn';
 await wait(120);
 const payload={roomId:rid,revision:g.revision,...(legal.length?{cardId:legal[0].id}:{})};
 const result=await request(actor,event,payload);
 assert.ok(result.ok,JSON.stringify(result));
 await until(()=>views.get(resumed).revision>g.revision);
 const next=views.get(resumed);
 assert.equal(next.drawPileCount+next.discardPileCount+next.tableCards.length+Object.values(next.players).reduce((sum,p)=>sum+p.handCount,0),54);
 if(n===0)assert.equal((await request(actor,event,payload)).ok,false);
 }
 assert.equal(views.get(resumed).phase,'GAME_OVER');
 console.log('PASS: default names, rename synchronization, invalid names, ownership, rename survives reconnect, identity, private state, unauthorized actions, replay rejection, disconnect pause, token reconnect, full game, 54-card conservation');
}finally{clients.forEach(s=>s.disconnect());server.kill();}
