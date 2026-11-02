import test from 'node:test';
import assert from 'node:assert/strict';
import {Bucket,validate,expired} from '../dist/security.js';
test('bucket bounds bursts and replenishes over time',()=>{
 const b=new Bucket(2,1,0);assert.ok(b.take(0));assert.ok(b.take(0));assert.equal(b.take(999),false);assert.ok(b.take(1000));assert.equal(b.take(1000),false);assert.ok(b.take(100000));assert.ok(b.take(100000));assert.equal(b.take(100000),false);
});
test('strict schema rejects impersonation and malformed input',()=>{
 const roomId='ABCD1234';
 for(const [event,data] of [['create_room',null],['create_room',[]],['update_nickname',{roomId,nickname:'x',playerId:'victim'}],['update_nickname',{roomId,nickname:'a\n'}],['update_nickname',{roomId,nickname:'x'.repeat(21)}],['play_card',{roomId,cardId:'a'.repeat(36)}],['reconnect_game',{roomId,token:'fake'}],['request_game_state',{roomId:{}}],['end_leader_turn',{roomId,revision:-1}]])assert.throws(()=>validate(event,data));
 validate('create_room',{});validate('update_nickname',{roomId,nickname:'红桃玩家'});validate('reconnect_game',{roomId,token:'a'.repeat(64)});validate('end_leader_turn',{roomId,revision:3});
});
test('waiting, active, finished and hard lifetime deadlines',()=>{
 const minute=60000,meta={created:0,activity:0};
 assert.equal(expired(meta,'WAITING_FOR_PLAYERS',29*minute),false);assert.ok(expired(meta,'WAITING_FOR_PLAYERS',30*minute));
 assert.equal(expired(meta,'LEADER_PLAYING',119*minute),false);assert.ok(expired(meta,'LEADER_PLAYING',120*minute));
 assert.ok(expired({created:0,activity:50*minute,finished:minute},'GAME_OVER',31*minute));
 assert.ok(expired({created:0,activity:24*60*minute},'LEADER_PLAYING',24*60*minute));
});
