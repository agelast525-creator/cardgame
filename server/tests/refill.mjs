import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settleNormal,settleDecline} from '../dist/game.js';
let serial=0;
const cards=n=>Array.from({length:n},()=>({id:String(++serial),type:'normal',suit:'spade',rank:7}));
function game(a,b,deck=30,owners=['a','b','a']){
 return {players:{a:{id:'a',hand:cards(a)},b:{id:'b',hand:cards(b)}},leaderId:'a',followerId:'b',phase:'FOLLOWER_RESPONDING',drawPile:cards(deck),discardPile:[],tableCards:owners.map((ownerId,i)=>({card:cards(1)[0],ownerId,playedOrder:i+1})),pendingAttackCardId:'attack'};
}
test('吃牌后双方都补齐，原先手继续，桌面不进废牌堆',()=>{
 const g=game(3,2); const table=g.tableCards.map(t=>t.card.id);
 settleDecline(g);
 assert.equal(g.players.a.hand.length,8);assert.equal(g.players.b.hand.length,8);
 assert.ok(table.every(id=>g.players.b.hand.some(c=>c.id===id)));
 assert.equal(g.drawPile.length,22);assert.equal(g.discardPile.length,0);
 assert.equal(g.leaderId,'a');assert.equal(g.tableCards.length,0);
});
test('首张即不压，没出过牌的后手也补齐',()=>{
 const g=game(7,2,30,['a']);settleDecline(g);
 assert.equal(g.players.a.hand.length,8);assert.equal(g.players.b.hand.length,8);
});
test('吃牌超过8张保留，另一方补齐',()=>{
 const g=game(5,8);settleDecline(g);
 assert.equal(g.players.a.hand.length,8);assert.equal(g.players.b.hand.length,11);
 assert.equal(g.drawPile.length,27);
});
test('正常结算补齐以前缺少的牌，并交换先后手',()=>{
 const g=game(2,3,30,['a','b']);settleNormal(g);
 assert.equal(g.players.a.hand.length,8);assert.equal(g.players.b.hand.length,8);
 assert.equal(g.drawPile.length,19);assert.equal(g.discardPile.length,2);assert.equal(g.leaderId,'b');
});
test('牌堆不足时按实际出牌顺序分配',()=>{
 const g=game(2,2,3);const ids=g.drawPile.map(c=>c.id);settleNormal(g);
 assert.deepEqual(g.players.a.hand.slice(2).map(c=>c.id),[ids[0],ids[2]]);
 assert.deepEqual(g.players.b.hand.slice(2).map(c=>c.id),[ids[1]]);
 assert.equal(g.drawPile.length,0);
});
test('空牌堆仍能结算',()=>{
 for(const settle of [settleNormal,settleDecline]){const g=game(2,2,0);settle(g);assert.equal(g.drawPile.length,0);assert.equal(g.phase,'LEADER_PLAYING');}
});
test('打空立即获胜，不再收牌或补牌',()=>{
 for(const settle of [settleNormal,settleDecline]){const g=game(0,2);settle(g);assert.equal(g.winnerId,'a');assert.equal(g.phase,'GAME_OVER');assert.equal(g.drawPile.length,30);assert.equal(g.tableCards.length,3);}
});
