import {randomInt, randomUUID} from 'node:crypto';
export type Suit = 'spade' | 'heart' | 'club' | 'diamond';
export type NormalCard = { id: string; type: 'normal'; suit: Suit; rank: number };
export type JokerCard = { id: string; type: 'joker'; name: '枪毙' };
export type Card = NormalCard | JokerCard;
export type Phase = 'WAITING_FOR_PLAYERS'|'LEADER_PLAYING'|'FOLLOWER_RESPONDING'|'GAME_OVER';
export type TableCard = { card: Card; ownerId: string; playedOrder: number; role: 'leader'|'follower' };
export type Player = { id: string; nickname: string; connected: boolean; hand: Card[] };
export type GameState = { roomId:string; players:Record<string,Player>; drawPile:Card[]; discardPile:Card[]; tableCards:TableCard[]; trumpSuit:Suit; trumpIndicatorCard:Card; leaderId:string; followerId:string; phase:Phase; pendingAttackCardId?:string; winnerId?:string };

export const suitStrength: Record<Suit, number> = { spade:4, heart:3, club:2, diamond:1 };
const suits: Suit[] = ['spade','heart','club','diamond'];
const ranks = [3,4,5,6,7,8,9,10,11,12,13,14,15];
const id = () => randomUUID();

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of suits) for (const rank of ranks) cards.push({id:id(), type:'normal', suit, rank});
  cards.push({id:id(), type:'joker', name:'枪毙'}, {id:id(), type:'joker', name:'枪毙'});
  return cards;
}
export function shuffle<T>(items:T[]): T[] { for(let i=items.length-1;i>0;i--){const j=randomInt(i+1);[items[i],items[j]]=[items[j],items[i]];} return items; }
export function initialize(roomId:string, players:Record<string,Player>): GameState {
  const deck = shuffle(buildDeck());
  let indicatorIndex = deck.findIndex(c => c.type === 'normal');
  const indicator = deck.splice(indicatorIndex,1)[0];
  if (indicator.type !== 'normal') throw new Error('invalid indicator');
  deck.push(indicator);
  const ids = Object.keys(players);
  for (let i=0;i<8;i++) for (const pid of ids) players[pid].hand.push(deck.shift()!);
  const min = (p:Player) => p.hand.filter((c):c is NormalCard=>c.type==='normal').sort((a,b)=>a.rank-b.rank || suitStrength[b.suit]-suitStrength[a.suit])[0];
  const a=min(players[ids[0]]), b=min(players[ids[1]]);
  const leaderId = a.rank < b.rank || (a.rank === b.rank && suitStrength[a.suit] > suitStrength[b.suit]) ? ids[0] : ids[1];
  const followerId = leaderId === ids[0] ? ids[1] : ids[0];
  return {roomId, players, drawPile:deck, discardPile:[], tableCards:[], trumpSuit:indicator.suit, trumpIndicatorCard:indicator, leaderId, followerId, phase:'LEADER_PLAYING'};
}
export function canDefend(attack:NormalCard, defend:NormalCard, trump:Suit):boolean { const at=attack.suit===trump, dt=defend.suit===trump; if(at) return dt && defend.suit===attack.suit && defend.rank>attack.rank; if(dt) return true; return defend.suit===attack.suit && defend.rank>attack.rank; }
export function canContinue(card:Card, table:TableCard[]):boolean { return card.type==='normal' && new Set(table.filter(t=>t.card.type==='normal').map(t=>(t.card as NormalCard).rank)).has(card.rank); }
export function immediateWinner(game:GameState):string|undefined { const p=Object.values(game.players).find(x=>x.hand.length===0); if(p){game.winnerId=p.id;game.phase='GAME_OVER';return p.id;} return undefined; }
export function applyJokerPenalty(game:GameState, playerId:string) { const p=game.players[playerId]; const onlyJokers=p.hand.length>0 && p.hand.every(c=>c.type==='joker'); if(!onlyJokers)return; const amount=p.hand.length*3; for(let i=0;i<amount && game.discardPile.length;i++) p.hand.push(game.discardPile.pop()!); }

/** Repeat actual play order until both hands reach eight or the deck runs out.
 * A player who did not play this round still receives a place in the cycle.
 */
export function refillHands(game: GameState, ordered: TableCard[]) {
  const order = ordered.map(t => t.ownerId);
  for (const id of [game.leaderId, game.followerId]) {
    if (!order.includes(id)) order.push(id);
  }
  while (game.drawPile.length && Object.values(game.players).some(p => p.hand.length < 8)) {
    for (const id of order) {
      const player = game.players[id];
      if (player.hand.length < 8 && game.drawPile.length) {
        player.hand.push(game.drawPile.shift()!);
      }
    }
  }
}

export function settleNormal(game: GameState) {
  if (game.phase === 'GAME_OVER' || immediateWinner(game)) return;
  const ordered = [...game.tableCards].sort((a,b) => a.playedOrder-b.playedOrder);
  game.discardPile.push(...ordered.map(t => t.card));
  game.tableCards = [];
  game.pendingAttackCardId = undefined;
  refillHands(game, ordered);
  applyJokerPenalty(game, game.leaderId);
  applyJokerPenalty(game, game.followerId);
  [game.leaderId, game.followerId] = [game.followerId, game.leaderId];
  game.phase = 'LEADER_PLAYING';
}

export function settleDecline(game: GameState) {
  if (game.phase === 'GAME_OVER' || immediateWinner(game)) return;
  const ordered = [...game.tableCards].sort((a,b) => a.playedOrder-b.playedOrder);
  game.players[game.followerId].hand.push(...ordered.map(t => t.card));
  game.tableCards = [];
  game.pendingAttackCardId = undefined;
  refillHands(game, ordered);
  applyJokerPenalty(game, game.leaderId);
  applyJokerPenalty(game, game.followerId);
  game.phase = 'LEADER_PLAYING';
}
