import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {io} from 'socket.io-client';
import type {Card,Suit,TableCard,Phase} from '../../server/src/game';
import './style.css';
type PublicPlayer={id:string;nickname:string;connected:boolean;handCount:number;hand?:Card[]};
type View={roomId:string;viewerId:string;revision:number;players:Record<string,PublicPlayer>;drawPileCount:number;discardPileCount:number;tableCards:TableCard[];trumpSuit:Suit;trumpIndicatorCard:Card;leaderId:string;followerId:string;phase:Phase;winnerId?:string;notice?:string};
const socket=io({autoConnect:false});
const suits={spade:'♠ 黑桃',heart:'♥ 红桃',club:'♣ 梅花',diamond:'♦ 方片'};
const rank=(n:number)=>({11:'J',12:'Q',13:'K',14:'A',15:'2'}[n]||String(n));
const label=(c:Card)=>c.type==='joker'?'枪毙':suits[c.suit][0]+' '+rank(c.rank);
const initialRoom=new URLSearchParams(location.search).get('room')||'';
const guest=new URLSearchParams(location.search).has('guest');
const storageKey=(rid:string)=>'card-game:'+rid;
function App(){
 const [name,setName]=useState('玩家'),[room,setRoom]=useState(initialRoom),[state,setState]=useState<View>(),[selected,setSelected]=useState(''),[message,setMessage]=useState(''),[connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 useEffect(()=>{
 const update=(g:View)=>{setState(g);setRoom(g.roomId);setSelected('');setConfirm(false);};
 const connect=()=>{
 setConnected(true);
 const rid=new URLSearchParams(location.search).get('room')||initialRoom;
 const token=(guest?sessionStorage:localStorage).getItem(storageKey(rid));
 if(rid&&token)socket.emit('reconnect_game',{roomId:rid,token},(r:{ok:boolean})=>{if(!r.ok){setState(undefined);(guest?sessionStorage:localStorage).removeItem(storageKey(rid));}});
 };
 const disconnect=()=>{setConnected(false);setBusy(false);};
 const error=(s:string)=>setMessage(s);
 socket.on('connect',connect).on('disconnect',disconnect).on('connect_error',()=>setMessage('连接失败，正在重试，请确认终端中的服务仍在运行')).on('game_state_updated',update).on('game_error',error);
 socket.connect();
 return()=>{socket.removeAllListeners();socket.disconnect();};
 },[]);
 function send(event:string,payload:object={},identity=false){
 if(busy||!connected)return;setBusy(true);setMessage('');
 socket.timeout(6000).emit(event,{roomId:room,revision:state?.revision,...payload},(err:Error|null,result:{ok:boolean;error?:string;roomId?:string;token?:string})=>{
 setBusy(false);if(err){setMessage('响应超时，请重新连接后确认牌局');socket.disconnect().connect();return;}
 if(!result.ok){setMessage(result.error||'操作失败');return;}
 if(identity&&result.roomId&&result.token){(guest?sessionStorage:localStorage).setItem(storageKey(result.roomId),result.token);setRoom(result.roomId);history.replaceState(null,'','?room='+result.roomId+(guest?'&guest=1':''));}
 });
 }
 const me=state?.players[state.viewerId],opponent=state&&Object.values(state.players).find(p=>p.id!==state.viewerId);
 const leader=state?.leaderId===state?.viewerId;
 const paused=!connected||!!opponent&&!opponent.connected;
 const myTurn=!!state&&!paused&&state.phase!=='GAME_OVER'&&(leader?state.phase==='LEADER_PLAYING':state.phase==='FOLLOWER_RESPONDING');
 const ranks=state?Array.from(new Set(state.tableCards.flatMap(t=>t.card.type==='normal'?[t.card.rank]:[]))):[];
 function legal(c:Card){if(!myTurn||!state)return false;if(leader)return c.type==='normal'&&(!state.tableCards.length||ranks.includes(c.rank));if(c.type==='joker')return true;const a=state.tableCards.at(-1)?.card;return !!a&&a.type==='normal'&&((c.suit===a.suit&&c.rank>a.rank)||(c.suit===state.trumpSuit&&a.suit!==state.trumpSuit));}
 const invite=location.origin+'/?room='+room;
 const status=state?.phase==='GAME_OVER'?(state.winnerId===state.viewerId?'你赢了！':'本局结束 · '+state.players[state.winnerId!]?.nickname+'获胜'):paused?'连接中断 · 等待重连':myTurn?(leader?(state?.tableCards.length?'继续出牌或结束本回合':'请选择一张普通牌先手出牌'):'请选择一张牌压制，或不压收牌'):'等待对方操作';
 function card(c:Card){return <><span>{label(c)}</span><small>{c.type==='joker'?'终结回合':c.suit===state?.trumpSuit?'王牌':'普通牌'}</small></>;}
 return <main><header><div><small>双人在线对战</small><h1>枪毙 · 纸牌</h1></div><span>{connected?'● 已连接':'○ 连接中'}</span></header>
 {!state?<section className="lobby"><h2>与好友开一局</h2><label>你的昵称<input value={name} maxLength={20} onChange={e=>setName(e.target.value)}/></label><label>房间号<input value={room} onChange={e=>setRoom(e.target.value.trim().toUpperCase())} placeholder="输入好友的房间号"/></label><button disabled={busy||!connected||!name.trim()} onClick={()=>send('create_room',{nickname:name},true)}>创建房间</button><button disabled={busy||!connected||!name.trim()||!room} onClick={()=>send('join_room',{nickname:name},true)}>加入房间</button></section>
 :state.phase==='WAITING_FOR_PLAYERS'?<section className="lobby"><h2>等待好友加入</h2><p>房间号 <strong>{room}</strong> · 1 / 2 人</p><input aria-label="邀请链接" value={invite} readOnly/><button onClick={async()=>{try{await navigator.clipboard.writeText(invite);setMessage('链接已复制')}catch{setMessage('请选中链接手动复制')}}}>复制邀请链接</button><a href={invite+'&guest=1'} target="_blank" rel="noopener noreferrer">打开第二个玩家页面（本机测试）</a><p>本机测试页使用独立身份。好友通过你的局域网地址进入；localhost 链接仅限本机。</p></section>
 :<><section className="opponent"><b>◉ {opponent?.nickname}</b><span>{opponent?.connected?'在线':'断线'} · 手牌 {opponent?.handCount} 张</span></section><section className="info"><b>王牌 {suits[state.trumpSuit]}</b><span>底牌 {label(state.trumpIndicatorCard)}</span><span>摸牌 {state.drawPileCount}</span><span>废牌 {state.discardPileCount}</span></section>
 <section className="table"><h2 aria-live="polite">{status}</h2><p className="notice">{state.notice}</p>{state.tableCards.length===0?<p className="empty">桌面等待出牌</p>:<div className="pairs">{state.tableCards.filter((_,i)=>i%2===0).map((t,i)=><div className="pair" key={t.playedOrder}><div><small>先手</small><div className="card">{card(t.card)}</div></div><span>→</span><div><small>后手</small><div className="card">{state.tableCards[i*2+1]?card(state.tableCards[i*2+1].card):'待压制'}</div></div></div>)}</div>}</section>
 {leader&&myTurn&&ranks.length>0&&<p>可续出点数：{ranks.map(rank).join('、')}</p>}
 {leader&&myTurn&&state.tableCards.length===0&&me?.hand?.every(c=>c.type==='joker')&&<p role="alert">当前只剩枪毙且无法补到普通牌：此特殊情况的处理规则尚待确认，本局无法继续。</p>}<div className="hand-title"><b>{me?.nickname} · 我的手牌 {me?.handCount}</b><span>{leader?'先手':'后手'}</span></div>
 <section className="hand">{me?.hand?.map(c=><button aria-pressed={selected===c.id} disabled={!legal(c)||busy} className={'card '+(selected===c.id?'selected ':'')+(c.type==='normal'&&['heart','diamond'].includes(c.suit)?'red':'')} key={c.id} onClick={()=>setSelected(selected===c.id?'':c.id)}>{card(c)}</button>)}</section>
 <section className="actions"><button disabled={!selected||!myTurn||busy} onClick={()=>send('play_card',{cardId:selected})}>{busy?'提交中…':'确认出牌'}</button>{leader&&myTurn&&state.tableCards.length>0&&<button disabled={busy} onClick={()=>send('end_leader_turn')}>结束出牌</button>}{!leader&&myTurn&&<button disabled={busy} onClick={()=>setConfirm(true)}>不压 · 收牌</button>}</section>
 {state.phase==='GAME_OVER'&&<p><a href="/">返回首页，创建新一局</a></p>}
 {confirm&&<div className="overlay"><section role="dialog" aria-modal="true" aria-label="确认收牌"><h2>确定不压吗？</h2><p>本回合桌面的 {state.tableCards.length} 张牌都归你。随后双方不足 8 张补齐，对方继续先手。</p><button onClick={()=>setConfirm(false)}>取消</button><button disabled={busy} onClick={()=>{setConfirm(false);send('decline_to_defend');}}>确认收牌</button></section></div>}</>}
 {message&&<p role="status" className="error">{message}</p>}<details><summary>游戏规则</summary><p>普通牌按 3 到 2 排序。同花色大牌压小牌，王牌压非王牌。先手续出需匹配桌面出现的点数；后手出枪毙立刻结束回合。不压则收走全部桌面牌。每回合结束双方补到 8 张，牌堆不足则摸完。打空手牌立即获胜。只剩枪毙，每张从废牌堆摸 3 张，不足则摸完。</p></details></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
