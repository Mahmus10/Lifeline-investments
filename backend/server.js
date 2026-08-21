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
  console.log("DB OK");
 }catch(e){console.log(e.message)}
}
init();

app.post('/api/register',async(req,res)=>{
 try{
  const{name,phone,password,ref}=req.body;
  const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase();
  try{
   await db.query("INSERT INTO users (fullName,name,username,phone,password,myReferralCode,referredBy,balance,bonus) VALUES (?,?,?,?,?,?,?,0,0)",[name,name,name,phone,password,code,ref||null]);
  }catch(e){
   await db.query("INSERT INTO users (fullName,phone,password) VALUES (?,?,?)",[name,phone,password]);
  }
  const[r]=await db.query("SELECT * FROM users WHERE phone=?",[phone]);
  res.json(r[0]);
 }catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/login',async(req,res)=>{
 const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]);
 if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"});
});
app.post('/api/deposit',async(req,res)=>{
 const{userId,amount,airtelNo,screenshot}=req.body;
 const[u]=await db.query("SELECT * FROM users WHERE id=?",[userId]);
 await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot,status) VALUES (?,?,?,?,?,'pending')",[userId,u[0].phone,amount,airtelNo,screenshot||null]);
 res.json({ok:1});
});
app.get('/api/user/:id',async(req,res)=>{
 const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]);
 res.json(u[0]||{});
});
app.get('/api/admin/deposits',async(req,res)=>{
 if(req.query.key!==ADMIN_KEY) return res.status(401).json([]);
 const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC");
 res.json(r);
});
app.post('/api/admin/approve/:id',async(req,res)=>{
 if(req.query.key!==ADMIN_KEY) return res.status(401).json({error:"no"});
 const[d]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]);
 await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]);
 await db.query("UPDATE users SET balance=balance+? WHERE id=?",[d[0].amount,d[0].userId]);
 res.json({ok:1});
});

app.get('/',(req,res)=>{
 res.send('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:20px}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><h2>Lifeline Investments</h2><input id="n" placeholder="Name"><input id="p" placeholder="Phone"><input id="pw" type="password" placeholder="Password"><input id="rf" placeholder="Referral"><button onclick="reg()">Register</button><button onclick="log()" style="background:#333;color:#fff">Login</button><script>async function reg(){let r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,phone:p.value,password:pw.value,ref:rf.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert(j.error)}async function log(){let r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:p.value,password:pw.value})});let j=await r.json();if(j.id){localStorage.setItem("uid",j.id);location.href="/dashboard"}else alert("Wrong")}</script></body></html>');
});

app.get('/dashboard',(req,res)=>{
 res.send('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:20px}button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none;font-weight:bold}.gold{background:gold}.dark{background:#222;color:#fff}.bal{background:#111;padding:20px;border-radius:15px;text-align:center}</style></head><body><div class="bal"><h3>Balance</h3><h1 id="b">0 UGX</h1></div><button class="gold" onclick="location.href=\'/deposit\'">Deposit</button><button class="dark" onclick="location.href=\'/invest\'">Invest</button><button class="dark" onclick="localStorage.removeItem(\'uid\');location.href=\'/\'">Logout</button><script>let uid=localStorage.getItem("uid");if(!uid)location.href="/";async function load(){let r=await fetch("/api/user/"+uid);let u=await r.json();document.getElementById("b").textContent=(u.balance||0)+" UGX"}load()</script></body></html>');
});

app.get('/deposit',(req,res)=>{
 res.send('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:Arial;padding:20px}input,button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none}button{background:gold;font-weight:bold}</style></head><body><a href="/dashboard" style="color:gold">Back</a><h2>Deposit</h2><input id="am" placeholder="Amount"><input id="air" placeholder="Your Airtel No"><input type="file" id="file" accept="image/*"><img id="prev" style="display:none;width:100%;margin:10px 0"><button onclick="dep()">Submit</button><script>let uid=localStorage.getItem("uid");let b64="";document.getElementById("file").addEventListener("change",e=>{let r=new FileReader();r.onload=()=>{b64=r.result;let im=document.getElementById("prev");im.src=b64;im.style.display="block"};r.readAsDataURL(e.target.files[0])});async function dep(){if(!b64){alert("Upload screenshot");return}await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:uid,amount:am.value,airtelNo:air.value,screenshot:b64})});alert("Sent!");location.href="/dashboard"}</script></body></html>');
});

app.get('/invest',(req,res)=>{
 res.send('<html><body style="background:#000;color:#fff;padding:20px;font-family:Arial"><a href="/dashboard" style="color:gold">Back</a><h2>Invest - Coming Soon</h2></body></html>');
});

app.get('/admin',(req,res)=>{
 res.send('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;padding:20px;font-family:Arial}input,button{width:100%;padding:12px;margin:8px 0;border-radius:8px;border:none}button{background:gold;font-weight:bold}</style></head><body><div id="loginBox"><h2>Admin Login</h2><input id="pass" type="password" placeholder="Password"><button onclick="check()">Unlock</button><p id="err"></p></div><div id="adminBox" style="display:none"><h2>ADMIN PENDING</h2><div id="l">Loading...</div></div><script>const ADMIN_PASS="LIFELINE123";let entered="";function check(){let v=document.getElementById("pass").value;if(v===ADMIN_PASS){entered=v;document.getElementById("loginBox").style.display="none";document.getElementById("adminBox").style.display="block";ld()}else document.getElementById("err").textContent="Wrong"}async function ld(){let r=await fetch("/api/admin/deposits?key="+entered);let d=await r.json();let e=document.getElementById("l");if(!d.length){e.innerHTML="No pending"}else{let h="";for(let x of d){h+="<div id=\\"r-"+x.id+"\\" style=\\"background:#222;padding:12px;margin:10px 0;border-radius:10px;transition:.5s\\"><b>"+x.phone+"</b> - "+x.amount+"<br>From: "+x.airtelNo+"<br>"+(x.screenshot?"<img src=\\""+x.screenshot+"\\" style=\\"width:100%;max-width:300px;margin:10px 0\\">":"")+"<br><button onclick=\\"ap("+x.id+")\\" style=\\"background:lime;padding:8px\\">Approve</button></div>"}e.innerHTML=h}}async function ap(id){await fetch("/api/admin/approve/"+id+"?key="+entered,{method:"POST"});let el=document.getElementById("r-"+id);el.style.opacity=0;el.style.transform="translateX(100%)";setTimeout(()=>el.remove(),500)}</script></body></html>');
});

app.listen(process.env.PORT||3000,()=>console.log("UP"));
