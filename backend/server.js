const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());

let db;
(async()=>{
  try{
    const url=process.env.DATABASE_URL||process.env.MYSQL_URL;
    db=await mysql.createConnection(url);
    console.log("DB OK");
    await db.query(`CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, phone VARCHAR(20), amount DECIMAL(12,2), airtelNo VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await db.query(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100), phone VARCHAR(20) UNIQUE, password VARCHAR(100), balance DECIMAL(12,2) DEFAULT 0, bonus DECIMAL(12,2) DEFAULT 0, myReferralCode VARCHAR(20), referredBy VARCHAR(20))`);
  }catch(e){console.log(e.message)}
})();

// ADMIN API
app.get('/api/admin/deposits', async(req,res)=>{
  try{
    const [rows]=await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC");
    res.json(rows);
  }catch(e){res.json([])}
});
app.post('/api/admin/approve/:id', async(req,res)=>{
  const [dep]=await db.query("SELECT * FROM deposits WHERE id=?",[req.params.id]);
  if(!dep[0]) return res.json({error:"not found"});
  await db.query("UPDATE deposits SET status='approved' WHERE id=?",[req.params.id]);
  await db.query("UPDATE users SET balance=balance+? WHERE id=?",[dep[0].amount, dep[0].userId]);
  res.json({success:true});
});

// THIS IS YOUR FADE ADMIN - WORKS ALWAYS
app.get('/admin', (req,res)=>{
  res.send(`<!DOCTYPE html><html><body style="background:black;color:white;padding:20px;font-family:sans-serif"><h2>🔐 ADMIN - PENDING DEPOSITS</h2><div id="list">Loading...</div><script>async function load(){let r=await fetch('/api/admin/deposits');let data=await r.json();let el=document.getElementById('list');if(!data.length) el.innerHTML='<h3>No pending ✅</h3>';else el.innerHTML=data.map(d=>\`<div id="row-\${d.id}" style="background:#222;padding:12px;margin:10px 0;border-radius:10px;transition:0.5s">\${d.phone} - \${d.amount} UGX - \${d.airtelNo||''} <button onclick="approve(\${d.id})" style="background:#00ff00;color:black;padding:6px 15px;border:none;border-radius:5px;margin-left:10px">Approve</button></div>\`).join('')}async function approve(id){await fetch('/api/admin/approve/'+id,{method:'POST'});let row=document.getElementById('row-'+id);row.style.opacity='0';row.style.transform='translateX(100%)';setTimeout(()=>row.remove(),500);}load();<\/script></body></html>`);
});

app.get('/', (req,res)=>{res.redirect('/admin')});
app.listen(process.env.PORT||3000, ()=>console.log("Running"));
