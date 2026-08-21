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
  pool.query(sql, (err)=>{ if(err) console.log('safeQuery ignore:', err.message); });
}

safeQuery(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(100), phone VARCHAR(20) UNIQUE, password VARCHAR(255), balance DECIMAL(10,2) DEFAULT 0, referralCode VARCHAR(20) UNIQUE, referredBy INT DEFAULT NULL, totalReferralBonus DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
safeQuery(`CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount DECIMAL(10,2), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
safeQuery(`CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, plan VARCHAR(50), amount DECIMAL(10,2), claimed DECIMAL(10,2) DEFAULT 0, status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
safeQuery(`CREATE TABLE IF NOT EXISTS withdraws (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount DECIMAL(10,2), phone VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
safeQuery(`CREATE TABLE IF NOT EXISTS transactions (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, type VARCHAR(30), amount DECIMAL(10,2), description VARCHAR(255), status VARCHAR(20) DEFAULT 'completed', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

// Try add columns - ignore error if already exists
safeQuery(`ALTER TABLE users ADD COLUMN referralCode VARCHAR(20)`);
safeQuery(`ALTER TABLE users ADD COLUMN referredBy INT DEFAULT NULL`);
safeQuery(`ALTER TABLE users ADD COLUMN totalReferralBonus DECIMAL(10,2) DEFAULT 0`);

const DAILY_RATE = 0.05;
const REFERRAL_RATE = 0.10;
const PLAN_DAYS = { Starter:30, Pro:30, VIP:30 };
function calcProfit(inv){
  const maxDays = PLAN_DAYS[inv.plan] || 30;
  const diffDays = Math.floor((new Date() - new Date(inv.created_at))/1000/3600/24);
  const days = Math.min(diffDays, maxDays);
  const totalProfit = inv.amount * DAILY_RATE * days;
  const available = totalProfit - (inv.claimed||0);
  return { daysPassed: days, totalProfit, available: available>0?available:0, remaining: maxDays-days, maxDays, rate: DAILY_RATE, isCompleted: days>=maxDays };
}
function genReferralCode(phone){ return 'LIFE'+phone.slice(-4)+Math.floor(10+Math.random()*90); }
function addTransaction(userId, type, amount, desc, status='completed'){
  pool.query('INSERT INTO transactions (userId,type,amount,description,status) VALUES (?,?,?,?,?)',[userId,type,amount,desc,status],(e)=>{ if(e) console.log('tx err', e.message); });
}

app.get('/', (req,res)=>{
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a
