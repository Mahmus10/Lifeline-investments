const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

let db;
async function initDB() {
  db = await mysql.createConnection(process.env.DATABASE_URL || process.env.MYSQL_URL);
  console.log("DB Connected");

  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100),
    phone VARCHAR(20) UNIQUE,
    password VARCHAR(100),
    balance DECIMAL(12,2) DEFAULT 0,
    bonus DECIMAL(12,2) DEFAULT 0,
    myReferralCode VARCHAR(20),
    referralCode VARCHAR(20),
    referredBy VARCHAR(20),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS deposits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT,
    phone VARCHAR(20),
    amount DECIMAL(12,2),
    airtelNo VARCHAR(20),
    status VARCHAR(20) DEFAULT 'pending',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS investments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT,
    amount DECIMAL(12,2),
    profit DECIMAL(12,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  try {
    await db.query("ALTER TABLE users ADD COLUMN referralCode VARCHAR(20)");
  } catch(e){}
  try {
    await db.query("ALTER TABLE users ADD COLUMN referredBy VARCHAR(20)");
  } catch(e){}
  try {
    await db.query("ALTER TABLE users ADD COLUMN myReferralCode VARCHAR(20)");
  } catch(e){}
}
initDB();

// REGISTER
app.post('/api/register', async (req,res)=>{
  try {
    const {name, phone, password, ref} = req.body;
    const myCode = 'LIFE' + Math.random().toString(36).substring(2,6).toUpperCase();
    await db.query("INSERT INTO users (name, phone, password, myReferralCode, referredBy) VALUES (?,?,?,?,?)",
    [name, phone, password, myCode, ref || null]);

    if(ref){
      await db.query("UPDATE users SET bonus = bonus +? WHERE myReferralCode=?", [1000, ref]);
    }
    const [user] = await db.query("SELECT * FROM users WHERE phone=?", [phone]);
    res.json(user[0]);
  } catch(e){ res.status(400).json({error:e.message}); }
});

// LOGIN
app.post('/api/login', async (req,res)=>{
  const {phone, password} = req.body;
  const [rows] = await db.query("SELECT * FROM users WHERE phone=? AND password=?", [phone, password]);
  if(rows.length) res.json(rows[0]);
  else res.status(401).json({error:"Wrong credentials"});
});

// DEPOSIT REQUEST
app.post('/api/deposit', async (req,res)=>{
  const {userId, amount, airtelNo} = req.body;
  const [u] = await db.query("SELECT * FROM users WHERE id=?", [userId]);
  await db.query("INSERT INTO deposits (userId, phone, amount, airtelNo) VALUES (?,?,?,?)",
  [userId, u[0].phone, amount, airtelNo]);
  res.json({success:true});
});

// INVEST
app.post('/api/invest', async (req,res)=>{
  const {userId, amount} = req.body;
  const [u] = await db.query("SELECT * FROM users WHERE id=?", [userId]);
  if(u[0].balance < amount) return res.status(400).json({error:"Low balance"});
  await db.query("UPDATE users SET balance=balance-? WHERE id=?", [amount, userId]);
  await db.query("INSERT INTO investments (userId, amount) VALUES (?,?)", [userId, amount]);
  res.json({success:true});
});

// GET USER DATA
app.get('/api/user/:id', async (req,res)=>{
  const [u] = await db.query("SELECT * FROM users WHERE id=?", [req.params.id]);
  const [deps] = await db.query("SELECT * FROM deposits WHERE userId=? ORDER BY id DESC", [req.params.id]);
  const [invs] = await db.query("SELECT * FROM investments WHERE userId=?", [req.params.id]);
  res.json({...u[0], deposits:deps, investments:invs});
});

// ===== ADMIN =====
app.get('/api/admin/deposits', async (req,res)=>{
  const [rows] = await db.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC");
  res.json(rows);
});

app.post('/api/admin/approve/:id', async (req,res)=>{
  const [dep] = await db.query("SELECT * FROM deposits WHERE id=?", [req.params.id]);
  if(!dep[0]) return res.status(404).json({error:"Not found"});
  await db.query("UPDATE deposits SET status='approved' WHERE id=?", [req.params.id]);
  await db.query("UPDATE users SET balance=balance+? WHERE id=?", [dep[0].amount, dep[0].userId]);
  res.json({success:true});
});

app.get('/api/admin/all', async (req,res)=>{
  const [users] = await db.query("SELECT * FROM users");
  const [deps] = await db.query("SELECT * FROM deposits");
  res.json({users, deposits:deps});
});

app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("Running on "+PORT));
