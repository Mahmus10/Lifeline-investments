const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
let db;
const ADMIN_KEY="LIFELINE123";
const TG_LINK="https://t.me/+CbCGmt2mSgcwY2U0";

// ========== VIRTUAL LEAGUE HIDDEN 75% + HALFTIME + MAX 7 GOALS + 0-0 ==========
const V_TEAMS = [
 {name:'Arsenal',short:'ARS',pts:74, power:88},
 {name:'Man City',short:'MCI',pts:72, power:90},
 {name:'Liverpool',short:'LIV',pts:70, power:87},
 {name:'Chelsea',short:'CHE',pts:64, power:80},
 {name:'Man Utd',short:'MUN',pts:58, power:78},
 {name:'Newcastle',short:'NEW',pts:56, power:76},
 {name:'Aston Villa',short:'AVL',pts:55, power:75},
 {name:'Tottenham',short:'TOT',pts:52, power:74},
 {name:'Brighton',short:'BHA',pts:48, power:70},
 {name:'West Ham',short:'WHU',pts:44, power:68}
];
function genMatch(){
 let a = V_TEAMS[Math.floor(Math.random()*V_TEAMS.length)];
 let b = V_TEAMS[Math.floor(Math.random()*V_TEAMS.length)];
 while(b.name===a.name) b = V_TEAMS[Math.floor(Math.random()*V_TEAMS.length)];
 return {id: Date.now(), home:a, away:b, homeScore:0, awayScore:0, minute:0, result:null, targetResult:null, events:[]};
}
let virtualNext = genMatch();
let virtualCurrent = null;
let virtualPhase = 'betting'; // betting, live1, halftime, live2
let virtualTimeLeft = 240;
let virtualMinuteTimer = 0;
let virtualBetsPlaced = 0;

async function decideResult(matchId){
 try{
  if(!db) return ['home','draw','away'][Math.floor(Math.random()*3)];
  const [bets] = await db.query("SELECT prediction, SUM(amount) as total FROM virtual_bets WHERE matchId=? AND status='pending' GROUP BY prediction",[matchId]);
  let totals={home:0,draw:0,away:0};
  for(let r of bets) totals[r.prediction]=parseInt(r.total)||0;
  let totalAll=totals.home+totals.draw+totals.away;
  if(totalAll===0){
    let rnd=Math.random();
    // allow 0-0 draw more often when no bets
    return rnd<0.35?'home': rnd<0.65?'draw':'away';
  }
  let houseWin = Math.random() < 0.75;
  let res;
  if(houseWin){
    let min=Math.min(totals.home||0, totals.draw||0, totals.away||0);
    let maxVal=Math.max(totals.home, totals.draw, totals.away);
    let mostPopular = Object.keys(totals).find(k=>totals[k]===maxVal);
    let candidates = Object.keys(totals).filter(k=>totals[k]===min);
    let filtered = candidates.filter(k=>k!==mostPopular);
    res = (filtered.length>0? filtered[0] : candidates[0]) || 'draw';
    if(Math.random()<0.4){
      let opts=['home','draw','away'].filter(o=>o!==mostPopular);
      res=opts[Math.floor(Math.random()*opts.length)];
    }
  } else {
    let maxVal=Math.max(totals.home, totals.draw, totals.away);
    res = Object.keys(totals).find(k=>totals[k]===maxVal) || 'home';
  }
  return res;
 }catch(e){ return 'home'; }
}

async function settleVirtual(match){
 try{
  if(!match) return;
  let res=match.targetResult||'draw';
  let total=match.homeScore+match.awayScore;

  if(res==='draw'){
    if(total===0 && Math.random()<0.6){
      match.homeScore=0; match.awayScore=0;
    } else {
      if(match.homeScore!==match.awayScore){
        let g=Math.min(Math.max(match.homeScore,match.awayScore),3);
        if(total===0) g=Math.random()<0.5?0:1;
        match.homeScore=g; match.awayScore=g;
      }
    }
  } else if(res==='home'){
    if(match.homeScore<=match.awayScore) match.homeScore=match.awayScore+1;
  } else if(res==='away'){
    if(match.awayScore<=match.homeScore) match.awayScore=match.homeScore+1;
  }

  while(match.homeScore+match.awayScore>7){
    if(match.homeScore>match.awayScore) match.homeScore--;
    else match.awayScore--;
  }
  if(match.homeScore<0) match.homeScore=0;
  if(match.awayScore<0) match.awayScore=0;

  match.result=res;
  const [bets]=await db.query("SELECT * FROM virtual_bets WHERE matchId=? AND status='pending'",[match.id]);
  for(let bet of bets){
   if(bet.prediction===res){
     let win=bet.amount*2;
     await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win, bet.userId]);
     await db.query("UPDATE virtual_bets SET status='won', winAmount=? WHERE id=?",[win, bet.id]);
   } else {
     await db.query("UPDATE virtual_bets SET status='lost', winAmount=0 WHERE id=?",[bet.id]);
   }
  }
 }catch(e){}
}

