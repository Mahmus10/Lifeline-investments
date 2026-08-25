const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lifeline_secret_2025_gold';

app.use(cors());
app.use(express.json());

let users = [];
let transactions = [];

function auth(req,res,next){
  const token = req.headers['authorization']?.split(' ')[1];
  if(!token) return res.status(401).json({error:'No token'});
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e){ return res.status(401).json({error:'Invalid token'}); }
}

app.get('/manifest.json', (req,res)=>{
  res.json({
    name: "Lifeline Hybrid", short_name: "Lifeline",
    start_url: "/", display: "standalone",
    background_color: "#080a0f", theme_color: "#FFD700",
    icons: [{src:"/icon.svg", sizes:"512x512", type:"image/svg+xml"}]
  });
});
app.get('/icon.svg', (req,res)=>{
  res.setHeader('Content-Type','image/svg+xml');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="120" fill="#080a0f"/><circle cx="256" cy="256" r="140" fill="none" stroke="#FFD700" stroke-width="18"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="120" font-weight="900" fill="#FFD700">L</text></svg>`);
});

app.get('/', (req,res)=>{
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#080a0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}.box{background:#0f1219;border:1px solid rgba(255,215,0,0.2);border-radius:20px;padding:24px;width:100%;max-width:380px}h1{color:#FFD700;text-align:center;margin-bottom:20px}input{width:100%;padding:12px;border-radius:10px;border:1px solid #333;background:#1a1f2e;color:#fff;margin:8px 0}button{width:100%;padding:13px;background:#FFD700;color:#000;border:none;border-radius:10px;font-weight:800;margin-top:10px}a{color:#FFD700;text-decoration:none;font-size:12px}</style></head><body><div class="box"><h1>⚽ LIFELINE</h1><div id="loginForm"><input id="lphone" placeholder="Phone 07..."><input id="lpass" type="password" placeholder="Password"><button onclick="login()">Login</button><p style="text-align:center;margin-top:12px"><a href="#" onclick="showReg()">Create Account</a></p></div><div id="regForm" style="display:none"><input id="rname" placeholder="Full Name"><input id="rphone" placeholder="Phone 07..."><input id="rpass" type="password" placeholder="Password"><button onclick="register()">Register</button><p style="text-align:center;margin-top:12px"><a href="#" onclick="showLog()">Already have account</a></p></div></div><script>function showReg(){loginForm.style.display='none';regForm.style.display='block'}function showLog(){regForm.style.display='none';loginForm.style.display='block'}function register(){fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:rname.value,phone:rphone.value,password:rpass.value})}).then(r=>r.json()).then(d=>{if(d.token){localStorage.setItem('token',d.token);location.href='/dashboard'}else alert(d.error)})}function login(){fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:lphone.value,password:lpass.value})}).then(r=>r.json()).then(d=>{if(d.token){localStorage.setItem('token',d.token);location.href='/dashboard'}else alert(d.error)})}</script></body></html>`);
});

