const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'10mb'}));
let db;
const ADMIN_KEY="LIFELINE123";
async function init(){
 try{
  const u=process.env.DATABASE_URL||process.env.MYSQL_URL;
  db=await mysql.createConnection(u);
  try{await db.query("ALTER TABLE users MODIFY fullName VARCHAR(100) NULL")}catch(e){}
  try{await db.query("ALTER TABLE deposits ADD COLUMN screenshot TEXT")}catch(e){}
  try{await db.query("ALTER TABLE users ADD COLUMN referralBonus INT DEFAULT 0")}catch(e){}
  try{await db.query("CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, club VARCHAR(50), amount INT, rate INT, lockDays INT, startDate DATETIME DEFAULT CURRENT_TIMESTAMP, status VARCHAR(20) DEFAULT 'active')")}catch(e){}
  try{await db.query("CREATE TABLE IF NOT EXISTS withdrawals (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount INT, type VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)")}catch(e){}
  console.log("DB OK");
 }catch(e){console.log(e.message)}
}
init();

app.post('/api/register',async(req,res)=>{
 try{
  const{name,phone,password,ref}=req.body;
  const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase();
  try{
   await db.query("INSERT INTO users (fullName,name,username,phone,password,myReferralCode,referredBy,balance,bonus,referralBonus) VALUES (?,?,?,?,?,?,?,0,0,0)",[name,name,name,phone,password,code,ref||null]);
  }catch(e){
   await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy) VALUES (?,?,?,?,?)",[name,phone,password,code,ref||null]);
  }
  const[r]=await db.query("SELECT * FROM users WHERE phone=?",[phone]);
  res.json(r[0]);
 }catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/login',async(req,res)=>{
 const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]);
 if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"});
});
app.get('/api/user/:id',async(req,res)=>{
 const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]);
 const[inv]=await db.query("SELECT * FROM investments WHERE userId=? AND status='active'",[req.params.id]);
 let totalInterest=0; let now=new Date();
 for(let i of inv){
  let days=Math.floor((now - new Date(i.startDate))/(1000*60*60*24));
  if(days<0) days=0;
  totalInterest+= Math.floor(i.amount * i.rate/100 * days);
 }
 // subtract already withdrawn pending/approved
 const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.params.id]);
 let available = totalInterest - w[0].s;
 if(available<0) available=0;
 res.json({...u[0], totalInterest:available, rawInterest:totalInterest, investments:inv});
});
app.post('/api/deposit',async(req,res)=>{
 const{userId,amount,airtelNo,screenshot}=req.body;
 const[u]=await db.query("SELECT * FROM users WHERE id=?",[userId]);
 await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot,status) VALUES (?,?,?,?,?,'pending')",[userId,u[0].phone,amount,airtelNo,screenshot||null]);
 res.json({ok:1});
});
app.post('/api/invest',async(req,res)=>{
 try{
  const{userId,club,amount}=req.body;
  const clubs={arsenal:{rate:10,lock:10},manutd:{rate:10,lock:10},mancity:{rate:10,lock:10},chelsea:{rate:8,lock:8},liverpool:{rate:8,lock:8}};
  if(!clubs[club]) return res.status(400).json({error:"Invalid"});
  const[u]=await db.query("SELECT * FROM users WHERE id=?",[userId]);
  if((u[0].balance||0) < amount) return res.status(400).json({error:"Insufficient balance"});
  await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]);
  await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,clubs[club].rate,clubs[club].lock]);
  res.json({ok:1});
 }catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/withdraw',async(req,res)=>{
 try{
  const{userId,amount,phone}=req.body;
  if(amount<5000) return res.status(400).json({error:"Min withdraw is 5000"});
  const[u]=await db.query("SELECT * FROM users WHERE id=?",[userId]);
  const[inv]=await db.query("SELECT * FROM investments WHERE userId=? AND status='active'",[userId]);
  let totalInterest=0; let now=new Date();
  for(let i of inv){ let days=Math.floor((now - new Date(i.startDate))/(1000*60*60*24)); totalInterest+= Math.floor(i.amount * i.rate/100 * days); }
  const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[userId]);
  let available = totalInterest - w[0].s;
  if(amount>available) return res.status(400).json({error:"You have only "+available+" UGX interest available"});
  await db.query("INSERT INTO withdrawals (userId,amount,type,status) VALUES (?,?,'interest','pending')",[userId,amount]);
  res.json({ok:1});
 }catch(e){res.status(400).json({error:e.message})}
});
app.get('/api/admin/deposits',async(req,res)=>{
 if(req.query.key!==ADMIN_KEY) return res.status(401).json([]);
 const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC");
 res.json(r);
});
app.post('/api/admin/approve/:id',async(req,res)=>{
 if(req.query.key!==ADMIN_KEY) return res.status(401).json({error:"no"});
 const[d]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]);
 if(!d.length) return res.json({ok:0});
 await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]);
 await db.query("UPDATE users SET balance=balance+? WHERE id=?",[d[0].amount,d[0].userId]);
 try{
  const[u]=await db.query("SELECT * FROM users WHERE id=?",[d[0].userId]);
  if(u[0].referredBy){
   const[refUser]=await db.query("SELECT * FROM users WHERE myReferralCode=?",[u[0].referredBy]);
   if(refUser.length){
    let bonus=Math.floor(d[0].amount*0.1);
    await db.query("UPDATE users SET balance=balance+?, referralBonus=referralBonus+? WHERE id=?",[bonus,bonus,refUser[0].id]);
   }
  }
 }catch(e){}
 res.json({ok:1});
});
app.get('/api/admin/withdraws',async(req,res)=>{
 if(req.query.key!==ADMIN_KEY) return res.status(401).json([]);
 const[r]=await db.query("SELECT w.*, u.phone FROM withdrawals w JOIN users u ON w.userId=u.id WHERE w.status='pending' ORDER BY w.id DESC");
 res.json(r);
});
app.post('/api/admin/withdraw/:id',async(req,res)=>{
 if(req.query.key!==ADMIN_KEY) return res.status(401).json({error:"no"});
 const{action}=req.body; // approve / reject
 if(action==='approve'){
  await db.query("UPDATE withdrawals SET status='approved' WHERE id=?",[req.params.id]);
 }else{
  await db.query("UPDATE withdrawals SET status='rejected' WHERE id=?",[req.params.id]);
 }
 res.json({ok:1});
});

