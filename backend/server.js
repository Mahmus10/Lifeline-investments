const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
let db;
const ADMIN_KEY="LIFELINE123";

const TEAMS_16 = [
 {name:'Man Utd',short:'MUN'}, {name:'Aston Villa',short:'AVL'},
 {name:'Crystal Palace',short:'CRY'}, {name:'Everton',short:'EVE'},
 {name:'Tottenham',short:'TOT'}, {name:'West Ham',short:'WHU'},
 {name:'Liverpool',short:'LIV'}, {name:'Wolves',short:'WOL'},
 {name:'Arsenal',short:'ARS'}, {name:'Chelsea',short:'CHE'},
 {name:'Brentford',short:'BRE'}, {name:'Brighton',short:'BHA'},
 {name:'Man City',short:'MCI'}, {name:'Fulham',short:'FUL'},
 {name:'Newcastle',short:'NEW'}, {name:'Nottm Forest',short:'NFO'},
];

let season=1, matchday=0; // RESET TO 0 - will count fresh from 1
function genMatchday(){
  let shuffled=[...TEAMS_16].sort(()=>Math.random()-0.5);
  let fixtures=[];
  for(let i=0;i<8;i++){
    let home=shuffled[i*2]; let away=shuffled[i*2+1];
    fixtures.push({id:Date.now()+i*1000+Math.floor(Math.random()*9000), home, away, homeScore:0, awayScore:0, odds:{home:'2.00',draw:'2.00',away:'2.00'}, targetResult:null, result:null});
  }
  return fixtures;
}
let nextFixtures=genMatchday();
let liveFixtures=null;
let virtualPhase='betting';
let virtualTimeLeft=118;

function randomResult(){ return Math.random()<0.38?'home': Math.random()<0.65?'draw':'away'; }

async function decideAllResults(fixtures){
  try{
    let totals={}; fixtures.forEach(f=> totals[f.id]={home:0,draw:0,away:0});
    if(db){
      try{ const [rows]=await db.query("SELECT matchId, prediction, SUM(amount) as total FROM virtual_bets WHERE status='pending' GROUP BY matchId, prediction"); for(let b of rows){ if(totals[b.matchId]) totals[b.matchId][b.prediction]+=parseInt(b.total)||0; } }catch(e){}
      try{ const [accaRows]=await db.query("SELECT amount, selections FROM virtual_accas WHERE status='pending' AND season=? AND matchday=?",[season, matchday]); for(let r of accaRows){ try{ let sels=JSON.parse(r.selections); for(let s of sels){ if(totals[s.matchId]) totals[s.matchId][s.prediction]+=parseInt(r.amount)||0; } }catch(e){} } }catch(e){}
    }
    let res=[];
    for(let f of fixtures){
      let t=totals[f.id]||{home:0,draw:0,away:0};
      if(Math.random()<0.75){ let min=Math.min(t.home||0,t.draw||0,t.away||0); let cands=Object.keys(t).filter(k=>t[k]===min); res.push(cands[0]||'draw'); }
      else { let max=Math.max(t.home,t.draw,t.away); res.push(Object.keys(t).find(k=>t[k]===max)||randomResult()); }
    }
    return res;
  }catch(e){ return fixtures.map(()=>randomResult()); }
}

async function settleMatchday(fixtures){
  for(let m of fixtures){ let r=m.targetResult||m.result; if(r==='draw'){m.homeScore=1;m.awayScore=1;} else if(r==='home'){m.homeScore=2;m.awayScore=1;} else {m.homeScore=1;m.awayScore=2;} m.result=r; }
  try{
    if(db){
      const [accas]=await db.query("SELECT * FROM virtual_accas WHERE season=? AND matchday=? AND status='pending'",[season, matchday]);
      for(let acca of accas){ let sels=JSON.parse(acca.selections); let win=true; for(let s of sels){ let found=fixtures.find(f=> f.id===s.matchId); if(!found || found.result!==s.prediction){ win=false; break; } } if(win){ let w=Math.floor(acca.amount*acca.odd); await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[w, acca.userId]); await db.query("UPDATE virtual_accas SET status='won', winAmount=? WHERE id=?",[w, acca.id]); } else await db.query("UPDATE virtual_accas SET status='lost', winAmount=0 WHERE id=?",[acca.id]); }
    }
  }catch(e){}
  matchday++; if(matchday>30){matchday=1; season++;}
  nextFixtures=genMatchday();
}

