const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
let db;
const ADMIN_KEY="LIFELINE123";
const TEAMS_16 = [{name:'Man Utd',short:'MUN'},{name:'Aston Villa',short:'AVL'},{name:'Crystal Palace',short:'CRY'},{name:'Everton',short:'EVE'},{name:'Tottenham',short:'TOT'},{name:'West Ham',short:'WHU'},{name:'Liverpool',short:'LIV'},{name:'Wolves',short:'WOL'},{name:'Arsenal',short:'ARS'},{name:'Chelsea',short:'CHE'},{name:'Brentford',short:'BRE'},{name:'Brighton',short:'BHA'},{name:'Man City',short:'MCI'},{name:'Fulham',short:'FUL'},{name:'Newcastle',short:'NEW'},{name:'Nottm Forest',short:'NFO'}];
const CLUBS=[{id:'arsenal',name:'Arsenal',rate:10,lock:10,icon:'🔴'},{id:'mancity',name:'Man City',rate:10,lock:10,icon:'🔵'},{id:'liverpool',name:'Liverpool',rate:10,lock:10,icon:'🔴'},{id:'chelsea',name:'Chelsea',rate:8,lock:8,icon:'🔵'},{id:'manutd',name:'Man Utd',rate:8,lock:8,icon:'🔴'},{id:'tottenham',name:'Tottenham',rate:8,lock:8,icon:'⚪'}];

function generateSeasonSchedule(){
let teams=[...TEAMS_16];let rounds=[];let n=teams.length;let fixed=teams[0];let rotating=teams.slice(1);
for(let round=0;round<n-1;round++){
let fixtures=[];let all=[fixed,...rotating];
for(let i=0;i<n/2;i++){let home=all[i];let away=all[n-1-i];if(round%2===0)fixtures.push({home,away});else fixtures.push({home:away,away:home});}
rotating=[rotating[rotating.length-1],...rotating.slice(0,rotating.length-1)];rounds.push(fixtures);
}return rounds;
}
let seasonSchedule=generateSeasonSchedule();
let season=1,matchday=0;
function getFixturesFor(md){let round=seasonSchedule[md%15];return round.map((m,i)=>({...m,id: (md+1)*100000 + i*1000 + Math.floor(Math.random()*900)}));}
let currentFixtures=getFixturesFor(matchday);
let nextFixtures=getFixturesFor(matchday+1);
let liveFixtures=null;
let virtualPhase='betting';let virtualTimeLeft=120;let pastResults=[];
let leagueTable={};
function initTable(){leagueTable={};TEAMS_16.forEach(t=>{leagueTable[t.short]={name:t.name,short:t.short,pld:0,w:0,d:0,l:0,gf:0,ga:0,pts:0};});}
initTable();
function updateTable(fixtures){
fixtures.forEach(f=>{
let [hg,ag]=f.score.split('-').map(Number);
let ht=leagueTable[f.home.short];let at=leagueTable[f.away.short];
if(!ht||!at)return;
ht.pld++;at.pld++;ht.gf+=hg;ht.ga+=ag;at.gf+=ag;at.ga+=hg;
if(hg>ag){ht.w++;ht.pts+=3;at.l++;}else if(ag>hg){at.w++;at.pts+=3;ht.l++;}else{ht.d++;at.d++;ht.pts+=1;at.pts+=1;}
});
}
function scoreToResult(sc){let [h,a]=sc.split('-').map(Number);if(h>a)return 'home';if(a>h)return 'away';return 'draw';}
function maybeGoal(){
if(!liveFixtures)return;
if(Math.random()<0.14){
let cands=liveFixtures.filter(f=>{let [h,a]=f.score.split('-').map(Number);return (h+a)<5;});
if(!cands.length)return;
let f=cands[Math.floor(Math.random()*cands.length)];
let [h,a]=f.score.split('-').map(Number);
if(Math.random()<0.85){
if(Math.random()<0.52)h++;else a++;
f.score=h+'-'+a;f.result=scoreToResult(f.score);
}
}
}
function reduceDraws(fixtures){
fixtures.forEach(f=>{
if(f.score==='0-0' && Math.random()<0.75){
if(Math.random()<0.5){f.score='1-0';f.result='home';}
else{f.score='0-1';f.result='away';}
} else if(f.score==='0-0' && Math.random()<0.5){
f.score='1-1';f.result='draw';
}
});
}
setInterval(async()=>{
virtualTimeLeft--;
if(virtualPhase==='betting' && virtualTimeLeft<=0){
virtualPhase='first_half';virtualTimeLeft=45;
liveFixtures=currentFixtures.map(m=>({id:m.id,home:m.home,away:m.away,score:'0-0',result:'draw'}));
}
else if(virtualPhase==='first_half'){maybeGoal();if(virtualTimeLeft<=0){virtualPhase='halftime';virtualTimeLeft=5;}}
else if(virtualPhase==='halftime' && virtualTimeLeft<=0){virtualPhase='second_half';virtualTimeLeft=45;}
else if(virtualPhase==='second_half'){maybeGoal();if(virtualTimeLeft<=0){
if(liveFixtures){
reduceDraws(liveFixtures);
liveFixtures.forEach(f=>{f.result=scoreToResult(f.score);});
updateTable(liveFixtures);
}
pastResults.unshift({matchday:matchday+1,season,fixtures:liveFixtures.map(f=>({...f})),time:new Date().toLocaleTimeString()});if(pastResults.length>20)pastResults.pop();
try{if(db){let [accas]=await db.query("SELECT * FROM virtual_accas WHERE season=? AND matchday=? AND status='pending'",[season,matchday+1]);for(let a of accas){let sels=JSON.parse(a.selections);let win=true;for(let sel of sels){let mf=liveFixtures.find(f=>f.id==sel.matchId);if(!mf || mf.result!==sel.prediction)win=false;}if(win){let winAmt=Math.floor(a.amount*a.odd);await db.query("UPDATE virtual_accas SET status='won', winAmount=? WHERE id=?",[winAmt,a.id]);await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[winAmt,a.userId]);}else{await db.query("UPDATE virtual_accas SET status='lost' WHERE id=?",[a.id]);}} }}catch(e){}
matchday++;if(matchday>=15){season++;matchday=0;seasonSchedule=generateSeasonSchedule();initTable();}
currentFixtures=nextFixtures;
nextFixtures=getFixturesFor(matchday+1);
liveFixtures=null;virtualPhase='betting';virtualTimeLeft=120;
}}
},1000);