app.get('/dashboard', (req,res)=>{
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#080a0f;color:#fff;font-family:sans-serif;padding:12px;padding-bottom:80px}.header{background:linear-gradient(135deg,#0f1219,#1a1f2e);border:1px solid rgba(255,215,0,0.2);border-radius:16px;padding:16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.bal{font-size:28px;font-weight:900;color:#FFD700}.card{background:#1a1f2e;border:1px solid rgba(255,215,0,0.15);border-radius:14px;padding:14px;margin:8px 0;display:flex;justify-content:space-between}.btn{flex:1;padding:12px;border-radius:10px;border:none;font-weight:800;margin:4px;cursor:pointer}.btn-gold{background:#FFD700;color:#000}.btn-dark{background:#252b3d;color:#fff;border:1px solid #444}.histBtn{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#1a1f2e,#252b3d);border:1px solid rgba(255,215,0,0.35);color:#FFD700;padding:16px 18px;border-radius:14px;text-decoration:none;font-weight:bold;margin:12px 0}</style></head><body>
<div class="header"><div><div style="font-size:11px;color:#888">Total Balance</div><div class="bal" id="balance">UGX 0</div><div style="font-size:11px;color:#aaa" id="uName">Loading...</div></div><button onclick="logout()" style="background:#ff444422;color:#ff4444;border:1px solid #ff444444;padding:6px 12px;border-radius:8px">Logout</button></div>
<div style="display:flex"><button class="btn btn-gold" onclick="location.href='/invest'">⚽ Invest</button><button class="btn btn-dark" onclick="location.href='/deposit'">💳 Deposit</button><button class="btn btn-dark" onclick="location.href='/withdraw'">💸 Withdraw</button></div>
<div class="card"><span>Active Investment</span><b id="activeInv" style="color:#FFD700">UGX 0</b></div><div class="card"><span>Total Profit</span><b id="totalProfit" style="color:#00ff88">UGX 0</b></div>
<a href="/history" class="histBtn"><span style="display:flex;align-items:center;gap:10px"><span style="font-size:20px">📜</span> Transaction History</span><span style="background:rgba(255,215,0,0.15);padding:6px 12px;border-radius:8px;font-size:12px">View →</span></a>
<script>const token=localStorage.getItem('token');if(!token)location.href='/';function logout(){localStorage.clear();location.href='/'}function loadDash(){fetch('/api/me',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json()).then(d=>{balance.innerText='UGX '+Number(d.balance||0).toLocaleString();uName.innerText=d.name||d.phone;activeInv.innerText='UGX '+Number(d.activeInvestment||0).toLocaleString();totalProfit.innerText='UGX '+Number(d.totalProfit||0).toLocaleString()})}loadDash();</script></body></html>`);
});

app.get('/history', (req,res)=>{
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#080a0f;color:#fff;font-family:sans-serif;min-height:100vh}.header{background:linear-gradient(135deg,#0f1219,#1a1f2e);padding:16px;border-bottom:1px solid rgba(255,215,0,0.2);position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px}.back{color:#FFD700;text-decoration:none;font-size:18px;padding:6px 12px;border:1px solid rgba(255,215,0,0.3);border-radius:8px}.title{color:#FFD700;font-weight:800;font-size:18px}.filters{display:flex;gap:8px;padding:14px;overflow-x:auto}.fbtn{padding:8px 14px;border-radius:20px;border:1px solid rgba(255,215,0,0.3);background:#1a1f2e;color:#aaa;font-size:12px;white-space:nowrap;cursor:pointer}.fbtn.active{background:#FFD700;color:#000;font-weight:bold}.container{padding:0 14px 20px}.card{background:linear-gradient(135deg,#1a1f2e,#181d2a);border:1px solid rgba(255,215,0,0.15);border-radius:14px;padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}.icon{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px}.empty{text-align:center;padding:60px 20px;color:#666}</style></head><body>
<div class="header"><a href="/dashboard" class="back">← Back</a><div class="title">📜 Transaction History</div></div>
<div class="filters"><button class="fbtn active" onclick="filterHist('all',this)">All</button><button class="fbtn" onclick="filterHist('deposit',this)">Deposits</button><button class="fbtn" onclick="filterHist('withdraw',this)">Withdrawals</button><button class="fbtn" onclick="filterHist('profit',this)">Profits</button><button class="fbtn" onclick="filterHist('invest',this)">Investments</button></div>
<div class="container" id="historyList"><div class="empty"><div style="font-size:40px">⏳</div>Loading...</div></div>
<script>
let allData=[]; const token=localStorage.getItem('token'); if(!token) location.href='/';
function loadHistory(){ fetch('/api/transactions',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json()).then(d=>{ allData=d.transactions||d.history||d||[]; if(allData.length===0){historyList.innerHTML='<div class="empty"><div style="font-size:40px">📭</div>No transactions yet</div>';return} render(allData); })}
function render(list){ historyList.innerHTML=list.map(t=>{ const tp=(t.type||'').toLowerCase(); let ic='💰',bg='#FFD70022',col='#FFD700'; if(tp.includes('deposit')){ic='⬇️';bg='#00ff8822';col='#00ff88'} if(tp.includes('withdraw')){ic='⬆️';bg='#ff444422';col='#ff4444'} if(tp.includes('profit')){ic='📈'} if(tp.includes('invest')){ic='⚽';bg='#0088ff22';col='#0088ff'} const st=t.status||'completed'; const stC=st==='completed'?'#00ff88':st==='pending'?'#FFD700':'#ff4444'; return \`<div class="card"><div style="display:flex;gap:12px;align-items:center"><div class="icon" style="background:\${bg};color:\${col}">\${ic}</div><div><div style="font-weight:700;font-size:13px">\${t.type}</div><div style="font-size:10px;color:#888">\${new Date(t.date||t.createdAt).toLocaleString()}</div></div></div><div style="text-align:right"><div style="font-weight:800;color:\${col}">UGX \${Number(t.amount||0).toLocaleString()}</div><div style="font-size:10px;padding:3px 8px;border-radius:20px;display:inline-block;background:\${stC}22;color:\${stC}">\${st}</div></div></div>\`; }).join(''); }
function filterHist(type,el){ document.querySelectorAll('.fbtn').forEach(b=>b.classList.remove('active')); el.classList.add('active'); if(type==='all'){render(allData);return} const f=allData.filter(t=>(t.type||'').toLowerCase().includes(type)); if(f.length===0) historyList.innerHTML='<div class="empty">No '+type+' found</div>'; else render(f); }
loadHistory();
</script></body></html>`);
});