setInterval(async()=>{
  virtualTimeLeft--;
  if(virtualPhase==='betting' && virtualTimeLeft<=0){
    let targets=await decideAllResults(nextFixtures);
    liveFixtures=nextFixtures.map((f,i)=>({...f, targetResult:targets[i]}));
    nextFixtures=[]; virtualPhase='live'; virtualTimeLeft=120;
  } else if(virtualPhase==='live' && virtualTimeLeft<=0){
    await settleMatchday(liveFixtures); virtualPhase='betting'; virtualTimeLeft=118; liveFixtures=null;
  }
},1000);

async function init(){
 try{
  const u=process.env.DATABASE_URL||process.env.MYSQL_URL;
  if(!u) throw new Error("no db");
  db=mysql.createPool(u+"?connectionLimit=10&keepAlive=true");
  await db.query("CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(100), phone VARCHAR(30), password VARCHAR(100), myReferralCode VARCHAR(20), referredBy VARCHAR(20), balance INT DEFAULT 0, gameBalance INT DEFAULT 0, miningBalance INT DEFAULT 0)");
  await db.query("CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, phone VARCHAR(30), amount INT, airtelNo VARCHAR(30), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, club VARCHAR(50), amount INT, rate INT, lockDays INT, startDate DATETIME DEFAULT CURRENT_TIMESTAMP, status VARCHAR(20) DEFAULT 'active')");
  await db.query("CREATE TABLE IF NOT EXISTS spins (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount INT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS mining (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, earned INT DEFAULT 0, lastClaim DATETIME DEFAULT CURRENT_TIMESTAMP, isMining TINYINT DEFAULT 0)");
  await db.query("CREATE TABLE IF NOT EXISTS virtual_bets (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, matchId BIGINT, homeTeam VARCHAR(30), awayTeam VARCHAR(30), prediction VARCHAR(10), amount INT, status VARCHAR(20) DEFAULT 'pending', winAmount INT DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS virtual_accas (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, season INT, matchday INT, selections TEXT, amount INT, odd FLOAT, status VARCHAR(20) DEFAULT 'pending', winAmount INT DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  console.log("READY MD0 FRESH");
 }catch(e){ console.log("memory mode"); }
}
init();

const PWA_HEAD = `<link rel="manifest" href="/manifest.json">`;
const FIELD_BG_CSS = `body{background:#080a0f;color:#fff;font-family:Arial;padding:12px;padding-bottom:90px}body::before{content:'';position:fixed;inset:-20px;z-index:-3;background-image:linear-gradient(rgba(0,0,0,0.55),rgba(0,0,0,0.75)),url('https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200&q=80');background-size:cover;background-position:center}.glass{background:rgba(18,22,35,0.85);backdrop-filter:blur(16px);border:1px solid rgba(255,215,0,0.15)}.field-logo-top{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(0,0,0,0.7);border:1px solid gold;padding:6px 18px;border-radius:30px;color:gold;font-size:11px;font-weight:bold}`;

const pages = {
home: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:12px;border:none}button{background:gold;font-weight:bold}.card{padding:20px;border-radius:20px}</style></head><body><div class="field-logo-top">MD 0 FRESH • 16 TEAMS • x2.00</div><div class="card glass" style="margin-top:60px"><h2>Lifeline - Fresh Start</h2><input id="n" placeholder="Full Name"><input id="p" placeholder="Phone"><input id="pw" type="password" placeholder="Password"><button onclick="reg()">Register</button><button onclick="log()" style="background:#222;color:#fff">Login</button></div><script>async function reg(){let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert(j.error)}async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert("Wrong")}</script></body></html>`,

dash: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.bal{padding:22px;border-radius:24px;text-align:center}.walletGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.walletCard{padding:14px;border-radius:16px;text-align:left}button{width:100%;padding:14px;margin:7px 0;border-radius:12px;border:none;font-weight:bold}.gold{background:gold;color:#000}.dark{background:rgba(20,25,35,0.9);color:#fff;border:1px solid rgba(255,255,255,0.1)}#wheelModal{position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:300;display:none;align-items:center;justify-content:center;padding:20px;flex-direction:column}#wheelCanvas{border-radius:50%;box-shadow:0 0 40px gold;border:6px solid gold;max-width:90vw}.virtCard{background:linear-gradient(135deg,#1a0033,#000033);border:2px solid #ff00cc;padding:16px;border-radius:18px;margin:12px 0}</style></head><body>
<div class="field-logo-top" id="topInfo">MD 0 FRESH • x2.00 • STADIUM</div>
<div id="wheelModal"><canvas id="wheelCanvas" width="340" height="340"></canvas><button onclick="doSpin()" class="gold" style="max-width:340px;margin-top:15px">SPIN NOW</button><button onclick="closeWheel()" style="background:#333;color:#fff;max-width:340px">Close</button></div>
<div class="bal glass" style="margin-top:60px">
<div class="walletGrid"><div class="walletCard glass"><h4>GAME</h4><h2 id="gb">0</h2></div><div class="walletCard glass"><h4>INVEST</h4><h2 id="b">0</h2></div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="glass" style="padding:10px;border-radius:12px;text-align:center"><small>INTEREST</small><br><span id="int" style="color:#00ff88;font-weight:bold">0</span></div><div class="glass" style="padding:10px;border-radius:12px;text-align:center"><small>MINING</small><br><span id="mineBal" style="color:#ff00cc;font-weight:bold">0</span></div></div>
<p id="ph" style="color:gold"></p>
</div>
<div class="virtCard" onclick="location.href='/virtual'"><div style="display:flex;justify-content:space-between"><b style="color:#ff00cc">🔥 VIRTUAL x2.00 - MD 0 FRESH</b><span id="virtPhase" style="background:#00ff88;color:#000;padding:4px 10px;border-radius:20px;font-size:10px">BETTING</span></div><div id="virtPreview" style="margin-top:10px">8 Matches x2.00</div><div style="text-align:center;margin-top:8px">⏱️ <span id="virtTimer">--:--</span> • Tap →</div></div>
<button class="gold" onclick="openWheel()">🎡 SPIN WHEEL</button>
<button class="dark" onclick="startMining()" id="mineBtn">⛏️ Start Mining</button>
<button class="gold" onclick="location.href='/virtual'">⚽ PLAY VIRTUAL - x2.00</button>
<button class="dark" onclick="location.href='/deposit'">💰 Deposit</button>
<button class="dark" onclick="location.href='/invest'">📈 Invest</button>
<button class="dark" onclick="location.href='/history'">📜 History</button>
<button class="dark" onclick="location.href='/referral'">👥 My Team</button>
<script>
let uid=localStorage.getItem("uid");if(!uid)location.href="/";
function openWheel(){ document.getElementById('wheelModal').style.display='flex'; let c=document.getElementById('wheelCanvas'); let ctx=c.getContext('2d'); let prizes=[0,100,200,300,500,1000,2000,100]; let angle=0; for(let i=0;i<prizes.length;i++){ ctx.beginPath(); ctx.moveTo(170,170); ctx.fillStyle=['#222','#ffcc00','#00ff88','#ff00cc','#00ccff','#ff6600','#ffd700','#444'][i]; ctx.arc(170,170,160, angle, angle+Math.PI*2/prizes.length); ctx.lineTo(170,170); ctx.fill(); ctx.save(); ctx.translate(170,170); ctx.rotate(angle+Math.PI/prizes.length); ctx.fillStyle='#fff'; ctx.font='bold 14px Arial'; ctx.fillText(prizes[i]+' UGX', 60, 5); ctx.restore(); angle+=Math.PI*2/prizes.length; } }
function closeWheel(){ document.getElementById('wheelModal').style.display='none'; }
async function doSpin(){ let r=await fetch("/api/spin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid})}); let j=await r.json(); alert(j.win!==undefined? "Won "+j.win : j.error); closeWheel(); load(); }
async function startMining(){ await fetch("/api/mining/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid})}); alert("Mining started!"); load(); }
async function load(){ try{ let r=await fetch("/api/user/"+uid);let u=await r.json(); document.getElementById('b').textContent=(u.balance||0).toLocaleString(); document.getElementById('gb').textContent=(u.gameBalance||0).toLocaleString(); document.getElementById('mineBal').textContent=(u.miningBalance||0).toLocaleString(); document.getElementById('ph').textContent=u.phone||""; document.getElementById('int').textContent=(u.totalInterest||0).toLocaleString(); }catch(e){} }
async function loadVirtualPreview(){ try{ let r=await fetch("/api/virtual/status"); let d=await r.json(); document.getElementById('virtPhase').textContent=d.phase.toUpperCase(); document.getElementById('virtTimer').textContent=Math.floor(d.timeLeft/60)+":"+String(d.timeLeft%60).padStart(2,'0'); document.getElementById('topInfo').textContent='MD '+d.matchday+' FRESH • x2.00 • STADIUM'; }catch(e){} }
load(); setInterval(loadVirtualPreview,1000); loadVirtualPreview();
</script></body></html>`,

