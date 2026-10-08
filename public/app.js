let ws, roomCode, myId, state, hintTimer;
const $ = id => document.getElementById(id);
const show = id => { for (const s of ["home","lobby","game","ending"]) $(s).hidden = s !== id; };
function connect() {
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === "joined") { roomCode=m.code; myId=m.id; show("lobby"); render(); }
    if (m.type === "state") { state=m.state; render(); }
    if (m.type === "error") $("error").textContent=m.message;
    if (m.type === "wrong") { $("feedback").textContent="That doesn't unlock the mechanism."; $("feedback").className="wrong"; }
    if (m.type === "hint") { $("hintBox").hidden=false; $("hintBox").textContent=m.text; }
  };
}
function send(type, extra={}) { if(ws?.readyState===1) ws.send(JSON.stringify({type,...extra})); }
$("create").onclick=()=>{ connect(); setTimeout(()=>send("create",{name:$("name").value||"Player 1"}),150); };
$("showJoin").onclick=()=> $("joinBox").hidden=false;
$("join").onclick=()=>{ connect(); setTimeout(()=>send("join",{code:$("code").value,name:$("name").value||"Player"}),150); };
$("ready").onclick=()=>send("ready");
$("start").onclick=()=>send("start");
$("copy").onclick=async()=>{await navigator.clipboard?.writeText(location.href+"?room="+roomCode);$("copy").textContent="INVITE COPIED";};
$("submit").onclick=()=>{send("solve",{answer:$("answer").value});$("answer").value=""};
$("answer").onkeydown=e=>{if(e.key==="Enter")$("submit").click()};
$("hint").onclick=()=>send("hint");

function render(){
  if(!state)return;
  if(state.phase==="lobby"){ show("lobby"); $("roomLabel").textContent="ROOM "+state.code; $("bigCode").textContent=state.code;
    $("players").innerHTML=state.players.map(p=>`<div class="player"><b>${esc(p.name)}</b><div class="ready">${p.ready?"✓ READY":"WAITING"}</div></div>`).join("");
    $("ready").textContent=state.players.find(p=>p.id===myId)?.ready?"NOT READY":"I'M READY";
    $("start").hidden=!(state.players.length>=2 && state.players.every(p=>p.ready));
  } else if(state.phase==="playing"){ show("game"); $("gameRoom").textContent=state.code; $("count").textContent=state.players.length;
    $("crew").innerHTML=state.players.map(p=>`<div class="player"><b>${esc(p.name)}</b><div class="ready">${p.ready?"READY":"IN GAME"}</div></div>`).join("");
    $("puzzleTitle").textContent=state.puzzle.title; $("puzzleText").textContent=state.puzzle.text;
    $("progress").textContent=`${state.puzzleIndex+1}/4`; $("hintBox").hidden=true; $("feedback").textContent="";
    updateTimer(state.remaining);
  } else if(state.phase==="ended"){ show("ending"); const map={perfect:["PERFECT ESCAPE","You solved the island's secrets with time to spare. The rescue boat carries your crew—and the hidden treasure—home."],narrow:["NARROW ESCAPE","The rescue boat arrived just in time. Your crew made it off the island, but the island kept some of its secrets."],stranded:["STRANDED","The storm closed in before the escape was complete. The island remains your prison—for now."]}; const x=map[state.ending]||map.stranded;$("endingTitle").textContent=x[0];$("endingText").textContent=x[1];}
}
function updateTimer(sec){ const m=Math.floor(sec/60),s=sec%60;$("timer").textContent=`${m}:${String(s).padStart(2,"0")}`; }
function esc(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
const q=new URLSearchParams(location.search).get("room"); if(q){$("joinBox").hidden=false;$("code").value=q.toUpperCase();}
