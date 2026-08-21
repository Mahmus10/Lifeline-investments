const express=require('express');
const cors=require('cors');
const path=require('path');
const mysql=require('mysql2/promise');
const bcrypt=require('bcryptjs');
require('dotenv').config();
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
app.use(express.urlencoded({limit:'50mb',extended:true}));
const db=mysql.createPool({
  host:process.env.MYSQLHOST||process.env.DB_HOST,
  user:process.env.MYSQLUSER||process.env.DB_USER,
  password:process.env.MYSQLPASSWORD||process.env.DB_PASS,
  database:process.env.MYSQLDATABASE||process.env.DB_NAME,
  port:process.env.MYSQLPORT||3306,
  waitForConnections:true,connectionLimit:10
});
function genCode(){return 'LIFE'+Math.random().toString(36).substring(2,7).toUpperCase();}
app.get('/',(req,res)=>{res.sendFile(path.join(__dirname,'index.html'));});
app.get('/dashboard',(req,res)=>{res.sendFile(path.join(__dirname,'dashboard.html'));});
app.get('/admin',(req,res)=>{res.sendFile(path.join(__dirname,'admin.html'));});
app.post('/api/register',async(req,res)=>{
  try{
    let {fullName,phone,password,referralCode}=req.body;
    let [e]=await db.query('SELECT id FROM users WHERE phone=?',[phone]);
    if(e.length) return res.status(400).json({message:'Phone exists'});
    let ref=null;
    if(referralCode){
      let [r]=await db.query('SELECT id FROM users WHERE referralCode=?',[referralCode]);
      if(r.length) ref=r[0].id;
    }
    let hash=await bcrypt.hash(password,10);
    let code=genCode();
    let [ins]=await db.query('INSERT INTO users (fullName,phone,password,referralCode,referredBy) VALUES (?,?,?,?,?)',[fullName,phone,hash,code,ref]);
    res.json({message:'Registered',id:ins.insertId});
  }catch(e){res.status(500).json({message:e.message});}
});
app.post('/api/login',async(req,res)=>{
  try{
    let {phone,password}=req.body;
    let [r]=await db.query('SELECT * FROM users WHERE phone=?',[phone]);
    if(!r.length) return res.status(400).json({message:'Not found'});
    let ok=await bcrypt.compare(password,r[0].password);
    if(!ok) return res.status(400).json({message:'Wrong pass'});
    res.json({message:'OK',user:{id:r[0].id,fullName:r[0].fullName,phone:r[0].phone,balance:r[0].balance,referralCode:r[0].referralCode,totalReferralBonus:r[0].totalReferralBonus}});
  }catch(e){res.status(500).json({message:e.message});}
});
app.post('/api/deposit',async(req,res)=>{
  try{
    let {userId,amount,screenshot}=req.body;
    await db.query('INSERT INTO deposits (userId,amount,screenshot,status) VALUES (?,?,?,?)',[userId,amount,screenshot,'pending']);
    res.json({message:'Deposit pending'});
  }catch(e){res.status(500).json({message:e.message});}
});
app.post('/api/invest',async(req,res)=>{
  try{
    let {userId,plan,amount}=req.body;
    let [u]=await db.query('SELECT balance FROM users WHERE id=?',[userId]);
    if(u[0].balance<amount) return res.status(400).json({message:'Low balance'});
    await db.query('UPDATE users SET balance=balance-? WHERE id=?',[amount,userId]);
    await db.query('INSERT INTO investments (userId,plan,amount) VALUES (?,?,?)',[userId,plan,amount]);
    res.json({message:'Invested'});
  }catch(e){res.status(500).json({message:e.message});}
});
app.get('/api/my-investments/:id',async(req,res)=>{
  try{
    let [rows]=await db.query('SELECT * FROM investments WHERE userId=?',[req.params.id]);
    let now=new Date();
    let data=rows.map(r=>{
      let st=new Date(r.startDate);
      let diff=Math.floor((now-st)/(1000*60*60*24));
      let days=Math.min(diff,30);
      let total=(r.amount*0.05*days);
      let avail=total-r.claimed;
      return {...r,days,max:30,avail:avail<0?0:avail};
    });
    res.json(data);
  }catch(e){res.status(500).json({message:e.message});}
});
app.post('/api/claim/:id',async(req,res)=>{
  try{
    let [r]=await db.query('SELECT * FROM investments WHERE id=?',[req.params.id]);
    if(!r.length) return res.status(404).json({message:'No'});
    let inv=r[0];
    let now=new Date(); let st=new Date(inv.startDate);
    let diff=Math.floor((now-st)/(1000*60*60*24));
    let days=Math.min(diff,30);
    let total=(inv.amount*0.05*days);
    let avail=total-inv.claimed;
    if(avail<=0) return res.json({message:'Nothing'});
    await db.query('UPDATE investments SET claimed=claimed+? WHERE id=?',[avail,inv.id]);
    await db.query('UPDATE users SET balance=balance+? WHERE id=?',[avail,inv.userId]);
    res.json({message:'Claimed '+avail});
  }catch(e){res.status(500).json({message:e.message});}
});
app.post('/api/withdraw',async(req,res)=>{
  try{
    let {userId,amount,phone}=req.body;
    let [u]=await db.query('SELECT balance FROM users WHERE id=?',[userId]);
    if(u[0].balance<amount) return res.status(400).json({message:'Low'});
    await db.query('UPDATE users SET balance=balance-? WHERE id=?',[amount,userId]);
    await db.query('INSERT INTO withdrawals (userId,amount,phone,status) VALUES (?,?,?,?)',[userId,amount,phone,'pending']);
    res.json({message:'Withdraw requested'});
  }catch(e){res.status(500).json({message:e.message});}
});
app.get('/api/history/:id',async(req,res)=>{
  try{
    let [deps]=await db.query('SELECT "deposit" as type, amount, status, created_at FROM deposits WHERE userId=?',[req.params.id]);
    let [withs]=await db.query('SELECT "withdraw" as type, amount, status, created_at FROM withdrawals WHERE userId=?',[req.params.id]);
    res.json([...deps,...withs].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));
  }catch(e){res.status(500).json({message:e.message});}
});
app.get('/api/admin/deposits',async(req,res)=>{let [r]=await db.query('SELECT d.*, u.phone, u.referredBy FROM deposits d LEFT JOIN users u ON d.userId=u.id ORDER BY d.created_at DESC');res.json(r);});
app.get('/api/admin/withdraws',async(req,res)=>{let [r]=await db.query('SELECT * FROM withdrawals ORDER BY created_at DESC');res.json(r);});
app.get('/api/admin/users',async(req,res)=>{let [r]=await db.query('SELECT id,fullName,phone,referralCode,referredBy,balance,totalReferralBonus FROM users ORDER BY id DESC');res.json(r);});
app.post('/api/admin/approve/:id',async(req,res)=>{
  try{
    let [d]=await db.query('SELECT * FROM deposits WHERE id=?',[req.params.id]);
    if(!d.length) return res.status(404).json({message:'No'});
    if(d[0].status=='approved') return res.json({message:'Already'});
    await db.query('UPDATE deposits SET status=? WHERE id=?',['approved',req.params.id]);
    await db.query('UPDATE users SET balance=balance+? WHERE id=?',[d[0].amount,d[0].userId]);
    let [u]=await db.query('SELECT referredBy FROM users WHERE id=?',[d[0].userId]);
    if(u[0].referredBy){
      let bonus=d[0].amount*0.1;
      await db.query('UPDATE users SET balance=balance+?, totalReferralBonus=totalReferralBonus+? WHERE id=?',[bonus,bonus,u[0].referredBy]);
    }
    res.json({message:'Approved +10% if ref'});
  }catch(e){res.status(500).json({message:e.message});}
});
app.post('/api/admin/reject/:id',async(req,res)=>{await db.query('UPDATE deposits SET status=? WHERE id=?',['rejected',req.params.id]);res.json({message:'Rejected'});});
app.post('/api/admin/withdraw/approve/:id',async(req,res)=>{await db.query('UPDATE withdrawals SET status=? WHERE id=?',['approved',req.params.id]);res.json({message:'Sent'});});
app.post('/api/admin/withdraw/reject/:id',async(req,res)=>{
  let [w]=await db.query('SELECT * FROM withdrawals WHERE id=?',[req.params.id]);
  if(w.length){await db.query('UPDATE users SET balance=balance+? WHERE id=?',[w[0].amount,w[0].userId]);}
  await db.query('UPDATE withdrawals SET status=? WHERE id=?',['rejected',req.params.id]);
  res.json({message:'Rejected & returned'});
});
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>{console.log('Running '+PORT);});
