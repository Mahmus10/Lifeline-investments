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
      let [r]=await db.query('SELECT id FROM users WHERE referralCode=?',