async function init(){
try{
const u=process.env.DATABASE_URL||process.env.MYSQL_URL;if(!u)throw new Error("no db");
db=mysql.createPool(u+"?connectionLimit=10&keepAlive=true");
await db.query("CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(100), phone VARCHAR(30), password VARCHAR(100), myReferralCode VARCHAR(20), referredBy VARCHAR(20), balance INT DEFAULT 0, gameBalance INT DEFAULT 0)");
await db.query("CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, phone VARCHAR(30), amount INT, airtelNo VARCHAR(30), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
await db.query("CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, club VARCHAR(50), amount INT, rate INT, lockDays INT, startDate DATETIME DEFAULT CURRENT_TIMESTAMP, status VARCHAR(20) DEFAULT 'active')");
await db.query("CREATE TABLE IF NOT EXISTS virtual_accas (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, season INT, matchday INT, selections TEXT, amount INT, odd FLOAT, status VARCHAR(20) DEFAULT 'pending', winAmount INT DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
await db.query("UPDATE investments SET rate=10, lockDays=10 WHERE club IN ('arsenal','mancity','liverpool')");
await db.query("UPDATE investments SET rate=8, lockDays=8 WHERE club IN ('chelsea','manutd','tottenham')");
}catch(e){}
}
init();
const BG=`body{background:#080a0f;color:#fff;font-family:Arial;padding:12px;padding-bottom:90px}body::before{content:'';position:fixed;inset:-20px;z-index:-3;background-image:linear-gradient(rgba(0,0,0,0.55),rgba(0,0,0,0.75)),url('https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200&q=80');background-size:cover;background-position:center}.glass{background:rgba(18,22,35,0.85);backdrop-filter:blur(16px);border:1px solid rgba(255,215,0,0.15)}.top{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(0,0,0,0.7);border:1px solid gold;padding:6px 18px;border-radius:30px;color:gold;font-size:11px;font-weight:bold}`;
const pages={
home:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BG}input,button{width:100%;padding:14px;margin:8px 0;border-radius:12px;border:none}button{background:gold;font-weight:bold}.card{padding:20px;border-radius:20px}</style></head><body><div class="top">LIFELINE • x2.00</div><div class="card glass" style="margin-top:60px"><h2>Register</h2><input id="n" placeholder="Full Name"><input id="p" placeholder="Phone"><input id="pw" type="password" placeholder="Password"><button onclick="reg()">Register</button><button onclick="log()" style="background:#222;color:#fff">Login</button></div><script>async function reg(){let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}}async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}}</script></body></html>`,
dash:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BG}.bal{padding:22px;border-radius:24px;text-align:center}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.gc{padding:14px;border-radius:16px;text-align:left}button{width:100%;padding:14px;margin:7px 0;border-radius:12px;border:none;font-weight:bold}.gold{background:gold;color:#000}.dark{background:rgba(20,25,35,0.9);color:#fff;border:1px solid rgba(255,255,255,0.1)}.virtCard{background:linear-gradient(135deg,#1a0033,#000033);border:2px solid #ff00cc;padding:16px;border-radius:18px;margin:12px 0}</style></head><body><div class="top">LIFELINE • x2.00</div><div class="bal glass" style="margin-top:60px"><div class="grid"><div class="gc glass"><h4>GAME</h4><h2 id="gb">0</h2><small id="gt" style="color:#aaa"></small></div><div class="gc glass"><h4>INVEST</h4><h2 id="b">0</h2></div></div></div><div class="virtCard" onclick="location.href='/virtual'"><div style="display:flex;justify-content:space-between"><b style="color:#ff00cc">🔥 VIRTUAL MD <span id="mdt">0</span> S<span id="sdt">1</span></b><span id="vp" style="background:#0f0;color:#000;padding:4px 10px;border-radius:20px;font-size:10px">BETTING</span></div><div style="text-align:center;margin-top:8px">⏱️ <span id="vt">02:00</span></div></div><button class="gold" onclick="location.href='/virtual'">⚽ VIRTUAL</button><button class="dark" onclick="location.href='/deposit'">💰 Deposit</button><button class="dark" onclick="location.href='/invest'">📈 INVEST 10% & 8%</button><button class="dark" onclick="location.href='/history'">📜 History</button><button class="dark" onclick="location.href='/referral'">👥 My Team</button><script>let uid=localStorage.getItem("uid");if(!uid)location.href="/";async function load(){let r=await fetch("/api/user/"+uid);let u=await r.json();b.textContent=(u.balance||0).toLocaleString();gb.textContent=(u.gameBalance||0).toLocaleString();gt.textContent="Total: "+((u.balance||0)+(u.gameBalance||0)).toLocaleString();}async function sync(){let r=await fetch("/api/virtual/status");let d=await r.json();mdt.textContent=d.matchday;sdt.textContent=d.season;let tl=d.timeLeft;let ph=d.phase;let disp="";if(ph==='betting')disp=Math.floor(tl/60)+":"+String(tl%60).padStart(2,'0');else if(ph==='first_half')disp="00:"+(45-tl).toString().padStart(2,'0');else if(ph==='halftime')disp="00:0"+tl;else{let tot=45+(45-tl);disp=String(Math.floor(tot/60)).padStart(2,'0')+":"+String(tot%60).padStart(2,'0');}vt.textContent=disp;vp.textContent=ph==='betting'?'BETTING':ph.toUpperCase();}load();sync();setInterval(sync,1000);</script></body></html>`,
invest:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BG}.club{background:rgba(25,30,45,0.9);border:1px solid rgba(255,215,0,0.2);border-radius:16px;padding:16px;margin:10px 0;display:flex;justify-content:space-between;align-items:center}.invCard{background:rgba(0,100,0,0.2);border:1px solid #0f0;border-radius:12px;padding:12px;margin:8px 0}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:900}.back{color:gold;text-decoration:none;display:inline-block;margin-top:60px}</style></head><body><div class="top">INVEST • 10% & 8%</div><a href="/dashboard" class="back">← Back</a><h2>📈 Invest</h2><div style="background:rgba(0,0,0,0.6);padding:12px;border-radius:12px;margin:10px 0"><div>Invest Wallet: <b id="bal" style="color:gold">0</b> UGX</div></div><div id="clubs"></div><h3>My Active</h3><div id="myInv">Loading...</div><script>
let uid=localStorage.getItem("uid");
const CLUBS=[{id:'arsenal',name:'Arsenal',rate:10,lock:10,icon:'🔴'},{id:'mancity',name:'Man City',rate:10,lock:10,icon:'🔵'},{id:'liverpool',name:'Liverpool',rate:10,lock:10,icon:'🔴'},{id:'chelsea',name:'Chelsea',rate:8,lock:8,icon:'🔵'},{id:'manutd',name:'Man Utd',rate:8,lock:8,icon:'🔴'},{id:'tottenham',name:'Tottenham',rate:8,lock:8,icon:'⚪'}];
async function load(){
let r=await fetch("/api/user/"+uid);let u=await r.json();bal.textContent=(u.balance||0).toLocaleString();
let cHtml='';CLUBS.forEach(c=>{let badge=c.rate===10?'<span style="background:gold;color:#000;padding:2px 6px;border-radius:8px;font-size:10px;margin-left:6px">10D 10%</span>':'<span style="background:#0ff;color:#000;padding:2px 6px;border-radius:8px;font-size:10px;margin-left:6px">8D 8%</span>';cHtml+='<div class=club><div><div style="font-size:18px">'+c.icon+' <b>'+c.name+'</b>'+badge+'</div><div style="font-size:12px;color:#aaa">'+c.rate+'% x '+c.lock+' days</div></div><div><input id="amt_'+c.id+'" type="number" placeholder="2000" style="width:90px;padding:8px;background:#111;color:#fff;border:1px solid gold;border-radius:8px"><button onclick="investClub(&quot;'+c.id+'&quot;)" style="padding:8px 12px;margin-top:4px;font-size:12px">INVEST</button></div></div>';});
clubs.innerHTML=cHtml;
let r2=await fetch("/api/investments/"+uid);let invs=await r2.json();
if(!invs.length)myInv.innerHTML='<div style="color:#666;text-align:center;padding:20px">No investments</div>';
else{let h='';invs.forEach(i=>{let days=Math.floor((Date.now()-new Date(i.startDate).getTime())/(1000*60*60*24));let profit=Math.floor(i.amount * i.rate/100 * Math.min(days,i.lockDays));h+='<div class=invCard><b>'+i.club.toUpperCase()+' '+i.rate+'% x '+i.lockDays+'D</b><div>Amount: '+i.amount+' | Profit: <b style="color:gold">'+profit+'</b> | Days '+days+'/'+i.lockDays+'</div></div>';});myInv.innerHTML=h;}
}
async function investClub(club){let amt=document.getElementById('amt_'+club).value;if(!amt||parseInt(amt)<2000)return alert("Min 2000");let r=await fetch("/api/invest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,club,amount:parseInt(amt)})});let j=await r.json();if(j.ok){alert("Invested "+club);load();}else alert(j.error);}
load();
</script></body></html>`,
virtual:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;padding:0;padding-bottom:110px;background:#0f0f0f;color:#fff;font-family:Arial}
.top{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(0,0,0,0.8);border:1px solid gold;padding:5px 16px;border-radius:20px;color:gold;font-size:11px;font-weight:bold}
.tabPill{display:flex;background:#2a2a2a;border-radius:30px;padding:5px;margin:60px 12px 14px 12px;gap:5px}
.tab{flex:1;padding:14px 8px;text-align:center;border-radius:26px;font-weight:800;font-size:14px;cursor:pointer;color:#888}
.tab.active{background:#3a3a3a;color:#fff}.tab.liveActive{color:#ff6b00!important}
.liveTag{padding:3px 8px;border-radius:10px;font-size:11px;font-weight:900}.fh{background:#ff6b00;color:#fff}.ht{background:yellow;color:#000}.sh{background:red;color:#fff}
.match{background:#1e1e1e;margin:10px 12px;border-radius:14px;padding:14px;border:1px solid #2a2a2a}
.row{display:flex;gap:8px}.odd{flex:1;background:#2c2c2c;border-radius:10px;padding:14px 10px;display:flex;justify-content:space-between;cursor:pointer;border:2px solid transparent;font-weight:bold}.odd.sel{background:#1a3d1a;border-color:#00c853}
.bar{position:fixed;bottom:0;left:0;right:0;background:#b2ff00;color:#000;padding:16px;display:flex;justify-content:space-between;z-index:30;font-weight:900}
.sheet{position:fixed;bottom:0;left:0;right:0;background:#1e1e1e;border-radius:18px 18px 0 0;max-height:85vh;overflow-y:auto;z-index:40;display:none;padding:18px;border-top:2px solid gold}
.resCard{background:#1e1e1e;margin:10px 12px;border-radius:12px;padding:12px;border-left:4px solid gold}
@keyframes goalFlash{0%{background:#1e1e1e}50%{background:#2a5a1a}100%{background:#1e1e1e}}
.goal{animation:goalFlash 0.8s}
.tableWrap{margin:20px 12px;background:#1e1e1e;border-radius:14px;padding:12px;border:1px solid #333}
th{color:#888;font-size:11px;padding:6px 2px;text-align:center}
td{padding:8px 2px;text-align:center;font-size:13px;border-top:1px solid #2a2a2a}
td:first-child{text-align:left;padding-left:8px;font-weight:800}
.nextBadge{background:#b2ff00;color:#000;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:900;margin-left:6px}
.liveBadge{background:#ff6b00;color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:900;margin-left:6px}
</style></head><body>
<div class="top">MD <span id="topMD">0</span> • S<span id="topSeason">1</span> • BALANCED</div>
<div class="tabPill"><div id="tabLive" class="tab active liveActive" onclick="switchTab('live')">Live <span id="liveCount" class="liveBadge" style="display:none">LIVE</span></div><div id="tabNext" class="tab" onclick="switchTab('next')">Next Match <span class="nextBadge">BET OPEN</span></div><div id="tabResults" class="tab" onclick="switchTab('results')">Results</div></div>
<div id="liveSec"><div style="padding:0 14px;color:#aaa;font-size:12px;display:flex;justify-content:space-between"><span id="phaseInfo">BETTING</span><span id="timerTop" style="color:#ff6b00;font-weight:900;font-size:16px">02:00</span></div><div id="list">Loading...</div><div class="tableWrap"><h3>🏆 Table S<span id="tblSeason">1</span> MD <span id="tblMD">0</span>/15</h3><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding-left:8px">Team</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>Pts</th></tr></thead><tbody id="tableBody"></tbody></table></div></div>
<div id="nextSec" style="display:none"><div style="padding:12px;color:#fff;text-align:center;background:#1a2a1a;margin:0 12px;border-radius:10px;border:1px solid #b2ff00">🔥 Next MD <span id="nextMD">3</span> - BET NOW while Live is ON! Next in <span id="nextCountdown" style="color:#b2ff00">--:--</span></div><div id="nextList"></div></div>
<div id="resultsSec" style="display:none"><div style="padding:12px;color:#888;text-align:center">Previous Results</div><div id="resList">No results</div></div>
<div class="bar" onclick="openS()"><span>🎫 Betslip x2.00 • MD <span id="betMD">0</span></span><span id="lc" style="background:#000;color:#b2ff00;padding:6px 14px;border-radius:20px">0 legs</span></div>
<div class="sheet" id="sheet"><h3 style="color:gold;margin:0">Betslip - <span id="sc">0</span> legs • MD <span id="slMD">0</span></h3><div>Odd: <b id="odd">x0</b> • Pot: <b id="pot" style="color:#0f0">0</b></div><div style="font-size:11px;color:#aaa;margin:4px 0">Usable: <span id="usableBal">0</span> (Game + Invest)</div><div id="sl"></div><input id="amt" type="number" value="500" style="width:100%;padding:14px;background:#111;color:#fff;border:1px solid gold;border-radius:10px;margin:10px 0"><button onclick="place()" style="width:100%;padding:16px;background:gold;border:none;border-radius:12px;font-weight:900">Place Bet x<span id="ob">0</span></button><button onclick="closeS()" style="width:100%;padding:12px;background:#2a2a2a;color:#fff;border:none;border-radius:10px;margin-top:10px">Close</button></div>
<script>
let sel=[];let curPhase='betting';let curTab='live';let lastScores={};let currentBetMD=0;let userTotal=0;
function fmtDown(s){if(s<0)s=0;let m=Math.floor(s/60).toString().padStart(2,'0');let sec=(s%60).toString().padStart(2,'0');return m+":"+sec;}
function fmtUp(el){let m=Math.floor(el/60).toString().padStart(2,'0');let sec=(el%60).toString().padStart(2,'0');return m+":"+sec;}
function switchTab(t){curTab=t;document.querySelectorAll('.tab').forEach(x=>{x.classList.remove('active');x.classList.remove('liveActive');});let el=document.getElementById('tab'+t.charAt(0).toUpperCase()+t.slice(1));el.classList.add('active');if(t==='live')el.classList.add('liveActive');document.getElementById('liveSec').style.display=t==='live'?'block':'none';document.getElementById('nextSec').style.display=t==='next'?'block':'none';document.getElementById('resultsSec').style.display=t==='results'?'block':'none';if(t==='results')loadResults();if(t==='next'){sel=[];rend();currentBetMD=parseInt(topMD.textContent)+1;}else if(t==='live'){sel=[];rend();}}
function tog(id,hn,an,hs,as,p,md){let ex=sel.findIndex(s=>s.matchId===id);if(ex!==-1){if(sel[ex].prediction===p)sel.splice(ex,1);else sel[ex].prediction=p;}else{if(sel.length>=8){alert("Max 8");return;}if(sel.length>0 && sel[0].md!==md){alert("One MD at a time! Clear first");return;}sel.push({matchId:id,homeTeam:hn,awayTeam:an,homeShort:hs,awayShort:as,prediction:p,md:md});}currentBetMD=md;rend();}
function rend(){
document.querySelectorAll('.odd').forEach(b=>b.classList.remove('sel'));
sel.forEach(s=>{let el=document.querySelector('[data-m="'+s.matchId+'"][data-p="'+s.prediction+'"]');if(el)el.classList.add('sel');});
sc.textContent=sel.length;lc.textContent=sel.length+" legs";let o=sel.length?Math.pow(2,sel.length):0;if(sel.length===8)o=256;odd.textContent='x'+o;ob.textContent=o;let a=parseInt(amt.value)||0;pot.textContent=Math.floor(a*o).toLocaleString()+" UGX";betMD.textContent=currentBetMD||topMD.textContent;slMD.textContent=currentBetMD||topMD.textContent;
sl.innerHTML=sel.map(s=>'<div style="background:#2a2a2a;padding:10px;margin:5px 0;border-radius:8px;display:flex;justify-content:space-between"><span>MD'+s.md+' '+s.homeShort+'-'+s.awayShort+' → '+s.prediction.toUpperCase()+' @2.00</span><span style="color:red;cursor:pointer" onclick="remSel('+s.matchId+')">✕</span></div>').join('')||'<small style=color:#888>Tap 1 X 2</small>';
}
function remSel(id){sel=sel.filter(s=>s.matchId!==id);if(sel.length===0)currentBetMD=0;rend();}
function openS(){sheet.style.display='block';loadBal();}function closeS(){sheet.style.display='none';}
async function loadBal(){try{let r=await fetch("/api/user/"+localStorage.getItem("uid"));let u=await r.json();userTotal=(u.gameBalance||0)+(u.balance||0);usableBal.textContent=userTotal.toLocaleString()+" UGX";}catch(e){}}
amt.addEventListener('input',rend);
async function place(){
if(sel.length<1)return alert("Add 1 leg!");
let a=parseInt(amt.value);if(a<200)return alert("Min 200");
if(a>userTotal)return alert("Not enough! Total="+userTotal);
try{
let r=await fetch("/api/virtual/bet/acca",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:localStorage.getItem("uid"),amount:a,selections:sel.map(s=>({matchId:s.matchId,homeTeam:s.homeTeam,awayTeam:s.awayTeam,prediction:s.prediction,md:s.md})),betMD:currentBetMD})});
let j=await r.json();if(j.ok){alert("Bet placed MD"+j.md+" x"+j.odd);sel=[];currentBetMD=0;rend();closeS();}else alert(j.error);
}catch(e){alert(e.message);}
}
function renderTable(tableData, tbodyId){let sorted=Object.values(tableData).sort((a,b)=>{if(b.pts!==a.pts)return b.pts-a.pts;let gdA=a.gf-a.ga;let gdB=b.gf-b.ga;if(gdB!==gdA)return gdB-gdA;return b.gf-a.gf;});let html='';sorted.forEach((t,i)=>{let c=i<4?'color:#0f0':i>12?'color:#f55':'';html+='<tr style="'+c+'"><td><span style="color:#666;margin-right:4px">'+(i+1)+'</span>'+t.short+'</td><td>'+t.pld+'</td><td>'+t.w+'</td><td>'+t.d+'</td><td>'+t.l+'</td><td>'+t.gf+'</td><td>'+t.ga+'</td><td style="font-weight:900;color:gold">'+t.pts+'</td></tr>';});document.getElementById(tbodyId).innerHTML=html||'<tr><td colspan="8" style="color:#666">No data</td></tr>';}
function renderLive(fix,phase,timeLeft,md){
let h='';fix.forEach(m=>{
let isGoal=false;if(lastScores[m.id] && lastScores[m.id]!==m.score)isGoal=true;lastScores[m.id]=m.score;
let tag='';if(phase==='first_half'){let el=45-timeLeft;let disp=fmtUp(el);tag='<span class="liveTag fh">1ST '+disp+' • <b>'+m.score+'</b> '+(isGoal?'⚽':'')+'</span>';}
else if(phase==='halftime'){let disp="00:0"+timeLeft;tag='<span class="liveTag ht">HT '+disp+' • <b>'+m.score+'</b></span>';}
else if(phase==='second_half'){let total=45+(45-timeLeft);let disp=fmtUp(total);tag='<span class="liveTag sh">2ND '+disp+' • <b>'+m.score+'</b> '+(isGoal?'⚽':'')+'</span>';}
else{tag='<span style="color:#555;font-size:11px">MD'+md+' BETTING</span>';}
let disabled=phase!=='betting'?' style="opacity:0.5;pointer-events:none"':'';
h+='<div class="match '+(isGoal?'goal':'')+'" '+disabled+'><div style="display:flex;justify-content:space-between"><span style="font-weight:800">'+m.home.short+' - '+m.away.short+'</span>'+tag+'</div><div class=row style="margin-top:10px"><div class="odd" data-m="'+m.id+'" data-p="home" onclick="tog('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','home',"+md+')"><span>1</span><span>2.00</span></div><div class="odd" data-m="'+m.id+'" data-p="draw" onclick="tog('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','draw',"+md+')"><span>X</span><span>2.00</span></div><div class="odd" data-m="'+m.id+'" data-p="away" onclick="tog('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','away',"+md+')"><span>2</span><span>2.00</span></div></div></div>';
});
document.getElementById('list').innerHTML=h;rend();
}
function renderNext(fix,md){let h='';fix.forEach(m=>{h+='<div class=match><div style="display:flex;justify-content:space-between"><span style="font-weight:800">'+m.home.short+' - '+m.away.short+'</span><span style="color:#b2ff00;font-size:11px;font-weight:900">MD '+md+' • BET OPEN</span></div><div class=row style="margin-top:10px"><div class="odd" data-m="'+m.id+'" data-p="home" onclick="tog('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','home',"+md+')"><span>1</span><span>2.00</span></div><div class="odd" data-m="'+m.id+'" data-p="draw" onclick="tog('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','draw',"+md+')"><span>X</span><span>2.00</span></div><div class="odd" data-m="'+m.id+'" data-p="away" onclick="tog('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','away',"+md+')"><span>2</span><span>2.00</span></div></div></div>';});document.getElementById('nextList').innerHTML=h;}
async function loadResults(){try{let r=await fetch("/api/virtual/results");let d=await r.json();if(!d.length){resList.innerHTML='<div style="padding:30px;text-align:center;color:#666">No results</div>';return;}let h='';d.forEach(md=>{h+='<div class=resCard><div style="display:flex;justify-content:space-between;font-weight:900;color:gold;margin-bottom:8px"><span>S'+md.season+' MD '+String(md.matchday).padStart(2,'0')+'</span><span style="color:#888;font-size:12px">'+md.time+'</span></div>';md.fixtures.forEach(f=>{h+='<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2a2a2a"><span>'+f.home.short+' vs '+f.away.short+'</span><b>'+f.score+'</b><span style="color:'+(f.result==='home'?'#0f0':f.result==='away'?'#f00':'#ff0')+'">'+f.result.toUpperCase()+'</span></div>';});h+='</div>';});resList.innerHTML=h;}catch(e){}}
async function sync(){
try{
let r=await fetch("/api/virtual/status");let d=await r.json();
topMD.textContent=String(d.matchday).padStart(2,'0');topSeason.textContent=d.season;tblMD.textContent=d.matchday;tblSeason.textContent=d.season;
curPhase=d.phase;let tl=d.timeLeft;let disp="";let label="";
if(d.phase==='betting'){disp=fmtDown(tl);label='BETTING MD'+d.matchday+' - '+disp;liveCount.style.display='none';}
else if(d.phase==='first_half'){disp=fmtUp(45-tl);label='🔴 LIVE 1ST '+disp;liveCount.style.display='inline';}
else if(d.phase==='halftime'){disp="00:0"+tl;label='⏸️ HT '+disp;liveCount.style.display='inline';}
else{let total=45+(45-tl);disp=fmtUp(total);label='🔴 LIVE 2ND '+disp;liveCount.style.display='inline';}
phaseInfo.textContent=label;timerTop.textContent=disp;
let nextIn=d.phase==='betting'?d.timeLeft+95:d.phase==='first_half'?50+d.timeLeft:d.phase==='halftime'?45+d.timeLeft:d.timeLeft;
nextCountdown.textContent=fmtDown(nextIn);nextMD.textContent=d.nextMD;
if(curTab==='live'){let fix=d.phase==='betting'?d.currentFixtures:d.allLive;renderLive(fix,d.phase,tl,d.matchday);}
renderNext(d.nextFixtures,d.nextMD);
renderTable(d.table,'tableBody');
if(currentBetMD===0)currentBetMD=d.phase==='betting'?d.matchday:d.nextMD;
}catch(e){}
}
sync();setInterval(sync,1000);
</script></body></html>`,
deposit:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BG}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><div class="top">DEPOSIT</div><a href="/dashboard" style="color:gold;margin-top:60px;display:inline-block">← Back</a><h2>Deposit</h2><input id="am" placeholder="Amount"><input id="air" placeholder="Airtel"><input type="file" id="file"><button onclick="dep()">Submit</button><script>let uid=localStorage.getItem("uid");let b64="";file.addEventListener("change",e=>{let r=new FileReader();r.onload=()=>{b64=r.result};r.readAsDataURL(e.target.files[0])});async function dep(){let r=await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:am.value,airtelNo:air.value,screenshot:b64})});let j=await r.json();if(j.ok)location.href="/dashboard"}</script></body></html>`,
history:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BG}.card{background:#1a1f2e;border:1px solid gold;padding:14px;margin:8px 0;border-radius:12px;display:flex;justify-content:space-between}a{color:gold}</style></head><body><div class="top">HISTORY</div><div style="margin-top:60px"><a href="/dashboard">← Back</a><h2>History</h2><div id="list">Loading...</div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/history/"+uid);let d=await r.json();let h="";for(let t of d){h+="<div class=card><span>"+t.type+" "+(t.amount||0)+" x"+(t.odd||'')+"</span><span>"+(t.status||'')+" MD"+(t.matchday||'')+"</span></div>";}document.getElementById('list').innerHTML=h||"No data";}load()</script></body></html>`,
referral:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BG}.card{padding:15px;border-radius:12px;margin:10px 0;text-align:center}button{width:100%;padding:12px;border-radius:8px;border:none;background:gold;font-weight:bold;margin:5px 0}input{width:100%;padding:12px;border-radius:8px;border:none;background:#111;color:#fff;text-align:center}a{color:gold}</style></head><body><div class="top">TEAM</div><div style="margin-top:60px"><a href="/dashboard">Back</a><h2>My Team</h2><div class="card glass"><h3>Code: <span id="code">---</span></h3><input id="link" readonly><button onclick="copy()">Copy</button></div><div id="team"></div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/team/"+uid);let j=await r.json();code.textContent=j.code;link.value=location.origin+"/?ref="+j.code;let html="";for(let t of j.team){html+="<div class=card glass style=text-align:left>"+t.phone+"</div>"}team.innerHTML=html||"No team";}function copy(){link.select();document.execCommand("copy");alert("Copied!")}load()</script></body></html>`,
admin:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}input,button{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:none}button{background:gold;font-weight:bold}.card{background:#111;padding:12px;margin:8px 0;border-radius:10px;border-left:4px solid gold}</style></head><body><div id="loginBox"><h2>Admin</h2><input id="pass" type="password" placeholder="LIFELINE123"><button onclick="check()">Unlock</button></div><div id="adminBox" style="display:none"><h2>S<span id="sAdmin">1</span> MD <span id="mdAdmin">1</span> → Next <span id="nAdmin">2</span></h2><button onclick="resetMD()" style="background:red;color:#fff">RESET</button><div id="l">Loading...</div></div><script>const AP="LIFELINE123";let en="";function check(){if(pass.value===AP){en=pass.value;loginBox.style.display="none";adminBox.style.display="block";loadVirt();}}async function loadVirt(){let r=await fetch("/api/admin/virtual?key="+en);let d=await r.json();mdAdmin.textContent=d.currentMD||0;sAdmin.textContent=d.season||1;nAdmin.textContent=d.nextMD||0;l.innerHTML=(d.accas||[]).slice(0,20).map(a=>"<div class=card>MD"+a.matchday+" "+a.phone+" x"+(a.odd||0)+" "+a.amount+" "+a.status+"</div>").join('');}async function resetMD(){if(confirm("Reset?")){await fetch("/api/admin/reset-md?key="+en,{method:"POST"});alert("Reset!");loadVirt();}}</script></body></html>`
};
function render(n,res){res.send(pages[n]);}
app.get('/',(req,res)=>render('home',res));
app.get('/dashboard',(req,res)=>render('dash',res));
app.get('/deposit',(req,res)=>render('deposit',res));
app.get('/invest',(req,res)=>render('invest',res));
app.get('/referral',(req,res)=>render('referral',res));
app.get('/history',(req,res)=>render('history',res));
app.get('/virtual',(req,res)=>render('virtual',res));
app.get('/admin',(req,res)=>render('admin',res));
app.get('/api/virtual/status',(req,res)=>{
res.json({season,matchday:matchday+1,nextMD:(matchday+1)%15+1,phase:virtualPhase,timeLeft:virtualTimeLeft,currentFixtures: virtualPhase==='betting'?currentFixtures:[],allLive:liveFixtures,nextFixtures:nextFixtures,table:leagueTable});
});
app.get('/api/virtual/results',(req,res)=>{res.json(pastResults);});
app.get('/api/investments/:id',async(req,res)=>{try{const[rows]=await db.query("SELECT * FROM investments WHERE userId=? ORDER BY id DESC",[req.params.id]);res.json(rows);}catch(e){res.json([]);}});
app.post('/api/virtual/bet/acca',async(req,res)=>{
try{
const{userId,amount,selections,betMD}=req.body;
if(!selections||selections.length<1)return res.status(400).json({error:"Select 1!"});
if(parseInt(amount)<200)return res.status(400).json({error:"Min 200"});
const[u]=await db.query("SELECT balance, gameBalance FROM users WHERE id=?",[userId]);
if(!u.length)return res.status(400).json({error:"User not found"});
let totalBal=(u[0].balance||0)+(u[0].gameBalance||0);
if(totalBal<amount)return res.status(400).json({error:"Not enough! Total=" +totalBal});
let remain=parseInt(amount);
let gameBal=u[0].gameBalance||0;
let useGame=Math.min(gameBal,remain);
let useMain=remain-useGame;
if(useGame>0)await db.query("UPDATE users SET gameBalance=gameBalance-? WHERE id=?",[useGame,userId]);
if(useMain>0)await db.query("UPDATE users SET balance=balance-? WHERE id=?",[useMain,userId]);
let targetMD=betMD|| (virtualPhase==='betting'? matchday+1 : (matchday+2>15?1:matchday+2));
let targetSeason=season;
if(targetMD===1 && matchday+1>=15)targetSeason=season+1;
let odd=Math.pow(2,selections.length);if(selections.length===8)odd=256;
await db.query("INSERT INTO virtual_accas (userId,season,matchday,selections,amount,odd) VALUES (?,?,?,?,?,?)",[userId,targetSeason,targetMD,JSON.stringify(selections),parseInt(amount),odd]);
res.json({ok:1,odd,md:targetMD});
}catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/register',async(req,res)=>{try{const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase();await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy,balance,gameBalance) VALUES (?,?,?,?,?,0,0)",[req.body.name,req.body.phone,req.body.password,code,req.body.ref||null]);const[r]=await db.query("SELECT * FROM users WHERE phone=? ORDER BY id DESC LIMIT 1",[req.body.phone]);res.json(r[0]);}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/login',async(req,res)=>{try{const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]);if(r.length)res.json(r[0]);else res.status(401).json({error:"Wrong"});}catch(e){res.status(401).json({error:"Wrong"})}});
app.get('/api/user/:id',async(req,res)=>{try{const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]);if(!u.length)return res.json({balance:0,gameBalance:0});res.json({...u[0]});}catch(e){res.json({balance:0,gameBalance:0});}});
app.post('/api/deposit',async(req,res)=>{try{const{userId,amount,airtelNo,screenshot}=req.body;const[u]=await db.query("SELECT phone FROM users WHERE id=?",[userId]);await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot) VALUES (?,?,?,?,?)",[userId,u[0]?u[0].phone:"",parseInt(amount),airtelNo,screenshot]);res.json({ok:1});}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/invest',async(req,res)=>{try{const{userId,club,amount}=req.body;if(amount<2000)return res.status(400).json({error:"Min 2000"});const[u]=await db.query("SELECT balance FROM users WHERE id=?",[userId]);if(!u[0]||u[0].balance<amount)return res.status(400).json({error:"No invest wallet"});await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]);let rate=CLUBS.find(c=>c.id===club)?.rate||10;let lock=CLUBS.find(c=>c.id===club)?.lock||10;await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,rate,lock]);res.json({ok:1});}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/history/:id',async(req,res)=>{try{const uid=req.params.id;const[deps]=await db.query("SELECT id,amount,status,createdAt,'deposit' as type,0 as odd,0 as matchday FROM deposits WHERE userId=?",[uid]);const[accas]=await db.query("SELECT id,amount,status,createdAt,'acca' as type,odd,matchday FROM virtual_accas WHERE userId=?",[uid]);const[invs]=await db.query("SELECT id,amount,status,createdAt,'invest' as type,0 as odd,0 as matchday FROM investments WHERE userId=?",[uid]);let all=[...deps,...accas,...invs].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));res.json(all);}catch(e){res.json([])}});
app.get('/api/team/:id',async(req,res)=>{try{const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]);const[team]=await db.query("SELECT phone FROM users WHERE referredBy=?",[u[0].myReferralCode]);res.json({code:u[0].myReferralCode,team});}catch(e){res.json({team:[]})}});
app.get('/api/admin/virtual',async(req,res)=>{if(req.query.key!==ADMIN_KEY)return res.status(401).json({});try{const[r2]=await db.query("SELECT a.*, u.phone FROM virtual_accas a JOIN users u ON a.userId=u.id ORDER BY a.id DESC LIMIT 100");res.json({accas:r2,currentMD:matchday+1,nextMD:(matchday+1)%15+1,season,table:leagueTable});}catch(e){res.json({accas:[],currentMD:matchday+1,nextMD:2,season});}});
app.post('/api/admin/reset-md',async(req,res)=>{if(req.query.key!==ADMIN_KEY)return res.status(401).json({});matchday=0;season=1;seasonSchedule=generateSeasonSchedule();currentFixtures=getFixturesFor(matchday);nextFixtures=getFixturesFor(matchday+1);virtualPhase='betting';virtualTimeLeft=120;liveFixtures=null;pastResults=[];initTable();res.json({ok:1});});
app.post('/api/admin/migrate-invest',async(req,res)=>{if(req.query.key!==ADMIN_KEY)return res.status(401).json({});try{let [r1]=await db.query("UPDATE investments SET rate=10, lockDays=10 WHERE club IN ('arsenal','mancity','liverpool')");let [r2]=await db.query("UPDATE investments SET rate=8, lockDays=8 WHERE club IN ('chelsea','manutd','tottenham')");res.json({ok:1,updated:(r1.affectedRows||0)+(r2.affectedRows||0)});}catch(e){res.status(500).json({error:e.message});}});
app.listen(process.env.PORT||3000,()=>console.log("CLEAN: No mention of reduced 0-0"));
