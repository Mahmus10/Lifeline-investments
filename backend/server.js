const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
let db;
const ADMIN_KEY="LIFELINE123";

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
  for(let i=0;i<8;i++){ let home=shuffled[i*2]; let away=shuffled[i*2+1]; fixtures.push({id:Date.now()+i*1000+Math.floor(Math.random()*9999), home, away, homeScore:0, awayScore:0, minute:0, events:[`0' KO ${home.short} vs ${away.short}`], targetResult:null, result:null}); }
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
    let totalsByMatch={}; fixtures.forEach(f=> totalsByMatch[f.id]={home:0,draw:0,away:0});
    if(db){
      try{ const [singleBets]=await db.query("SELECT matchId, prediction, SUM(amount) as total FROM virtual_bets WHERE status='pending' GROUP BY matchId, prediction"); for(let b of singleBets){ if(totalsByMatch[b.matchId]) totalsByMatch[b.matchId][b.prediction]+=parseInt(b.total)||0; } }catch(e){}
      try{ const [accaRows]=await db.query("SELECT amount, selections FROM virtual_accas WHERE status='pending' AND season=? AND matchday=?",[season, matchday]); for(let row of accaRows){ try{ let sels=JSON.parse(row.selections); let stake=parseInt(row.amount)||0; for(let s of sels){ if(totalsByMatch[s.matchId]) totalsByMatch[s.matchId][s.prediction]+=stake; } }catch(e){} } }catch(e){}
    }
    for(let f of fixtures){
      let t=totalsByMatch[f.id]||{home:0,draw:0,away:0}; let sum=t.home+t.draw+t.away; let res;
      if(sum===0){ res=randomResult(); }
      else{ let houseWin=Math.random()<0.75; if(houseWin){ let min=Math.min(t.home||0,t.draw||0,t.away||0); let maxVal=Math.max(t.home,t.draw,t.away); let most=Object.keys(t).find(k=>t[k]===maxVal); let cands=Object.keys(t).filter(k=>t[k]===min); let filt=cands.filter(k=>k!==most); res=filt[0]||cands[0]||'draw'; } else { let maxVal=Math.max(t.home,t.draw,t.away); res=Object.keys(t).find(k=>t[k]===maxVal)||'home'; } }
      results.push(res);
    }
    return results;
  }catch(e){ return fixtures.map(()=>randomResult()); }
}
async function settleMatchday(fixtures){
  for(let m of fixtures){
    let res=m.targetResult||m.result;
    if(res==='draw'){ if(m.homeScore!==m.awayScore){ let g=Math.min(Math.max(m.homeScore,m.awayScore),2); if(m.homeScore+m.awayScore===0) g=Math.random()<0.6?0:1; m.homeScore=g; m.awayScore=g; } }
    else if(res==='home' && m.homeScore<=m.awayScore) m.homeScore=m.awayScore+1;
    else if(res==='away' && m.awayScore<=m.homeScore) m.awayScore=m.homeScore+1;
    while(m.homeScore+m.awayScore>7){ if(m.homeScore>m.awayScore) m.homeScore--; else m.awayScore--; }
    m.result=res;
    let h=leagueTable[m.home.name]; let a=leagueTable[m.away.name]; if(!h||!a) continue;
    h.P++; a.P++; h.GF+=m.homeScore; h.GA+=m.awayScore; a.GF+=m.awayScore; a.GA+=m.homeScore; h.GD=h.GF-h.GA; a.GD=a.GF-a.GA;
    if(res==='home'){ h.W++; h.Pts+=3; a.L++; } else if(res==='away'){ a.W++; a.Pts+=3; h.L++; } else { h.D++; a.D++; h.Pts+=1; a.Pts+=1; }
  }
  try{
    if(db){
      for(let f of fixtures){ const [bets]=await db.query("SELECT * FROM virtual_bets WHERE matchId=? AND status='pending'",[f.id]); for(let bet of bets){ if(bet.prediction===f.result){ let win=bet.amount*2; await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win, bet.userId]); await db.query("UPDATE virtual_bets SET status='won', winAmount=? WHERE id=?",[win, bet.id]); } else await db.query("UPDATE virtual_bets SET status='lost', winAmount=0 WHERE id=?",[bet.id]); } }
      const [accas]=await db.query("SELECT * FROM virtual_accas WHERE season=? AND matchday=? AND status='pending'",[season, matchday]);
      for(let acca of accas){ let sels=JSON.parse(acca.selections); let allWin=true; for(let sel of sels){ let found=fixtures.find(f=> f.id===sel.matchId); if(!found || found.result!==sel.prediction){ allWin=false; break; } } if(allWin){ let win=Math.floor(acca.amount*acca.odd); await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win, acca.userId]); await db.query("UPDATE virtual_accas SET status='won', winAmount=? WHERE id=?",[win, acca.id]); } else await db.query("UPDATE virtual_accas SET status='lost', winAmount=0 WHERE id=?",[acca.id]); }
    }
  }catch(e){}
  matchday++; if(matchday>30){ season++; matchday=1; initTable(); }
  nextFixtures=genMatchday();
}
setInterval(async()=>{
 try{
  virtualTimeLeft--;
  if(virtualPhase==='betting'){ if(virtualTimeLeft<=0){ let targets=await decideAllResults(nextFixtures); liveFixtures=nextFixtures.map((f,i)=>{ return {...f, homeScore:0, awayScore:0, minute:0, targetResult:targets[i], events:[`0' KO ${f.home.short} vs ${f.away.short}`]}; }); nextFixtures=[]; virtualPhase='live1'; virtualTimeLeft=180; minuteTimer=0; } }
  else if(virtualPhase==='live1'){ minuteTimer++; if(minuteTimer>=4){ minuteTimer=0; liveFixtures.forEach(m=>{ m.minute++; if(Math.random()<0.035 && m.homeScore+m.awayScore<7){ let st=null; if(m.targetResult==='home' && m.homeScore<=m.awayScore) st='home'; else if(m.targetResult==='away' && m.awayScore<=m.homeScore) st='away'; else if(m.targetResult==='draw' && m.homeScore===0 && m.awayScore===0 && Math.random()<0.7) st=null; else if(m.targetResult==='draw' && m.homeScore>m.awayScore) st='away'; else if(m.targetResult==='draw' && m.awayScore>m.homeScore) st='home'; else st=Math.random()<0.5?'home':'away'; if(st){ let team=m[st]; let pl=team.players[Math.floor(Math.random()*team.players.length)]; if(st==='home'){ m.homeScore++; m.events.unshift(`${m.minute}' ${pl} (${m.home.short}) ${m.homeScore}-${m.awayScore}`);} else { m.awayScore++; m.events.unshift(`${m.minute}' ${pl} (${m.away.short}) ${m.homeScore}-${m.awayScore}`);} } } }); } if(virtualTimeLeft<=0){ virtualPhase='halftime'; virtualTimeLeft=60; liveFixtures.forEach(m=>{ m.minute=45; m.events.unshift(`45' HT ${m.homeScore}-${m.awayScore}`); }); } }
  else if(virtualPhase==='halftime'){ virtualTimeLeft--; if(virtualTimeLeft<=0){ virtualPhase='live2'; virtualTimeLeft=180; minuteTimer=0; liveFixtures.forEach(m=>m.events.unshift(`46' 2nd half`)); } }
  else if(virtualPhase==='live2'){ minuteTimer++; if(minuteTimer>=4){ minuteTimer=0; liveFixtures.forEach(m=>{ m.minute++; if(Math.random()<0.045 && m.homeScore+m.awayScore<7){ if(m.minute>=83){ if(m.targetResult==='home' && m.homeScore<=m.awayScore){ m.homeScore=m.awayScore+1; let pl=m.home.players[Math.floor(Math.random()*m.home.players.length)]; m.events.unshift(`${m.minute}' WINNER ${pl}`);} else if(m.targetResult==='away' && m.awayScore<=m.homeScore){ m.awayScore=m.homeScore+1; let pl=m.away.players[Math.floor(Math.random()*m.away.players.length)]; m.events.unshift(`${m.minute}' WINNER ${pl}`);} else if(m.targetResult==='draw' && m.homeScore!==m.awayScore && m.homeScore+m.awayScore<7){ if(m.homeScore>m.awayScore){ m.awayScore=m.homeScore; m.events.unshift(`${m.minute}' EQUALIZER`);} else { m.homeScore=m.awayScore; m.events.unshift(`${m.minute}' EQUALIZER`);} } } else { if(m.targetResult==='home' && Math.random()<0.55){ let pl=m.home.players[Math.floor(Math.random()*m.home.players.length)]; m.homeScore++; m.events.unshift(`${m.minute}' ${pl} ${m.homeScore}-${m.awayScore}`);} else if(m.targetResult==='away' && Math.random()<0.55){ let pl=m.away.players[Math.floor(Math.random()*m.away.players.length)]; m.awayScore++; m.events.unshift(`${m.minute}' ${pl} ${m.homeScore}-${m.awayScore}`);} } } }); } if(virtualTimeLeft<=0){ await settleMatchday(liveFixtures); virtualPhase='betting'; virtualTimeLeft=240; liveFixtures=null; } }
 }catch(e){}
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
  console.log("FIXED READY");
 }catch(e){ console.log("DB init error, running in memory mode", e.message); }
}
init();
app.get('/icon.svg',(req,res)=>{ res.set('Content-Type','image/svg+xml'); res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="120" fill="#000"/><circle cx="256" cy="256" r="190" fill="none" stroke="#FFD700" stroke-width="2"/></svg>`);});
app.get('/manifest.json',(req,res)=>{ res.json({name:"Lifeline",short_name:"Lifeline",start_url:"/",display:"standalone",background_color:"#080a0f",theme_color:"#FFD700",icons:[{src:"/icon.svg", sizes:"512x512"}]})});
app.get('/sw.js',(req,res)=>{ res.set('Content-Type','application/javascript'); res.send(`self.addEventListener('install',e=>self.skipWaiting());`);});
app.get('/api/crypto',(req,res)=>{ res.json({btc:"$67,450"}); });
app.get('/api/virtual/status',(req,res)=>{
  if(!liveFixtures && (!nextFixtures || nextFixtures.length===0)){ nextFixtures=genMatchday(); virtualPhase='betting'; virtualTimeLeft=240; }
  let tableArr=Object.values(leagueTable).sort((a,b)=> b.Pts-a.Pts || b.GD-a.GD);
  res.json({season, matchday, phase:virtualPhase, timeLeft:virtualTimeLeft, current:liveFixtures?liveFixtures[0]:null, allLive:liveFixtures, next:nextFixtures[0]||null, nextAll:nextFixtures||[], table:tableArr});
});
app.get('/api/virtual/mybets/:id',async(req,res)=>{ try{ const [r]=await db.query("SELECT * FROM virtual_bets WHERE userId=? ORDER BY id DESC LIMIT 20",[req.params.id]); res.json(r); }catch(e){res.json([])} });
app.get('/api/virtual/myaccas/:id',async(req,res)=>{ try{ const [r]=await db.query("SELECT * FROM virtual_accas WHERE userId=? ORDER BY id DESC LIMIT 20",[req.params.id]); res.json(r.map(x=>{ try{ return {...x, selections: JSON.parse(x.selections)} }catch{ return x; } })); }catch(e){res.json([])} });
app.post('/api/virtual/bet',async(req,res)=>{ try{ const {userId, prediction, amount}=req.body; if(parseInt(amount)<200) return res.status(400).json({error:"Min 200"}); if(!db) return res.status(400).json({error:"DB not ready"}); const [u]=await db.query("SELECT gameBalance FROM users WHERE id=?",[userId]); if(!u.length || u[0].gameBalance < amount) return res.status(400).json({error:"No Game Wallet"}); let fid, ht, at; if(virtualPhase==='betting'){ fid=nextFixtures[0]?.id; ht=nextFixtures[0].home.name; at=nextFixtures[0].away.name; } else if(virtualPhase==='halftime'){ fid=liveFixtures[0]?.id; ht=liveFixtures[0].home.name; at=liveFixtures[0].away.name; } else return res.status(400).json({error:"Betting pre-match & halftime only"}); await db.query("UPDATE users SET gameBalance=gameBalance-? WHERE id=?",[parseInt(amount), userId]); await db.query("INSERT INTO virtual_bets (userId,matchId,homeTeam,awayTeam,prediction,amount) VALUES (?,?,?,?,?,?)",[userId, fid, ht, at, prediction, parseInt(amount)]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
app.post('/api/virtual/bet/acca',async(req,res)=>{
 try{
  const {userId, amount, selections}=req.body;
  if(!selections || selections.length<1) return res.status(400).json({error:"Select at least 1 match!"});
  if(selections.length>8) return res.status(400).json({error:"Max 8"});
  if(parseInt(amount)<200) return res.status(400).json({error:"Min 200"});
  if(!db) return res.status(400).json({error:"DB not ready, try again"});
  const [u]=await db.query("SELECT gameBalance FROM users WHERE id=?",[userId]);
  if(!u.length || u[0].gameBalance < amount) return res.status(400).json({error:"No Game Wallet"});
  if(virtualPhase!=='betting' && virtualPhase!=='halftime') return res.status(400).json({error:"Betting only pre-match & halftime"});
  let odd=Math.pow(2, selections.length);
  if(selections.length>=4) odd*=1.2; if(selections.length>=6) odd*=1.5; if(selections.length===8) odd=256; if(selections.length===1) odd=2;
  await db.query("UPDATE users SET gameBalance=gameBalance-? WHERE id=?",[parseInt(amount), userId]);
  await db.query("INSERT INTO virtual_accas (userId,season,matchday,selections,amount,odd) VALUES (?,?,?,?,?,?)",[userId, season, matchday, JSON.stringify(selections), parseInt(amount), odd]);
  res.json({ok:1, odd, potential: Math.floor(parseInt(amount)*odd)});
 }catch(e){ res.status(400).json({error:e.message}) }
});
app.post('/api/register',async(req,res)=>{ try{ const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase(); await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy,balance,gameBalance) VALUES (?,?,?,?,?,0,0)",[req.body.name,req.body.phone,req.body.password,code,req.body.ref||null]); const[r]=await db.query("SELECT * FROM users WHERE phone=? ORDER BY id DESC LIMIT 1",[req.body.phone]); res.json(r[0]); }catch(e){res.status(400).json({error:e.message})} });
app.post('/api/login',async(req,res)=>{ try{ const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]); if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"}); }catch(e){ res.status(401).json({error:"Wrong"}) } });
app.get('/api/user/:id',async(req,res)=>{ try{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); if(!u.length) return res.json({balance:0,gameBalance:0,miningBalance:0,totalInterest:0,investments:[]}); const[inv]=await db.query("SELECT * FROM investments WHERE userId=? ORDER BY id DESC",[req.params.id]); let total=0; let now=new Date(); for(let i of inv){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24)); if(d<0)d=0; let rate=i.rate||10; total+=Math.floor((i.amount||0)*rate/100*d);} const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.params.id]); let avail=total-w[0].s; if(avail<0)avail=0; const[depSum]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM deposits WHERE userId=? AND status='approved'",[req.params.id]); let vip='BRONZE'; let vipRate='8%'; if(depSum[0].s>=100000){vip='GOLD'; vipRate='12%'} else if(depSum[0].s>=20000){vip='SILVER'; vipRate='10%'} const[spinCheck]=await db.query("SELECT * FROM spins WHERE userId=? AND DATE(createdAt)=CURDATE()",[req.params.id]); const[mining]=await db.query("SELECT * FROM mining WHERE userId=? ORDER BY id DESC LIMIT 1",[req.params.id]); let miningEarn=0; if(mining.length && mining[0].isMining){ let mins=Math.floor((now-new Date(mining[0].lastClaim))/(1000*60)); miningEarn=mins*2; } res.json({...u[0], totalInterest:avail, investments:inv, totalDep:depSum[0].s, vip, vipRate, hasSpunToday: spinCheck.length>0, investCount: inv.length, miningPending: miningEarn, isMining: mining.length?mining[0].isMining:0}); }catch(e){ res.json({balance:0,gameBalance:0,totalInterest:0,investments:[], vip:'BRONZE', vipRate:'8%', hasSpunToday:false, investCount:0, miningPending:0, isMining:0}); } });
app.get('/api/team/:id',async(req,res)=>{ try{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); if(!u.length) return res.json({team:[]}); const[team]=await db.query("SELECT phone,fullName FROM users WHERE referredBy=?",[u[0].myReferralCode]); res.json({code:u[0].myReferralCode, bonus:u[0].referralBonus||0, count:team.length, team:team}); }catch(e){res.json({team:[]})} });
app.post('/api/spin',async(req,res)=>{ try{ const uid=req.body.userId; const[inv]=await db.query("SELECT COUNT(*) as c FROM investments WHERE userId=?",[uid]); if(inv[0].c===0) return res.status(400).json({error:"Invest first!"}); const[last]=await db.query("SELECT * FROM spins WHERE userId=? AND DATE(createdAt)=CURDATE()",[uid]); if(last.length) return res.status(400).json({error:"Already spun"}); const prizes=[0,100,200,300,500,1000,2000,100]; let weights=[20,25,20,15,10,5,2,23]; let rand=Math.random()*100; let cum=0; let win=100; for(let i=0;i<prizes.length;i++){ cum+=weights[i]; if(rand<=cum){ win=prizes[i]; break; } } await db.query("INSERT INTO spins (userId,amount) VALUES (?,?)",[uid,win]); if(win>0) await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win,uid]); res.json({win}); }catch(e){ res.status(400).json({error:e.message}) } });
app.post('/api/mining/start',async(req,res)=>{ try{ const uid=req.body.userId; const[m]=await db.query("SELECT * FROM mining WHERE userId=?",[uid]); if(m.length){ await db.query("UPDATE mining SET isMining=1, lastClaim=NOW() WHERE userId=?",[uid]); } else { await db.query("INSERT INTO mining (userId,earned,isMining) VALUES (?,0,1)",[uid]); } res.json({ok:1}); }catch(e){res.json({ok:1})} });
app.post('/api/mining/claim',async(req,res)=>{ try{ const uid=req.body.userId; const[m]=await db.query("SELECT * FROM mining WHERE userId=?",[uid]); if(!m.length) return res.json({earned:0}); let now=new Date(); let mins=Math.floor((now-new Date(m[0].lastClaim))/(1000*60)); let earn=mins*2; if(earn<=0) return res.json({earned:0}); await db.query("UPDATE mining SET lastClaim=NOW(), earned=earned+? WHERE userId=?",[earn,uid]); await db.query("UPDATE users SET miningBalance=miningBalance+?, gameBalance=gameBalance+? WHERE id=?",[earn,earn,uid]); res.json({earned:earn}); }catch(e){res.json({earned:0})} });
app.post('/api/deposit',async(req,res)=>{ try{ const {userId, amount, airtelNo, screenshot} = req.body; if(!screenshot || screenshot.length < 100) return res.status(400).json({error:"Upload proof!"}); const[u]=await db.query("SELECT phone FROM users WHERE id=?",[userId]); await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot) VALUES (?,?,?,?,?)",[userId, u[0]?u[0].phone:"", parseInt(amount), airtelNo, screenshot]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
app.post('/api/invest',async(req,res)=>{ try{ const{userId,club,amount}=req.body; if(amount<2000) return res.status(400).json({error:"Min 2000"}); const[u]=await db.query("SELECT balance FROM users WHERE id=?",[userId]); if(!u[0] || u[0].balance<amount) return res.status(400).json({error:"No balance"}); await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]); await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,10,10]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
app.get('/api/history/:id',async(req,res)=>{ try{ const uid=req.params.id; const[deps]=await db.query("SELECT id,amount,status,createdAt,'deposit' as type FROM deposits WHERE userId=?",[uid]); const[vbets]=await db.query("SELECT id,amount,status,createdAt,'virtual' as type FROM virtual_bets WHERE userId=?",[uid]); const[accas]=await db.query("SELECT id,amount,status,createdAt,'acca' as type FROM virtual_accas WHERE userId=?",[uid]); let all=[...deps,...vbets,...accas].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)); res.json(all); }catch(e){res.json([])} });
app.post('/api/withdraw',async(req,res)=>{ try{ const[inv]=await db.query("SELECT * FROM investments WHERE userId=?",[req.body.userId]); let total=0; let now=new Date(); for(let i of inv){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24)); let rate=i.rate||10; total+=Math.floor((i.amount||0)*rate/100*d);} const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.body.userId]); let avail=total-w[0].s; if(req.body.amount>avail) return res.status(400).json({error:"Only "+avail+" available"}); if(req.body.amount<5000) return res.status(400).json({error:"Min 5000"}); await db.query("INSERT INTO withdrawals (userId,amount,type) VALUES (?,?,'interest')",[req.body.userId,req.body.amount]); res.json({ok:1}); }catch(e){res.status(400).json({error:e.message})} });
app.get('/api/admin/deposits',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC"); res.json(r); });
app.post('/api/admin/approve/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); const[d]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]); if(!d.length) return res.json({}); await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]); await db.query("UPDATE users SET balance=balance+? WHERE id=?",[d[0].amount,d[0].userId]); res.json({ok:1}); });
app.get('/api/admin/virtual',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT v.*, u.phone FROM virtual_bets v JOIN users u ON v.userId=u.id ORDER BY v.id DESC LIMIT 100"); const[r2]=await db.query("SELECT a.*, u.phone FROM virtual_accas a JOIN users u ON a.userId=u.id ORDER BY a.id DESC LIMIT 100"); res.json({singles:r, accas:r2}); });

const PWA_HEAD = `<link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#000"><link rel="icon" href="/icon.svg">`;
const FIELD_BG_CSS = `body{background:#080a0f;color:#fff;font-family:Arial;padding:12px;padding-bottom:90px}body::before{content:'';position:fixed;inset:-20px;z-index:-3;background-image:linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.7)),url('https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200&q=80');background-size:110% 110%;background-position:center}.glass{background:rgba(18,22,35,0.85);backdrop-filter:blur(16px);border:1px solid rgba(255,215,0,0.15)}.field-logo-top{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(0,0,0,0.7);border:1px solid gold;padding:6px 18px;border-radius:30px;color:gold;font-size:11px;font-weight:bold}`;

const pages = {
home: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:12px;border:none}button{background:gold;font-weight:bold}.card{padding:20px;border-radius:20px}</style></head><body><div class="field-logo-top">16 TEAMS • ACCA 1-8 x256</div><div class="card glass" style="margin-top:60px"><h2>💎 Lifeline Hybrid</h2><input id="n" placeholder="Full Name"><input id="p" placeholder="Phone"><input id="pw" type="password" placeholder="Password"><input id="cpw" type="password" placeholder="Confirm"><button onclick="reg()">Register</button><button onclick="log()" style="background:#222;color:#fff">Login</button></div><script>
async function reg(){ if(pw.value!==cpw.value){alert("No match");return;} let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value})}); let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert(j.error)}
async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert("Wrong")}</script></body></html>`,
dash: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>
${FIELD_BG_CSS}
.bal{padding:22px;border-radius:24px;text-align:center}
.vip{padding:6px 14px;border-radius:20px;font-weight:bold;font-size:11px;display:inline-block;margin:5px}.vip-bronze{background:#cd7f32}
.walletGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.walletCard{padding:14px;border-radius:16px;text-align:left}
.money-card{padding:14px;border-radius:16px;margin:12px 0;display:flex;align-items:center;gap:12px}
button{width:100%;padding:14px;margin:7px 0;border-radius:12px;border:none;font-weight:bold}.gold{background:gold;color:#000}.dark{background:rgba(20,25,35,0.9);color:#fff;border:1px solid rgba(255,255,255,0.1)}
#wheelModal{position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:300;display:none;align-items:center;justify-content:center;padding:20px;flex-direction:column}
#wheelCanvas{border-radius:50%;box-shadow:0 0 40px gold;border:6px solid gold;max-width:90vw}
.virtCard{background:linear-gradient(135deg,#1a0033,#000033);border:2px solid #ff00cc;padding:16px;border-radius:18px;margin:12px 0}
.liveMini{background:#111;padding:5px 8px;border-radius:6px;margin:3px 0;font-size:10px;display:flex;justify-content:space-between}
</style></head><body>
<div class="field-logo-top" id="topInfo">S1 MD1 • 16 TEAMS • ACCA 1-8</div>
<div id="wheelModal"><canvas id="wheelCanvas" width="340" height="340"></canvas><button id="doSpinBtn" onclick="doSpin()" class="gold" style="max-width:340px">SPIN NOW</button><button onclick="closeWheel()" style="background:#333;color:#fff;max-width:340px">Close</button></div>
<div class="bal glass" style="margin-top:60px">
<div class="walletGrid"><div class="walletCard glass"><h4>GAME</h4><h2 id="gb">0</h2></div><div class="walletCard glass"><h4>INVEST</h4><h2 id="b">0</h2></div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="glass" style="padding:8px;border-radius:12px;text-align:center"><small>INTEREST LIVE</small><br><span id="int" style="color:#00ff88;font-weight:bold">0</span></div><div class="glass" style="padding:8px;border-radius:12px;text-align:center"><small>MINING</small><br><span id="mineBal" style="color:#ff00cc;font-weight:bold">0</span></div></div>
<p id="ph"></p>
</div>
<div class="virtCard" onclick="location.href='/virtual'"><div style="display:flex;justify-content:space-between"><b style="color:#ff00cc">🔥 VIRTUAL 16 TEAMS ACCA 1-8</b><span id="virtPhase" style="background:#00ff88;color:#000;padding:4px 10px;border-radius:20px;font-size:10px">BETTING</span></div><div id="virtPreview" style="margin-top:10px">Loading...</div><div id="otherMatchesPreview"></div><div style="text-align:center">⏱️ <span id="virtTimer">--:--</span> • Tap to bet 1-8 matches →</div></div>
<button class="gold" onclick="openWheel()">Spin Wheel</button><button class="dark" onclick="location.href='/deposit'">Deposit</button><button class="dark" onclick="location.href='/invest'">Invest</button><button class="dark" onclick="location.href='/virtual'">Play ACCA Virtual</button><button class="dark" onclick="location.href='/referral'">My Team</button>
<script>
let uid=localStorage.getItem("uid");if(!uid)location.href="/";
let baseInt=0; let secRate=0;
function openWheel(){ document.getElementById('wheelModal').style.display='flex'; }
function closeWheel(){ document.getElementById('wheelModal').style.display='none'; }
async function doSpin(){ let r=await fetch("/api/spin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid})}); let j=await r.json(); alert(j.win!==undefined? "Won "+j.win : j.error); closeWheel(); load(); }
async function load(){ try{ let r=await fetch("/api/user/"+uid);let u=await r.json(); document.getElementById('b').textContent=(u.balance||0).toLocaleString(); document.getElementById('gb').textContent=(u.gameBalance||0).toLocaleString(); document.getElementById('mineBal').textContent=(u.miningBalance||0).toLocaleString(); document.getElementById('ph').textContent=u.phone||""; baseInt=u.totalInterest||0; document.getElementById('int').textContent=baseInt.toLocaleString(); }catch(e){} }
async function loadVirtualPreview(){
 try{
  let r=await fetch("/api/virtual/status"); let d=await r.json();
  document.getElementById('virtPhase').textContent=d.phase.toUpperCase();
  document.getElementById('virtTimer').textContent=Math.floor(d.timeLeft/60)+":"+String(d.timeLeft%60).padStart(2,'0');
  document.getElementById('topInfo').textContent='S'+d.season+' MD'+d.matchday+' • 16 TEAMS • ACCA 1-8 x256';
  if(d.phase==='betting'){
    document.getElementById('virtPreview').innerHTML="NEXT MD"+d.matchday+": <b>"+d.next.home.short+" vs "+d.next.away.short+" + "+(d.nextAll.length-1)+" more</b><br><small>Bet 1 team x2 or 8 teams x256</small>";
  } else {
    let f=d.current; if(f) document.getElementById('virtPreview').innerHTML="🔴 LIVE "+f.home.short+" "+f.homeScore+"-"+f.awayScore+" "+f.away.short+" "+f.minute+"'";
  }
  let others=(d.allLive||d.nextAll||[]).slice(0,3).map(m=>'<div class=liveMini><span>'+m.home.short+' vs '+m.away.short+'</span><span>'+m.homeScore+'-'+m.awayScore+'</span></div>').join(''); document.getElementById('otherMatchesPreview').innerHTML=others;
 }catch(e){ document.getElementById('virtPreview').innerHTML="Loading..."; }
}
load(); setInterval(loadVirtualPreview,1000); loadVirtualPreview();
</script></body></html>`,
virtual: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>
${FIELD_BG_CSS}
.liveBox{background:radial-gradient(circle at center,#1a0033,#000);border:2px solid #ff00cc;border-radius:20px;padding:18px;margin:12px 0;text-align:center;position:relative;min-height:120px}
.score{font-size:32px;font-weight:900;color:#fff}
.phase{position:absolute;top:10px;left:12px;padding:4px 10px;border-radius:20px;font-size:9px;font-weight:bold}
.betting{background:#00ff88;color:#000}.live{background:red;color:#fff}.ht{background:orange;color:#000}
.timer{position:absolute;top:10px;right:12px;background:#ff00cc;color:#fff;padding:4px 10px;border-radius:20px;font-size:10px}
.matchCard{background:#151a28;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:10px;margin:8px 0}
.betBtn{padding:8px 4px;border-radius:8px;border:none;font-weight:900;font-size:11px;width:31%;margin:1px;cursor:pointer}
.home{background:#00ff88;color:#000}.draw{background:gold;color:#000}.away{background:#0088ff;color:#fff}
.betBtn.sel{outline:2px solid #fff;transform:scale(1.05);box-shadow:0 0 10px gold}
.accaTicket{position:sticky;bottom:10px;background:linear-gradient(180deg,#1a0033,#000);border:2px solid gold;border-radius:16px;padding:12px;margin:12px 0;z-index:10}
.table{max-height:300px;overflow-y:auto;background:rgba(0,0,0,0.5);border-radius:10px;padding:6px;margin:8px 0}
.row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:10px}
</style></head><body>
<div class="field-logo-top" id="top">ACCA 1-8 • 16 TEAMS • x256</div>
<div style="margin-top:60px"><a href="/dashboard" style="color:gold">← Back</a>
<h2 style="color:#ff00cc">🔥 ACCA BET - 1 to 8 Matches!</h2>
<p style="font-size:11px;color:#aaa">Bet 1 match x2 • 2 matches x4 • 8 matches x256 • Season infinity • Live odds</p>
<div class="liveBox" id="featBox">Loading fixtures... please wait</div>
<div id="allMatchesBet"></div>
<div class="accaTicket" id="ticket">
<h3 style="margin:0;color:gold">🎫 ACCA Ticket - <span id="selCount">0</span> matches selected</h3>
<div style="font-size:11px">Odd: <b id="odd" style="color:#ff00cc">x0</b> • Potential: <b id="pot" style="color:#00ff88">0 UGX</b></div>
<div id="selList" style="max-height:100px;overflow-y:auto;margin:6px 0;font-size:10px;color:#fff"></div>
<input id="accaAmt" type="number" value="500" style="width:100%;padding:10px;border-radius:8px;border:1px solid gold;background:#111;color:#fff;margin:6px 0">
<button onclick="placeAcca()" style="width:100%;padding:12px;background:linear-gradient(90deg,gold,#ff8c00);border:none;border-radius:10px;font-weight:bold;color:#000">Place Bet (1-8 matches) - Win x256!</button>
<button onclick="clearAcca()" style="width:100%;padding:6px;background:#222;color:#fff;border:none;border-radius:8px;margin-top:4px;font-size:11px">Clear Ticket</button>
<p style="font-size:9px;color:#aaa">Game Wallet: <span id="gBal">0</span> UGX • You can bet 1 team alone or 8 teams</p>
</div>
<h3>📊 Table 16 Teams</h3><div class="table" id="table"></div>
<h3>🎫 My ACCA Bets</h3><div id="myAccas"></div>
</div>
<script>
let uid=localStorage.getItem("uid");
let selections=[];
let FALLBACK_FIXTURES=[
  {id:1, home:{name:'Arsenal',short:'ARS',players:['Saka']}, away:{name:'Man City',short:'MCI',players:['Haaland']}, homeScore:0, awayScore:0, minute:0, events:[]},
  {id:2, home:{name:'Liverpool',short:'LIV',players:['Salah']}, away:{name:'Chelsea',short:'CHE',players:['Palmer']}, homeScore:0, awayScore:0, minute:0, events:[]},
  {id:3, home:{name:'Man Utd',short:'MUN',players:['Rashford']}, away:{name:'Newcastle',short:'NEW',players:['Isak']}, homeScore:0, awayScore:0, minute:0, events:[]},
  {id:4, home:{name:'Aston Villa',short:'AVL',players:['Watkins']}, away:{name:'Tottenham',short:'TOT',players:['Son']}, homeScore:0, awayScore:0, minute:0, events:[]},
  {id:5, home:{name:'Brighton',short:'BHA',players:['Mitoma']}, away:{name:'West Ham',short:'WHU',players:['Bowen']}, homeScore:0, awayScore:0, minute:0, events:[]},
  {id:6, home:{name:'Crystal Palace',short:'CRY',players:['Eze']}, away:{name:'Fulham',short:'FUL',players:['Jimenez']}, homeScore:0, awayScore:0, minute:0, events:[]},
  {id:7, home:{name:'Brentford',short:'BRE',players:['Toney']}, away:{name:'Everton',short:'EVE',players:['Calvert-Lewin']}, homeScore:0, awayScore:0, minute:0, events:[]},
  {id:8, home:{name:'Wolves',short:'WOL',players:['Cunha']}, away:{name:'Nottm Forest',short:'NFO',players:['Wood']}, homeScore:0, awayScore:0, minute:0, events:[]},
];
function toggleSel(matchId, homeTeam, awayTeam, homeShort, awayShort, pred){
  let ex=selections.findIndex(s=>s.matchId===matchId);
  if(ex!==-1){ if(selections[ex].prediction===pred){ selections.splice(ex,1); } else { selections[ex].prediction=pred; } }
  else { if(selections.length>=8){ alert("Max 8 matches x256"); return; } selections.push({matchId, homeTeam, awayTeam, homeShort, awayShort, prediction:pred}); }
  document.querySelectorAll('[data-match="'+matchId+'"]').forEach(b=>b.classList.remove('sel'));
  let sel=selections.find(s=>s.matchId===matchId); if(sel){ let el=document.querySelector('[data-match="'+matchId+'"][data-pred="'+sel.prediction+'"]'); if(el) el.classList.add('sel'); }
  updateTicket();
}
function updateTicket(){
  document.getElementById('selCount').textContent=selections.length;
  let odd=0; if(selections.length===1) odd=2; else if(selections.length>1){ odd=Math.pow(2,selections.length); if(selections.length>=4) odd*=1.2; if(selections.length>=6) odd*=1.5; if(selections.length===8) odd=256; }
  document.getElementById('odd').textContent='x'+odd.toFixed(1);
  let amt=parseInt(document.getElementById('accaAmt').value)||0; document.getElementById('pot').textContent=Math.floor(amt*odd).toLocaleString()+' UGX';
  let list=selections.map(s=>'<div style="display:flex;justify-content:space-between;background:rgba(255,215,0,0.1);padding:4px;border-radius:4px;margin:2px 0"><span>'+s.homeShort+' vs '+s.awayShort+'</span><span style="color:gold">'+s.prediction.toUpperCase()+'</span><span style="color:red;cursor:pointer" onclick="removeSel('+s.matchId+')">✕</span></div>').join(''); document.getElementById('selList').innerHTML=list||'<small style=color:#888>Select 1 to 8 matches - 1 team x2, 8 teams x256</small>';
}
function removeSel(mid){ selections=selections.filter(s=>s.matchId!==mid); document.querySelectorAll('[data-match="'+mid+'"]').forEach(b=>b.classList.remove('sel')); updateTicket(); }
function clearAcca(){ selections=[]; document.querySelectorAll('.betBtn').forEach(b=>b.classList.remove('sel')); updateTicket(); }
document.getElementById('accaAmt').addEventListener('input',updateTicket);
async function placeAcca(){
  if(selections.length<1) return alert("Select at least 1 match! 1 team = x2");
  let amt=parseInt(document.getElementById('accaAmt').value); if(amt<200) return alert("Min 200");
  try{
    let r=await fetch("/api/virtual/bet/acca",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid, amount:amt, selections: selections.map(s=>({matchId:s.matchId, homeTeam:s.homeTeam, awayTeam:s.awayTeam, prediction:s.prediction}))})});
    let j=await r.json(); if(j.ok){ alert("ACCA placed! "+selections.length+" matches Odd x"+j.odd.toFixed(1)+" Win "+j.potential.toLocaleString()+" UGX"); clearAcca(); loadAccas(); } else alert(j.error||"Failed");
  }catch(e){ alert("Error: "+e.message); }
}
function renderFixtures(fixtures, phase, season, matchday, timeLeft){
  let box=document.getElementById('featBox');
  let tl=Math.floor(timeLeft/60)+":"+String(timeLeft%60).padStart(2,'0');
  if(phase==='betting'){
    box.innerHTML='<span class="phase betting">BETTING '+tl+'</span><span class=timer>'+tl+'</span><div style="margin-top:24px"><div class=score>MD'+matchday+' - 8 MATCHES</div><small>Season '+season+' • Bet 1 team x2 or 8 teams x256<br>Live Premier League</small></div>';
  } else {
    let f=fixtures[0]; if(!f) return; box.innerHTML='<span class="phase '+(phase==='halftime'?'ht':'live')+'">'+(phase==='halftime'?'HT 45\\'':'LIVE '+f.minute+"'")+' '+tl+'</span><span class=timer>'+tl+'</span><div style="margin-top:24px"><div class=score>'+f.home.short+' '+f.homeScore+'-'+f.awayScore+' '+f.away.short+'</div><small>'+(f.events && f.events[0]?f.events[0]:'')+'</small></div>';
  }
  let html=''; fixtures.forEach(m=>{
    html+='<div class=matchCard><div style="display:flex;justify-content:space-between;font-weight:bold"><span>'+m.home.short+' vs '+m.away.short+'</span><span style="font-size:9px">MD'+matchday+'</span></div><div style="font-size:10px;color:#aaa;margin:4px 0">'+m.home.name+' vs '+m.away.name+' '+(m.homeScore!==undefined?' - '+m.homeScore+'-'+m.awayScore+' '+m.minute+"'" :'')+'</div><div style="display:flex"><button class="betBtn home" data-match="'+m.id+'" data-pred="home" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','home')\">"+m.home.short+' x2</button><button class="betBtn draw" data-match="'+m.id+'" data-pred="draw" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','draw')\">DRAW x2</button><button class="betBtn away" data-match="'+m.id+'" data-pred="away" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','away')\">"+m.away.short+' x2</button></div></div>';
  });
  document.getElementById('allMatchesBet').innerHTML=html;
  selections.forEach(s=>{ let el=document.querySelector('[data-match="'+s.matchId+'"][data-pred="'+s.prediction+'"]'); if(el) el.classList.add('sel'); });
}
async function loadS(){
 try{
  let r=await fetch("/api/virtual/status");
  if(!r.ok) throw new Error("Server error");
  let d=await r.json();
  document.getElementById('top').textContent='S'+d.season+' MD'+d.matchday+' • 1-8 MATCHES • x256';
  let fixtures = d.phase==='betting'? (d.nextAll && d.nextAll.length? d.nextAll : FALLBACK_FIXTURES) : (d.allLive && d.allLive.length? d.allLive : FALLBACK_FIXTURES);
  renderFixtures(fixtures, d.phase, d.season, d.matchday, d.timeLeft);
  let tb=''; (d.table||[]).forEach((t,i)=>{ tb+='<div class=row><span>'+(i+1)+'. '+t.short+'</span><span>'+t.P+' '+t.W+' '+t.D+' '+t.L+' '+t.GF+'-'+t.GA+' <b style=color:gold>'+t.Pts+'</b></span></div>'; }); document.getElementById('table').innerHTML=tb||'<div class=row>Loading table...</div>';
 }catch(e){
  console.log("fallback", e.message);
  renderFixtures(FALLBACK_FIXTURES, 'betting', 1, 1, 240);
  document.getElementById('table').innerHTML='<div class=row>Table loading...</div>';
 }
}
async function loadAccas(){ try{ let r=await fetch("/api/virtual/myaccas/"+uid); let d=await r.json(); let h=d.map(a=>{ let sels=a.selections||[]; let c=a.status==='won'?'#0f0':a.status==='lost'?'red':'gold'; return '<div style="background:#111;padding:8px;border-radius:8px;margin:4px 0;border-left:3px solid '+c+';font-size:10px"><b>'+sels.length+' matches x'+(a.odd||0).toFixed(1)+'</b> '+a.amount+' => '+a.status.toUpperCase()+' '+(a.winAmount||0)+'</div>'; }).join(''); document.getElementById('myAccas').innerHTML=h||'No bets yet - select 1 to 8 matches!'; let ru=await fetch("/api/user/"+uid); let u=await ru.json(); document.getElementById('gBal').textContent=(u.gameBalance||0).toLocaleString(); }catch(e){} }
setInterval(loadS,1000); loadS(); loadAccas(); setInterval(loadAccas,5000);
</script></body></html>`,
deposit: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><div class="field-logo-top">DEPOSIT</div><a href="/dashboard" style="color:gold;margin-top:60px;display:inline-block">← Back</a><h2>Deposit</h2><input id="am" placeholder="Amount"><input id="air" placeholder="Airtel"><input type="file" id="file"><button onclick="dep()">Submit</button><script>let uid=localStorage.getItem("uid");let b64=""; file.addEventListener("change",e=>{let r=new FileReader();r.onload=()=>{b64=r.result};r.readAsDataURL(e.target.files[0])});async function dep(){let r=await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:am.value,airtelNo:air.value,screenshot:b64})});let j=await r.json();if(j.ok)location.href="/dashboard";else alert(j.error)}</script></body></html>`,
invest: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold}</style></head><body><div class="field-logo-top">INVEST</div><a href="/dashboard" style="color:gold;margin-top:60px;display:inline-block">← Back</a><h2>Invest</h2><p>Bal: <b id="bal">0</b></p><input id="a" placeholder="Amount"><button onclick="inv()">Invest Arsenal</button><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/user/"+uid);let u=await r.json();bal.textContent=u.balance;}async function inv(){let r=await fetch("/api/invest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,club:'arsenal',amount:parseInt(a.value)})});let j=await r.json();if(j.ok)location.href="/dashboard";else alert(j.error)}load()</script></body></html>`,
history: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.card{background:#1a1f2e;border:1px solid gold;padding:14px;margin:8px 0;border-radius:12px;display:flex;justify-content:space-between}a{color:gold}</style></head><body><div class="field-logo-top">HISTORY</div><div style="margin-top:60px"><a href="/dashboard">← Back</a><h2>History</h2><div id="list">Loading...</div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/history/"+uid);let d=await r.json();let h="";for(let t of d){h+="<div class=card><span>"+t.type+" "+(t.amount||0)+"</span><span>"+(t.status||'')+"</span></div>";}document.getElementById('list').innerHTML=h||"No data";}load()</script></body></html>`,
referral: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.card{padding:15px;border-radius:12px;margin:10px 0;text-align:center}button{width:100%;padding:12px;border-radius:8px;border:none;background:gold;font-weight:bold;margin:5px 0}input{width:100%;padding:12px;border-radius:8px;border:none;background:#111;color:#fff;text-align:center}a{color:gold}</style></head><body><div class="field-logo-top">TEAM</div><div style="margin-top:60px"><a href="/dashboard">Back</a><h2>My Team</h2><div class="card glass"><h3>Code: <span id="code">---</span></h3><input id="link" readonly><button onclick="copy()">Copy</button></div><div id="team"></div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/team/"+uid);let j=await r.json();code.textContent=j.code;link.value=location.origin+"/?ref="+j.code;let html="";for(let t of j.team){html+="<div class=card glass style=text-align:left>"+t.phone+"</div>"}team.innerHTML=html||"No team";}function copy(){link.select();document.execCommand("copy");alert("Copied!")}load()</script></body></html>`,
admin: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}input,button{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:none}button{background:gold;font-weight:bold}.tab{padding:10px;background:#222;display:inline-block;margin:5px;border-radius:5px;cursor:pointer}.active{background:gold;color:#000}</style></head><body><div id="loginBox"><h2>Admin</h2><input id="pass" type="password"><button onclick="check()">Unlock</button></div><div id="adminBox" style="display:none"><h2>ADMIN 75%</h2><div><span class="tab active" onclick="showTab('dep')">Deposits</span><span class="tab" onclick="showTab('virt')">Virtual</span></div><div id="depBox"><div id="l">Loading</div></div><div id="virtBox" style="display:none"><div id="lvirt"></div></div></div><script>
const AP="LIFELINE123";let en="";function check(){if(pass.value===AP){en=pass.value;loginBox.style.display="none";adminBox.style.display="block";ld()}}
function showTab(t){depBox.style.display=t==='dep'?'block':'none';virtBox.style.display=t==='virt'?'block':'none';if(t==='dep')ld();if(t==='virt')loadVirt()}
async function ld(){let r=await fetch("/api/admin/deposits?key="+en);let d=await r.json();document.getElementById('l').innerHTML=d.map(x=>"<div style=background:#222;padding:12px;margin:10px 0><b>"+x.phone+"</b> "+x.amount+"<button onclick=ap("+x.id+")>Approve</button></div>").join('')||"No pending"}
async function ap(id){await fetch("/api/admin/approve/"+id+"?key="+en,{method:"POST"});ld()}
async function loadVirt(){let r=await fetch("/api/admin/virtual?key="+en);let d=await r.json();let acc=d.accas||[]; let singles=d.singles||[]; let sum={won:0,lost:0}; for(let b of [...acc,...singles]){ if(b.status==='won') sum.won+=b.winAmount; else if(b.status==='lost') sum.lost+=b.amount; } let profit=sum.lost-sum.won; document.getElementById('lvirt').innerHTML="<div style=background:#111;padding:12px;border:1px solid gold>Profit: "+profit+" UGX<br>Singles: "+singles.length+" ACCAs: "+acc.length+"</div>"+acc.slice(0,20).map(a=>"<div style=background:#222;margin:3px;padding:5px;font-size:11px>"+a.phone+" ACCA "+(a.selections?JSON.parse(a.selections).length:a.odd)+" x"+a.odd+" "+a.amount+"</div>").join('');}
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
app.listen(process.env.PORT||3000,()=>console.log("FINAL FIXED - NO MAX 7 TEXT, 1-8 ALLOWED, FALLBACK FIXTURES"));
