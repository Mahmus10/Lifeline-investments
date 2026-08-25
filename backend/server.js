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
  for(let i=0;i<8;i++){ let home=shuffled[i*2]; let away=shuffled[i*2+1]; fixtures.push({id:Date.now()+i*1000+Math.floor(Math.random()*999), home, away, homeScore:0, awayScore:0, minute:0, events:[], targetResult:null, result:null}); }
  return fixtures;
}
let nextFixtures=genMatchday();
let liveFixtures=null;
let virtualPhase='betting';
let virtualTimeLeft=240;
let minuteTimer=0;
function randomResult(){ let r=Math.random(); return r<0.38?'home': r<0.64?'draw':'away'; }

// FIXED - SAFE 75% HOUSE EDGE FOR ALL MATCHES
async function decideAllResults(fixtures){
  let results=[];
  try{
    if(!db) return fixtures.map(()=>randomResult());
    let totalsByMatch={};
    fixtures.forEach(f=> totalsByMatch[f.id]={home:0,draw:0,away:0});
    try{
      const [singleBets]=await db.query("SELECT matchId, prediction, SUM(amount) as total FROM virtual_bets WHERE status='pending' GROUP BY matchId, prediction");
      for(let b of singleBets){ if(totalsByMatch[b.matchId]) totalsByMatch[b.matchId][b.prediction]+=parseInt(b.total)||0; }
    }catch(e){}
    try{
      const [accaRows]=await db.query("SELECT amount, selections FROM virtual_accas WHERE status='pending' AND season=? AND matchday=?",[season, matchday]);
      for(let row of accaRows){ try{ let sels=JSON.parse(row.selections); let stake=parseInt(row.amount)||0; for(let s of sels){ if(totalsByMatch[s.matchId]) totalsByMatch[s.matchId][s.prediction]+=stake; } }catch(e){} }
    }catch(e){}
    for(let f of fixtures){
      let t=totalsByMatch[f.id]||{home:0,draw:0,away:0}; let sum=t.home+t.draw+t.away; let res;
      if(sum===0){ res=randomResult(); }
      else{
        let houseWin=Math.random()<0.75;
        if(houseWin){ let min=Math.min(t.home||0,t.draw||0,t.away||0); let maxVal=Math.max(t.home,t.draw,t.away); let most=Object.keys(t).find(k=>t[k]===maxVal); let cands=Object.keys(t).filter(k=>t[k]===min); let filt=cands.filter(k=>k!==most); res=filt[0]||cands[0]||'draw'; if(Math.random()<0.35){ let opts=['home','draw','away'].filter(o=>o!==most); res=opts[Math.floor(Math.random()*opts.length)]; } }
        else { let maxVal=Math.max(t.home,t.draw,t.away); res=Object.keys(t).find(k=>t[k]===maxVal)||'home'; }
      }
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
    let h=leagueTable[m.home.name]; let a=leagueTable[m.away.name];
    if(!h||!a) continue; h.P++; a.P++; h.GF+=m.homeScore; h.GA+=m.awayScore; a.GF+=m.awayScore; a.GA+=m.homeScore; h.GD=h.GF-h.GA; a.GD=a.GF-a.GA;
    if(res==='home'){ h.W++; h.Pts+=3; a.L++; } else if(res==='away'){ a.W++; a.Pts+=3; h.L++; } else { h.D++; a.D++; h.Pts+=1; a.Pts+=1; }
  }
  try{
    for(let f of fixtures){ const [bets]=await db.query("SELECT * FROM virtual_bets WHERE matchId=? AND status='pending'",[f.id]); for(let bet of bets){ if(bet.prediction===f.result){ let win=bet.amount*2; await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win, bet.userId]); await db.query("UPDATE virtual_bets SET status='won', winAmount=? WHERE id=?",[win, bet.id]); } else await db.query("UPDATE virtual_bets SET status='lost', winAmount=0 WHERE id=?",[bet.id]); } }
    const [accas]=await db.query("SELECT * FROM virtual_accas WHERE season=? AND matchday=? AND status='pending'",[season, matchday]);
    for(let acca of accas){ let sels=JSON.parse(acca.selections); let allWin=true; for(let sel of sels){ let found=fixtures.find(f=> f.id===sel.matchId); if(!found || found.result!==sel.prediction){ allWin=false; break; } } if(allWin){ let win=Math.floor(acca.amount*acca.odd); await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win, acca.userId]); await db.query("UPDATE virtual_accas SET status='won', winAmount=? WHERE id=?",[win, acca.id]); } else await db.query("UPDATE virtual_accas SET status='lost', winAmount=0 WHERE id=?",[acca.id]); }
  }catch(e){}
  matchday++; if(matchday>30){ season++; matchday=1; initTable(); } nextFixtures=genMatchday();
}

