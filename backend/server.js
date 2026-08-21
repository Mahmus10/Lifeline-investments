const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
let db;
const ADMIN_KEY="LIFELINE123";
const TG_LINK="https://t.me/+CbCGmt2mSgcwY2U0";
async function init(){
 try{
  const u=process.env.DATABASE_URL||process.env.MYSQL_URL;
  db=await mysql.createConnection(u);
  await db.query("CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(100), phone VARCHAR(30), password VARCHAR(100), myReferralCode VARCHAR(20), referredBy VARCHAR(20), balance INT DEFAULT 0, referralBonus INT DEFAULT 0)");
  await db.query("CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, phone VARCHAR(30), amount INT, airtelNo VARCHAR(30), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await db.query("CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, club VARCHAR(50), amount INT, rate INT, lockDays INT, startDate DATETIME DEFAULT CURRENT_TIMESTAMP, status VARCHAR(20) DEFAULT 'active')");
  await db.query("CREATE TABLE IF NOT EXISTS withdrawals (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount INT, type VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)");
  try{await db.query("ALTER TABLE users ADD COLUMN referralBonus INT DEFAULT 0")}catch(e){}
  try{await db.query("UPDATE investments SET rate=10, lockDays=10 WHERE club IN ('arsenal','manutd','mancity') AND (rate IS NULL OR rate=0)")}catch(e){}
  try{await db.query("UPDATE investments SET rate=8, lockDays=8 WHERE club IN ('chelsea','liverpool') AND (rate IS NULL OR rate=0)")}catch(e){}
  console.log("DB OK CLEAN");
 }catch(e){console.log(e.message)}
}
init();

app.post('/api/register',async(req,res)=>{
 try{
  const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase();
  await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy,balance,referralBonus) VALUES (?,?,?,?,?,0,0)",[req.body.name,req.body.phone,req.body.password,code,req.body.ref||null]);
  const[r]=await db.query("SELECT * FROM users WHERE phone=?",[req.body.phone]); res.json(r[0]);
 }catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/login',async(req,res)=>{const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]); if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"});});
app.get('/api/user/:id',async(req,res)=>{
 const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]);
 const[inv]=await db.query("SELECT * FROM investments WHERE userId=? AND status='active'",[req.params.id]);
 let total=0; let now=new Date(); const rm={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8};
 for(let i of inv){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24)); if(d<0)d=0; let r=i.rate||rm[i.club]||10; total+=Math.floor((i.amount||0)*r/100*d);}
 const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.params.id]);
 let avail=total-w[0].s; if(avail<0)avail=0;
 res.json({...u[0], totalInterest:avail, investments:inv});
});
app.get('/api/team/:id',async(req,res)=>{
 const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]);
 if(!u.length) return res.json({team:[]});
 const[team]=await db.query("SELECT phone,fullName,balance FROM users WHERE referredBy=?",[u[0].myReferralCode]);
 res.json({code:u[0].myReferralCode, bonus:u[0].referralBonus||0, count:team.length, team:team});
});
app.post('/api/deposit',async(req,res)=>{
 const[u]=await db.query("SELECT phone FROM users WHERE id=?",[req.body.userId]);
 await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot) VALUES (?,?,?,?,?)",[req.body.userId, u[0]?u[0].phone:"", parseInt(req.body.amount), req.body.airtelNo, req.body.screenshot||""]);
 res.json({ok:1});
});
app.post('/api/invest',async(req,res)=>{
 const{userId,club,amount}=req.body;
 if(amount<2000) return res.status(400).json({error:"Min 2000"});
 const[u]=await db.query("SELECT balance FROM users WHERE id=?",[userId]);
 if(u[0].balance<amount) return res.status(400).json({error:"Insufficient balance"});
 const rates={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8};
 const locks={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8};
 await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]);
 await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,rates[club],locks[club]]);
 res.json({ok:1});
});
app.post('/api/withdraw',async(req,res)=>{
 const[inv]=await db.query("SELECT * FROM investments WHERE userId=? AND status='active'",[req.body.userId]);
 let total=0; let now=new Date(); const rm={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8};
 for(let i of inv){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24)); total+=Math.floor((i.amount||0)*(i.rate||rm[i.club]||10)/100*d);}
 const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.body.userId]);
 let avail=total-w[0].s;
 if(req.body.amount>avail) return res.status(400).json({error:"Only "+avail+" available"});
 if(req.body.amount<5000) return res.status(400).json({error:"Min 5000"});
 await db.query("INSERT INTO withdrawals (userId,amount,type) VALUES (?,?,'interest')",[req.body.userId,req.body.amount]);
 res.json({ok:1});
});
app.get('/api/admin/deposits',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC"); res.json(r); });
app.post('/api/admin/approve/:id',async(req,res)=>{
 if(req.query.key!==ADMIN_KEY) return res.status(401).json({});
 const[d]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]);
 await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]);
 await db.query("UPDATE users SET balance=balance+? WHERE id=?",[d[0].amount,d[0].userId]);
 const[u]=await db.query("SELECT * FROM users WHERE id=?",[d[0].userId]);
 if(u[0].referredBy){ const[ref]=await db.query("SELECT * FROM users WHERE myReferralCode=?",[u[0].referredBy]); if(ref.length){let b=Math.floor(d[0].amount*0.1); await db.query("UPDATE users SET balance=balance+?, referralBonus=referralBonus+? WHERE id=?",[b,b,ref[0].id]);} }
 res.json({ok:1});
});
app.get('/api/admin/withdraws',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json([]); const[r]=await db.query("SELECT w.*, u.phone FROM withdrawals w JOIN users u ON w.userId=u.id WHERE w.status='pending'"); res.json(r); });
app.post('/api/admin/withdraw/:id',async(req,res)=>{ if(req.query.key!==ADMIN_KEY) return res.status(401).json({}); if(req.body.action==='approve') await db.query("UPDATE withdrawals SET status='approved' WHERE id=?",[req.params.id]); else await db.query("UPDATE withdrawals SET status='rejected' WHERE id=?",[req.params.id]); res.json({ok:1}); });

