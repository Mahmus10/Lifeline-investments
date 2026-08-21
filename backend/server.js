const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const app = express();

app.use(express.json());
app.use(cors({origin: "*"}));

const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10,
});

// Auto create correct table for LIFELINE
pool.query(`CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100),
  phone VARCHAR(20) UNIQUE,
  password VARCHAR(255),
  referral_code VARCHAR(20) UNIQUE,
  referred_by VARCHAR(20),
  balance DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

pool.query(`CREATE TABLE IF NOT EXISTS deposits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  amount DECIMAL(10,2),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

// HEALTH CHECK
app.get('/', (req,res)=> res.send('LIFELINE API Running'));
app.get('/api', (req,res)=> res.json({status:"LIFELINE API OK"}));

// REGISTER - THIS IS THE FIX
app.post('/api/auth/register', async (req,res)=>{
  try{
    const {name, phone, password, referralCode} = req.body;
    if(!name ||!phone ||!password) return res.status(400).json({message:"Missing fields"});

    const hashed = await bcrypt.hash(password, 10);
    const myCode = phone.slice(-6) + Math.floor(Math.random()*1000);

    pool.query('SELECT * FROM users WHERE phone=?', [phone], (err, exists)=>{
      if(exists && exists.length>0) return res.status(400).json({message:"Phone already registered"});

      pool.query('INSERT INTO users (name, phone, password, referral_code, referred_by) VALUES (?,?,?,?,?)',
      [name, phone, hashed, myCode, referralCode||null],
      (err2, result)=>{
        if(err2){ console.log(err2); return res.status(500).json({message:"DB Error", error: err2.message}); }
        res.json({message:"Account created", phone, referralCode: myCode, id: result.insertId});
      });
    });
  }catch(e){
    res.status(500).json({message:"Server error", error:e.message});
  }
});

// LOGIN
app.post('/api/auth/login', (req,res)=>{
  const {phone, password} = req.body;
  pool.query('SELECT * FROM users WHERE phone=?', [phone], async (err, rows)=>{
    if(err || rows.length==0) return res.status(400).json({message:"User not found"});
    const ok = await bcrypt.compare(password, rows[0].password);
    if(!ok) return res.status(400).json({message:"Wrong password"});
    res.json({message:"Login ok", user: {id: rows[0].id, name: rows[0].name, phone: rows[0].phone}});
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('LIFELINE Running on '+PORT));
