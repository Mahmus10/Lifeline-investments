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

// Create tables only if not exists - SAFE, never deletes
pool.query(`CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fullName VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  balance DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

pool.query(`CREATE TABLE IF NOT EXISTS deposits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT,
  amount DECIMAL(10,2),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

console.log('Database ready - no DROP');

app.get('/', (req,res) => {
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#1a1a1a;padding:25px;border-radius:15px;width:90%;max-width:350px} h1{color:#00ff88;text-align:center;font-size:22px} input{width:100%;padding:12px;margin:8px 0;border-radius:8px;border:none;box-sizing:border-box} button{width:100%;padding:12px;background:#00ff88;border:none;border-radius:8px;font-weight:bold;margin-top:10px;cursor:pointer}.msg{margin:10px 0;color:#00ff88}</style></head><body><div class="box"><h1>LIFELINE INVESTMENTS</h1><h3>Create Account</h3><input id="name" placeholder="Full Name"><input id="phone" placeholder="Phone 07..."><input id="pass" type="password" placeholder="Password"><button onclick="reg()">Register Now</button><p id="msg" class="msg"></p><hr style="margin:20px 0"><h3>Login</h3><input id="lphone" placeholder="Phone"><input id="lpass" type="password" placeholder="Password"><button onclick="log()">Login</button><p id="msg2" class="msg"></p></div><script>
async function reg(){
 const fullName=document.getElementById('name').value;
 const phone=document.getElementById('phone').value;
 const password=document.getElementById('pass').value;
 const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fullName,phone,password})});
 const d=await r.json();
 document.getElementById('msg').innerText=d.message;
 if(r.ok){ alert(d.message); document.getElementById('msg').innerText='Now login below!'; }
}
async function log(){
 const phone=document.getElementById('lphone').value;
 const password=document.getElementById('lpass').value;
 const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password})});
 const d=await r.json();
 document.getElementById('msg2').innerText=d.message;
 if(r.ok){
   localStorage.setItem('user', JSON.stringify(d.user));
   window.location.href='/dashboard';
 }
}
</script></body></html>`);
});

app.get('/dashboard', (req,res)=>{
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a;color:white;font-family:sans-serif;padding:20px}.card{background:#1a1a1a;padding:20px;border-radius:15px;max-width:400px;margin:auto} h1{color:#00ff88} button{padding:10px 15px;margin:5px;border:none;border-radius:8px;font-weight:bold}.green{background:#00ff88}.red{background:#ff4444;color:white}</style></head><body><div class="card"><h1 id="welcome">Loading...</h1><p>Balance: <b>UGX <span id="bal">0</span></b></p><button class="green">Deposit</button><button class="green">Invest</button><button class="red" onclick="logout()">Logout</button></div><script>
 const u=JSON.parse(localStorage.getItem('user')||'{}');
 if(!u.phone) window.location.href='/';
 document.getElementById('welcome').innerText='Welcome '+u.fullName;
 document.getElementById('bal').innerText=u.balance||0;
 function logout(){ localStorage.clear(); window.location.href='/'; }
</script></body></html>`);
});

app.post('/api/register', async (req,res)=>{
  const {fullName, phone, password}=req.body;
  if(!fullName||!phone||!password) return res.status(400).json({message:'All fields required'});
  const hashed=await bcrypt.hash(password,10);
  pool.query('INSERT INTO users (fullName, phone, password) VALUES (?,?,?)',[fullName,phone,hashed],(err)=>{
    if(err){
      if(err.code==='ER_DUP_ENTRY') return res.status(400).json({message:'Phone already registered'});
      return res.status(500).json({message:err.message});
    }
    res.json({message:'Account created! Now login below'});
  });
});

app.post('/api/login', (req,res)=>{
  const {phone,password}=req.body;
  pool.query('SELECT * FROM users WHERE phone=?',[phone], async (err,results)=>{
    if(err) return res.status(500).json({message:'DB error'});
    if(results.length===0) return res.status(400).json({message:'Phone not found'});
    const user=results[0];
    const match=await bcrypt.compare(password,user.password);
    if(!match) return res.status(400).json({message:'Wrong password'});
    res.json({message:'Welcome '+user.fullName, user:{id:user.id, fullName:user.fullName, phone:user.phone, balance:user.balance}});
  });
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('Running '+PORT));