// PAGES
app.get('/',(req,res)=>{
 res.send('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:20px}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><h2>Lifeline Investments</h2><input id="n" placeholder="Name"><input id="p" placeholder="Phone"><input id="pw" type="password" placeholder="Password"><input id="rf" placeholder="Referral code"><button onclick="reg()">Register</button><button onclick="log()" style="background:#333;color:#fff">Login</button><script>async function reg(){let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value,ref:rf.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert(j.error)}async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert("Wrong")}</script></body></html>');
});
app.get('/dashboard',(req,res)=>{
 res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:15px}button{width:100%;padding:14px;margin:6px 0;border-radius:10px;border:none;font-weight:bold}.gold{background:gold}.dark{background:#222;color:#fff}.bal{background:#111;padding:15px;border-radius:15px;text-align:center;margin-bottom:10px}.green{color:#0f0}</style></head><body>
 <div class="bal"><h3>Balance</h3><h1 id="b">0 UGX</h1><p id="ph"></p><p>Interest Available: <span id="int" class="green">0 UGX</span></p><p id="code" style="font-size:12px;color:gold"></p><p style="font-size:11px;color:#888">Min withdraw 5k - Anytime</p></div>
 <button class="gold" onclick="location.href='/deposit'">💵 Deposit</button>
 <button class="gold" onclick="location.href='/invest'">📈 Invest in Clubs</button>
 <button class="dark" onclick="withdraw()">💸 Withdraw Interest</button>
 <button class="dark" onclick="location.href='/myinvest'">📊 My Investments</button>
 <button class="dark" onclick="location.href='/withdraws'">📜 Withdraw History</button>
 <button class="dark" onclick="localStorage.removeItem('uid');location.href='/'">Logout</button>
 <script>let uid=localStorage.getItem('uid');if(!uid)location.href='/';async function load(){let r=await fetch('/api/user/'+uid);let u=await r.json();document.getElementById('b').textContent=(u.balance||0)+' UGX';document.getElementById('ph').textContent=u.phone||'';document.getElementById('int').textContent=(u.totalInterest||0)+' UGX';document.getElementById('code').textContent='Ref Code: '+(u.myReferralCode||'')+' | Earn 10%';}async function withdraw(){let a=prompt('Enter amount to withdraw (min 5000)');if(!a)return;let r=await fetch('/api/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:uid,amount:parseInt(a)})});let j=await r.json();alert(j.error||'Withdraw request sent! Wait approval');}load()</script></body></html>`);
});
app.get('/deposit',(req,res)=>{
 res.send('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:20px}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><a href="/dashboard" style="color:gold">← Back</a><h2>💵 Deposit</h2><input id="am" placeholder="Amount"><input id="air" placeholder="Your Airtel No"><input type="file" id="file" accept="image/*"><img id="prev" style="display:none;width:100%;margin:10px 0"><button onclick="dep()">Submit</button><script>let uid=localStorage.getItem("uid");let b64="";document.getElementById("file").addEventListener("change",e=>{let r=new FileReader();r.onload=()=>{b64=r.result;let im=document.getElementById("prev");im.src=b64;im.style.display="block"};r.readAsDataURL(e.target.files[0])});async function dep(){if(!b64){alert("Upload screenshot");return}await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:am.value,airtelNo:air.value,screenshot:b64})});alert("Sent!");location.href="/dashboard"}</script></body></html>');
});
app.get('/invest',(req,res)=>{
 res.send(`
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:15px}.club{background:#111;padding:15px;border-radius:12px;margin:10px 0;border-left:4px solid gold} button{width:100%;padding:12px;border-radius:8px;border:none;background:gold;font-weight:bold;margin-top:8px} input{width:100%;padding:12px;border-radius:8px;border:none;margin:5px 0} a{color:gold}</style></head><body>
<a href="/dashboard">← Back</a><h2>📈 Invest in Football Clubs</h2><p>Balance: <span id="bal">0</span> UGX</p>
<div class="club" style="border-color:red"><h3>🔴 Arsenal F/C</h3><p>10% daily - Locked 10 days</p><input id="a-arsenal" placeholder="Amount"><button onclick="inv('arsenal')">Invest Arsenal</button></div>
<div class="club" style="border-color:#ff0000"><h3>🔴 Man United F/C</h3><p>10% daily - Locked 10 days</p><input id="a-manutd" placeholder="Amount"><button onclick="inv('manutd')">Invest Man Utd</button></div>
<div class="club" style="border-color:#6ec1e4"><h3>🔵 Man City F/C</h3><p>10% daily - Locked 10 days</p><input id="a-mancity" placeholder="Amount"><button onclick="inv('mancity')">Invest Man City</button></div>
<div class="club" style="border-color:#034694"><h3>🔵 Chelsea F/C</h3><p>8% daily - Locked 8 days</p><input id="a-chelsea" placeholder="Amount"><button onclick="inv('chelsea')">Invest Chelsea</button></div>
<div class="club" style="border-color:#c8102e"><h3>🔴 Liverpool F/C</h3><p>8% daily - Locked 8 days</p><input id="a-liverpool" placeholder="Amount"><button onclick="inv('liverpool')">Invest Liverpool</button></div>
<script>let uid=localStorage.getItem('uid');async function load(){let r=await fetch('/api/user/'+uid);let u=await r.json();document.getElementById('bal').textContent=u.balance}async function inv(club){let amt=document.getElementById('a-'+club).value;if(!amt)return alert('Enter amount');let r=await fetch('/api/invest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:uid,club,amount:parseInt(amt)})});let j=await r.json();if(j.ok){alert('Invested!');location.href='/myinvest'}else alert(j.error)}load()</script>
</body></html>
`);
});
app.get('/myinvest',(req,res)=>{
 res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:15px}.card{background:#111;padding:12px;margin:10px 0;border-radius:10px}a{color:gold}</style></head><body><a href="/dashboard">← Back</a><h2>My Investments</h2><div id="l">Loading...</div><script>let uid=localStorage.getItem('uid');async function load(){let r=await fetch('/api/user/'+uid);let u=await r.json();let list=u.investments||[];let now=new Date();let html='';for(let i of list){let days=Math.floor((now-new Date(i.startDate))/(1000*60*60*24));let profit=Math.floor(i.amount*i.rate/100*days);let left=i.lockDays-days;html+='<div class="card"><b>'+i.club.toUpperCase()+'</b> - '+i.amount+' UGX<br>Rate: '+i.rate+'% daily | Lock: '+i.lockDays+' days<br>Running: '+days+' days<br>Profit: '+profit+' UGX<br>'+(left>0?'Locked - '+left+' days left':'✅ UNLOCKED - You can withdraw interest')+'</div>'}document.getElementById('l').innerHTML=html||'No investments';}load()</script></body></html>`);
});
app.get('/withdraws',(req,res)=>{
 res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:15px}a{color:gold}.card{background:#111;padding:10px;margin:8px 0;border-radius:8px}</style></head><body><a href="/dashboard">← Back</a><h2>Withdraw History</h2><div id="l">Loading...</div><script>let uid=localStorage.getItem('uid');async function load(){let r=await fetch('/api/user/'+uid);let u=await r.json();document.getElementById('l').innerHTML='Interest Available: '+u.totalInterest+' UGX<br><br>Your withdrawals are approved in Admin panel';}load()</script></body></html>`);
});
app.get('/admin',(req,res)=>{
 res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}input,button{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:none}button{background:gold;font-weight:bold}.tab{padding:10px;background:#222;display:inline-block;margin:5px;border-radius:5px;cursor:pointer}.active{background:gold;color:#000}</style></head><body>
<div id="loginBox"><h2>Admin Login</h2><input id="pass" type="password" placeholder="Password"><button onclick="check()">Unlock</button><p id="err"></p></div>
<div id="adminBox" style="display:none">
<h2>ADMIN PANEL</h2>
<div><span class="tab active" id="t1" onclick="showTab('dep')">Deposits</span><span class="tab" id="t2" onclick="showTab('with')">Withdraws</span></div>
<div id="depBox"><h3>Pending Deposits</h3><div id="l">Loading...</div></div>
<div id="withBox" style="display:none"><h3>Pending Withdraws (Min 5k)</h3><div id="lw">Loading...</div></div>
</div>
<script>const ADMIN_PASS="LIFELINE123";let entered="";function check(){let v=document.getElementById("pass").value;if(v===ADMIN_PASS){entered=v;document.getElementById("loginBox").style.display="none";document.getElementById("adminBox").style.display="block";ld();lw()}else document.getElementById("err").textContent="Wrong"}function showTab(t){if(t==='dep'){document.getElementById('depBox').style.display='block';document.getElementById('withBox').style.display='none';document.getElementById('t1').classList.add('active');document.getElementById('t2').classList.remove('active')}else{document.getElementById('depBox').style.display='none';document.getElementById('withBox').style.display='block';document.getElementById('t2').classList.add('active');document.getElementById('t1').classList.remove('active');lw()}}
async function ld(){let r=await fetch("/api/admin/deposits?key="+entered);let d=await r.json();let e=document.getElementById("l");if(!d.length){e.innerHTML="No pending"}else{let h="";for(let x of d){h+="<div id=\\"r-"+x.id+"\\" style=\\"background:#222;padding:12px;margin:10px 0;border-radius:10px;transition:.5s\\"><b>"+x.phone+"</b> - "+x.amount+" UGX<br>From: "+x.airtelNo+"<br>"+(x.screenshot?"<img src=\\""+x.screenshot+"\\" style=\\"width:100%;max-width:300px;margin:10px 0\\">":"")+"<br><button onclick=\\"ap("+x.id+")\\" style=\\"background:lime;padding:8px\\">Approve Deposit ✅</button></div>"}e.innerHTML=h}}
async function ap(id){await fetch("/api/admin/approve/"+id+"?key="+entered,{method:"POST"});let el=document.getElementById("r-"+id);el.style.opacity=0;setTimeout(()=>el.remove(),500)}
async function lw(){let r=await fetch("/api/admin/withdraws?key="+entered);let d=await r.json();let e=document.getElementById("lw");if(!d.length){e.innerHTML="No pending withdraws"}else{let h="";for(let x of d){h+="<div id=\\"w-"+x.id+"\\" style=\\"background:#222;padding:12px;margin:10px 0;border-radius:10px\\"><b>"+x.phone+"</b> wants "+x.amount+" UGX<br>Type: "+x.type+"<br><button onclick=\\"aw("+x.id+",'approve')\\" style=\\"background:lime;padding:8px;margin-right:5px\\">Approve Paid ✅</button><button onclick=\\"aw("+x.id+",'reject')\\" style=\\"background:red;color:#fff;padding:8px\\">Reject</button></div>"}e.innerHTML=h}}
async function aw(id,act){await fetch("/api/admin/withdraw/"+id+"?key="+entered,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:act})});let el=document.getElementById("w-"+id);el.style.opacity=0;setTimeout(()=>el.remove(),500)}
</script></body></html>`);
});
app.listen(process.env.PORT||3000,()=>console.log("UP"));