// VIRTUAL - TIMER COUNTING + NO SMALL BOTTOM MENU
virtual: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="manifest" href="/manifest.json"><style>
body{margin:0;background:#121212;color:#fff;font-family:Arial;padding-bottom:100px}
.topBar{background:#1e1e1e;padding:14px 16px;display:flex;justify-content:space-between;position:sticky;top:0;z-index:20;border-bottom:1px solid #2a2a2a}
.countDown{color:#ff6b00;font-weight:900;font-size:16px}
.matchCard{background:#1e1e1e;margin:8px 10px;border-radius:10px;padding:14px}
.teams{font-weight:800;font-size:14px;margin-bottom:10px;letter-spacing:0.3px}
.oddsRow{display:flex;gap:8px}
.oddBox{flex:1;background:#2a2a2a;border-radius:8px;padding:14px 10px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;border:2px solid transparent;font-weight:bold}
.oddBox.sel{background:#1a3d1a;border-color:#00c853}
.betSlipBar{position:fixed;bottom:0;left:0;right:0;background:#b2ff00;color:#000;padding:14px 16px;display:flex;justify-content:space-between;z-index:30;font-weight:900;font-size:14px;cursor:pointer}
.accaSheet{position:fixed;bottom:0;left:0;right:0;background:#1e1e1e;border-radius:18px 18px 0 0;max-height:85vh;overflow-y:auto;z-index:40;display:none;padding:18px;border-top:2px solid gold}
</style></head><body>
<div class="topBar"><a href="/dashboard" style="color:#fff;text-decoration:none;font-size:24px">‹</a><span id="mdText" style="font-weight:700">Matchday 0 • Starts in: <span id="timer" class="countDown">01:58</span> • x2.00</span><span style="color:#666">⟳</span></div>
<div id="list" style="margin-top:8px">Loading 8 matches fresh from MD 0...</div>
<div class="betSlipBar" onclick="openSlip()"><span>🎫 Add legs x2.00 - Win Bonus</span><span id="legsCount" style="background:#000;color:#b2ff00;padding:6px 12px;border-radius:20px;font-size:13px">0 legs</span></div>
<div class="accaSheet" id="accaSheet">
<h3 style="color:gold;margin:0">Betslip x2.00 - <span id="selCount">0</span> legs • MD <span id="mdInSlip">0</span></h3>
<div style="margin:8px 0;font-size:13px">Odd: <b id="odd">x0</b> • Potential: <b id="pot" style="color:#0f0">0 UGX</b></div>
<div id="selList" style="margin:10px 0"></div>
<input id="accaAmt" type="number" value="500" style="width:100%;padding:14px;background:#111;color:#fff;border:1px solid gold;border-radius:10px;margin:10px 0;font-size:16px">
<button onclick="placeAcca()" style="width:100%;padding:16px;background:gold;border:none;border-radius:12px;font-weight:900;font-size:16px">Place Bet x<span id="oddBtn">0</span> • x2.00 each</button>
<button onclick="closeSlip()" style="width:100%;padding:12px;background:#2a2a2a;color:#fff;border:none;border-radius:10px;margin-top:10px">Close</button>
<p style="font-size:11px;color:#888;margin-top:10px">Game Wallet: <span id="gBal">0</span> UGX • 1 leg x2 • 8 legs x256</p>
</div>
<script>
let selections=[];
let timeLeft=118;
let curMD=0;
let FALLBACK=[
  {id:101, home:{name:'Man Utd',short:'MUN'}, away:{name:'Aston Villa',short:'AVL'}},
  {id:102, home:{name:'Crystal Palace',short:'CRY'}, away:{name:'Everton',short:'EVE'}},
  {id:103, home:{name:'Tottenham',short:'TOT'}, away:{name:'West Ham',short:'WHU'}},
  {id:104, home:{name:'Liverpool',short:'LIV'}, away:{name:'Wolves',short:'WOL'}},
  {id:105, home:{name:'Arsenal',short:'ARS'}, away:{name:'Chelsea',short:'CHE'}},
  {id:106, home:{name:'Brentford',short:'BRE'}, away:{name:'Brighton',short:'BHA'}},
  {id:107, home:{name:'Man City',short:'MCI'}, away:{name:'Fulham',short:'FUL'}},
  {id:108, home:{name:'Newcastle',short:'NEW'}, away:{name:'Nottm Forest',short:'NFO'}},
];
function fmt(s){ if(s<0)s=0; let m=Math.floor(s/60).toString().padStart(2,'0'); let sec=(s%60).toString().padStart(2,'0'); return m+":"+sec; }
function toggleSel(id,hn,an,hs,as,p){ let ex=selections.findIndex(s=>s.matchId===id); if(ex!==-1){ if(selections[ex].prediction===p) selections.splice(ex,1); else selections[ex].prediction=p; } else { if(selections.length>=8){alert("Max 8 legs x256");return;} selections.push({matchId:id,homeTeam:hn,awayTeam:an,homeShort:hs,awayShort:as,prediction:p}); } renderSel(); }
function renderSel(){ document.querySelectorAll('.oddBox').forEach(b=>b.classList.remove('sel')); selections.forEach(s=>{ let el=document.querySelector('[data-match="'+s.matchId+'"][data-pred="'+s.prediction+'"]'); if(el) el.classList.add('sel'); }); document.getElementById('selCount').textContent=selections.length; document.getElementById('legsCount').textContent=selections.length+" legs"; document.getElementById('mdInSlip').textContent=curMD; let odd=selections.length?Math.pow(2,selections.length):0; if(selections.length===8) odd=256; document.getElementById('odd').textContent='x'+odd; document.getElementById('oddBtn').textContent=odd; let amt=parseInt(document.getElementById('accaAmt').value)||0; document.getElementById('pot').textContent=Math.floor(amt*odd).toLocaleString()+" UGX"; document.getElementById('selList').innerHTML=selections.map(s=>'<div style="background:#2a2a2a;padding:10px;margin:5px 0;border-radius:8px;display:flex;justify-content:space-between;font-size:13px"><span>'+s.homeShort+' - '+s.awayShort+' → '+s.prediction.toUpperCase()+' @2.00</span><span style="color:red;cursor:pointer;font-weight:bold" onclick="removeSel('+s.matchId+')">✕</span></div>').join('')||'<small style=color:#888>Tap 1 X 2 - All odds x2.00 • Fresh from MD 0</small>'; }
function removeSel(id){ selections=selections.filter(s=>s.matchId!==id); renderSel(); }
function openSlip(){ document.getElementById('accaSheet').style.display='block'; }
function closeSlip(){ document.getElementById('accaSheet').style.display='none'; }
document.getElementById('accaAmt').addEventListener('input',renderSel);
async function placeAcca(){ if(selections.length<1)return alert("Add 1 leg!"); let amt=parseInt(accaAmt.value); if(amt<200)return alert("Min 200"); try{ let r=await fetch("/api/virtual/bet/acca",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:localStorage.getItem("uid"),amount:amt,selections:selections.map(s=>({matchId:s.matchId,homeTeam:s.homeTeam,awayTeam:s.awayTeam,prediction:s.prediction}))})}); let j=await r.json(); if(j.ok){alert("MD "+curMD+" Bet placed! "+selections.length+" legs x2.00 = x"+j.odd); selections=[]; renderSel(); closeSlip();} else alert(j.error);}catch(e){alert(e.message);} }
function renderFixtures(fixtures){ let h=''; fixtures.forEach(m=>{ h+='<div class=matchCard><div class=teams>'+m.home.short+' - '+m.away.short+'</div><div class=oddsRow><div class="oddBox" data-match="'+m.id+'" data-pred="home" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','home')"+'"><span>1</span><span>2.00</span></div><div class="oddBox" data-match="'+m.id+'" data-pred="draw" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','draw')"+'"><span>X</span><span>2.00</span></div><div class="oddBox" data-match="'+m.id+'" data-pred="away" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','away')"+'"><span>2</span><span>2.00</span></div></div></div>'; }); document.getElementById('list').innerHTML=h; renderSel(); }
function startLocalTimer(){ setInterval(()=>{ timeLeft--; if(timeLeft<0) timeLeft=118; document.getElementById('timer').textContent=fmt(timeLeft); document.getElementById('mdText').innerHTML='Matchday '+curMD+' • Starts in: <span class=countDown>'+fmt(timeLeft)+'</span> • All x2.00'; },1000); }
async function syncServer(){ try{ let r=await fetch("/api/virtual/status"); let d=await r.json(); curMD=d.matchday; timeLeft=d.timeLeft; let fixtures=d.nextAll && d.nextAll.length? d.nextAll : FALLBACK; renderFixtures(fixtures); }catch(e){ renderFixtures(FALLBACK); } }
renderFixtures(FALLBACK); startLocalTimer(); syncServer(); setInterval(syncServer,4000);
</script></body></html>`,

deposit: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><div class="field-logo-top">DEPOSIT</div><a href="/dashboard" style="color:gold;margin-top:60px;display:inline-block">← Back</a><h2>Deposit</h2><input id="am" placeholder="Amount"><input id="air" placeholder="Airtel Number"><input type="file" id="file"><button onclick="dep()">Submit</button><script>let uid=localStorage.getItem("uid");let b64=""; file.addEventListener("change",e=>{let r=new FileReader();r.onload=()=>{b64=r.result};r.readAsDataURL(e.target.files[0])});async function dep(){let r=await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:am.value,airtelNo:air.value,screenshot:b64})});let j=await r.json();if(j.ok)location.href="/dashboard";else alert(j.error)}</script></body></html>`,
invest: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold}</style></head><body><div class="field-logo-top">INVEST</div><a href="/dashboard" style="color:gold;margin-top:60px;display:inline-block">← Back</a><h2>Invest</h2><p>Bal: <b id="bal">0</b></p><input id="a" placeholder="Amount"><button onclick="inv()">Invest</button><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/user/"+uid);let u=await r.json();bal.textContent=u.balance;}async function inv(){let r=await fetch("/api/invest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,club:'arsenal',amount:parseInt(a.value)})});let j=await r.json();if(j.ok)location.href="/dashboard";else alert(j.error)}load()</script></body></html>`,
history: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.card{background:#1a1f2e;border:1px solid gold;padding:14px;margin:8px 0;border-radius:12px;display:flex;justify-content:space-between}a{color:gold}</style></head><body><div class="field-logo-top">HISTORY</div><div style="margin-top:60px"><a href="/dashboard">← Back</a><h2>History</h2><div id="list">Loading...</div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/history/"+uid);let d=await r.json();let h="";for(let t of d){h+="<div class=card><span>"+t.type+" "+(t.amount||0)+"</span><span>"+(t.status||'')+"</span></div>";}document.getElementById('list').innerHTML=h||"No data";}load()</script></body></html>`,
referral: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.card{padding:15px;border-radius:12px;margin:10px 0;text-align:center}button{width:100%;padding:12px;border-radius:8px;border:none;background:gold;font-weight:bold;margin:5px 0}input{width:100%;padding:12px;border-radius:8px;border:none;background:#111;color:#fff;text-align:center}a{color:gold}</style></head><body><div class="field-logo-top">TEAM</div><div style="margin-top:60px"><a href="/dashboard">Back</a><h2>My Team</h2><div class="card glass"><h3>Code: <span id="code">---</span></h3><input id="link" readonly><button onclick="copy()">Copy</button></div><div id="team"></div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/team/"+uid);let j=await r.json();code.textContent=j.code;link.value=location.origin+"/?ref="+j.code;let html="";for(let t of j.team){html+="<div class=card glass style=text-align:left>"+t.phone+"</div>"}team.innerHTML=html||"No team";}function copy(){link.select();document.execCommand("copy");alert("Copied!")}load()</script></body></html>`,
admin: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin 75%</title><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}input,button{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:none}button{background:gold;font-weight:bold}.card{background:#111;padding:12px;margin:8px 0;border-radius:10px;border-left:4px solid gold}.profitBox{background:linear-gradient(90deg,#FFD700,#FFA500);color:#000;padding:16px;border-radius:12px;font-weight:900;text-align:center;margin:12px 0}</style></head><body>
<div id="loginBox"><h2>Admin - 75% Profit - MD 0 Fresh</h2><input id="pass" type="password" placeholder="LIFELINE123"><button onclick="check()">Unlock</button></div>
<div id="adminBox" style="display:none"><h2>🏆 ADMIN 75% - MD <span id="mdAdmin">0</span> FRESH</h2><div class="profitBox" id="profitBox">Calculating...</div><button onclick="resetMD()" style="background:red;color:#fff">RESET MATCHDAY TO 0</button><div id="l">Loading...</div></div>
<script>
const AP="LIFELINE123";let en="";function check(){if(pass.value===AP){en=pass.value;loginBox.style.display="none";adminBox.style.display="block";loadVirt();}}
async function loadVirt(){let r=await fetch("/api/admin/virtual?key="+en);let d=await r.json();let acc=d.accas||[]; let totalStaked=0,totalPaid=0; acc.forEach(b=>{ totalStaked+=parseInt(b.amount)||0; if(b.status==='won') totalPaid+=parseInt(b.winAmount)||0; }); let profit=totalStaked-totalPaid; let pct=totalStaked? (profit/totalStaked*100).toFixed(1):0; document.getElementById('profitBox').innerHTML="MD: "+(d.currentMD||0)+" FRESH<br>STAKED: "+totalStaked+" UGX<br>PAID: "+totalPaid+" UGX<br>PROFIT: "+profit+" UGX ("+pct+"%) - Target 75%"; document.getElementById('mdAdmin').textContent=d.currentMD||0; document.getElementById('l').innerHTML=acc.slice(0,20).map(a=>"<div class=card>"+a.phone+" x"+(a.odd||0)+" "+a.amount+" "+a.status+"</div>").join('');}
async function resetMD(){ if(confirm("Reset Matchday to 0?")){ await fetch("/api/admin/reset-md?key="+en,{method:"POST"}); alert("Reset to MD 0!"); loadVirt(); } }
</script></body></html>`
};
function render(name,res){ res.send(pages[name]); }
app.get('/',(req,res)=>render('home',res));
app.get('/dashboard',(req,res)=>render('dash',res));
app.get('/deposit',(req,res)=>render('deposit',res));
app.get('/invest',(req,res)=>render('invest',res));
app.get('/referral',(req,res)=>render('referral',res));
app.get('/history',(req,res)=>render('history',res));
app.get('/virtual',(req,res)=>render('virtual',res));
app.get('/admin',(req,res)=>render('admin',res));
app.get('/api/virtual/status',(req,res)=>{
  if(!liveFixtures && (!nextFixtures || nextFixtures.length===0)){ nextFixtures=genMatchday(); virtualPhase='betting'; virtualTimeLeft=118; }
  res.json({season, matchday, phase:virtualPhase, timeLeft:virtualTimeLeft, nextAll:nextFixtures, allLive:liveFixtures});
});
app.get('/api/virtual/myaccas/:id',async(req,res)=>{ try{ const [r]=await db.query("SELECT * FROM virtual_accas WHERE userId=? ORDER BY id DESC LIMIT 20",[req.params.id]); res.json(r); }catch(e){res.json([])} });
app.post('/api/virtual/bet/acca',async(req,res)=>{
 try{
  const {userId, amount, selections}=req.body;
  if(!selections || selections.length<1) return res.status(400).json({error:"Select 1!"});
  if(parseInt(amount)<200) return res.status(400).json({error:"Min 200"});
  const [u]=await db.query("SELECT gameBalance FROM users WHERE id=?",[userId]);
  if(!u.length || u[0].gameBalance < amount) return res.status(400).json({error:"No Game Wallet"});
  if(virtualPhase!=='betting') return res.status(400).json({error:"Betting closed!"});
  let odd=Math.pow(2, selections.length); if(selections.length===8) odd=256;
  await db.query("UPDATE users SET gameBalance=gameBalance-? WHERE id=?",[parseInt(amount), userId]);
  await db.query("INSERT INTO virtual_accas (userId,season,matchday,selections,amount,odd) VALUES (?,?,?,?,?,?)",[userId, season, matchday, JSON.stringify(selections), parseInt(amount), odd]);
  res.json({ok:1, odd, potential: Math.floor(parseInt(amount)*odd)});
 }catch(e){ res.status(400).json({error:e.message}) }
});
app.post('/api/register',async(req,res)=>{ try{ const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase(); await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy,balance,gameBalance) VALUES (?,?,?,?,?,0,0)",[req.body.name,req.body.phone,req.body.password,code,req.body.ref||null]); const[r]=await db.query("SELECT * FROM users WHERE phone=? ORDER BY id DESC LIMIT 1",[req.body.phone]); res.json(r[0]); }catch(e){res.status(400).json({error:e.message})} });
app.post('/api/login',async(req,res)=>{ try{ const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]); if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"}); }catch(e){ res.status(401).json({error:"Wrong"}) } });
app.get('/api/user/:id',async(req,res)=>{ try{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); if(!u.length) return res.json({balance:0,gameBalance:0}); const[inv]=await db.query("SELECT * FROM investments WHERE userId=? ORDER BY id DESC",[req.params.id]); let total=0; let now=new Date(); for(let i of inv){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24)); if(d<0)d=0; total+=Math.floor((i.amount||0)*10/100*d);} const[mining]=await db.query("SELECT * FROM mining WHERE userId=? ORDER BY id DESC LIMIT 1",[req.params.id]); let miningEarn=0; if(mining.length && mining[0].isMining){ let mins=Math.floor((now-new Date(mining[0].lastClaim))/(1000*60)); miningEarn=mins*2; } res.json({...u[0], totalInterest:total, miningPending: miningEarn, isMining: mining.length?mining[0].isMining:0}); }catch(e){ res.json({balance:0,gameBalance:0}); } });
app.post('/api/spin',async(req,res)=>{ try{ const uid=req.body.userId; const[last]=await db.query("SELECT * FROM spins WHERE userId=? AND DATE(createdAt)=CURDATE()",[uid]); if(last.length) return res.status(400).json({error:"Already spun"}); const prizes=[0,100,200,300,500,1000,2000,100]; let win=prizes[Math.floor(Math.random()*prizes.length)]; await db.query("INSERT INTO spins (userId,amount) VALUES (?,?)",[uid,win]); if(win>0) await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win,uid]); res.json({win}); }catch(e){ res.status(400).json({error:e.message}) } });
app.post('/api/mining/start',async(req,res)=>{ try{ const uid=req.body.userId; const[m]=await db.query("SELECT * FROM mining WHERE userId=?",[uid]); if(m.length){ await db.query("UPDATE mining SET isMining=1, lastClaim=NOW() WHERE userId=?",[uid]); } else { await db.query("INSERT INTO mining (userId,earned,isMining) VALUES (?,0,1)",[uid]); } res.json({ok:1}); }catch(e){res.json({ok:1})} });
app.post('/api/deposit',async(req,res)=>{ try{ const {userId, amount, airtelNo, screenshot} = req.body; const[u]=await db.query("SELECT phone FROM users WHERE id=?",[userId]); await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot) VALUES (?,?,?,?,?)",[userId, u[0]?u[0].phone:"", parseInt(amount), airtelNo, screenshot]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
app.post('/api/invest',async(req,res)=>{ try{ const{userId,club,amount}=req.body; if(amount<2000) return res.status(400).json({error:"Min 2000"}); const[u]=await db.query("SELECT balance FROM users WHERE id=?",[userId]); if(!u[0] || u[0].balance<amount) return res.status(400).json({error:"No balance"}); await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]); await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,10,10]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
app.get('/api/history/:id',async(req,res)=>{ try{ const uid=req.params.id; const[deps]=await db.query("SELECT id,amount,status,createdAt,'deposit' as type FROM deposits WHERE userId=?",[uid]); const[accas]=await db.query("SELECT id,amount,status,createdAt,'acca' as type FROM virtual_accas WHERE userId=?",[uid]); let all=[...deps,...accas].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)); res.json(all); }catch(e){res.json([])} });
app.get('/api/team/:id',async(req,res)=>{ try{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); const[team]=await db.query("SELECT phone FROM users WHERE referredBy=?",[u[0].myReferralCode]); res.json({code:u[0].myReferralCode, team}); }catch(e){res.json({team:[]})} });
app.get('/api/admin/deposits',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC"); res.json(r); });
app.post('/api/admin/approve/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); const[d]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]); if(!d.length) return res.json({}); await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]); await db.query("UPDATE users SET balance=balance+? WHERE id=?",[d[0].amount,d[0].userId]); res.json({ok:1}); });
app.get('/api/admin/virtual',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); try{ const[r2]=await db.query("SELECT a.*, u.phone FROM virtual_accas a JOIN users u ON a.userId=u.id ORDER BY a.id DESC LIMIT 100"); res.json({accas:r2, currentMD:matchday}); }catch(e){ res.json({accas:[], currentMD:matchday}); } });
app.post('/api/admin/reset-md',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); matchday=0; season=1; nextFixtures=genMatchday(); virtualPhase='betting'; virtualTimeLeft=118; liveFixtures=null; res.json({ok:1, matchday}); });

app.listen(process.env.PORT||3000,()=>console.log("FINAL MD0 FRESH - NO BOTTOM MENU - TIMER COUNTING - x2.00 - 75%"));
