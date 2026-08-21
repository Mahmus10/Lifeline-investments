const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
let db;
const ADMIN_KEY="LIFELINE123";
async function init(){
 try{
  const u=process.env.DATABASE_URL||process.env.MYSQL_URL;
  db=await mysql.createConnection(u);
  try{await db.query("ALTER TABLE users MODIFY fullName VARCHAR(100) NULL")}catch(e){}
  try{await db.query("ALTER TABLE deposits ADD COLUMN phone VARCHAR(20)")}catch(e){}
  try{await db.query("ALTER TABLE deposits ADD COLUMN airtelNo VARCHAR(20)")}catch(e){}
  try{await db.query("ALTER TABLE deposits ADD COLUMN screenshot LONGTEXT")}catch(e){}
  try{await db.query("ALTER TABLE deposits MODIFY screenshot LONGTEXT")}catch(e){}
  try{await db.query("ALTER TABLE users ADD COLUMN referralBonus INT DEFAULT 0")}catch(e){}
  try{await db.query("CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, club VARCHAR(50), amount INT, rate INT, lockDays INT, startDate DATETIME DEFAULT CURRENT_TIMESTAMP, status VARCHAR(20) DEFAULT 'active')")}catch(e){}
  try{await db.query("CREATE TABLE IF NOT EXISTS withdrawals (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount INT, type VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)")}catch(e){}
  try{await db.query("CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, phone VARCHAR(20), amount INT, airtelNo VARCHAR(20), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)")}catch(e){}
  console.log("DB OK");
 }catch(e){console.log(e.message)}
}
init();
app.post('/api/register',async(req,res)=>{
 try{
  const{name,phone,password,ref}=req.body;
  const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase();
  try{await db.query("INSERT INTO users (fullName,name,username,phone,password,myReferralCode,referredBy,balance,bonus,referralBonus) VALUES (?,?,?,?,?,?,?,0,0,0)",[name,name,name,phone,password,code,ref||null]);}catch(e){await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy) VALUES (?,?,?,?,?)",[name,phone,password,code,ref||null]);}
  const[r]=await db.query("SELECT * FROM users WHERE phone=?",[phone]); res.json(r[0]);
 }catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/login',async(req,res)=>{const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]); if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"});});
app.get('/api/user/:id',async(req,res)=>{
 const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]);
 const[inv]=await db.query("SELECT * FROM investments WHERE userId=? AND status='active'",[req.params.id]);
 let totalInterest=0; let now=new Date();
 for(let i of inv){let days=Math.floor((now - new Date(i.startDate))/(1000*60*60*24)); if(days<0) days=0; totalInterest+= Math.floor(i.amount * i.rate/100 * days);}
 const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.params.id]);
 let available = totalInterest - w[0].s; if(available<0) available=0;
 res.json({...u[0], totalInterest:available, rawInterest:totalInterest, investments:inv});
});
app.post('/api/deposit',async(req,res)=>{
 try{
  const{userId,amount,airtelNo,screenshot}=req.body;
  const[u]=await db.query("SELECT * FROM users WHERE id=?",[userId]);
  let phone = u.length?u[0].phone:"unknown";
  await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot,status) VALUES (?,?,?,?,?,'pending')",[userId,phone,parseInt(amount),airtelNo,screenshot||""]);
  res.json({ok:1});
 }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/invest',async(req,res)=>{
 try{
  const{userId,club,amount}=req.body;
  const[u]=await db.query("SELECT * FROM users WHERE id=?",[userId]);
  if((u[0].balance||0) < amount) return res.status(400).json({error:"Insufficient"});
  const clubs={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8};
  const locks={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8};
  await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]);
  await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,clubs[club],locks[club]]);
  res.json({ok:1});
 }catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/withdraw',async(req,res)=>{
 try{
  const{userId,amount}=req.body;
  if(amount<5000) return res.status(400).json({error:"Min 5k"});
  const[inv]=await db.query("SELECT * FROM investments WHERE userId=? AND status='active'",[userId]);
  let totalInterest=0; let now=new Date();
  for(let i of inv){ let days=Math.floor((now - new Date(i.startDate))/(1000*60*60*24)); totalInterest+= Math.floor(i.amount * i.rate/100 * days); }
  const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[userId]);
  let available = totalInterest - w[0].s;
  if(amount>available) return res.status(400).json({error:"Only "+available+" available"});
  await db.query("INSERT INTO withdrawals (userId,amount,type,status) VALUES (?,?,'interest','pending')",[userId,amount]);
  res.json({ok:1});
 }catch(e){res.status(400).json({error:e.message})}
});
app.get('/api/admin/deposits',async(req,res)=>{
 if(req.query.key!==ADMIN_KEY) return res.status(401).json([]);
 try{
  const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC LIMIT 50");
  res.json(r);
 }catch(e){res.json([])}
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
   if(refUser.length){let bonus=Math.floor(d[0].amount*0.1); await db.query("UPDATE users SET balance=balance+?, referralBonus=referralBonus+? WHERE id=?",[bonus,bonus,refUser[0].id]);}
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
 const{action}=req.body;
 if(action==='approve'){await db.query("UPDATE withdrawals SET status='approved' WHERE id=?",[req.params.id]);}else{await db.query("UPDATE withdrawals SET status='rejected' WHERE id=?",[req.params.id]);}
 res.json({ok:1});
});
app.get('/',(req,res)=>{res.send('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:20px}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><h2>Lifeline</h2><input id="n" placeholder="Name"><input id="p" placeholder="Phone"><input id="pw" type="password" placeholder="Password"><input id="rf" placeholder="Referral"><button onclick="reg()">Register</button><button onclick="log()" style="background:#333;color:#fff">Login</button><script>async function reg(){let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value,ref:rf.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert(j.error)}async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert("Wrong")}</script></body></html>');});
app.get('/dashboard',(req,res)=>{res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:15px}button{width:100%;padding:14px;margin:6px 0;border-radius:10px;border:none;font-weight:bold}.gold{background:gold}.dark{background:#222;color:#fff}.bal{background:#111;padding:15px;border-radius:15px;text-align:center}</style></head><body><div class="bal"><h1 id="b">0 UGX</h1><p id="ph"></p><p>Interest: <span id="int" style="color:#0f0">0</span></p><p id="code" style="color:gold;font-size:12px"></p></div><button class="gold" onclick="location.href='/deposit'">Deposit</button><button class="gold" onclick="location.href='/invest'">Invest</button><button class="dark" onclick="withdraw()">Withdraw</button><button class="dark" onclick="location.href='/myinvest'">My Invest</button><button class="dark" onclick="localStorage.clear();location.href='/'">Logout</button><script>let uid=localStorage.getItem('uid');if(!uid)location.href='/';async function load(){let r=await fetch('/api/user/'+uid);let u=await r.json();b.textContent=(u.balance||0)+' UGX';ph.textContent=u.phone;int.textContent=(u.totalInterest||0)+' UGX';code.textContent='Ref: '+(u.myReferralCode||'')+' 10%';}async function withdraw(){let a=prompt('Amount min 5000');if(!a)return;let r=await fetch('/api/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:uid,amount:parseInt(a)})});let j=await r.json();alert(j.error||'Sent');}load()</script></body></html>`);});
app.get('/deposit',(req,res)=>{res.send('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;padding:20px;font-family:Arial}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><a href="/dashboard" style="color:gold">Back</a><h2>Deposit</h2><input id="am" placeholder="Amount"><input id="air" placeholder="Airtel No"><input type="file" id="file" accept="image/*"><img id="prev" style="display:none;width:100%"><button onclick="dep()">Submit</button><script>let uid=localStorage.getItem("uid");let b64="";file.addEventListener("change",e=>{let r=new FileReader();r.onload=()=>{b64=r.result;prev.src=b64;prev.style.display="block"};r.readAsDataURL(e.target.files[0])});async function dep(){let r=await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:am.value,airtelNo:air.value,screenshot:b64})});let j=await r.json();if(j.ok){alert("Sent!");location.href="/dashboard"}else alert(j.error)}</script></body></html>');});
app.get('/invest',(req,res)=>{res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}.club{background:#111;padding:15px;border-radius:12px;margin:10px 0}button{width:100%;padding:12px;border-radius:8px;border:none;background:gold;font-weight:bold}input{width:100%;padding:12px;border-radius:8px;border:none}a{color:gold}</style></head><body><a href="/dashboard">Back</a><h2>Invest</h2><p>Bal: <span id="bal">0</span></p><div class="club"><h3>Arsenal 10%/10d</h3><input id="a-arsenal"><button onclick="inv('arsenal')">Invest</button></div><div class="club"><h3>Man Utd 10%/10d</h3><input id="a-manutd"><button onclick="inv('manutd')">Invest</button></div><div class="club"><h3>Man City 10%/10d</h3><input id="a-mancity"><button onclick="inv('mancity')">Invest</button></div><div class="club"><h3>Chelsea 8%/8d</h3><input id="a-chelsea"><button onclick="inv('chelsea')">Invest</button></div><div class="club"><h3>Liverpool 8%/8d</h3><input id="a-liverpool"><button onclick="inv('liverpool')">Invest</button></div><script>let uid=localStorage.getItem('uid');async function load(){let r=await fetch('/api/user/'+uid);let u=await r.json();bal.textContent=u.balance}async function inv(c){let v=document.getElementById('a-'+c).value;let r=await fetch('/api/invest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:uid,club:c,amount:parseInt(v)})});let j=await r.json();if(j.ok){alert('Done');location.href='/myinvest'}else alert(j.error)}load()</script></body></html>`);});
app.get('/myinvest',(req,res)=>{res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}.card{background:#111;padding:12px;margin:10px 0;border-radius:10px}a{color:gold}</style></head><body><a href="/dashboard">Back</a><h2>My Invest</h2><div id="l"></div><script>let uid=localStorage.getItem('uid');async function load(){let r=await fetch('/api/user/'+uid);let u=await r.json();let html='';let now=new Date();for(let i of (u.investments||[])){let d=Math.floor((now-new Date(i.startDate))/(1000*60*60*24));let p=Math.floor(i.amount*i.rate/100*d);html+='<div class=card><b>'+i.club+'</b> '+i.amount+' UGX<br>Profit: '+p+' UGX<br>Days: '+d+'/'+i.lockDays+'</div>'}l.innerHTML=html||'None'}load()</script></body></html>`);});
app.get('/admin',(req,res)=>{res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;padding:15px;font-family:Arial}input,button{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:none}button{background:gold;font-weight:bold}.tab{padding:10px;background:#222;display:inline-block;margin:5px;border-radius:5px;cursor:pointer}.active{background:gold;color:#000}</style></head><body><div id="loginBox"><h2>Admin</h2><input id="pass" type="password"><button onclick="check()">Unlock</button></div><div id="adminBox" style="display:none"><h2>ADMIN</h2><div><span class="tab active" id="t1" onclick="showTab('dep')">Deposits</span><span class="tab" id="t2" onclick="showTab('with')">Withdraws</span></div><div id="depBox"><div id="l">Loading</div></div><div id="withBox" style="display:none"><div id="lw">Loading</div></div></div><script>const ADMIN_PASS="LIFELINE123";let entered="";function check(){if(pass.value===ADMIN_PASS){entered=pass.value;loginBox.style.display="none";adminBox.style.display="block";ld()}}function showTab(t){if(t==='dep'){depBox.style.display='block';withBox.style.display='none';t1.classList.add('active');t2.classList.remove('active');ld()}else{depBox.style.display='none';withBox.style.display='block';t2.classList.add('active');t1.classList.remove('active');lw()}}async function ld(){let r=await fetch("/api/admin/deposits?key="+entered);let d=await r.json();let e=document.getElementById("l");if(!d.length)e.innerHTML="No pending";else{let h="";for(let x of d){h+="<div id=r-"+x.id+" style=background:#222;padding:12px;margin:10px 0;border-radius:10px><b>"+x.phone+"</b> "+x.amount+" UGX<br>"+x.airtelNo+"<br>"+(x.screenshot?"<img src="+x.screenshot+" style=width:100%>":"")+"<br><button onclick=ap("+x.id+")>Approve</button></div>"}e.innerHTML=h}}async function ap(id){await fetch("/api/admin/approve/"+id+"?key="+entered,{method:"POST"});document.getElementById("r-"+id).remove()}async function lw(){let r=await fetch("/api/admin/withdraws?key="+entered);let d=await r.json();let e=document.getElementById("lw");if(!d.length)e.innerHTML="No pending";else{let h="";for(let x of d){h+="<div id=w-"+x.id+" style=background:#222;padding:12px;margin:10px 0;border-radius:10px><b>"+x.phone+"</b> wants "+x.amount+"<br><button onclick=aw("+x.id+",'approve')>Approve</button><button onclick=aw("+x.id+",'reject')>Reject</button></div>"}e.innerHTML=h}}async function aw(id,act){await fetch("/api/admin/withdraw/"+id+"?key="+entered,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:act})});document.getElementById("w-"+id).remove()}</script></body></html>`);});
app.listen(process.env.PORT||3000,()=>console.log("UP"));