setInterval(async()=>{
 try{
  virtualTimeLeft--;
  if(virtualPhase==='betting'){ if(virtualTimeLeft<=0){ let targets=await decideAllResults(nextFixtures); liveFixtures=nextFixtures.map((f,i)=>{ return {...f, homeScore:0, awayScore:0, minute:0, targetResult:targets[i], events:[`0' KO ${f.home.short} vs ${f.away.short}`]}; }); nextFixtures=[]; virtualPhase='live1'; virtualTimeLeft=180; minuteTimer=0; } }
  else if(virtualPhase==='live1'){ minuteTimer++; if(minuteTimer>=4){ minuteTimer=0; liveFixtures.forEach(m=>{ m.minute++; if(Math.random()<0.035 && m.homeScore+m.awayScore<7){ let st=null; if(m.targetResult==='home' && m.homeScore<=m.awayScore) st='home'; else if(m.targetResult==='away' && m.awayScore<=m.homeScore) st='away'; else if(m.targetResult==='draw' && m.homeScore===0 && m.awayScore===0 && Math.random()<0.7) st=null; else if(m.targetResult==='draw' && m.homeScore>m.awayScore) st='away'; else if(m.targetResult==='draw' && m.awayScore>m.homeScore) st='home'; else st=Math.random()<0.5?'home':'away'; if(st){ let team=m[st]; let pl=team.players[Math.floor(Math.random()*team.players.length)]; if(st==='home'){ m.homeScore++; m.events.unshift(`${m.minute}' ${pl} (${m.home.short}) ${m.homeScore}-${m.awayScore}`);} else { m.awayScore++; m.events.unshift(`${m.minute}' ${pl} (${m.away.short}) ${m.homeScore}-${m.awayScore}`);} } } }); } if(virtualTimeLeft<=0){ virtualPhase='halftime'; virtualTimeLeft=60; liveFixtures.forEach(m=>{ m.minute=45; m.events.unshift(`45' HT ${m.homeScore}-${m.awayScore}`); }); } }
  else if(virtualPhase==='halftime'){ virtualTimeLeft--; if(virtualTimeLeft<=0){ virtualPhase='live2'; virtualTimeLeft=180; minuteTimer=0; liveFixtures.forEach(m=>m.events.unshift(`46' 2nd half`)); } }
  else if(virtualPhase==='live2'){ minuteTimer++; if(minuteTimer>=4){ minuteTimer=0; liveFixtures.forEach(m=>{ m.minute++; if(Math.random()<0.045 && m.homeScore+m.awayScore<7){ if(m.minute>=83){ if(m.targetResult==='home' && m.homeScore<=m.awayScore){ m.homeScore=m.awayScore+1; let pl=m.home.players[Math.floor(Math.random()*m.home.players.length)]; m.events.unshift(`${m.minute}' WINNER ${pl} ${m.homeScore}-${m.awayScore}`);} else if(m.targetResult==='away' && m.awayScore<=m.homeScore){ m.awayScore=m.homeScore+1; let pl=m.away.players[Math.floor(Math.random()*m.away.players.length)]; m.events.unshift(`${m.minute}' WINNER ${pl} ${m.homeScore}-${m.awayScore}`);} else if(m.targetResult==='draw' && m.homeScore!==m.awayScore && m.homeScore+m.awayScore<7){ if(m.homeScore>m.awayScore){ m.awayScore=m.homeScore; m.events.unshift(`${m.minute}' EQUALIZER`);} else { m.homeScore=m.awayScore; m.events.unshift(`${m.minute}' EQUALIZER`);} } } else { if(m.targetResult==='home' && Math.random()<0.55){ let pl=m.home.players[Math.floor(Math.random()*m.home.players.length)]; m.homeScore++; m.events.unshift(`${m.minute}' ${pl} ${m.homeScore}-${m.awayScore}`);} else if(m.targetResult==='away' && Math.random()<0.55){ let pl=m.away.players[Math.floor(Math.random()*m.away.players.length)]; m.awayScore++; m.events.unshift(`${m.minute}' ${pl} ${m.homeScore}-${m.awayScore}`);} } } }); } if(virtualTimeLeft<=0){ await settleMatchday(liveFixtures); virtualPhase='betting'; virtualTimeLeft=240; liveFixtures=null; } }
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
  await db.query("CREATE TABLE IF NOT EXISTS spins (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount INT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS mining (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, earned INT DEFAULT 0, lastClaim DATETIME DEFAULT CURRENT_TIMESTAMP, isMining TINYINT DEFAULT 0)");
  await db.query("CREATE TABLE IF NOT EXISTS p2p_trades (id INT AUTO_INCREMENT PRIMARY KEY, sellerId INT, club VARCHAR(50), amount INT, price INT, profit INT, status VARCHAR(20) DEFAULT 'open', buyerId INT DEFAULT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS virtual_bets (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, matchId BIGINT, homeTeam VARCHAR(30), awayTeam VARCHAR(30), prediction VARCHAR(10), amount INT, status VARCHAR(20) DEFAULT 'pending', winAmount INT DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS virtual_accas (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, season INT, matchday INT, selections TEXT, amount INT, odd FLOAT, status VARCHAR(20) DEFAULT 'pending', winAmount INT DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  console.log("FIXED 1-8 ACCA READY");
 }catch(e){console.log(e.message)}
}
init();
app.get('/icon.svg',(req,res)=>{ res.set('Content-Type','image/svg+xml'); res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="120" fill="#000"/><circle cx="256" cy="256" r="190" fill="none" stroke="#FFD700" stroke-width="2"/><path d="M150 130 L150 380 Q150 400 170 400 L330 400 Q345 400 335 410 Q315 430 295 430 L170 430 Q130 430 130 390 L130 130 Q130 112 150 130Z" fill="#FFD700"/><path d="M165 375 C 250 355, 310 300, 380 170" fill="none" stroke="#FFD700" stroke-width="8" stroke-linecap="round"/><polygon points="385,145 410,170 360,180" fill="#FFD700"/></svg>`);});
app.get('/manifest.json',(req,res)=>{ res.json({name:"Lifeline Hybrid",short_name:"Lifeline",start_url:"/",display:"standalone",background_color:"#080a0f",theme_color:"#FFD700",icons:[{src:"/icon.svg", sizes:"512x512"}]})});
app.get('/sw.js',(req,res)=>{ res.set('Content-Type','application/javascript'); res.send(`self.addEventListener('install',e=>self.skipWaiting());`);});
app.get('/api/crypto',(req,res)=>{ res.json({btc:"$67,450 +2.3%",usdt:"1.00 UGX 3,750"}); });

// FIXED STATUS - NEVER EMPTY
app.get('/api/virtual/status',(req,res)=>{
  try{
    if(!liveFixtures && (!nextFixtures || nextFixtures.length===0)){ nextFixtures=genMatchday(); virtualPhase='betting'; virtualTimeLeft=240; }
    let tableArr=Object.values(leagueTable).sort((a,b)=> b.Pts-a.Pts || b.GD-a.GD);
    res.json({season, matchday, phase:virtualPhase, timeLeft:virtualTimeLeft, current:liveFixtures?liveFixtures[0]:null, allLive:liveFixtures, next:nextFixtures[0]||null, nextAll:nextFixtures||[], table:tableArr});
  }catch(e){ res.json({season:1, matchday:1, phase:'betting', timeLeft:240, current:null, allLive:null, next:nextFixtures[0], nextAll:nextFixtures, table:[]}); }
});
app.get('/api/virtual/mybets/:id',async(req,res)=>{ try{ const [r]=await db.query("SELECT * FROM virtual_bets WHERE userId=? ORDER BY id DESC LIMIT 20",[req.params.id]); res.json(r); }catch(e){res.json([])} });
app.get('/api/virtual/myaccas/:id',async(req,res)=>{ try{ const [r]=await db.query("SELECT * FROM virtual_accas WHERE userId=? ORDER BY id DESC LIMIT 20",[req.params.id]); res.json(r.map(x=>{ try{ return {...x, selections: JSON.parse(x.selections)} }catch{ return x; } })); }catch(e){res.json([])} });
app.post('/api/virtual/bet',async(req,res)=>{ try{ const {userId, prediction, amount}=req.body; if(parseInt(amount)<200) return res.status(400).json({error:"Min 200"}); const [u]=await db.query("SELECT gameBalance FROM users WHERE id=?",[userId]); if(!u.length || u[0].gameBalance < amount) return res.status(400).json({error:"No Game Wallet"}); let fid, ht, at; if(virtualPhase==='betting'){ fid=nextFixtures[0]?.id; ht=nextFixtures[0].home.name; at=nextFixtures[0].away.name; } else if(virtualPhase==='halftime'){ fid=liveFixtures[0]?.id; ht=liveFixtures[0].home.name; at=liveFixtures[0].away.name; } else return res.status(400).json({error:"Betting pre-match & halftime only"}); await db.query("UPDATE users SET gameBalance=gameBalance-? WHERE id=?",[parseInt(amount), userId]); await db.query("INSERT INTO virtual_bets (userId,matchId,homeTeam,awayTeam,prediction,amount) VALUES (?,?,?,?,?,?)",[userId, fid, ht, at, prediction, parseInt(amount)]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
// FIXED ACCA ALLOWS 1-8 MATCHES
app.post('/api/virtual/bet/acca',async(req,res)=>{
 try{
  const {userId, amount, selections}=req.body;
  if(!selections || selections.length<1) return res.status(400).json({error:"Select at least 1 match!"}); // NOW 1 ALLOWED
  if(selections.length>8) return res.status(400).json({error:"Max 8 matches"});
  if(parseInt(amount)<200) return res.status(400).json({error:"Min 200"});
  const [u]=await db.query("SELECT gameBalance FROM users WHERE id=?",[userId]);
  if(!u.length || u[0].gameBalance < amount) return res.status(400).json({error:"No Game Wallet"});
  if(virtualPhase!=='betting' && virtualPhase!=='halftime') return res.status(400).json({error:"Betting only pre-match & halftime"});
  let odd=Math.pow(2, selections.length);
  if(selections.length>=4) odd*=1.2;
  if(selections.length>=6) odd*=1.5;
  if(selections.length===8) odd=256;
  if(selections.length===1) odd=2; // 1 team alone = x2
  await db.query("UPDATE users SET gameBalance=gameBalance-? WHERE id=?",[parseInt(amount), userId]);
  await db.query("INSERT INTO virtual_accas (userId,season,matchday,selections,amount,odd) VALUES (?,?,?,?,?,?)",[userId, season, matchday, JSON.stringify(selections), parseInt(amount), odd]);
  res.json({ok:1, odd, potential: Math.floor(parseInt(amount)*odd)});
 }catch(e){ res.status(400).json({error:e.message}) }
});
app.post('/api/register',async(req,res)=>{ try{ const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase(); await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy,balance,gameBalance,miningBalance,referralBonus) VALUES (?,?,?,?,?,0,0,0,0)",[req.body.name,req.body.phone,req.body.password,code,req.body.ref||null]); const[r]=await db.query("SELECT * FROM users WHERE phone=? ORDER BY id DESC LIMIT 1",[req.body.phone]); res.json(r[0]); }catch(e){res.status(400).json({error:e.message})} });
app.post('/api/login',async(req,res)=>{ const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]); if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"}); });
app.get('/api/user/:id',async(req,res)=>{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); if(!u.length) return res.json({balance:0,gameBalance:0,miningBalance:0,totalInterest:0,investments:[]}); const[inv]=await db.query("SELECT * FROM investments WHERE userId=? ORDER BY id DESC",[req.params.id]); let total=0; let now=new Date(); for(let i of inv){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24)); if(d<0)d=0; let rate=i.rate||10; total+=Math.floor((i.amount||0)*rate/100*d);} const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.params.id]); let avail=total-w[0].s; if(avail<0)avail=0; const[depSum]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM deposits WHERE userId=? AND status='approved'",[req.params.id]); let vip='BRONZE'; let vipRate='8%'; if(depSum[0].s>=100000){vip='GOLD'; vipRate='12%'} else if(depSum[0].s>=20000){vip='SILVER'; vipRate='10%'} const[spinCheck]=await db.query("SELECT * FROM spins WHERE userId=? AND DATE(createdAt)=CURDATE()",[req.params.id]); const[mining]=await db.query("SELECT * FROM mining WHERE userId=? ORDER BY id DESC LIMIT 1",[req.params.id]); let miningEarn=0; if(mining.length && mining[0].isMining){ let mins=Math.floor((now-new Date(mining[0].lastClaim))/(1000*60)); miningEarn=mins*2; } res.json({...u[0], totalInterest:avail, investments:inv, totalDep:depSum[0].s, vip, vipRate, hasSpunToday: spinCheck.length>0, investCount: inv.length, miningPending: miningEarn, isMining: mining.length?mining[0].isMining:0}); });
app.get('/api/team/:id',async(req,res)=>{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); if(!u.length) return res.json({team:[]}); const[team]=await db.query("SELECT phone,fullName,balance FROM users WHERE referredBy=?",[u[0].myReferralCode]); res.json({code:u[0].myReferralCode, bonus:u[0].referralBonus||0, count:team.length, team:team}); });
app.post('/api/spin',async(req,res)=>{ const uid=req.body.userId; const[inv]=await db.query("SELECT COUNT(*) as c FROM investments WHERE userId=?",[uid]); if(inv[0].c===0) return res.status(400).json({error:"Invest first!"}); const[last]=await db.query("SELECT * FROM spins WHERE userId=? AND DATE(createdAt)=CURDATE()",[uid]); if(last.length) return res.status(400).json({error:"Already spun"}); const prizes=[0,100,200,300,500,1000,2000,100]; let weights=[20,25,20,15,10,5,2,23]; let rand=Math.random()*100; let cum=0; let win=100; for(let i=0;i<prizes.length;i++){ cum+=weights[i]; if(rand<=cum){ win=prizes[i]; break; } } await db.query("INSERT INTO spins (userId,amount) VALUES (?,?)",[uid,win]); if(win>0) await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win,uid]); res.json({win}); });
app.post('/api/mining/start',async(req,res)=>{ const uid=req.body.userId; const[m]=await db.query("SELECT * FROM mining WHERE userId=?",[uid]); if(m.length){ await db.query("UPDATE mining SET isMining=1, lastClaim=NOW() WHERE userId=?",[uid]); } else { await db.query("INSERT INTO mining (userId,earned,isMining) VALUES (?,0,1)",[uid]); } res.json({ok:1}); });
app.post('/api/mining/claim',async(req,res)=>{ const uid=req.body.userId; const[m]=await db.query("SELECT * FROM mining WHERE userId=?",[uid]); if(!m.length) return res.json({earned:0}); let now=new Date(); let mins=Math.floor((now-new Date(m[0].lastClaim))/(1000*60)); let earn=mins*2; if(earn<=0) return res.json({earned:0}); await db.query("UPDATE mining SET lastClaim=NOW(), earned=earned+? WHERE userId=?",[earn,uid]); await db.query("UPDATE users SET miningBalance=miningBalance+?, gameBalance=gameBalance+? WHERE id=?",[earn,earn,uid]); res.json({earned:earn}); });
app.get('/api/p2p/list',async(req,res)=>{ const[r]=await db.query("SELECT p.*, u.phone FROM p2p_trades p JOIN users u ON p.sellerId=u.id WHERE p.status='open' ORDER BY id DESC LIMIT 20"); res.json(r); });
app.post('/api/p2p/create',async(req,res)=>{ const{userId,investId,price}=req.body; const[inv]=await db.query("SELECT * FROM investments WHERE id=? AND userId=?",[investId,userId]); if(!inv.length) return res.status(400).json({error:"Not found"}); await db.query("INSERT INTO p2p_trades (sellerId,club,amount,price,profit) VALUES (?,?,?,?,?)",[userId,inv[0].club,inv[0].amount,price,price-inv[0].amount]); await db.query("UPDATE investments SET status='selling' WHERE id=?",[investId]); res.json({ok:1}); });
app.post('/api/p2p/buy',async(req,res)=>{ const{buyerId,tradeId}=req.body; const[t]=await db.query("SELECT * FROM p2p_trades WHERE id=? AND status='open'",[tradeId]); if(!t.length) return res.status(400).json({error:"Sold"}); const[buyer]=await db.query("SELECT balance FROM users WHERE id=?",[buyerId]); if(buyer[0].balance < t[0].price) return res.status(400).json({error:"No balance"}); await db.query("UPDATE users SET balance=balance-? WHERE id=?",[t[0].price,buyerId]); await db.query("UPDATE users SET balance=balance+? WHERE id=?",[t[0].price*0.95,t[0].sellerId]); await db.query("UPDATE p2p_trades SET status='sold', buyerId=? WHERE id=?",[buyerId,tradeId]); const[inv]=await db.query("SELECT * FROM investments WHERE userId=? AND club=? AND status='selling' LIMIT 1",[t[0].sellerId,t[0].club]); if(inv.length){ await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays,startDate) VALUES (?,?,?,?,?,?)",[buyerId,inv[0].club,inv[0].amount,inv[0].rate,inv[0].lockDays,inv[0].startDate]); } res.json({ok:1}); });
app.get('/api/history/:id',async(req,res)=>{ try{ const uid=req.params.id; const[deps]=await db.query("SELECT id,amount,status,createdAt,'deposit' as type FROM deposits WHERE userId=?",[uid]); const[withs]=await db.query("SELECT id,amount,status,createdAt,'withdraw' as type FROM withdrawals WHERE userId=?",[uid]); const[invs]=await db.query("SELECT id,amount,club as status, startDate as createdAt,'invest' as type FROM investments WHERE userId=?",[uid]); const[spins]=await db.query("SELECT id,amount,createdAt,'profit' as type, 'spin' as status FROM spins WHERE userId=?",[uid]); const[vbets]=await db.query("SELECT id,amount,status,createdAt,'virtual' as type FROM virtual_bets WHERE userId=?",[uid]); const[accas]=await db.query("SELECT id,amount,status,createdAt,'acca' as type FROM virtual_accas WHERE userId=?",[uid]); let all=[...deps,...withs,...invs,...spins,...vbets,...accas].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)); res.json(all); }catch(e){res.json([])} });
app.post('/api/deposit',async(req,res)=>{ try{ const {userId, amount, airtelNo, screenshot} = req.body; if(!screenshot || screenshot.length < 100) return res.status(400).json({error:"Upload proof!"}); if(parseInt(amount) < 2000) return res.status(400).json({error:"Min 2000"}); const [dup] = await db.query("SELECT id FROM deposits WHERE screenshot=? LIMIT 1", [screenshot]); if(dup.length > 0) return res.status(400).json({error:"Screenshot used!"}); const[u]=await db.query("SELECT phone FROM users WHERE id=?",[userId]); await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot) VALUES (?,?,?,?,?)",[userId, u[0]?u[0].phone:"", parseInt(amount), airtelNo, screenshot]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
app.post('/api/invest',async(req,res)=>{ const{userId,club,amount}=req.body; if(amount<2000) return res.status(400).json({error:"Min 2000"}); const[u]=await db.query("SELECT balance FROM users WHERE id=?",[userId]); if(!u[0] || u[0].balance<amount) return res.status(400).json({error:"No balance"}); const rates={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8}; const locks={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8}; await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]); await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,rates[club],locks[club]]); res.json({ok:1}); });
app.post('/api/withdraw',async(req,res)=>{ const[inv]=await db.query("SELECT * FROM investments WHERE userId=?",[req.body.userId]); let total=0; let now=new Date(); for(let i of inv){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24)); let rate=i.rate||10; total+=Math.floor((i.amount||0)*rate/100*d);} const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.body.userId]); let avail=total-w[0].s; if(req.body.amount>avail) return res.status(400).json({error:"Only "+avail+" available"}); if(req.body.amount<5000) return res.status(400).json({error:"Min 5000"}); await db.query("INSERT INTO withdrawals (userId,amount,type) VALUES (?,?,'interest')",[req.body.userId,req.body.amount]); res.json({ok:1}); });
app.post('/api/transfer',async(req,res)=>{ const{userId,from,to,amount}=req.body; if(from==='game' && to==='invest'){ const[u]=await db.query("SELECT gameBalance FROM users WHERE id=?",[userId]); if(u[0].gameBalance < amount) return res.status(400).json({error:"No game balance"}); await db.query("UPDATE users SET gameBalance=gameBalance-?, balance=balance+? WHERE id=?",[amount,amount,userId]); res.json({ok:1}); } else { res.status(400).json({error:"Invalid"}); } });
app.get('/api/admin/users',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT id,phone,fullName,password,balance,gameBalance FROM users ORDER BY id DESC LIMIT 100"); res.json(r); });
app.get('/api/admin/deposits',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC"); res.json(r); });
app.post('/api/admin/approve/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); const[d]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]); if(!d.length) return res.json({}); await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]); await db.query("UPDATE users SET balance=balance+? WHERE id=?",[d[0].amount,d[0].userId]); res.json({ok:1}); });
app.post('/api/admin/reject/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); await db.query("UPDATE deposits SET status='rejected' WHERE id=?",[req.params.id]); res.json({ok:1}); });
app.get('/api/admin/withdraws',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT w.*, u.phone FROM withdrawals w JOIN users u ON w.userId=u.id WHERE w.status='pending' ORDER BY id DESC"); res.json(r); });
app.post('/api/admin/withdraw/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); if(req.body.action==='approve') await db.query("UPDATE withdrawals SET status='approved' WHERE id=?",[req.params.id]); else await db.query("UPDATE withdrawals SET status='rejected' WHERE id=?",[req.params.id]); res.json({ok:1}); });
app.get('/api/admin/virtual',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT v.*, u.phone FROM virtual_bets v JOIN users u ON v.userId=u.id ORDER BY v.id DESC LIMIT 100"); const[r2]=await db.query("SELECT a.*, u.phone FROM virtual_accas a JOIN users u ON a.userId=u.id ORDER BY a.id DESC LIMIT 100"); res.json({singles:r, accas:r2}); });

const PWA_HEAD = `<link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#000"><link rel="icon" type="image/svg+xml" href="/icon.svg">`;
const FIELD_BG_CSS = `body{background:#080a0f;color:#fff;font-family:Arial;padding:15px;padding-bottom:90px;position:relative;min-height:100vh;overflow-x:hidden}body::before{content:'';position:fixed;inset:-20px;z-index:-3;background-image:linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.7)),url('https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200&q=80');background-size:110% 110%;background-position:center}.glass{background:rgba(18,22,35,0.85);backdrop-filter:blur(16px);border:1px solid rgba(255,215,0,0.15)}.field-logo-top{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(0,0,0,0.7);border:1px solid rgba(255,215,0,0.3);padding:6px 18px;border-radius:30px;display:flex;align-items:center;gap:8px;font-size:11px;font-weight:bold;color:gold}
.ticker{position:fixed;top:0;left:0;right:0;background:linear-gradient(90deg,gold,#ff8c00);color:#000;font-size:11px;font-weight:bold;padding:4px;white-space:nowrap;overflow:hidden;z-index:100}.ticker span{display:inline-block;padding-left:100%;animation:tickerMove 30s linear infinite} @keyframes tickerMove{0%{transform:translate(0,0)}100%{transform:translate(-100%,0)}}
.pw-wrap{position:relative;width:100%}.pw-wrap input{width:100%;padding-right:45px}.eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:18px;background:rgba(255,215,0,0.15);width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center}
`;
const pages = {
home: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:12px;border:none}button{background:gold;font-weight:bold}.card{padding:20px;border-radius:20px}</style></head><body><div class="ticker"><span>🔥 S1 • 16 TEAMS • 8 MATCHES • ACCA 1-8 x256 • SPIN WHEEL DAILY • MINING 2/min</span></div><div class="field-logo-top" style="top:30px">⚽ HYBRID • LIFELINE</div><div class="card glass" style="margin-top:75px"><h2>💎 Lifeline Hybrid</h2><input id="n" placeholder="Full Name"><input id="p" placeholder="Phone"><div class="pw-wrap"><input id="pw" type="password" placeholder="Password"><span class="eye" onclick="togglePw('pw',this)">👁️</span></div><div class="pw-wrap"><input id="cpw" type="password" placeholder="Confirm Password"><span class="eye" onclick="togglePw('cpw',this)">👁️</span></div><input id="rf" placeholder="Referral Code"><button onclick="reg()">Register</button><button onclick="log()" style="background:#222;color:#fff;border:1px solid #333">Login</button><div id="pwMatch" style="font-size:10px"></div></div><script>
function togglePw(id,el){ let inp=document.getElementById(id); if(inp.type==="password"){ inp.type="text"; el.textContent="🙈"; } else { inp.type="password"; el.textContent="👁️"; } }
let c=new URLSearchParams(location.search).get("ref");if(c)rf.value=c;
pw.addEventListener('input',checkMatch); cpw.addEventListener('input',checkMatch);
function checkMatch(){ if(pw.value===cpw.value && pw.value){ pwMatch.textContent="✅ Match"; pwMatch.style.color="#0f0"; } else { pwMatch.textContent="❌ No match"; pwMatch.style.color="red"; } }
async function reg(){ if(pw.value!==cpw.value){ alert("Passwords don't match!"); return; } let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value,ref:rf.value})}); let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert(j.error)}
async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert("Wrong")}</script></body></html>`,
dash: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>
${FIELD_BG_CSS}
.bal{padding:22px;border-radius:24px;text-align:center}
.vip{padding:6px 14px;border-radius:20px;font-weight:bold;font-size:11px;display:inline-block;margin:5px}.vip-bronze{background:#cd7f32}.vip-silver{background:silver;color:#000}.vip-gold{background:gold;color:#000}
.walletGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.walletCard{padding:14px;border-radius:16px;text-align:left}
.money-card{padding:14px;border-radius:16px;margin:12px 0;display:flex;align-items:center;gap:12px}.money-icon{width:48px;height:48px;background:rgba(255,255,255,0.08);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px}
button{width:100%;padding:14px;margin:7px 0;border-radius:12px;border:none;font-weight:bold}.gold{background:gold;color:#000}.dark{background:rgba(20,25,35,0.9);color:#fff;border:1px solid rgba(255,255,255,0.1)}
#wheelModal{position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:300;display:none;align-items:center;justify-content:center;padding:20px;flex-direction:column}
#wheelCanvas{border-radius:50%;box-shadow:0 0 40px gold;border:6px solid gold;max-width:90vw}
#wheelPointer{width:0;height:0;border-left:18px solid transparent;border-right:18px solid transparent;border-top:30px solid gold;margin-bottom:-15px;z-index:10}
.miningBar{background:linear-gradient(90deg,#ff00cc22,#3333ff22);border:1px solid #ff00cc44;padding:12px;border-radius:12px;margin:10px 0;text-align:center}
.histBtn{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#1a1f2e,#252b3d);border:1px solid rgba(255,215,0,0.35);color:#FFD700;padding:16px 18px;border-radius:14px;text-decoration:none;font-weight:bold;margin:12px 0}
.virtCard{background:linear-gradient(135deg,#1a0033,#000033);border:2px solid #ff00cc;padding:16px;border-radius:18px;margin:12px 0}
.liveMini{background:#111;padding:5px 8px;border-radius:6px;margin:3px 0;font-size:10px;display:flex;justify-content:space-between}
</style></head><body>
<div class="ticker"><span id="liveTick">Loading virtual 16 teams...</span></div>
<div class="field-logo-top" style="top:28px">⚽ HYBRID • STADIUM</div>
<div id="wheelModal"><div id="wheelPointer"></div><canvas id="wheelCanvas" width="340" height="340"></canvas><p id="spinInfo" style="color:gold;font-size:12px;margin:10px">Tap SPIN</p><button id="doSpinBtn" onclick="doSpin()" class="gold" style="max-width:340px">🎡 SPIN NOW</button><button onclick="closeWheel()" style="background:#333;color:#fff;max-width:340px">Close</button></div>
<div class="bal glass" style="margin-top:75px">
<div style="color:gold;font-size:11px;letter-spacing:3px;font-weight:bold">⚽ LIFELINE HYBRID ⚽</div>
<div id="vipBadge" class="vip vip-bronze">BRONZE</div>
<div class="walletGrid">
<div class="walletCard glass"><h4>💰 INVEST</h4><h2 id="b">0 UGX</h2></div>
<div class="walletCard glass" style="border-color:#ff00cc44"><h4>🎮 GAME</h4><h2 id="gb">0 UGX</h2></div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
<div class="glass" style="padding:8px;border-radius:12px;text-align:center"><small style="color:#aaffaa">INTEREST LIVE</small><br><span id="int" style="color:#00ff88;font-weight:bold;font-size:18px">0 UGX</span></div>
<div class="glass" style="padding:8px;border-radius:12px;text-align:center"><small>MINING</small><br><span id="mineBal" style="color:#ff00cc;font-weight:bold">0 UGX</span></div>
</div>
<div class="miningBar"><div style="font-size:11px">⛏️ MINING: <span id="mineStatus">Stopped</span> • Pending: <span id="minePend">0</span> UGX</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px"><button class="gold" style="padding:8px;font-size:12px" onclick="startMine()">Start Mining</button><button class="dark" style="padding:8px;font-size:12px" onclick="claimMine()">Claim</button></div></div>
<p id="ph" style="color:#aaffaa;margin:6px;font-size:12px"></p>
<p id="code" style="color:#fff;background:rgba(0,60,0,0.45);padding:6px 14px;border-radius:20px;display:inline-block;font-size:11px"></p>
</div>
<div class="virtCard" onclick="location.href='/virtual'" style="cursor:pointer">
<div style="display:flex;justify-content:space-between;align-items:center"><b style="color:#ff00cc">🔥 VIRTUAL 16 TEAMS - ACCA 1-8 x256</b><span style="background:#ff00cc;color:#fff;padding:4px 10px;border-radius:20px;font-size:10px" id="virtPhase">BETTING</span></div>
<div id="virtPreview" style="margin-top:10px;font-size:13px">Loading virtual...</div>
<div id="otherMatchesPreview" style="margin-top:6px"></div>
<div style="margin-top:8px;background:rgba(255,0,204,0.15);padding:6px;border-radius:8px;font-size:11px;text-align:center">⏱️ <span id="virtTimer">--:--</span> • Season <span id="sPrev">1</span> MD <span id="mdPrev">1</span> • 1-8 matches = x2 to x256 →</div>
</div>
<div class="money-card glass"><div class="money-icon">🎡</div><div style="flex:1"><b>Spin Wheel Daily</b><br><small>Up to 2000 UGX</small></div><button class="gold" style="width:auto" onclick="openWheel()">Spin</button></div>
<div class="money-card glass"><div class="money-icon">💳</div><div style="flex:1"><b>Deposit</b></div><button class="gold" style="width:auto" onclick="location.href='/deposit'">Deposit</button></div>
<div class="money-card glass"><div class="money-icon">⚽</div><div style="flex:1"><b>Invest Portfolio</b></div><button class="gold" style="width:auto" onclick="location.href='/invest'">Invest</button></div>
<div class="money-card glass" style="border-color:#ff00cc44"><div class="money-icon">🎮</div><div style="flex:1"><b>Virtual ACCA</b><br><small style="color:#ff8cdd">Bet 1 to 8 matches • x2 to x256</small></div><button class="gold" style="width:auto;background:linear-gradient(45deg,#ff00cc,#3333ff);color:#fff" onclick="location.href='/virtual'">Play Now</button></div>
<a href="/history" class="histBtn"><span>📜 Transaction History</span><span>View →</span></a>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0">
<button class="dark" onclick="withdraw()">Withdraw</button>
<button class="dark" onclick="location.href='/referral'">My Team</button>
</div>
<button class="dark" onclick="localStorage.clear();location.href='/'" style="opacity:0.3">Logout</button>
<script>
let uid=localStorage.getItem("uid");if(!uid)location.href="/";
let baseInt=0; let secRate=0; let userInvestCount=0; let hasSpun=false;
let prizes=[0,100,200,300,500,1000,2000,100]; let colors=["#333","#FFD700","#0a5c00","#FF6B00","#0088cc","#FF0000","#FFD700","#00aa00"]; let currentRotation=0;
function drawWheel(rot=0){ let canvas=document.getElementById('wheelCanvas'); let ctx=canvas.getContext('2d'); let cx=170,cy=170,r=160; ctx.clearRect(0,0,340,340); let slice=2*Math.PI/prizes.length; for(let i=0;i<prizes.length;i++){ let ang=rot + i*slice; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,ang,ang+slice); ctx.closePath(); ctx.fillStyle=colors[i]; ctx.fill(); ctx.save(); ctx.translate(cx,cy); ctx.rotate(ang+slice/2); ctx.textAlign="right"; ctx.fillStyle=(colors[i]==="#FFD700"?"#000":"#fff"); ctx.font="bold 16px Arial"; ctx.fillText(prizes[i]==0?"TRY AGAIN":prizes[i]+" UGX", r-15,5); ctx.restore(); } }
function openWheel(){ if(userInvestCount===0){ alert("Invest first!"); location.href="/invest"; return; } if(hasSpun){ alert("Already spun today!"); return; } document.getElementById('wheelModal').style.display='flex'; drawWheel(); }
function closeWheel(){ document.getElementById('wheelModal').style.display='none'; }
async function doSpin(){ let btn=document.getElementById('doSpinBtn'); btn.disabled=true; btn.textContent="Spinning..."; let r=await fetch("/api/spin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid})}); let j=await r.json(); if(j.error){ alert(j.error); btn.disabled=false; btn.textContent="🎡 SPIN NOW"; closeWheel(); return; } let win=j.win; let winIndex=prizes.indexOf(win); let slice=360/prizes.length; let targetDeg = 270 - (winIndex*slice + slice/2); let spins=5*360 + targetDeg; let start=currentRotation % 360; let diff=spins - start; let duration=4000; let startTime=null; function animate(t){ if(!startTime) startTime=t; let prog=Math.min((t-startTime)/duration,1); let ease=1-Math.pow(1-prog,3); let rot=start + diff*ease; drawWheel(rot*Math.PI/180); if(prog<1){ requestAnimationFrame(animate); } else{ currentRotation=rot; document.getElementById('spinInfo').innerHTML= win>0? "🎉 WON "+win+" UGX":"😢 0 UGX"; btn.textContent="Close"; btn.disabled=false; btn.onclick=()=>{ closeWheel(); load(); }; } } requestAnimationFrame(animate); }
function startLiveCounter(){ setInterval(()=>{ if(baseInt>0){ baseInt+=secRate; document.getElementById('int').textContent=Math.floor(baseInt).toLocaleString()+" UGX"; }},1000); }
async function load(){ let r=await fetch("/api/user/"+uid);let u=await r.json(); document.getElementById('b').textContent=(u.balance||0).toLocaleString()+" UGX"; document.getElementById('gb').textContent=(u.gameBalance||0).toLocaleString()+" UGX"; document.getElementById('mineBal').textContent=(u.miningBalance||0).toLocaleString()+" UGX"; document.getElementById('minePend').textContent=(u.miningPending||0).toLocaleString()+" UGX"; document.getElementById('mineStatus').textContent=u.isMining?"Mining...":"Stopped"; document.getElementById('ph').textContent=u.phone; baseInt=u.totalInterest||0; secRate = (u.investments && u.investments.length)? (u.investments.reduce((s,i)=>s+(i.amount*i.rate/100/86400),0)) : 0; document.getElementById('int').textContent=baseInt.toLocaleString()+" UGX"; document.getElementById('code').textContent="Ref: "+(u.myReferralCode||""); document.getElementById('vipBadge').textContent=u.vip+" - "+u.vipRate; userInvestCount=u.investCount||0; hasSpun=u.hasSpunToday||false; }
async function loadVirtualPreview(){
 try{
  let r=await fetch("/api/virtual/status"); let d=await r.json();
  if(!d.nextAll || d.nextAll.length===0){ document.getElementById('virtPreview').innerHTML="Loading next MD..."; return; }
  document.getElementById('virtPhase').textContent = d.phase.toUpperCase();
  document.getElementById('virtTimer').textContent = Math.floor(d.timeLeft/60)+":"+String(d.timeLeft%60).padStart(2,'0');
  document.getElementById('sPrev').textContent=d.season; document.getElementById('mdPrev').textContent=d.matchday;
  if(d.phase==='betting'){
    document.getElementById('virtPreview').innerHTML = "NEXT MD"+d.matchday+": <b style=color:#ff00cc>"+d.next.home.short+" vs "+d.next.away.short+" + "+(d.nextAll.length-1)+" more</b><br><small>Bet 1 match x2 • 8 matches x256</small>";
    let others=(d.nextAll||[]).slice(0,3).map(m=>'<div class=liveMini><span>'+m.home.short+' vs '+m.away.short+'</span><span>Odd x2</span></div>').join(''); document.getElementById('otherMatchesPreview').innerHTML=others;
  } else {
    let f=d.current; if(!f){ document.getElementById('virtPreview').innerHTML="Live starting..."; return; } document.getElementById('virtPreview').innerHTML = "🔴 LIVE MD"+d.matchday+" "+f.minute+"' : <b>"+f.home.short+" "+f.homeScore+" - "+f.awayScore+" "+f.away.short+"</b><br><small>"+(f.events[0]||"")+"</small>";
    let others=(d.allLive||[]).slice(1,4).map(m=>'<div class=liveMini><span>'+m.home.short+' '+m.homeScore+'-'+m.awayScore+' '+m.away.short+' '+m.minute+"'</span><span>"+(m.events[0]||'').slice(0,18)+'</span></div>').join(''); document.getElementById('otherMatchesPreview').innerHTML=others;
  }
  document.getElementById('liveTick').textContent = d.phase==='live1' || d.phase==='live2'? "🔴 LIVE S"+d.season+" MD"+d.matchday+" "+d.current.home.short+" "+d.current.homeScore+"-"+d.current.awayScore+" "+d.current.away.short+" | 8 MATCHES ACCA 1-8 x256" : d.phase==='halftime'? "⏸️ HALFTIME S"+d.season+" MD"+d.matchday+" - BET 1-8 MATCHES ACCA OPEN!" : "🟢 BETTING S"+d.season+" MD"+d.matchday+" - 1-8 MATCHES x2 to x256 - Bet now!";
 }catch(e){ document.getElementById('virtPreview').innerHTML="Reconnecting..."; }
}
async function startMine(){ await fetch("/api/mining/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid})}); load(); }
async function claimMine(){ let r=await fetch("/api/mining/claim",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid})}); let j=await r.json(); alert("Claimed "+(j.earned||0)+" UGX"); load(); }
async function withdraw(){let a=prompt("Withdraw min 5000:");if(!a)return;let r=await fetch("/api/withdraw",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:parseInt(a)})});let j=await r.json();alert(j.error||"Sent");}
startLiveCounter(); load(); setInterval(loadVirtualPreview,1000); loadVirtualPreview();
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
.event{font-size:10px;padding:3px 6px;background:rgba(255,255,255,0.06);border-radius:4px;margin:2px 0;text-align:left}
.table{max-height:300px;overflow-y:auto;background:rgba(0,0,0,0.5);border-radius:10px;padding:6px;margin:8px 0}
.row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:10px}
</style></head><body>
<div class="field-logo-top" id="top">ACCA 1-8 • x256 • 16 TEAMS</div>
<div style="margin-top:60px"><a href="/dashboard" style="color:gold">← Back</a>
<h2 style="color:#ff00cc">🔥 ACCA BET - 1 to 8 Matches!</h2>
<p style="font-size:10px;color:#aaa">Bet 1 match x2 • 2 matches x4 • 3 x8 • 4 x19 • 8 x256 • Max 7 goals • 0-0 allowed • Season infinity</p>
<div class="liveBox" id="featBox">Loading fixtures...</div>
<div id="allMatchesBet"></div>
<div class="accaTicket" id="ticket">
<h3 style="margin:0;color:gold">🎫 ACCA Ticket - <span id="selCount">0</span> matches selected</h3>
<div style="font-size:11px">Odd: <b id="odd" style="color:#ff00cc">x0</b> • Potential: <b id="pot" style="color:#00ff88">0 UGX</b></div>
<div id="selList" style="max-height:100px;overflow-y:auto;margin:6px 0;font-size:10px"></div>
<input id="accaAmt" type="number" value="500" style="width:100%;padding:10px;border-radius:8px;border:1px solid gold;background:#111;color:#fff;margin:6px 0">
<button onclick="placeAcca()" style="width:100%;padding:12px;background:linear-gradient(90deg,gold,#ff8c00);border:none;border-radius:10px;font-weight:bold;color:#000">Place ACCA Bet (1-8 matches) - Win x256!</button>
<button onclick="clearAcca()" style="width:100%;padding:6px;background:#222;color:#fff;border:none;border-radius:8px;margin-top:4px;font-size:11px">Clear Ticket</button>
<p style="font-size:9px;color:#aaa">Game Wallet: <span id="gBal">0</span> UGX • You can bet 1 team alone or 8 teams</p>
</div>
<h3>📊 Table 16 Teams</h3><div class="table" id="table"></div>
<h3>🎫 My ACCA Bets (1-8)</h3><div id="myAccas"></div>
</div>
<script>
let uid=localStorage.getItem("uid");
let selections=[];
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
  let list=selections.map(s=>'<div style="display:flex;justify-content:space-between;background:rgba(255,215,0,0.1);padding:4px;border-radius:4px;margin:2px 0"><span>'+s.homeShort+' vs '+s.awayShort+'</span><span style="color:gold">'+s.prediction.toUpperCase()+'</span><span style="color:red;cursor:pointer" onclick="removeSel('+s.matchId+')">✕</span></div>').join(''); document.getElementById('selList').innerHTML=list||'<small style=color:#666>Select 1 to 8 matches - 1 team x2, 8 teams x256</small>';
}
function removeSel(mid){ selections=selections.filter(s=>s.matchId!==mid); document.querySelectorAll('[data-match="'+mid+'"]').forEach(b=>b.classList.remove('sel')); updateTicket(); }
function clearAcca(){ selections=[]; document.querySelectorAll('.betBtn').forEach(b=>b.classList.remove('sel')); updateTicket(); }
document.getElementById('accaAmt').addEventListener('input',updateTicket);
async function placeAcca(){
  if(selections.length<1) return alert("Select at least 1 match! 1 team = x2");
  let amt=parseInt(document.getElementById('accaAmt').value);
  if(amt<200) return alert("Min 200");
  let r=await fetch("/api/virtual/bet/acca",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid, amount:amt, selections: selections.map(s=>({matchId:s.matchId, homeTeam:s.homeTeam, awayTeam:s.awayTeam, prediction:s.prediction}))})});
  let j=await r.json(); if(j.ok){ alert("ACCA placed! "+selections.length+" matches Odd x"+j.odd.toFixed(1)+" Win "+j.potential.toLocaleString()+" UGX"); clearAcca(); loadAccas(); } else alert(j.error);
}
async function loadS(){
 try{
  let r=await fetch("/api/virtual/status"); let d=await r.json();
  if(!d.nextAll || d.nextAll.length===0){ document.getElementById('featBox').innerHTML="Loading next MD..."; return; }
  document.getElementById('top').textContent='S'+d.season+' MD'+d.matchday+' • 1-8 MATCHES • x256 • 75% Hidden';
  let box=document.getElementById('featBox'); let tl=Math.floor(d.timeLeft/60)+":"+String(d.timeLeft%60).padStart(2,'0');
  if(d.phase==='betting'){
    box.innerHTML='<span class="phase betting">BETTING '+tl+'</span><span class=timer>'+tl+'</span><div style="margin-top:24px"><div class=score>MD'+d.matchday+' - 8 MATCHES</div><small>Season '+d.season+' • Bet 1 match x2 • 2 matches x4 • 8 matches x256<br>Max 7 goals • 0-0 possible</small></div>';
    let html=''; (d.nextAll||[]).forEach(m=>{
      html+='<div class=matchCard><div style="display:flex;justify-content:space-between;font-weight:bold"><span>'+m.home.short+' vs '+m.away.short+'</span><span style="font-size:9px">MD'+d.matchday+'</span></div><div style="font-size:10px;color:#aaa;margin:4px 0">'+m.home.name+' vs '+m.away.name+'</div><div style="display:flex"><button class="betBtn home" data-match="'+m.id+'" data-pred="home" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','home')\">"+m.home.short+' x2</button><button class="betBtn draw" data-match="'+m.id+'" data-pred="draw" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','draw')\">DRAW x2</button><button class="betBtn away" data-match="'+m.id+'" data-pred="away" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','away')\">"+m.away.short+' x2</button></div></div>';
    }); document.getElementById('allMatchesBet').innerHTML=html; selections.forEach(s=>{ let el=document.querySelector('[data-match="'+s.matchId+'"][data-pred="'+s.prediction+'"]'); if(el) el.classList.add('sel'); });
  } else {
    let f=d.current; if(!f){ document.getElementById('featBox').innerHTML="Live starting..."; return; } box.innerHTML='<span class="phase '+(d.phase==='halftime'?'ht':'live')+'">'+(d.phase==='halftime'?'HT 45\' - BET 1-8 OPEN':'LIVE '+f.minute+"'")+' '+tl+'</span><span class=timer>'+tl+'</span><div style="margin-top:24px"><div class=score>'+f.home.short+' '+f.homeScore+'-'+f.awayScore+' '+f.away.short+'</div><small>'+(f.events[0]||'')+'</small></div>';
    let html=''; (d.allLive||[]).forEach(m=>{
      html+='<div class=matchCard><div style="display:flex;justify-content:space-between;font-weight:bold"><span>'+m.home.short+' '+m.homeScore+'-'+m.awayScore+' '+m.away.short+' '+m.minute+"'</span><span style='font-size:9px'>"+(m.result||'LIVE')+'</span></div><div style="font-size:10px;color:#aaa">'+(m.events[0]||'').slice(0,60)+'</div>'+(d.phase==='halftime'?'<div style="display:flex;margin-top:6px"><button class="betBtn home" data-match="'+m.id+'" data-pred="home" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','home')\">"+m.home.short+' x2</button><button class="betBtn draw" data-match="'+m.id+'" data-pred="draw" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','draw')\">DRAW</button><button class="betBtn away" data-match="'+m.id+'" data-pred="away" onclick="toggleSel('+m.id+",'"+m.home.name+"','"+m.away.name+"','"+m.home.short+"','"+m.away.short+"','away')\">"+m.away.short+'</button></div>':'')+'</div>';
    }); document.getElementById('allMatchesBet').innerHTML=html; selections.forEach(s=>{ let el=document.querySelector('[data-match="'+s.matchId+'"][data-pred="'+s.prediction+'"]'); if(el) el.classList.add('sel'); });
  }
  let tb=''; d.table.forEach((t,i)=>{ tb+='<div class=row><span>'+(i+1)+'. '+t.short+'</span><span>'+t.P+' '+t.W+' '+t.D+' '+t.L+' '+t.GF+'-'+t.GA+' <b style=color:gold>'+t.Pts+'</b></span></div>'; }); document.getElementById('table').innerHTML=tb;
 }catch(e){ document.getElementById('featBox').innerHTML="Loading... Reconnecting"; }
}
async function loadAccas(){ try{ let r=await fetch("/api/virtual/myaccas/"+uid); let d=await r.json(); let h=d.map(a=>{ let sels=a.selections||[]; let selTxt=sels.map(s=>s.homeTeam.slice(0,3)+' '+s.prediction.slice(0,1).toUpperCase()).join(', '); let c=a.status==='won'?'#0f0':a.status==='lost'?'red':'gold'; return '<div style="background:#111;padding:8px;border-radius:8px;margin:4px 0;border-left:3px solid '+c+';font-size:10px"><b>ACCA '+sels.length+' x'+(a.odd||0).toFixed(1)+'</b> '+a.amount+' => '+a.status.toUpperCase()+' '+(a.winAmount||0)+'<br><small>'+selTxt+'</small></div>'; }).join(''); document.getElementById('myAccas').innerHTML=h||'No ACCA yet - bet 1 to 8 matches!'; let ru=await fetch("/api/user/"+uid); let u=await ru.json(); document.getElementById('gBal').textContent=(u.gameBalance||0).toLocaleString(); }catch(e){} }
setInterval(loadS,1000); loadS(); loadAccas(); setInterval(loadAccas,5000);
</script></body></html>`,
deposit: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}.box{padding:15px;border-radius:12px;margin:10px 0;text-align:center}</style></head><body><div class="field-logo-top">⚽ DEPOSIT</div><a href="/dashboard" style="color:gold;margin-top:60px;display:inline-block">← Back</a><h2>Deposit</h2><div class="box glass"><h1 style="color:gold">7184154</h1><h3>JASCENT LIFELINE</h3></div><input id="am" placeholder="Amount"><input id="air" placeholder="Your Airtel Number"><input type="file" id="file"><img id="prev" style="display:none;width:100%;border-radius:10px"><button onclick="dep()">Submit</button><script>let uid=localStorage.getItem("uid");let b64=""; file.addEventListener("change",e=>{let r=new FileReader();r.onload=()=>{b64=r.result;prev.src=b64;prev.style.display="block"};r.readAsDataURL(e.target.files[0])});async function dep(){let r=await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:am.value,airtelNo:air.value,screenshot:b64})});let j=await r.json();if(j.ok){alert("Sent!");location.href="/dashboard"}else alert(j.error)}</script></body></html>`,
invest: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.club{padding:16px;border-radius:18px;margin:14px 0;display:flex;align-items:center;gap:14px}.badge{width:62px;height:62px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:20px;color:#fff}.b-arsenal{background:#EF0107}.b-manutd{background:#DA291C}.b-mancity{background:#6CABDD}.info{flex:1}button{width:100%;padding:13px;border-radius:12px;border:none;background:gold;font-weight:bold;margin-top:8px}input{width:100%;padding:12px;border-radius:10px;border:1px solid #333;background:#111;color:#fff;margin-top:8px}a{color:gold}</style></head><body><div class="field-logo-top">🏟️ CLUBS</div><div style="margin-top:60px"><a href="/dashboard">← Back</a><h2>Invest</h2><p>Invest Wallet: <b id="bal" style="color:gold">0</b></p></div><div class="club glass"><div class="badge b-arsenal">AFC</div><div class="info"><h3>Arsenal 10%</h3><input id="a-arsenal" placeholder="Amount min 2000"><button onclick="inv('arsenal')">Invest</button></div></div><div class="club glass"><div class="badge b-manutd">MUN</div><div class="info"><h3>Man Utd 10%</h3><input id="a-manutd" placeholder="Amount"><button onclick="inv('manutd')">Invest</button></div></div><div class="club glass"><div class="badge b-mancity">MCI</div><div class="info"><h3>Man City 10%</h3><input id="a-mancity" placeholder="Amount"><button onclick="inv('mancity')">Invest</button></div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/user/"+uid);let u=await r.json();bal.textContent=u.balance;}async function inv(c){let v=document.getElementById("a-"+c).value;if(parseInt(v)<2000)return alert("Min 2000");let r=await fetch("/api/invest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,club:c,amount:parseInt(v)})});let j=await r.json();if(j.ok){alert("Invested!"); location.href="/dashboard"}else alert(j.error)}load()</script></body></html>`,
history: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.card{background:#1a1f2e;border:1px solid gold;padding:14px;margin:8px 0;border-radius:12px;display:flex;justify-content:space-between}a{color:gold}</style></head><body><div class="field-logo-top">📜 HISTORY</div><div style="margin-top:60px"><a href="/dashboard">← Back</a><h2>History</h2><div id="list">Loading...</div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/history/"+uid);let d=await r.json();let h="";for(let t of d){h+="<div class=card><span>"+t.type+" "+(t.amount||0)+"</span><span>"+(t.status||'')+(t.odd?' x'+t.odd:'')+"</span></div>";}document.getElementById('list').innerHTML=h||"No data";}load()</script></body></html>`,
referral: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.card{padding:15px;border-radius:12px;margin:10px 0;text-align:center}button{width:100%;padding:12px;border-radius:8px;border:none;background:gold;font-weight:bold;margin:5px 0}input{width:100%;padding:12px;border-radius:8px;border:none;background:#111;color:#fff;text-align:center}a{color:gold}</style></head><body><div class="field-logo-top">👥 TEAM</div><div style="margin-top:60px"><a href="/dashboard">Back</a><h2>My Team</h2><div class="card glass"><h3 style="color:gold">Code: <span id="code">---</span></h3><p>Team: <span id="count">0</span></p><input id="link" readonly><button onclick="copy()">Copy Link</button></div><div id="team"></div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/team/"+uid);let j=await r.json();code.textContent=j.code;count.textContent=j.count;let url=location.origin+"/?ref="+j.code;link.value=url;let html="";if(j.team.length==0)html="<p>No team</p>";else for(let t of j.team){html+="<div class=card glass style=text-align:left><b>"+(t.fullName||t.phone)+"</b><br>"+t.phone+"</div>"}team.innerHTML=html;}function copy(){link.select();document.execCommand("copy");alert("Copied!")}load()</script></body></html>`,
admin: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}input,button{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:none}button{background:gold;font-weight:bold}.tab{padding:10px;background:#222;display:inline-block;margin:5px;border-radius:5px;cursor:pointer}.active{background:gold;color:#000}</style></head><body><div id="loginBox"><h2>Admin</h2><input id="pass" type="password" placeholder="LIFELINE123"><button onclick="check()">Unlock</button></div><div id="adminBox" style="display:none"><h2>ADMIN 75% ALL</h2><div><span class="tab active" id="t1" onclick="showTab('dep')">Deposits</span><span class="tab" id="t2" onclick="showTab('virt')">Virtual 1-8</span><span class="tab" id="t3" onclick="showTab('users')">Users</span></div><div id="depBox"><div id="l">Loading</div></div><div id="virtBox" style="display:none"><div id="lvirt"></div></div><div id="usersBox" style="display:none"><div id="lu"></div></div></div><script>
const AP="LIFELINE123";let en="";function check(){if(pass.value===AP){en=pass.value;loginBox.style.display="none";adminBox.style.display="block";ld()}}
function showTab(t){depBox.style.display=t==='dep'?'block':'none';virtBox.style.display=t==='virt'?'block':'none';usersBox.style.display=t==='users'?'block':'none';if(t==='dep')ld();if(t==='virt')loadVirt();if(t==='users')loadUsers()}
async function ld(){let r=await fetch("/api/admin/deposits?key="+en);let d=await r.json();document.getElementById('l').innerHTML=d.map(x=>"<div style=background:#222;padding:12px;margin:10px 0;border-radius:10px><b>"+x.phone+"</b> "+x.amount+"<button onclick=ap("+x.id+")>Approve</button></div>").join('')||"No pending"}
async function ap(id){await fetch("/api/admin/approve/"+id+"?key="+en,{method:"POST"});ld()}
async function loadVirt(){let r=await fetch("/api/admin/virtual?key="+en);let d=await r.json();let acc=d.accas||[]; let singles=d.singles||[]; let sum={won:0,lost:0}; for(let b of [...acc,...singles]){ if(b.status==='won') sum.won+=b.winAmount; else if(b.status==='lost') sum.lost+=b.amount; } let profit=sum.lost-sum.won; document.getElementById('lvirt').innerHTML="<div style=background:#111;padding:12px;border:1px solid gold>Profit: "+profit+" UGX<br>Singles: "+singles.length+" ACCAs 1-8: "+acc.length+"<br>House win 75% active</div>"+acc.slice(0,30).map(a=>"<div style=background:#222;margin:3px;padding:5px;font-size:11px>"+a.phone+" ACCA "+a.selections?.length+" teams x"+a.odd+" "+a.amount+" "+a.status+"</div>").join('');}
async function loadUsers(){let r=await fetch("/api/admin/users?key="+en);let d=await r.json();document.getElementById('lu').innerHTML=d.map(u=>"<div style=background:#222;padding:6px;margin:3px 0>"+u.phone+" Bal:"+u.balance+" Game:"+u.gameBalance+"</div>").join('');}
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
app.listen(process.env.PORT||3000,()=>console.log("FIXED FINAL 1-8 ACCA x256 SPIN RESTORED READY"));
