const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors()); app.use(express.json());

let db;
(async()=>{
  try{
    const u=process.env.DATABASE_URL||process.env.MYSQL_URL;
    db=await mysql.createConnection(u);
    console.log("DB OK");

    // Create tables if not exist
    await db.query(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100), phone VARCHAR(20) UNIQUE, password VARCHAR(100), balance DECIMAL(12,2) DEFAULT 0, bonus DECIMAL(12,2) DEFAULT 0, myReferralCode VARCHAR(20), referredBy VARCHAR(20))`);
    await db.query(`CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, phone VARCHAR(20), amount DECIMAL(12,2), airtelNo VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await db.query(`CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount DECIMAL(12,2), profit DECIMAL(12,2) DEFAULT 0, status VARCHAR(20) DEFAULT 'active', createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    // FIX OLD TABLE - Add missing columns
    try{await db.query("ALTER TABLE users ADD COLUMN name VARCHAR(100)")}catch(e){}
    try{await db.query("ALTER TABLE users ADD COLUMN myReferralCode VARCHAR(20)")}catch(e){}
    try{await db.query("ALTER TABLE users ADD COLUMN referredBy VARCHAR(20)")}catch(e){}
    try{await db.query("ALTER TABLE users ADD COLUMN bonus DECIMAL(12,2) DEFAULT 0")}catch(e){}
    try{await db.query("ALTER TABLE users ADD COLUMN balance DECIMAL(12,2) DEFAULT 0")}catch(e){}
    try{await db.query("ALTER TABLE deposits ADD COLUMN airtelNo VARCHAR(20)")}catch(e){}

  }catch(e){console.log(e.message)}
})();

app.post('/api/register',async(req,res)=>{
  try{
    const{name,phone,password,ref}=req.body;
    const code='LIFE'+Math.random().toString(36).substring(2,6).toUpperCase();
    await db.query("INSERT INTO users (name,phone,password,myReferralCode,referredBy,balance,bonus) VALUES (?,?,?,?,?,0,0)",[name,phone,password,code,ref||null]);
    if(ref){try{await db.query("UPDATE users SET bonus=bonus+1000 WHERE myReferralCode=?",[ref])}catch(e){}}
    const [u]=await db.query("SELECT * FROM users WHERE phone=?",[phone]);
    res.json(u[0])
  }catch(e){console.log("Register error:",e.message);res.status(400).json({error:e.message})}
});

app.post('/api/login',async(req,res)=>{
  try{
    const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]);
    if(r.length)res.json(r[0]);else res.status(401).json({error:"Wrong phone or password"})
  }catch(e){res.status(400).json({error:e.message})}
});

app.post('/api/deposit',async(req,res)=>{
  try{
    const{userId,amount,airtelNo}=req.body;
    const[u]=await db.query("SELECT * FROM users WHERE id=?",[userId]);
    await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo) VALUES (?,?,?,?)",[userId,u[0].phone,amount,airtelNo]);
    res.json({success:true})
  }catch(e){res.status(400).json({error:e.message})}
});

app.post('/api/invest',async(req,res)=>{
  try{
    const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.body.userId]);
    if(u[0].balance<req.body.amount)return res.status(400).json({error:"Low balance"});
    await db.query("UPDATE users SET balance=balance-? WHERE id=?",[req.body.amount,req.body.userId]);
    await db.query("INSERT INTO investments (userId,amount) VALUES (?,?)",[req.body.userId,req.body.amount]);
    res.json({success:true})
  }catch(e){res.status(400).json({error:e.message})}
});

app.get('/api/user/:id',async(req,res)=>{
  try{
    const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]);
    res.json(u[0]||{})
  }catch(e){res.json({})}
});

app.get('/api/admin/deposits',async(req,res)=>{
  try{
    const[r]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC");
    res.json(r)
  }catch(e){res.json([])}
});

app.post('/api/admin/approve/:id',async(req,res)=>{
  try{
    const[d]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]);
    if(!d[0])return res.json({error:"not found"});
    await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]);
    await db.query("UPDATE users SET balance=balance+? WHERE id=?",[d[0].amount,d[0].userId]);
    res.json({success:true})
  }catch(e){res.status(400).json({error:e.message})}
});

app.get('/admin',(req,res)=>{
  res.send(`<!DOCTYPE html><html><body style="background:#000;color:#fff;padding:20px;font-family:Arial"><h2>🔐 ADMIN - PENDING</h2><div id="list">Loading...</div><script>async function load(){let r=await fetch('/api/admin/deposits');let d=await r.json();let e=document.getElementById('list');if(!d.length)e.innerHTML='<h3>No pending ✅</h3>';else e.innerHTML=d.map(x=>\`<div id="row-\${x.id}" style="background:#222;padding:12px;margin:10px 0;border-radius:10px;transition:0.5s">\${x.phone} - \${x.amount} UGX <button onclick="approve(\${x.id})" style="background:lime;padding:6px 15px;margin-left:10px;border:none;border-radius:5px">Approve</button></div>\`).join('')}async function approve(id){await fetch('/api/admin/approve/'+id,{method:'POST'});let row=document.getElementById('row-'+id);row.style.opacity='0';row.style.transform='translateX(100%)';setTimeout(()=>row.remove(),500);}load();<\/script></body></html>`)
});

app.get('/',(req,res)=>{
  res.send(`<!DOCTYPE html><html><head><meta name="viewport"
