const express=require('express');
const mysql=require('mysql2/promise');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
let db;
const ADMIN_KEY="LIFELINE123";
const TG_GROUP="https://t.me/+CbCGmt2mSgcwY2U0";
async function init(){
 try{
  const u=process.env.DATABASE_URL||process.env.MYSQL_URL;
  db=await mysql.createConnection(u);
  try{await db.query("ALTER TABLE users MODIFY fullName VARCHAR(100) NULL")}catch(e){}
  try{await db.query("ALTER TABLE deposits ADD COLUMN phone VARCHAR(20)")}catch(e){}
  try{await db.query("ALTER TABLE deposits ADD COLUMN airtelNo VARCHAR(20)")}catch(e){}
  try{await db.query("ALTER TABLE deposits ADD COLUMN screenshot LONGTEXT")}catch(e){}
  try{await db.query("ALTER TABLE deposits MODIFY screenshot LONGTEXT")}catch(e){}
  try{await db.query("ALTER TABLE users ADD COLUMN referralBonus INT DEFAULT 0")}catch(e){}
  try{await db.query("CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, club VARCHAR(50), amount INT, rate INT, lockDays INT, startDate DATETIME DEFAULT CURRENT_TIMESTAMP, status VARCHAR(20) DEFAULT 'active')")}catch(e){}
  try{await db.query("ALTER TABLE investments ADD COLUMN club VARCHAR(50)")}catch(e){}
  try{await db.query("ALTER TABLE investments ADD COLUMN rate INT")}catch(e){}
  try{await db.query("ALTER TABLE investments ADD COLUMN lockDays INT")}catch(e){}
  try{await db.query("UPDATE investments SET rate=10, lockDays=10 WHERE club IN ('arsenal','manutd','mancity') AND (rate IS NULL OR rate=0)")}catch(e){}
  try{await db.query("UPDATE investments SET rate=8, lockDays=8 WHERE club IN ('chelsea','liverpool') AND (rate IS NULL OR rate=0)")}catch(e){}
  try{await db.query("CREATE TABLE IF NOT EXISTS withdrawals (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount INT, type VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)")}catch(e){}
  try{await db.query("CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, phone VARCHAR(20), amount INT, airtelNo VARCHAR(20), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)")}catch(e){}
  console.log("DB OK");
 }catch(e){console.log(e.message)}
}
init();
app.post('/api/register',async(req,res)=>{
 try{
  const{name,phone,password,ref}=req.body;
  const code='LIFE'+Math.random().toString(36).slice(2,6).toUpperCase();
  try{await db.query("INSERT INTO users (fullName,name,username,phone,password,myReferralCode,referredBy,balance,bonus,referralBonus) VALUES (?,?,?,?,?,?,?,0,0,0)",[name,name,name,phone,password,code,ref||null]);}catch(e){await db.query("INSERT INTO users (fullName,phone,password,myReferralCode,referredBy) VALUES (?,?,?,?,?)",[name,phone,password,code,ref||null]);}
  const[r]=await db.query("SELECT * FROM users WHERE phone=?",[phone]); res.json(r[0]);
 }catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/login',async(req,res)=>{const[r]=await db.query("SELECT * FROM users WHERE phone=? AND password=?",[req.body.phone,req.body.password]); if(r.length) res.json(r[0]); else res.status(401).json({error:"Wrong"});});
app.get('/api/user/:id',async(req,res)=>{
 const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]);
 const[inv]=await db.query("SELECT * FROM investments WHERE userId=? AND status='active'",[req.params.id]);
 let totalInterest=0; let now=new Date(); const rateMap={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8};
 for(let i of inv){let days=Math.floor((now - new Date(i.startDate))/(1000*60*60*24)); if(days<0) days=0; let r=i.rate||rateMap[i.club]||10; totalInterest+= Math.floor((i.amount||0) * r/100 * days);}
 const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[req.params.id]);
 let available = totalInterest - w[0].s; if(available<0) available=0;
 res.json({...u[0], totalInterest:available, rawInterest:totalInterest, investments:inv});
});
app.get('/api/team/:id',async(req,res)=>{
 try{
  const[u]=await db.query("SELECT * FROM users WHERE id=?",[req.params.id]);
  if(!u.length) return res.json({team:[]});
  const code=u[0].myReferralCode;
  const[team]=await db.query("SELECT id,phone,fullName,balance,createdAt FROM users WHERE referredBy=?",[code]);
  res.json({code:code, bonus:u[0].referralBonus||0, team:team, count:team.length, tg:TG_GROUP});
 }catch(e){res.json({team:[]})}
});
app.post('/api/deposit',async(req,res)=>{
 try{
  const{userId,amount,airtelNo,screenshot}=req.body;
  const[u]=await db.query("SELECT * FROM users WHERE id=?",[userId]);
  let phone = u.length?u[0].phone:"unknown";
  await db.query("INSERT INTO deposits (userId,phone,amount,airtelNo,screenshot,status) VALUES (?,?,?,?,?,'pending')",[userId,phone,parseInt(amount),airtelNo,screenshot||""]);
  res.json({ok:1});
 }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/invest',async(req,res)=>{
 try{
  const{userId,club,amount}=req.body;
  if(parseInt(amount)<2000) return res.status(400).json({error:"Min 2000 UGX"});
  const[u]=await db.query("SELECT * FROM users WHERE id=?",[userId]);
  if((u[0].balance||0) < amount) return res.status(400).json({error:"Insufficient balance"});
  const clubs={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8};
  const locks={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8};
  await db.query("UPDATE users SET balance=balance-? WHERE id=?",[amount,userId]);
  await db.query("INSERT INTO investments (userId,club,amount,rate,lockDays) VALUES (?,?,?,?,?)",[userId,club,amount,clubs[club],locks[club]]);
  res.json({ok:1});
 }catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/withdraw',async(req,res)=>{
 try{
  const{userId,amount}=req.body;
  if(amount<5000) return res.status(400).json({error:"Min 5k"});
  const[inv]=await db.query("SELECT * FROM investments WHERE userId=? AND status='active'",[userId]);
  let totalInterest=0; let now=new Date(); const rateMap={arsenal:10,manutd:10,mancity:10,chelsea:8,liverpool:8};
  for(let i of inv){ let days=Math.floor((now - new Date(i.startDate))/(1000*60*60*24)); let r=i.rate||rateMap[i.club]||10; totalInterest+= Math.floor((i.amount||0)*r/100*days); }
  const[w]=await db.query("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status IN ('pending','approved')",[userId]);
  let available = totalInterest - w[0].s;
  if(amount>available) return res.status(400).json({error:"Only "+available+" available"});
  await db.query("INSERT INTO withdrawals (userId,amount,type,status) VALUES (?,
