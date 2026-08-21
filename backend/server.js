const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const app = express();
app.use(cors());
app.use(express.json({limit: '20mb'}));
const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10
});
function safeQuery(sql){
  pool.query(sql, (e)=>{ if(e) console.log('SQL:', e.message); });
}
safeQuery(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(100), phone VARCHAR(20) UNIQUE, password VARCHAR(255), balance DECIMAL(10,2) DEFAULT 0, referralCode VARCHAR(20), referredBy INT DEFAULT NULL, totalReferralBonus DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
safeQuery(`CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount DECIMAL(10,2), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
safeQuery(`CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, plan VARCHAR(50), amount DECIMAL(10,2), claimed DECIMAL(10,2) DEFAULT 0, status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
safeQuery(`CREATE TABLE IF NOT EXISTS withdraws (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount DECIMAL(10,2), phone VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

const DAILY_RATE = 0.05; const REFERRAL_RATE = 0.10;
function calcProfit(inv){ const maxDays=30; const diff=Math.floor((new Date()-new Date(inv.created_at))/86400000); const days=Math.min(diff,maxDays); const total=inv.amount*DAILY_RATE*days; const avail=total-(inv.claimed||0); return{daysPassed:days,totalProfit:total,available:avail>0?avail:0,maxDays,isCompleted:days>=maxDays}; }
function genCode(phone){ return 'LIFE'+phone.slice(-4)+Math.floor(10+Math.random()*90); }

app.get('/', (req,res)=>{ res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#1a1a1a;padding:25px;border-radius:15px;width:90%;max-width:360px}h1{color:#00ff88;text-align:center}input{width:100%;padding:12px;margin:8px 0;border-radius:8px;border:none}button{width:100%;padding:12px;background:#00ff88;border:none;border-radius:8px;font-weight:bold;margin-top:10px}.refBox{background:#222;padding:10px;border-radius:8px;border:1px dashed #00ff88;margin:8px 0}</style></head><body><div class="box"><h1>LIFELINE INVESTMENTS</h1><p style="text-align:center;color:#ffaa00">5% Daily + 10% Referral</p><h3>Register</h3><input id="name" placeholder="Full Name"><input id="phone" placeholder="Phone"><input id="pass" type="password" placeholder="Password"><div class="refBox" id="refWrap"><input id="refCode" placeholder="Referral Code (Optional)"><small id="refInfo" style="color:#00ff88;display:none"></small></div><button onclick="reg()">Register</button><p id="msg"></p><hr><h3>Login</h3><input id="lphone" placeholder="Phone"><input id="lpass" type="password" placeholder="Password"><button onclick="log()">Login</button><p id="msg2"></p></div><script>const p=new URLSearchParams(location.search);const r=p.get('ref');if(r && r!=='undefined' && r!=='null' && r!==''){document.getElementById('refCode').value=r;refInfo.style.display='block';refInfo.innerText='Referred by '+r;}else{document.getElementById('refWrap').style.display='none';}async function reg(){const res=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fullName:name.value,phone:document.getElementById('phone').value,password:pass.value,referralCode:refCode.value})});const d=await res.json();msg.innerText=d.message;}async function log(){const res=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:lphone.value,password:lpass.value})});const d=await res.json();msg2.innerText=d.message;if(res.ok){localStorage.setItem('user',JSON.stringify(d.user));location.href='/dashboard'}}</script></body></html>`); });
app.get('/dashboard', (req,res)=>{ res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a;color:#fff;font-family:sans-serif;padding:15px;margin:0}.card{background:#1a1a1a;padding:20px;border-radius:15px;max-width:460px;margin:auto}h1{color:#00ff88}button{padding:9px 12px;margin:3px;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:13px}.green{background:#00ff88}.red{background:#ff4444;color:#fff}.orange{background