const pages = {
home: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:20px}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}.tgbtn{position:fixed;bottom:20px;right:20px;background:#0088cc;color:#fff;padding:15px;border-radius:50px;text-decoration:none}</style></head><body><a class="tgbtn" href="TG_LINK_PLACE" target="_blank">Telegram Care</a><h2>Lifeline Investments</h2><input id="n" placeholder="Name"><input id="p" placeholder="Phone"><input id="pw" type="password" placeholder="Password"><input id="rf" placeholder="Referral Code"><button onclick="reg()">Register</button><button onclick="log()" style="background:#333;color:#fff">Login</button><p style="text-align:center"><a href="TG_LINK_PLACE" style="color:#0088cc">Join Telegram Customer Care</a></p><script>let c=new URLSearchParams(location.search).get("ref");if(c)rf.value=c;async function reg(){let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value,ref:rf.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert(j.error)}async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert("Wrong")}</script></body></html>',
dash: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:15px;padding-bottom:80px}button{width:100%;padding:14px;margin:6px 0;border-radius:10px;border:none;font-weight:bold}.gold{background:gold}.dark{background:#222;color:#fff}.bal{background:#111;padding:15px;border-radius:15px;text-align:center}.tgbtn{position:fixed;bottom:20px;right:20px;background:#0088cc;color:#fff;padding:15px;border-radius:50px;text-decoration:none}</style></head><body><a class="tgbtn" href="TG_LINK_PLACE" target="_blank">Telegram</a><div class="bal"><h1 id="b">0 UGX</h1><p id="ph"></p><p>Interest: <span id="int" style="color:#0f0">0</span></p><p id="code" style="color:gold"></p></div><button class="gold" onclick="location.href=\'/deposit\'">Deposit</button><button class="gold" onclick="location.href=\'/invest\'">Invest</button><button class="dark" onclick="withdraw()">Withdraw Interest</button><button class="dark" onclick="location.href=\'/myinvest\'">My Invest</button><button class="dark" onclick="location.href=\'/referral\'" style="background:gold;color:#000">My Team / Referral 10%</button><button style="background:#0088cc;color:#fff" onclick="window.open(\'TG_LINK_PLACE\')">Telegram Customer Care</button><button class="dark" onclick="localStorage.clear();location.href=\'/\'">Logout</button><script>let uid=localStorage.getItem("uid");if(!uid)location.href="/";async function load(){let r=await fetch("/api/user/"+uid);let u=await r.json();b.textContent=(u.balance||0)+" UGX";ph.textContent=u.phone;int.textContent=(u.totalInterest||0)+" UGX";code.textContent="Ref: "+(u.myReferralCode||"")+" 10% Bonus"}async function withdraw(){let a=prompt("Amount min 5000");if(!a)return;let r=await fetch("/api/withdraw",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:parseInt(a)})});let j=await r.json();alert(j.error||"Sent")}load()</script></body></html>',
deposit: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;padding:20px;font-family:Arial}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><a href="/dashboard" style="color:gold">Back</a><h2>Deposit Min 2000</h2><input id="am" placeholder="Amount"><input id="air" placeholder="Airtel No"><input type="file" id="file"><img id="prev" style="display:none;width:100%"><button onclick="dep()">Submit</button><button style="background:#0088cc;color:#fff" onclick="window.open(\'TG_LINK_PLACE\')">Telegram Help</button><script>let uid=localStorage.getItem("uid");let b64="";file.addEventListener("change",e=>{let r=new FileReader();r.onload=()=>{b64=r.result;prev.src=b64;prev.style.display="block"};r.readAsDataURL(e.target.files[0])});async function dep(){let r=await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:am.value,airtelNo:air.value,screenshot:b64})});let j=await r.json();if(j.ok){alert("Sent!");location.href="/dashboard"}else alert(j.error)}</script></body></html>',
invest: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}.club{background:#111;padding:15px;border-radius:12px;margin:10px 0}button{width:100%;padding:12px;border-radius:8px;border:none;background:gold;font-weight:bold}input{width:100%;padding:12px;border-radius:8px;border:none}a{color:gold}</style></head><body><a href="/dashboard">Back</a><h2>Invest Min 2000</h2><p>Bal: <span id="bal">0</span></p><div class="club"><h3>Arsenal 10%/10d</h3><input id="a-arsenal" placeholder="2000"><button onclick="inv(\'arsenal\')">Invest</button></div><div class="club"><h3>Man Utd 10%/10d</h3><input id="a-manutd"><button onclick="inv(\'manutd\')">Invest</button></div><div class="club"><h3>Man City 10%/10d</h3><input id="a-mancity"><button onclick="inv(\'mancity\')">Invest</button></div><div class="club"><h3>Chelsea 8%/8d</h3><input id="a-chelsea"><button onclick="inv(\'chelsea\')">Invest</button></div><div class="club"><h3>Liverpool 8%/8d</h3><input id="a-liverpool"><button onclick="inv(\'liverpool\')">Invest</button></div><button style="background:#0088cc;color:#fff" onclick="window.open(\'TG_LINK_PLACE\')">Telegram Care</button><script>let uid=localStorage.getItem("uid");async function load(){let r=await fetch("/api/user/"+uid);let u=await r.json();bal.textContent=u.balance}async function inv(c){let v=document.getElementById("a-"+c).value;if(parseInt(v)<2000)return alert("Min 2000");let r=await fetch("/api/invest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,club:c,amount:parseInt(v)})});let j=await r.json();if(j.ok){alert("Invested!");location.href="/myinvest"}else alert(j.error)}load()</script></body></html>',
myinvest: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}.card{background:#111;padding:12px;margin:10px 0;border-radius:10px}a{color:gold}</style></head><body><a href="/dashboard">Back</a><h2>My Invest</h2><div id="l"></div><button style
