const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10
});

function initDB(){
  pool.query(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(100), phone VARCHAR(20) UNIQUE, password VARCHAR(255), balance DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  pool.query(`CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount DECIMAL(10,2), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  pool.query(`CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, plan VARCHAR(50), amount DECIMAL(10,2), profit DECIMAL(10,2), status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
}
initDB();

app.get('/', (req,res)=>{ res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#1a1a1a;padding:25px;border-radius:15px;width:90%;max-width:350px}h1{color:#00ff88;text-align:center}input{width:100%;padding:12px;margin:8px 0;border-radius:8px;border:none;box-sizing:border-box}button{width:100%;padding:12px;background:#00ff88;border:none;border-radius:8px;font-weight:bold;margin-top:10px}</style></head><body><div class="box"><h1>LIFELINE INVESTMENTS</h1><h3>Create Account</h3><input id="name" placeholder="Full Name"><input id="phone" placeholder="Phone 07..."><input id="pass" type="password" placeholder="Password"><button onclick="reg()">Register</button><p id="msg"></p><hr><h3>Login</h3><input id="lphone" placeholder="Phone"><input id="lpass" type="password" placeholder="Password"><button onclick="log()">Login</button><p id="msg2"></p></div><script>async function reg(){const fullName=name.value,phone=document.getElementById('phone').value,password=pass.value;const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fullName,phone,password})});const d=await r.json();msg.innerText=d.message;}async function log(){const phone=lphone.value,password=lpass.value;const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password})});const d=await r.json();msg2.innerText=d.message;if(r.ok){localStorage.setItem('user',JSON.stringify(d.user));location.href='/dashboard'}}</script></body></html>`); });

app.get('/dashboard', (req,res)=>{ res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a;color:#fff;font-family:sans-serif;padding:20px;margin:0}.card{background:#1a1a1a;padding:20px;border-radius:15px;max-width:420px;margin:auto}h1{color:#00ff88}button{padding:12px 18px;margin:5px;border:none;border-radius:8px;font-weight:bold;cursor:pointer}.green{background:#00ff88}.red{background:#ff4444;color:#fff}.plan{background:#222;padding:12px;border-radius:10px;margin:10px 0;border:1px solid #00ff88}input{width:100%;padding:10px;margin:8px 0;border-radius:8px;border:none;box-sizing:border-box}#depositBox,#investBox{display:none;background:#222;padding:15px;border-radius:10px;margin-top:15px}</style></head><body><div class="card"><h1 id="welcome">Welcome</h1><p>Balance: <b>UGX <span id="bal">0</span></b></p><button class="green" onclick="showDeposit()">Deposit</button><button class="green" onclick="showInvest()">Invest</button><button class="red" onclick="logout()">Logout</button><div id="depositBox"><h3>Deposit via Airtel Money</h3><p>Send to: <b style="color:#00ff88;font-size:18px">0740383797 - Summaya</b></p><p style="color:#ffcc00">1. Go to Airtel Money<br>2. Send Money to 0740383797<br>3. Enter amount below<br>4. Click I have Paid</p><input id="depAmount" type="number" placeholder="Amount e.g 20000"><button class="green" onclick="doDeposit()">I have Paid - Confirm</button><p id="depMsg"></p></div><div id="investBox"><h3>Investment Plans</h3><div class="plan"><b>Starter - 10% daily x10 days</b><br>Min 20k UGX<br><button class="green" onclick="doInvest('Starter',20000)">Invest 20k</button></div><div class="plan"><b>Pro - 15% daily x15 days</b><br>Min 50k UGX<br><button class="green" onclick="doInvest('Pro',50000)">Invest 50k</button></div><div class="plan"><b>VIP - 20% daily x20 days</b><br>Min 100k UGX<br><button class="green" onclick="doInvest('VIP',100000)">Invest 100k</button></div><p id="invMsg"></p></div></div><script>const u=JSON.parse(localStorage.getItem('user')||'{}');if(!u.phone)location.href='/';welcome.innerText='Welcome '+u.fullName;bal.innerText=u.balance||'0.00';function logout(){localStorage.clear();location.href='/';}function showDeposit(){depositBox.style.display='block';investBox.style.display='none';}function showInvest(){investBox.style.display='block';depositBox.style.display='none';}async function doDeposit(){const amount=depAmount.value;if(!amount)return alert('Enter amount');const r=await fetch('/api/deposit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id,amount})});const d=await r.json();depMsg.innerText=d.message;alert(d.message);}async function doInvest(plan,amount){const r=await fetch('/api/invest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id,plan,amount})});const d=await r.json();invMsg.innerText=d.message;alert(d.message);}</script></body></html>`); });

app.post('/api/register', async (req,res)=>{
  const {fullName, phone, password}=req.body;
  if(!fullName||!phone||!password) return res.status(400).json({message:'All fields'});
  const hashed=await bcrypt.hash(password,10);
  pool.query('INSERT INTO users (fullName, phone, password) VALUES (?,?,?)',[fullName,phone,hashed],(err)=>{
    if(err){ if(err.code==='ER_DUP_ENTRY') return res.status(400).json({message:'Phone already registered'}); return res.status(500).json({message:err.sqlMessage}); }
    res.json({message:'Account created! Now login'});
  });
});
app.post('/api/login', (req,res)=>{
  const {phone,password}=req.body;
  pool.query('SELECT * FROM users WHERE phone=?',[phone], async (err,results)=>{
    if(err) return res.status(500).json({message:'DB error '+err.message});
    if(results.length===0) return res.status(400).json({message:'Phone not found'});
    const user=results[0]; const match=await bcrypt.compare(password,user.password);
    if(!match) return res.status(400).json({message:'Wrong password'});
    res.json({message:'Welcome '+user.fullName, user:{id:user.id, fullName:user.fullName, phone:user.phone, balance:user.balance}});
  });
});
app.post('/api/deposit', (req,res)=>{
  initDB();
  const {userId, amount}=req.body;
  pool.query('INSERT INTO deposits (userId, amount, status) VALUES (?,?,?)',[userId, amount, 'pending'], (err)=>{
    if(err) return res.status(500).json({message:'Deposit failed: '+err.sqlMessage});
    res.json({message:'SUCCESS! Deposit '+amount+' UGX recorded. We will confirm payment to 0740383797 and add to your balance in 5 mins!'});
  });
});
app.post('/api/invest', (req,res)=>{
  initDB();
  const {userId, plan, amount}=req.body;
  pool.query('INSERT INTO investments (userId, plan, amount, profit, status) VALUES (?,?,?,?,?)',[userId, plan, amount, amount*0.1, 'active'], (err)=>{
    if(err) return res.status(500).json({message:'Invest failed: '+err.sqlMessage});
    res.json({message:'Invested '+amount+' in '+plan+'! You will earn daily profit!'});
  });
});
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('Running '+PORT));