app.get('/invest', (req,res)=>{ res.send('<body style="background:#080a0f;color:white;padding:20px;font-family:sans-serif"><a href="/dashboard" style="color:gold">← Back</a><h2 style="color:gold;margin:15px 0">Invest Plans</h2><div style="background:#1a1f2e;padding:16px;border-radius:14px;margin:10px 0;border:1px solid gold">Plan 1 - UGX 20k - 10% Daily <button onclick="invest(20000)" style="background:gold;border:none;padding:8px 14px;border-radius:8px;font-weight:bold">Invest</button></div><div style="background:#1a1f2e;padding:16px;border-radius:14px;margin:10px 0;border:1px solid gold">Plan 2 - UGX 50k - 12% Daily <button onclick="invest(50000)" style="background:gold;border:none;padding:8px 14px;border-radius:8px;font-weight:bold">Invest</button></div><script>const token=localStorage.getItem("token");function invest(amt){fetch("/api/invest",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({amount:amt})}).then(r=>r.json()).then(d=>{alert(d.message||d.error);if(d.success)location.href="/dashboard"})}</script></body>'); });
app.get('/deposit', (req,res)=>{ res.send('<body style="background:#080a0f;color:white;padding:20px;font-family:sans-serif"><a href="/dashboard" style="color:gold">← Back</a><h2 style="color:gold;margin:15px 0">Deposit</h2><input id="amt" placeholder="Amount UGX" style="width:100%;padding:12px;border-radius:10px;background:#1a1f2e;border:1px solid #444;color:white"><button onclick="dep()" style="width:100%;padding:12px;background:gold;border:none;border-radius:10px;font-weight:bold;margin-top:10px">Deposit</button><script>const token=localStorage.getItem("token");function dep(){fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({amount:amt.value})}).then(r=>r.json()).then(d=>{alert(d.message);if(d.success)location.href="/dashboard"})}</script></body>'); });
app.get('/withdraw', (req,res)=>{ res.send('<body style="background:#080a0f;color:white;padding:20px;font-family:sans-serif"><a href="/dashboard" style="color:gold">← Back</a><h2 style="color:gold;margin:15px 0">Withdraw</h2><input id="amt" placeholder="Amount UGX" style="width:100%;padding:12px;border-radius:10px;background:#1a1f2e;border:1px solid #444;color:white"><button onclick="wd()" style="width:100%;padding:12px;background:gold;border:none;border-radius:10px;font-weight:bold;margin-top:10px">Withdraw</button><script>const token=localStorage.getItem("token");function wd(){fetch("/api/withdraw",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({amount:amt.value})}).then(r=>r.json()).then(d=>{alert(d.message);if(d.success)location.href="/history"})}</script></body>'); });

app.post('/api/register', async (req,res)=>{
  const {name,phone,password}=req.body;
  if(users.find(u=>u.phone===phone)) return res.json({error:'Phone already exists'});
  const hashed=await bcrypt.hash(password,10);
  const user={id:Date.now().toString(),name,phone,password:hashed,balance:0,activeInvestment:0,totalProfit:0};
  users.push(user);
  const token=jwt.sign({id:user.id,phone},JWT_SECRET);
  res.json({token,success:true});
});
app.post('/api/login', async (req,res)=>{
  const {phone,password}=req.body;
  const user=users.find(u=>u.phone===phone);
  if(!user) return res.json({error:'User not found'});
  const ok=await bcrypt.compare(password,user.password);
  if(!ok) return res.json({error:'Wrong password'});
  const token=jwt.sign({id:user.id,phone},JWT_SECRET);
  res.json({token,success:true});
});
app.get('/api/me', auth, (req,res)=>{ const u=users.find(x=>x.id===req.user.id); res.json(u||{}); });
app.get('/api/transactions', auth, (req,res)=>{ const list=transactions.filter(t=>t.userId===req.user.id).reverse(); res.json({transactions:list}); });
app.post('/api/invest', auth, (req,res)=>{ const u=users.find(x=>x.id===req.user.id); const amt=Number(req.body.amount); if(u.balance<amt) return res.json({error:'Insufficient balance'}); u.balance-=amt; u.activeInvestment+=amt; transactions.push({userId:u.id,type:'invest',amount:amt,status:'completed',date:new Date(),createdAt:new Date()}); res.json({success:true,message:'Invested UGX '+amt}); });
app.post('/api/deposit', auth, (req,res)=>{ const u=users.find(x=>x.id===req.user.id); const amt=Number(req.body.amount); u.balance+=amt; transactions.push({userId:u.id,type:'deposit',amount:amt,status:'completed',date:new Date(),createdAt:new Date()}); res.json({success:true,message:'Deposit added'}); });
app.post('/api/withdraw', auth, (req,res)=>{ const u=users.find(x=>x.id===req.user.id); const amt=Number(req.body.amount); if(u.balance<amt) return res.json({error:'Insufficient'}); u.balance-=amt; transactions.push({userId:u.id,type:'withdraw',amount:amt,status:'pending',date:new Date(),createdAt:new Date()}); res.json({success:true,message:'Withdrawal pending'}); });

app.listen(PORT, ()=>console.log('Running on '+PORT));
