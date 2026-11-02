import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
const server=spawn(process.execPath,['server/dist/index.js'],{env:{...process.env,PORT:'3110'}});
const clients=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await wait(20);}throw Error('timeout');}
async function connect(){const s=io('http://localhost:3110',{transports:['websocket'],reconnection:false});clients.push(s);await until(()=>s.connected);return s;}
const request=(s,event,data)=>s.timeout(2000).emitWithAck(event,data);
try{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',()=>reject(Error('server failed')));});
 const normal=await connect(),flood=await connect(),large=await connect();
 for(let i=0;i<60;i++)flood.emit('request_game_state',{roomId:'ABCDEF12'});
 await until(()=>!flood.connected);
 large.emit('create_room',{nickname:'a'.repeat(5000)});await until(()=>!large.connected);
 const made=await request(normal,'create_room',{});assert.ok(made.ok);
 assert.equal((await request(normal,'update_nickname',{roomId:made.roomId,nickname:'x',playerId:'forged'})).ok,false);
 let limited=false;for(let i=0;i<10;i++){const r=await request(normal,'update_nickname',{roomId:made.roomId,nickname:'测试'});if(!r.ok&&r.error.includes('太频繁'))limited=true;}assert.ok(limited);
 assert.ok((await request(normal,'request_game_state',{roomId:made.roomId})).ok);
 const res=await fetch('http://localhost:3110/health');assert.equal(res.status,200);assert.equal(res.headers.get('x-frame-options'),'DENY');assert.ok(res.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
 console.log('PASS: flood disconnect, oversized message disconnect, unaffected normal client, forged fields rejected, nickname rate limit, security headers');
}finally{clients.forEach(s=>s.disconnect());server.kill();}