setInterval(async()=>{
 try{
  virtualTimeLeft--;
  if(virtualPhase==='betting'){
    if(virtualTimeLeft<=0){
      let target = await decideResult(virtualNext.id);
      virtualCurrent = {...virtualNext, homeScore:0, awayScore:0, minute:0, targetResult:target, events:[`0' Kick Off ${virtualNext.home.short} vs ${virtualNext.away.short}`]};
      virtualNext = genMatch();
      virtualPhase='live1';
      virtualTimeLeft=180;
      virtualMinuteTimer=0;
    }
  } else if(virtualPhase==='live1'){
    virtualMinuteTimer++;
    if(virtualMinuteTimer>=4){
      virtualMinuteTimer=0;
      virtualCurrent.minute++;
      if(Math.random()<0.035 && virtualCurrent.homeScore+virtualCurrent.awayScore < 7){
        let target=virtualCurrent.targetResult;
        let scorer=null;
        if(target==='home' && virtualCurrent.homeScore<=virtualCurrent.awayScore) scorer='home';
        else if(target==='away' && virtualCurrent.awayScore<=virtualCurrent.homeScore) scorer='away';
        else if(target==='draw'){
          if(virtualCurrent.homeScore===0 && virtualCurrent.awayScore===0 && Math.random()<0.7) scorer=null;
          else if(virtualCurrent.homeScore>virtualCurrent.awayScore) scorer='away';
          else if(virtualCurrent.awayScore>virtualCurrent.homeScore) scorer='home';
          else scorer=Math.random()<0.5?'home':'away';
        } else scorer=Math.random()<0.5?'home':'away';
        if(scorer==='home'){ virtualCurrent.homeScore++; virtualCurrent.events.unshift(`${virtualCurrent.minute}' GOAL ${virtualCurrent.home.short} ${virtualCurrent.homeScore}-${virtualCurrent.awayScore}`); }
        else if(scorer==='away'){ virtualCurrent.awayScore++; virtualCurrent.events.unshift(`${virtualCurrent.minute}' GOAL ${virtualCurrent.away.short} ${virtualCurrent.homeScore}-${virtualCurrent.awayScore}`); }
      }
    }
    if(virtualTimeLeft<=0 || virtualCurrent.minute>=45){
      virtualPhase='halftime';
      virtualTimeLeft=60;
      virtualCurrent.minute=45;
      virtualCurrent.events.unshift(`45' HALFTIME ${virtualCurrent.homeScore}-${virtualCurrent.awayScore} - LIVE BET OPEN!`);
    }
  } else if(virtualPhase==='halftime'){
    virtualTimeLeft--;
    if(virtualTimeLeft<=0){
      virtualPhase='live2';
      virtualTimeLeft=180;
      virtualMinuteTimer=0;
      virtualCurrent.events.unshift(`46' Second half starts`);
    }
  } else if(virtualPhase==='live2'){
    virtualMinuteTimer++;
    if(virtualMinuteTimer>=4){
      virtualMinuteTimer=0;
      virtualCurrent.minute++;
      if(Math.random()<0.045 && virtualCurrent.homeScore+virtualCurrent.awayScore < 7){
        let target=virtualCurrent.targetResult;
        if(virtualCurrent.minute>=83){
          if(target==='home' && virtualCurrent.homeScore<=virtualCurrent.awayScore && virtualCurrent.homeScore+virtualCurrent.awayScore<7){ virtualCurrent.homeScore=virtualCurrent.awayScore+1; virtualCurrent.events.unshift(`${virtualCurrent.minute}' WINNER ${virtualCurrent.home.short} ${virtualCurrent.homeScore}-${virtualCurrent.awayScore}`); }
          else if(target==='away' && virtualCurrent.awayScore<=virtualCurrent.homeScore && virtualCurrent.homeScore+virtualCurrent.awayScore<7){ virtualCurrent.awayScore=virtualCurrent.homeScore+1; virtualCurrent.events.unshift(`${virtualCurrent.minute}' WINNER ${virtualCurrent.away.short} ${virtualCurrent.homeScore}-${virtualCurrent.awayScore}`); }
          else if(target==='draw' && virtualCurrent.homeScore!==virtualCurrent.awayScore && virtualCurrent.homeScore+virtualCurrent.awayScore<7){
            if(virtualCurrent.homeScore>virtualCurrent.awayScore){ virtualCurrent.awayScore=virtualCurrent.homeScore; virtualCurrent.events.unshift(`${virtualCurrent.minute}' EQUALIZER!`); }
            else { virtualCurrent.homeScore=virtualCurrent.awayScore; virtualCurrent.events.unshift(`${virtualCurrent.minute}' EQUALIZER!`); }
          }
        } else {
          if(target==='home' && Math.random()<0.55 && virtualCurrent.homeScore+virtualCurrent.awayScore<7){ virtualCurrent.homeScore++; virtualCurrent.events.unshift(`${virtualCurrent.minute}' GOAL ${virtualCurrent.home.short} ${virtualCurrent.homeScore}-${virtualCurrent.awayScore}`); }
          else if(target==='away' && Math.random()<0.55 && virtualCurrent.homeScore+virtualCurrent.awayScore<7){ virtualCurrent.awayScore++; virtualCurrent.events.unshift(`${virtualCurrent.minute}' GOAL ${virtualCurrent.away.short} ${virtualCurrent.homeScore}-${virtualCurrent.awayScore}`); }
          else if(target==='draw' && virtualCurrent.homeScore!==virtualCurrent.awayScore && virtualCurrent.homeScore+virtualCurrent.awayScore<7){
            if(virtualCurrent.homeScore>virtualCurrent.awayScore){ virtualCurrent.awayScore++; virtualCurrent.events.unshift(`${virtualCurrent.minute}' Equalizer ${virtualCurrent.away.short}`); }
            else { virtualCurrent.homeScore++; virtualCurrent.events.unshift(`${virtualCurrent.minute}' Equalizer ${virtualCurrent.home.short}`); }
          }
        }
      }
    }
    if(virtualTimeLeft<=0 || virtualCurrent.minute>=90){
      await settleVirtual(virtualCurrent);
      virtualPhase='betting';
      virtualTimeLeft=240;
      virtualCurrent=null;
    }
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
  await db.query("CREATE TABLE IF NOT EXISTS spins (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount INT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS mining (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, earned INT DEFAULT 0, lastClaim DATETIME DEFAULT CURRENT_TIMESTAMP, isMining TINYINT DEFAULT 0)");
  await db.query("CREATE TABLE IF NOT EXISTS p2p_trades (id INT AUTO_INCREMENT PRIMARY KEY, sellerId INT, club VARCHAR(50), amount INT, price INT, profit INT, status VARCHAR(20) DEFAULT 'open', buyerId INT DEFAULT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS virtual_bets (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, matchId BIGINT, homeTeam VARCHAR(30), awayTeam VARCHAR(30), prediction VARCHAR(10), amount INT, status VARCHAR(20) DEFAULT 'pending', winAmount INT DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  console.log("FINAL VIRTUAL READY");
 }catch(e){console.log(e.message)}
}
init();
app.get('/icon.svg',(req,res)=>{ res.set('Content-Type','image/svg+xml'); res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="120" fill="#000"/><circle cx="256" cy="256" r="190" fill="none" stroke="#FFD700" stroke-width="2"/><path d="M150 130 L150 380 Q150 400 170 400 L330 400 Q345 400 335 410 Q315 430 295 430 L170 430 Q130 430 130 390 L130 130 Q130 112 150 130Z" fill="#FFD700"/><path d="M165 375 C 250 355, 310 300, 380 170" fill="none" stroke="#FFD700" stroke-width="8" stroke-linecap="round"/><polygon points="385,145 410,170 360,180" fill="#FFD700"/></svg>`);});
app.get('/icon.png',(req,res)=>res.redirect('/icon.svg'));
app.get('/manifest.json',(req,res)=>{ res.json({name:"Lifeline Hybrid",short_name:"Lifeline",start_url:"/",display:"standalone",background_color:"#080a0f",theme_color:"#FFD700",icons:[{src:"/icon.svg", sizes:"512x512", type:"image/svg+xml", purpose:"any maskable"}]})});
app.get('/sw.js',(req,res)=>{ res.set('Content-Type','application/javascript'); res.send(`self.addEventListener('install',e=>self.skipWaiting());`);});
app.get('/api/livescores',(req,res)=>{ res.json([{match:"Arsenal vs Man Utd",score:"2-1",minute:"78'",status:"LIVE"}]); });
app.get('/api/crypto',(req,res)=>{ res.json({btc:"$67,450 +2.3%",usdt:"1.00 UGX 3,750"}); });
app.get('/api/virtual/status',(req,res)=>{ res.json({phase:virtualPhase,timeLeft:virtualTimeLeft,current:virtualCurrent,next:virtualNext,table:V_TEAMS.sort((a,b)=>b.pts-a.pts),totalBets:virtualBetsPlaced}); });
app.get('/api/virtual/mybets/:id',async(req,res)=>{ try{ const [r]=await db.query("SELECT * FROM virtual_bets WHERE userId=? ORDER BY id DESC LIMIT 20",[req.params.id]); res.json(r); }catch(e){res.json([])} });
app.post('/api/virtual/bet',async(req,res)=>{
 try{
  const {userId, prediction, amount}=req.body;
  if(!['home','draw','away'].includes(prediction)) return res.status(400).json({error:"Invalid"});
  if(parseInt(amount)<200) return res.status(400).json({error:"Min 200 UGX"});
  const [u]=await db.query("SELECT gameBalance FROM users WHERE id=?",[userId]);
  if(!u.length || u[0].gameBalance < amount) return res.status(400).json({error:"Insufficient Game Wallet"});
  let matchId, homeTeam, awayTeam;
  if(virtualPhase==='betting'){ matchId=virtualNext.id; homeTeam=virtualNext.home.name; awayTeam=virtualNext.away.name; }
  else if(virtualPhase==='halftime'){ matchId=virtualCurrent.id; homeTeam=virtualCurrent.home.name; awayTeam=virtualCurrent.away.name; }
  else { return res.status(400).json({error:"Betting open at pre-match (4min) & halftime (1min). Wait "+Math.floor(virtualTimeLeft/60)+":"+String(virtualTimeLeft%60).padStart(2,'0')}); }
  await db.query("UPDATE users SET gameBalance=gameBalance-? WHERE id=?",[parseInt(amount), userId]);
  await db.query("INSERT INTO virtual_bets (userId,matchId,homeTeam,awayTeam,prediction,amount) VALUES (?,?,?,?,?,?)",[userId, matchId, homeTeam, awayTeam, prediction, parseInt(amount)]);
  virtualBetsPlaced++;
  res.json({ok:1, match: homeTeam+" vs "+awayTeam});
 }catch(e){ res.status(400).json({error:e.message}) }
});
app.post('/api/register',async(req,res)=>{ try{ const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase(); await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy,balance,gameBalance,miningBalance,referralBonus) VALUES (?,?,?,?,?,0,0,0,0)",[req.body.name,req.body.phone,req.body.password,code,req.body.ref||null]); const[r]=await db.query("SELECT * FROM users WHERE phone=? ORDER BY id DESC LIMIT 1",[req.body.phone]); res.json(r[0]); }catch(e){res.status(400).json({error:e.message})} });
app.post('/api/login',async(req,res)=>{ const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=? ORDER BY id DESC",[req.body.phone,req.body.password]); if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"}); });
app.get('/api/user/:id',async(req,res)=>{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); if(!u.length) return res.json({balance:0,gameBalance:0,miningBalance:0,totalInterest:0,investments:[]}); const[inv]=await db.query("SELECT * FROM investments WHERE userId=? ORDER BY id DESC",[req.params.id]); let total=0; let now=new Date(); for(let i of inv){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24)); if(d<0)d=0; let rate=i.rate||10; total+=Math.floor((i.amount||0)*rate/100*d);} const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.params.id]); let avail=total-w[0].s; if(avail<0)avail=0; const[depSum]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM deposits WHERE userId=? AND status='approved'",[req.params.id]); let vip='BRONZE'; let vipRate='8%'; if(depSum[0].s>=100000){vip='GOLD'; vipRate='12%'} else if(depSum[0].s>=20000){vip='SILVER'; vipRate='10%'} const[spinCheck]=await db.query("SELECT * FROM spins WHERE userId=? AND DATE(createdAt)=CURDATE()",[req.params.id]); const[mining]=await db.query("SELECT * FROM mining WHERE userId=? ORDER BY id DESC LIMIT 1",[req.params.id]); let miningEarn=0; if(mining.length && mining[0].isMining){ let mins=Math.floor((now-new Date(mining[0].lastClaim))/(1000*60)); miningEarn=mins*2; } res.json({...u[0], totalInterest:avail, investments:inv, totalDep:depSum[0].s, vip, vipRate, hasSpunToday: spinCheck.length>0, investCount: inv.length, miningPending: miningEarn, isMining: mining.length?mining[0].isMining:0}); });
app.get('/api/team/:id',async(req,res)=>{ const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]); if(!u.length) return res.json({team:[]}); const[team]=await db.query("SELECT phone,fullName,balance FROM users WHERE referredBy=?",[u[0].myReferralCode]); res.json({code:u[0].myReferralCode, bonus:u[0].referralBonus||0, count:team.length, team:team}); });
app.post('/api/spin',async(req,res)=>{ const uid=req.body.userId; const[inv]=await db.query("SELECT COUNT(*) as c FROM investments WHERE userId=?",[uid]); if(inv[0].c===0) return res.status(400).json({error:"Invest first!"}); const[last]=await db.query("SELECT * FROM spins WHERE userId=? AND DATE(createdAt)=CURDATE()",[uid]); if(last.length) return res.status(400).json({error:"Already spun"}); const prizes=[0,100,200,300,500,1000,2000,100]; let weights=[20,25,20,15,10,5,2,23]; let rand=Math.random()*100; let cum=0; let win=100; for(let i=0;i<prizes.length;i++){ cum+=weights[i]; if(rand<=cum){ win=prizes[i]; break; } } await db.query("INSERT INTO spins (userId,amount) VALUES (?,?)",[uid,win]); if(win>0) await db.query("UPDATE users SET gameBalance=gameBalance+? WHERE id=?",[win,uid]); res.json({win}); });
app.get('/api/p2p/list',async(req,res)=>{ const[r]=await db.query("SELECT p.*, u.phone FROM p2p_trades p JOIN users u ON p.sellerId=u.id WHERE p.status='open' ORDER BY id DESC LIMIT 20"); res.json(r); });
app.post('/api/p2p/create',async(req,res)=>{ const{userId,investId,price}=req.body; const[inv]=await db.query("SELECT * FROM investments WHERE id=? AND userId=?",[investId,userId]); if(!inv.length) return res.status(400).json({error:"Not found"}); await db.query("INSERT INTO p2p_trades (sellerId,club,amount,price,profit) VALUES (?,?,?,?,?)",[userId,inv[0].club,inv[0].amount,price,price-inv[0].amount]); await db.query("UPDATE investments SET status='selling' WHERE id=?",[investId]); res.json({ok:1}); });
app.post('/api/p2p/buy',async(req,res)=>{ const{buyerId,tradeId}=req.body; const[t]=await db.query("SELECT * FROM p2p_trades WHERE id=? AND status='open'",[tradeId]); if(!t.length) return res.status(400).json({error:"Sold"}); const[buyer]=await db.query("SELECT balance FROM users WHERE id=?",[buyerId]); if(buyer[0].balance < t[0].price) return res.status(400).json({error:"No balance"}); await db.query("UPDATE users SET balance=balance-? WHERE id=?",[t[0].price,buyerId]); await db.query("UPDATE users SET balance=balance+? WHERE id=?",[t[0].price*0.95,t[0].sellerId]); await db.query("UPDATE p2p_trades SET status='sold', buyerId=? WHERE id=?",[buyerId,tradeId]); const[inv]=await db.query("SELECT * FROM investments WHERE userId=? AND club=? AND status='selling' LIMIT 1",[t[0].sellerId,t[0].club]); if(inv.length){ await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays,startDate) VALUES (?,?,?,?,?,?)",[buyerId,inv[0].club,inv[0].amount,inv[0].rate,inv[0].lockDays,inv[0].startDate]); } res.json({ok:1}); });
app.get('/api/history/:id',async(req,res)=>{ try{ const uid=req.params.id; const[deps]=await db.query("SELECT id,amount,status,createdAt,'deposit' as type FROM deposits WHERE userId=? ORDER BY id DESC",[uid]); const[withs]=await db.query("SELECT id,amount,status,createdAt,'withdraw' as type FROM withdrawals WHERE userId=? ORDER BY id DESC",[uid]); const[invs]=await db.query("SELECT id,amount,club as status, startDate as createdAt,'invest' as type FROM investments WHERE userId=? ORDER BY id DESC",[uid]); const[spins]=await db.query("SELECT id,amount,createdAt,'profit' as type, 'spin' as status FROM spins WHERE userId=? ORDER BY id DESC",[uid]); const[vbets]=await db.query("SELECT id,amount,status,createdAt, CONCAT(homeTeam,' vs ',awayTeam) as status2, 'virtual' as type FROM virtual_bets WHERE userId=? ORDER BY id DESC",[uid]); let all=[...deps,...withs,...invs,...spins,...vbets].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)); res.json(all); }catch(e){res.json([])} });
app.post('/api/deposit',async(req,res)=>{ try{ const {userId, amount, airtelNo, screenshot} = req.body; if(!screenshot || screenshot.length < 100) return res.status(400).json({error:"Upload proof!"}); if(parseInt(amount) < 2000) return res.status(400).json({error:"Min 2000"}); const [dup] = await db.query("SELECT id FROM deposits WHERE screenshot=? LIMIT 1", [screenshot]); if(dup.length > 0) return res.status(400).json({error:"Screenshot used!"}); const[u]=await db.query("SELECT phone FROM users WHERE id=?",[userId]); await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot) VALUES (?,?,?,?,?)",[userId, u[0]?u[0].phone:"", parseInt(amount), airtelNo, screenshot]); res.json({ok:1}); }catch(e){ res.status(400).json({error:e.message}) } });
app.post('/api/invest',async(req,res)=>{ const{userId,club,amount}=req.body; if(amount<2000) return res.status(400).json({error:"Min 2000"}); const[u]=await db.query("SELECT balance FROM users WHERE id=?",[userId]); if(!u[0] || u[0].balance<amount) return res.status(400).json({error:"No balance"}); const rates={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8}; const locks={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8}; await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]); await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,rates[club],locks[club]]); res.json({ok:1}); });
app.post('/api/withdraw',async(req,res)=>{ const[inv]=await db.query("SELECT * FROM investments WHERE userId=?",[req.body.userId]); let total=0; let now=new Date(); for(let i of inv){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24)); let rate=i.rate||10; total+=Math.floor((i.amount||0)*rate/100*d);} const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.body.userId]); let avail=total-w[0].s; if(req.body.amount>avail) return res.status(400).json({error:"Only "+avail+" available"}); if(req.body.amount<5000) return res.status(400).json({error:"Min 5000"}); await db.query("INSERT INTO withdrawals (userId,amount,type) VALUES (?,?,'interest')",[req.body.userId,req.body.amount]); res.json({ok:1}); });
app.get('/api/admin/users',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT id,phone,fullName,password,balance,gameBalance FROM users ORDER BY id DESC LIMIT 100"); res.json(r); });
app.get('/api/admin/deposits',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC"); res.json(r); });
app.post('/api/admin/approve/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); const[d]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]); if(!d.length) return res.json({}); await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]); await db.query("UPDATE users SET balance=balance+? WHERE id=?",[d[0].amount,d[0].userId]); res.json({ok:1}); });
app.post('/api/admin/reject/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); await db.query("UPDATE deposits SET status='rejected' WHERE id=?",[req.params.id]); res.json({ok:1}); });
app.get('/api/admin/withdraws',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT w.*, u.phone FROM withdrawals w JOIN users u ON w.userId=u.id WHERE w.status='pending' ORDER BY id DESC"); res.json(r); });
app.post('/api/admin/withdraw/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); if(req.body.action==='approve') await db.query("UPDATE withdrawals SET status='approved' WHERE id=?",[req.params.id]); else await db.query("UPDATE withdrawals SET status='rejected' WHERE id=?",[req.params.id]); res.json({ok:1}); });
app.get('/api/admin/virtual',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT v.*, u.phone FROM virtual_bets v JOIN users u ON v.userId=u.id ORDER BY v.id DESC LIMIT 100"); res.json(r); });

const PWA_HEAD = `<link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#000"><link rel="icon" type="image/svg+xml" href="/icon.svg">`;
const FIELD_BG_CSS = `body{background:#080a0f;color:#fff;font-family:Arial;padding:15px;padding-bottom:90px;position:relative;min-height:100vh;overflow-x:hidden}body::before{content:'';position:fixed;inset:-20px;z-index:-3;background-image:linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.7)),url('https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200&q=80');background-size:110% 110%;background-position:center}.glass{background:rgba(18,22,35,0.85);backdrop-filter:blur(16px);border:1px solid rgba(255,215,0,0.15)}.field-logo-top{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(0,0,0,0.7);border:1px solid rgba(255,215,0,0.3);padding:6px 18px;border-radius:30px;display:flex;align-items:center;gap:8px;font-size:11px;font-weight:bold;color:gold}
.ticker{position:fixed;top:0;left:0;right:0;background:linear-gradient(90deg,gold,#ff8c00);color:#000;font-size:11px;font-weight:bold;padding:4px;white-space:nowrap;overflow:hidden;z-index:100}.ticker span{display:inline-block;padding-left:100%;animation:tickerMove 30s linear infinite} @keyframes tickerMove{0%{transform:translate(0,0)}100%{transform:translate(-100%,0)}}
.pw-wrap{position:relative;width:100%}.pw-wrap input{width:100%;padding-right:45px}.eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:18px;background:rgba(255,215,0,0.15);width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center}
`;
const pages = {
home: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:12px;border:none}button{background:gold;font-weight:bold}.card{padding:20px;border-radius:20px}</style></head><body><div class="ticker"><span>🔥 VIRTUAL PREMIER LEAGUE LIVE • Bet 200 UGX Win x2 • Halftime Betting Open</span></div><div class="field-logo-top" style="top:30px">⚽ LIFELINE • VIRTUAL</div><div class="card glass" style="margin-top:75px"><h2>💎 Lifeline Hybrid</h2><input id="n" placeholder="Full Name"><input id="p" placeholder="Phone"><div class="pw-wrap"><input id="pw" type="password" placeholder="Password"><span class="eye" onclick="togglePw('pw',this)">👁️</span></div><div class="pw-wrap"><input id="cpw" type="password" placeholder="Confirm Password"><span class="eye" onclick="togglePw('cpw',this)">👁️</span></div><input id="rf" placeholder="Referral Code"><button onclick="reg()">Register</button><button onclick="log()" style="background:#222;color:#fff;border:1px solid #333">Login</button><div id="pwMatch" style="font-size:10px"></div></div><script>
function togglePw(id,el){ let inp=document.getElementById(id); if(inp.type==="password"){ inp.type="text"; el.textContent="🙈"; } else { inp.type="password"; el.textContent="👁️"; } }
let c=new URLSearchParams(location.search).get("ref");if(c)rf.value=c;
pw.addEventListener('input',checkMatch); cpw.addEventListener('input',checkMatch);
function checkMatch(){ if(pw.value===cpw.value && pw.value){ pwMatch.textContent="✅ Match"; pwMatch.style.color="#0f0"; } else { pwMatch.textContent="❌ No match"; pwMatch.style.color="red"; } }
async function reg(){ if(pw.value!==cpw.value){ alert("Passwords don't match!"); return; } let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value,ref:rf.value})}); let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert(j.error)}
async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert("Wrong")}</script></body></html>`,
dash: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.bal{padding:22px;border-radius:24px;text-align:center}.walletGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.walletCard{padding:14px;border-radius:16px}.money-card{padding:14px;border-radius:16px;margin:12px 0;display:flex;gap:12px}button{width:100%;padding:14px;margin:7px 0;border-radius:12px;border:none;font-weight:bold}.gold{background:gold;color:#000}.dark{background:#222;color:#fff}.virtCard{background:linear-gradient(135deg,#1a0033,#000033);border:2px solid #ff00cc;padding:16px;border-radius:18px;margin:12px 0}.histBtn{display:flex;justify-content:space-between;background:#1a1f2e;border:1px solid gold;color:gold;padding:16px;border-radius:14px;text-decoration:none;font-weight:bold;margin:12px 0}</style></head><body><div class="ticker"><span id="liveTick">Virtual Premier League Live...</span></div><div class="field-logo-top" style="top:28px">⚽ HYBRID • VIRTUAL</div><div class="bal glass" style="margin-top:75px"><div style="color:gold;font-size:11px">⚽ LIFELINE VIRTUAL ⚽</div><div class="walletGrid"><div class="walletCard glass"><h4>💰 INVEST</h4><h2 id="b">0 UGX</h2></div><div class="walletCard glass"><h4>🎮 GAME</h4><h2 id="gb">0 UGX</h2></div></div><p id="ph"></p><p id="code" style="background:rgba(0,60,0,0.45);padding:6px 14px;border-radius:20px;display:inline-block;font-size:11px"></p></div><div class="virtCard" onclick="location.href='/virtual'" style="cursor:pointer"><div style="display:flex;justify-content:space-between"><b style="color:#ff00cc">🔥 VIRTUAL LEAGUE</b><span style="background:#ff00cc;color:#fff;padding:4px 10px;border-radius:20px;font-size:10px" id="virtPhase">BETTING</span></div><div id="virtPreview" style="margin-top:10px">Loading...</div><div style="margin-top:8px;background:rgba(255,0,204,0.15);padding:6px;border-radius:8px;font-size:11px;text-align:center">⏱️ <span id="virtTimer">--:--</span> • Tap to play →</div></div><div class="money-card glass"><div style="flex:1"><b>Deposit</b></div><button class="gold" style="width:auto" onclick="location.href='/deposit'">Deposit</button></div><div class="money-card glass"><div style="flex:1"><b>Invest</b></div><button class="gold" style="width:auto" onclick="location.href='/invest'">Invest</button></div><div class="money-card glass"><div style="flex:1"><b>Virtual League</b><br><small>Live + Halftime betting</small></div><button class="gold" style="width:auto;background:#ff00cc;color:#fff" onclick="location.href='/virtual'">Play</button></div><a href="/history" class="histBtn"><span>📜 History</span><span>→</span></a><button class="dark" onclick="location.href='/referral'">My Team</button><script>
let uid=localStorage.getItem("uid");if(!uid)location.href="/";
async function load(){ let r=await fetch("/api/user/"+uid);let u=await r.json(); document.getElementById('b').textContent=(u.balance||0).toLocaleString()+" UGX"; document.getElementById('gb').textContent=(u.gameBalance||0).toLocaleString()+" UGX"; document.getElementById('ph').textContent=u.phone; document.getElementById('code').textContent="Ref: "+(u.myReferralCode||""); }
async function loadVirtualPreview(){ let r=await fetch("/api/virtual/status"); let d=await r.json(); document.getElementById('virtPhase').textContent=d.phase.toUpperCase(); document.getElementById('virtTimer').textContent=Math.floor(d.timeLeft/60)+":"+String(d.timeLeft%60).padStart(2,'0'); if(d.phase==='betting'){ document.getElementById('virtPreview').innerHTML="NEXT: <b>"+d.next.home.short+" vs "+d.next.away.short+"</b><br><small>Bet now - 4 min window</small>"; } else if(d.phase==='halftime'){ document.getElementById('virtPreview').innerHTML="⏸️ HT <b>"+d.current.home.short+" "+d.current.homeScore+"-"+d.current.awayScore+" "+d.current.away.short+"</b><br><small style=color:orange>⚡ LIVE BET OPEN!</small>"; } else { document.getElementById('virtPreview').innerHTML="🔴 LIVE "+d.current.minute+"' <b>"+d.current.home.short+" "+d.current.homeScore+"-"+d.current.awayScore+" "+d.current.away.short+"</b>"; } document.getElementById('liveTick').textContent=d.phase==='halftime'? "⏸️ HALFTIME "+d.current.home.short+" "+d.current.homeScore+"-"+d.current.awayScore+" "+d.current.away.short+" - LIVE BETTING OPEN!" : d.phase==='betting'? "🟢 BETTING "+d.next.home.short+" vs "+d.next.away.short : "🔴 LIVE "+d.current.home.short+" "+d.current.homeScore+"-"+d.current.awayScore+" "+d.current.away.short+" "+d.current.minute+"'"; }
load(); setInterval(loadVirtualPreview,1000); loadVirtualPreview();
</script></body></html>`,
virtual: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>
${FIELD_BG_CSS}
.liveBox{background:radial-gradient(circle at center,#1a0033,#000);border:2px solid #ff00cc;border-radius:20px;padding:18px;margin:12px 0;text-align:center;position:relative;min-height:150px}
.score{font-size:38px;font-weight:900;color:#fff}
.timer{position:absolute;top:12px;right:14px;background:#ff00cc;color:#fff;padding:5px 12px;border-radius:20px;font-size:11px;font-weight:bold}
.phase{position:absolute;top:12px;left:14px;padding:5px 12px;border-radius:20px;font-size:10px;font-weight:bold}
.betting{background:#00ff88;color:#000}.live{background:red;color:#fff}.ht{background:orange;color:#000;animation:blink 1s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.6}}
.betBtn{padding:14px;border-radius:12px;border:none;font-weight:900;font-size:14px;width:32%;margin:2px;cursor:pointer}
.home{background:linear-gradient(45deg,#00ff88,#00aa55);color:#000}.draw{background:linear-gradient(45deg,gold,#ff8c00);color:#000}.away{background:linear-gradient(45deg,#0088ff,#0044aa);color:#fff}
.betBtn.selected{outline:3px solid #fff;transform:scale(1.05)}
.event{font-size:11px;padding:5px 8px;background:rgba(255,255,255,0.08);border-radius:6px;margin:3px 0;text-align:left}
input{width:100%;padding:12px;border-radius:10px;border:1px solid #333;background:#111;color:#fff;margin:8px 0}
button.gold{background:gold;color:#000;font-weight:bold;padding:14px;border-radius:12px;border:none;width:100%}
</style></head><body>
<div class="field-logo-top">🎮 VIRTUAL PREMIER LEAGUE</div>
<div style="margin-top:60px"><a href="/dashboard" style="color:gold;text-decoration:none">← Dashboard</a>
<h2 style="color:#ff00cc">🔥 Virtual Premier League</h2>
<p style="font-size:11px;color:#aaa">Realistic football • 0-0 to 7 goals max • Halftime live betting • Min 200 UGX • Win x2</p>
<div class="liveBox" id="liveBox">Loading...</div>
<div id="betSection">
<h3 id="betTitle">Bet</h3>
<div style="display:flex;justify-content:space-between">
<button class="betBtn home" id="btnHome" onclick="selectBet('home')"><span id="homeLabel">HOME</span><br><small>x2.0</small></button>
<button class="betBtn draw" id="btnDraw" onclick="selectBet('draw')">DRAW<br><small>x2.0</small></button>
<button class="betBtn away" id="btnAway" onclick="selectBet('away')"><span id="awayLabel">AWAY</span><br><small>x2.0</small></button>
</div>
<p style="font-size:12px">Selected: <b id="selBet" style="color:gold">None</b></p>
<input id="betAmount" type="number" value="500">
<button class="gold" onclick="placeBet()">Place Bet - Win x2</button>
<p style="font-size:10px;color:#aaa">Game Wallet: <span id="gBal">0</span> UGX</p>
</div>
<div style="margin-top:12px"><h4>📺 Commentary</h4><div id="events"></div></div>
<h3>🎫 My Bets</h3><div id="myBets"></div>
</div>
<script>
let uid=localStorage.getItem("uid"); let selected='';
function selectBet(p){ selected=p; document.getElementById('selBet').textContent=p.toUpperCase(); document.querySelectorAll('.betBtn').forEach(b=>b.classList.remove('selected')); document.getElementById('btn'+p.charAt(0).toUpperCase()+p.slice(1)).classList.add('selected'); }
async function placeBet(){
 if(!selected) return alert("Pick team");
 let amt=parseInt(document.getElementById('betAmount').value);
 let r=await fetch("/api/virtual/bet",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,prediction:selected,amount:amt})});
 let j=await r.json();
 if(j.ok){ alert("Bet placed!"); selected=''; loadBets(); } else alert(j.error);
}
async function loadStatus(){
 let r=await fetch("/api/virtual/status"); let d=await r.json();
 let box=document.getElementById('liveBox');
 let tl=Math.floor(d.timeLeft/60)+":"+String(d.timeLeft%60).padStart(2,'0');
 if(d.phase==='betting'){
   box.innerHTML=\`<span class="phase betting">BETTING \${tl}</span><span class="timer">\${tl}</span><div style="margin-top:32px"><small>NEXT MATCH</small><br><div class="score">\${d.next.home.short} VS \${d.next.away.short}</div><small>\${d.next.home.name} vs \${d.next.away.name}<br>\${d.totalBets} bets</small></div>\`;
   document.getElementById('betTitle').textContent='Bet NEXT: '+d.next.home.short+' vs '+d.next.away.short;
   document.getElementById('homeLabel').textContent=d.next.home.short; document.getElementById('awayLabel').textContent=d.next.away.short;
   document.getElementById('betSection').style.display='block';
   document.getElementById('events').innerHTML='<div class="event">Betting open for next match</div>';
 } else if(d.phase==='halftime'){
   box.innerHTML=\`<span class="phase ht">HALFTIME 45' \${tl}</span><span class="timer">HT \${tl}</span><div style="margin-top:32px"><div class="score">\${d.current.home.short} \${d.current.homeScore} - \${d.current.awayScore} \${d.current.away.short}</div><small>Halftime score<br><b style="color:orange">⚡ LIVE BETTING OPEN NOW!</b></small></div>\`;
   document.getElementById('betTitle').innerHTML='🔴 LIVE BET HT: '+d.current.home.short+' '+d.current.homeScore+'-'+d.current.awayScore+' '+d.current.away.short;
   document.getElementById('homeLabel').textContent=d.current.home.short; document.getElementById('awayLabel').textContent=d.current.away.short;
   document.getElementById('betSection').style.display='block';
   document.getElementById('events').innerHTML=(d.current.events||[]).map(e=>'<div class="event">'+e+'</div>').join('');
 } else {
   let ph=d.phase==='live1'?'1ST HALF':'2ND HALF';
   box.innerHTML=\`<span class="phase live">\${ph} \${d.current.minute}'</span><span class="timer">\${tl}</span><div style="margin-top:32px"><div class="score">\${d.current.home.short} \${d.current.homeScore} - \${d.current.awayScore} \${d.current.away.short}</div><small>\${d.current.minute}' • Live - Bet at halftime</small></div>\`;
   document.getElementById('betSection').style.display='none';
   document.getElementById('events').innerHTML=(d.current.events||[]).map(e=>'<div class="event">'+e+'</div>').join('');
 }
}
async function loadBets(){
 let r=await fetch("/api/virtual/mybets/"+uid); let d=await r.json();
 let h=d.map(b=>{let c=b.status==='won'?'#0f0':b.status==='lost'?'red':'gold'; return \`<div style="background:#111;padding:10px;border-radius:10px;margin:6px 0;border-left:3px solid \${c}"><b>\${b.homeTeam} vs \${b.awayTeam}</b> \${b.prediction.toUpperCase()} \${b.amount}<br><small>\${b.status} \${b.winAmount? '+'+b.winAmount:''}</small></div>\`}).join(''); document.getElementById('myBets').innerHTML=h||"No bets";
 let ru=await fetch("/api/user/"+uid); let u=await ru.json(); document.getElementById('gBal').textContent=(u.gameBalance||0).toLocaleString();
}
setInterval(loadStatus,1000); loadStatus(); loadBets(); setInterval(loadBets,4000);
</script></body></html>`,
history: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}a{color:gold}.card{background:#1a1f2e;border:1px solid gold;padding:14px;margin:8px 0;border-radius:12px;display:flex;justify-content:space-between}</style></head><body><div class="field-logo-top">📜 HISTORY</div><div style="margin-top:60px"><a href="/dashboard">← Back</a><h2>History</h2><div id="list">Loading...</div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/history/"+uid);let d=await r.json();let h="";for(let t of d){h+="<div class=card><span>"+t.type+" "+(t.amount||0)+"</span><span>"+(t.status||'')+"</span></div>";}document.getElementById('list').innerHTML=h||"No data";}load()</script></body></html>`,
deposit: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold}</style></head><body><div class="field-logo-top">DEPOSIT</div><div style="margin-top:60px"><a href="/dashboard" style="color:gold">← Back</a><h2>Deposit 7184154</h2><input id="am" placeholder="Amount"><input id="air" placeholder="Airtel No"><input type="file" id="file"><img id="prev" style="display:none;width:100%"><button onclick="dep()">Submit</button></div><script>let uid=localStorage.getItem("uid");let b64="";file.onchange=e=>{let r=new FileReader();r.onload=()=>{b64=r.result;prev.src=b64;prev.style.display="block"};r.readAsDataURL(e.target.files[0])};async function dep(){let r=await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:am.value,airtelNo:air.value,screenshot:b64})});let j=await r.json();if(j.ok){alert("Sent");location.href="/dashboard"}else alert(j.error)}</script></body></html>`,
invest: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.club{padding:16px;border-radius:18px;margin:14px 0;display:flex;gap:14px}.badge{width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#fff;background:red}.info{flex:1}input,button{width:100%;padding:12px;border-radius:10px;border:none;margin-top:6px}button{background:gold}a{color:gold}</style></head><body><div class="field-logo-top">CLUBS</div><div style="margin-top:60px"><a href="/dashboard">← Back</a><h2>Invest</h2><p>Bal: <b id="bal">0</b></p><div class="club glass"><div class="badge">ARS</div><div class="info"><h3>Arsenal 10%</h3><input id="a-arsenal" placeholder="2000 min"><button onclick="inv('arsenal')">Invest</button></div></div><div class="club glass"><div class="badge">MUN</div><div class="info"><h3>Man Utd 10%</h3><input id="a-manutd" placeholder="Amount"><button onclick="inv('manutd')">Invest</button></div></div><div class="club glass"><div class="badge">MCI</div><div class="info"><h3>Man City 10%</h3><input id="a-mancity" placeholder="Amount"><button onclick="inv('mancity')">Invest</button></div></div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/user/"+uid);let u=await r.json();bal.textContent=u.balance;}async function inv(c){let v=document.getElementById("a-"+c).value;let r=await fetch("/api/invest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,club:c,amount:parseInt(v)})});let j=await r.json();if(j.ok){alert("Done");location.href="/dashboard"}else alert(j.error)}load()</script></body></html>`,
referral: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${PWA_HEAD}<style>${FIELD_BG_CSS}.card{padding:15px;border-radius:12px;margin:10px 0;text-align:center}input,button{width:100%;padding:12px;border-radius:8px;border:none;margin:5px 0}button{background:gold}a{color:gold}</style></head><body><div class="field-logo-top">TEAM</div><div style="margin-top:60px"><a href="/dashboard">Back</a><h2>Team</h2><div class="card glass"><h3>Code: <span id="code"></span></h3><input id="link" readonly><button onclick="copy()">Copy</button></div><div id="team"></div></div><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/team/"+uid);let j=await r.json();code.textContent=j.code;link.value=location.origin+"/?ref="+j.code;let html="";for(let t of j.team){html+="<div class=card glass style=text-align:left>"+t.phone+"</div>"}team.innerHTML=html||"No team";}function copy(){link.select();document.execCommand("copy");alert("Copied")}load()</script></body></html>`,
admin: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}input,button{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:none}button{background:gold;font-weight:bold}.tab{padding:10px;background:#222;display:inline-block;margin:5px;border-radius:5px;cursor:pointer}.active{background:gold;color:#000}</style></head><body><div id="loginBox"><h2>Admin</h2><input id="pass" type="password" placeholder="LIFELINE123"><button onclick="check()">Unlock</button></div><div id="adminBox" style="display:none"><h2>ADMIN</h2><div><span class="tab active" id="t1" onclick="showTab('dep')">Deposits</span><span class="tab" id="t2" onclick="showTab('with')">Withdraws</span><span class="tab" id="t3" onclick="showTab('virt')">Virtual</span><span class="tab" id="t4" onclick="showTab('users')">Users</span></div><div id="depBox"><div id="l"></div></div><div id="withBox" style="display:none"><div id="lw"></div></div><div id="virtBox" style="display:none"><div id="lvirt"></div></div><div id="usersBox" style="display:none"><input id="search" placeholder="Search"><button onclick="loadUsers()">Search</button><div id="lu"></div></div></div><script>
const AP="LIFELINE123";let en="";function check(){if(pass.value===AP){en=pass.value;loginBox.style.display="none";adminBox.style.display="block";ld()}}
function showTab(t){depBox.style.display=t==='dep'?'block':'none';withBox.style.display=t==='with'?'block':'none';virtBox.style.display=t==='virt'?'block':'none';usersBox.style.display=t==='users'?'block':'none';document.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));if(t==='dep'){t1.classList.add('active');ld()}if(t==='with'){t2.classList.add('active');lw()}if(t==='virt'){t3.classList.add('active');loadVirt()}if(t==='users'){t4.classList.add('active');loadUsers()}}
async function ld(){let r=await fetch("/api/admin/deposits?key="+en);let d=await r.json();let e=document.getElementById("l");e.innerHTML=d.map(x=>"<div style=background:#222;padding:10px;margin:6px 0><b>"+x.phone+"</b> "+x.amount+"<button onclick=ap("+x.id+")>Approve</button></div>").join('')||"No pending"}
async function ap(id){await fetch("/api/admin/approve/"+id+"?key="+en,{method:"POST"});ld()}
async function lw(){let r=await fetch("/api/admin/withdraws?key="+en);let d=await r.json();document.getElementById('lw').innerHTML=d.map(x=>"<div style=background:#222;padding:10px;margin:6px 0>"+x.phone+" "+x.amount+"<button onclick=aw("+x.id+",'approve')>OK</button></div>").join('')||"No pending"}
async function aw(id,act){await fetch("/api/admin/withdraw/"+id+"?key="+en,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:act})});lw()}
async function loadVirt(){let r=await fetch("/api/admin/virtual?key="+en);let d=await r.json();let sum={home:0,draw:0,away:0,won:0,lost:0,profit:0}; for(let b of d){ sum[b.prediction]+=b.amount; if(b.status==='won') sum.won+=b.winAmount; if(b.status==='lost') sum.lost+=b.amount; } sum.profit=sum.lost - sum.won; document.getElementById('lvirt').innerHTML="<div style=background:#111;padding:12px;border-radius:10px;border:1px solid #ff00cc;margin-bottom:10px><b style=color:#ff00cc>HOUSE STATS (hidden from users)</b><br>H:"+sum.home+" D:"+sum.draw+" A:"+sum.away+"<br>Paid: "+sum.won+"<br>Collected: "+sum.lost+"<br><b style=color:"+(sum.profit>0?"#0f0":"red")+">Profit: "+sum.profit+"</b></div>"+d.slice(0,80).map(b=>"<div style=background:#222;padding:6px;margin:4px 0;border-radius:6px;font-size:11px>"+b.phone+" "+b.homeTeam+" vs "+b.awayTeam+" "+b.prediction+" "+b.amount+" => <b style=color:"+(b.status==='won'?"#0f0":"red")+">"+b.status+" "+(b.winAmount||0)+"</b></div>").join('')}
async function loadUsers(){let q=document.getElementById('search').value;let r=await fetch("/api/admin/users?key="+en+"&search="+encodeURIComponent(q));let d=await r.json();document.getElementById('lu').innerHTML=d.map(u=>"<div style=background:#222;padding:8px;margin:4px 0>"+u.phone+" Bal:"+u.balance+" Game:"+u.gameBalance+"</div>").join('')}
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
app.listen(process.env.PORT||3000,()=>console.log("FINAL VIRTUAL READY - hidden edge, halftime bet, max7, 0-0"));
