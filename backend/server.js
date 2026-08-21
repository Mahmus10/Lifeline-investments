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

pool.query(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(100), phone VARCHAR(20) UNIQUE, password VARCHAR(255), balance DECIMAL(10,2) DEFAULT 0, referralCode VARCHAR(20) UNIQUE, referredBy INT DEFAULT NULL, totalReferralBonus DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
pool.query(`CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount DECIMAL(10,2), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
pool.query(`CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, plan VARCHAR(50), amount DECIMAL(10,2), claimed DECIMAL(10,2) DEFAULT 0, status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
pool.query(`CREATE TABLE IF NOT EXISTS withdraws (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount DECIMAL(10,2), phone VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

const DAILY_RATE = 0.05; // 5% daily
const REFERRAL_RATE = 0.10; // 10%
const PLAN_DAYS = { Starter:30, Pro:30, VIP:30 }; // 30 days all

function calcProfit(inv){
  const rate = DAILY_RATE;
  const maxDays = PLAN_DAYS[inv.plan] || 30;
  const created = new Date(inv.created_at);
  const diffDays = Math.floor((new Date() - created)/1000/3600/24);
  const days = Math.min(diffDays, maxDays);
  const totalProfit = inv.amount * rate * days;
  const available = totalProfit - (inv.claimed||0);
  return { daysPassed: days, totalProfit, available: available>0?available:0, remaining: maxDays-days, maxDays, rate, isCompleted: days>=maxDays };
}

function genReferralCode(phone){ return 'LIFE'+phone.slice(-4)+Math.floor(Math.random()*99); }

app.get('/', (req,res)=>{
  const ref = req.query.ref || '';
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#1a1a1a;padding:25px;border-radius:15px;width:90%;max-width:360px}h1{color:#00ff88;text-align:center}input{width:100%;padding:12px;margin:8px 0;border-radius:8px;border:none}button{width:100%;padding:12px;background:#00ff88;border:none;border-radius:8px;font-weight:bold;margin-top:10px}.refBox{background:#222;padding:10px;border-radius:8px;border:1px dashed #00ff88;margin:8px 0}</style></head><body><div class="box"><h1>LIFELINE INVESTMENTS</h1><p style="text-align:center;color:#ffaa00">Earn 5% Daily + 10% Referral Bonus!</p><h3>Register</h3><input id="name" placeholder="Full Name"><input id="phone" placeholder="Phone"><input id="pass" type="password" placeholder="Password"><div class="refBox"><input id="refCode" placeholder="Referral Code (Optional)" value="${ref}"><small style="color:#888">If someone referred you, enter their code</small></div><button onclick="reg()">Register</button><p id="msg"></p><hr><h3>Login</h3><input id="lphone" placeholder="Phone"><input id="lpass" type="password" placeholder="Password"><button onclick="log()">Login</button><p id="msg2"></p></div><script>async function reg(){const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fullName:name.value,phone:document.getElementById('phone').value,password:pass.value,referralCode:refCode.value})});const d=await r.json();msg.innerText=d.message;}async function log(){const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:lphone.value,password:lpass.value})});const d=await r.json();msg2.innerText=d.message;if(r.ok){localStorage.setItem('user',JSON.stringify(d.user));location.href='/dashboard'}}</script></body></html>`);
});

app.get('/dashboard', (req,res)=>{ res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a;color:#fff;font-family:sans-serif;padding:15px;margin:0}.card{background:#1a1a1a;padding:20px;border-radius:15px;max-width:440px;margin:auto}h1{color:#00ff88}button{padding:10px 14px;margin:4px;border:none;border-radius:8px;font-weight:bold;cursor:pointer}.green{background:#00ff88}.red{background:#ff4444;color:#fff}.orange{background:#ffaa00}.blue{background:#00aaff;color:#fff}.plan{background:#222;padding:12px;border-radius:10px;margin:10px 0;border:1px solid #00ff88}input{width:100%;padding:10px;margin:8px 0;border-radius:8px;border:none}#depositBox,#investBox,#withdrawBox{display:none;background:#222;padding:15px;border-radius:10px;margin-top:15px}img{max-width:100%;border-radius:8px;margin-top:10px}.inv{border:1px solid #00ff88;border-radius:10px;padding:12px;margin:10px 0;background:#151515}.ref{background:#222;border:2px dashed #00ff88;padding:12px;border-radius:10px;margin:10px 0;text-align:center}</style></head><body><div class="card"><h1 id="welcome">Welcome</h1><p>Balance: <b>UGX <span id="bal">0</span></b> | Referral Bonus: <b style="color:#ffaa00">UGX <span id="refBonus">0</span></b></p><div class="ref"><b>Your Referral Link (10% bonus):</b><br><input id="myLink" readonly style="background:#000;color:#00ff88;text-align:center"><button class="blue" onclick="copyLink()">Copy Link</button><br><small>Share! When friend deposits & admin approves, you get 10% instantly!</small></div><button class="green" onclick="showDeposit()">Deposit</button><button class="green" onclick="showInvest()">Invest (5% daily)</button><button class="orange" onclick="showWithdraw()">Withdraw</button><button class="blue" onclick="loadInvests()">My Profit</button><button class="red" onclick="logout()">Logout</button><div id="depositBox"><h3>Deposit via 0740383797</h3><input id="depAmount" type="number" placeholder="Amount"><input id="screenshotFile" type="file" accept="image/*" onchange="previewImage()"><img id="preview" style="display:none"><button class="green" onclick="doDeposit()">Submit</button><p id="depMsg"></p></div><div id="investBox"><h3>Plans - 5% Daily</h3><div class="plan"><b>Starter 5% daily x30 days</b><br>20k → 1k/day → Total 50k<br><button class="green" onclick="doInvest('Starter',20000)">Invest 20k</button></div><div class="plan"><b>Pro 5% daily x30 days</b><br>50k → 2.5k/day → Total 125k<br><button class="green" onclick="doInvest('Pro',50000)">Invest 50k</button></div><div class="plan"><b>VIP 5% daily x30 days</b><br>100k → 5k/day → Total 250k<br><button class="green" onclick="doInvest('VIP',100000)">Invest 100k</button></div><p id="invMsg"></p></div><div id="withdrawBox"><h3>Withdraw</h3><input id="withAmount" type="number" placeholder="Amount"><input id="withPhone" type="text" placeholder="Airtel Number"><button class="orange" onclick="doWithdraw()">Request Withdraw</button><p id="withMsg"></p></div><div id="myInvests" style="margin-top:15px"></div></div><script>const u=JSON.parse(localStorage.getItem('user')||'{}');if(!u.phone)location.href='/';welcome.innerText='Welcome '+u.fullName;bal.innerText=u.balance||'0.00';refBonus.innerText=u.totalReferralBonus||'0';myLink.value=location.origin+'/?ref='+u.referralCode;function copyLink(){myLink.select();document.execCommand('copy');alert('Copied: '+myLink.value);}function logout(){localStorage.clear();location.href='/';}function showDeposit(){depositBox.style.display='block';investBox.style.display='none';withdrawBox.style.display='none';}function showInvest(){investBox.style.display='block';depositBox.style.display='none';withdrawBox.style.display='none';}function showWithdraw(){withdrawBox.style.display='block';depositBox.style.display='none';investBox.style.display='none';withPhone.value=u.phone;}let base64Screenshot='';function previewImage(){const f=screenshotFile.files[0];if(!f)return;const r=new FileReader();r.onload=e=>{base64Screenshot=e.target.result;preview.src=base64Screenshot;preview.style.display='block';};r.readAsDataURL(f);}async function doDeposit(){const amount=depAmount.value;if(!amount)return alert('Enter amount');if(!base64Screenshot)return alert('Upload screenshot!');depMsg.innerText='Uploading...';const res=await fetch('/api/deposit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id,amount,screenshot:base64Screenshot})});const d=await res.json();depMsg.innerText=d.message;alert(d.message);}async function doInvest(p,a){const r=await fetch('/api/invest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id,plan:p,amount:a})});const d=await r.json();invMsg.innerText=d.message;alert(d.message);if(r.ok)loadInvests();}async function doWithdraw(){const amount=withAmount.value;const phone=withPhone.value;if(!amount||!phone)return alert('Enter amount and phone');withMsg.innerText='Sending...';const r=await fetch('/api/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id,amount,phone})});const d=await r.json();withMsg.innerText=d.message;alert(d.message);}async function loadInvests(){myInvests.innerHTML='Loading profits...';const r=await fetch('/api/my-investments/'+u.id);const data=await r.json();if(!data.length){myInvests.innerHTML='<p>No investments yet - Invest now to earn 5% daily!</p>';return;}let h='<h3>💰 My Investments - 5% Daily</h3>';let totalAvailable=0;data.forEach(inv=>{totalAvailable+=inv.available;h+='<div class=inv><b>'+inv.plan+' - UGX '+inv.amount+'</b><br>Rate: 5% daily = '+(inv.amount*0.05)+' UGX/day<br>Day '+inv.daysPassed+'/'+inv.maxDays+'<br>Total Earned: UGX '+inv.totalProfit.toFixed(0)+'<br>Claimed: UGX '+inv.claimed+'<br><b style=color:#00ff88>Available: UGX '+inv.available.toFixed(0)+'</b><br>'+(inv.remaining>0?inv.remaining+' days left':'COMPLETED')+'<br>'+(inv.available>0?'<button class=green onclick=claim('+inv.id+')>CLAIM '+inv.available.toFixed(0)+'</button>':'<button style=opacity:0.3>Wait 24h</button>')+'</div>';});h='<div style=background:#00ff88;color:#000;padding:10px;border-radius:8px;margin-bottom:10px><b>Total Available: UGX '+totalAvailable.toFixed(0)+'</b></div>'+h;myInvests.innerHTML=h;}async function claim(id){if(!confirm('Claim to balance?'))return;const r=await fetch('/api/claim/'+id,{method:'POST'});const d=await r.json();alert(d.message);location.reload();}loadInvests();</script></body></html>`); });

app.get('/admin', (req,res)=>{ res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:sans-serif;padding:15px}h1{color:#00ff88}.tabs{display:flex;gap:10px;margin:15px 0;flex-wrap:wrap}.activeTab{background:#00ff88!important;color:#000}.dep{background:#1a1a1a;padding:15px;margin:10px 0;border-radius:10px;border:1px solid #333}img{max-width:100%;border-radius:8px;margin:10px 0}button{padding:10px 18px;margin:5px;border:none;border-radius:6px;font-weight:bold;transition:0.3s;cursor:pointer}.green{background:#00ff88}.red{background:#ff4444;color:#fff}.orange{background:#ffaa00}</style></head><body><h1>ADMIN - 0740383797</h1><div class="tabs"><button id="tabDep" class="activeTab" onclick="showTab('dep')">Deposits</button><button id="tabWith" onclick="showTab('with')">Withdraws</button><button onclick="showTab('inv')">Investments</button><button onclick="showTab('users')">Users & Referrals</button></div><div id="list">Loading...</div><script>let currentTab='dep';function showTab(t){currentTab=t;document.querySelectorAll('.tabs button').forEach(b=>b.className='');load();}async function load(){if(currentTab==='dep'){const r=await fetch('/api/admin/deposits');const data=await r.json();let h='<h2>Deposits ('+data.length+') - 10% goes to referrer on approve</h2>';data.forEach(d=>{let isDone=d.status!=='pending';let s=isDone?'opacity:0.3;pointer-events:none;':'';let c=d.status==='approved'?'#00ff88':(d.status==='rejected'?'#ff4444':'#ffcc00');h+='<div class=dep><b>ID:'+d.userId+' Phone:'+d.phone+' Amount: UGX '+d.amount+' | ReferredBy:'+(d.referredBy||'None')+'</b><br>Status: <b style=color:'+c+'>'+d.status.toUpperCase()+'</b><br>'+d.created_at+'<br>'+(d.screenshot?'<img src='+d.screenshot+'>':'')+'<br><button class=green style='+s+' onclick=approveDep('+d.id+')>APPROVE + give 10% to referrer</button> <button class=red style='+s+' onclick=rejectDep('+d.id+')>REJECT</button></div>';});list.innerHTML=h;}else if(currentTab==='with'){const r=await fetch('/api/admin/withdraws');const data=await r.json();let h='<h2>Withdraws ('+data.length+')</h2>';data.forEach(d=>{let isDone=d.status!=='pending';let s=isDone?'opacity:0.3;pointer-events:none;':'';let c=d.status==='approved'?'#00ff88':(d.status==='rejected'?'#ff4444':'#ffcc00');h+='<div class=dep><b>UserID:'+d.userId+' Phone:'+d.phone+' Amount: UGX '+d.amount+'</b><br>Send to: <b style=color:#ffaa00>'+d.phone+'</b><br>Status: <b style=color:'+c+'>'+d.status.toUpperCase()+'</b><br>'+d.created_at+'<br><button class=orange style='+s+' onclick=approveWith('+d.id+')>SENT</button> <button class=red style='+s+' onclick=rejectWith('+d.id+')>REJECT</button></div>';});list.innerHTML=h;}else if(currentTab==='inv'){const r=await fetch('/api/admin/investments');const data=await r.json();let h='<h2>Investments 5% daily ('+data.length+')</h2>';data.forEach(d=>{h+='<div class=dep>UserID:'+d.userId+' Phone:'+d.phone+' Plan:'+d.plan+' Amount:'+d.amount+' Claimed:'+d.claimed+'<br>'+d.created_at+'</div>';});list.innerHTML=h;}else{const r=await fetch('/api/admin/users');const data=await r.json();let h='<h2>Users & Referral Codes ('+data.length+')</h2>';data.forEach(u=>{h+='<div class=dep>'+u.fullName+' | '+u.phone+'<br>Code: <b style=color:#00ff88>'+u.referralCode+'</b> | ReferredBy: '+(u.referredBy||'None')+'<br>Balance: '+u.balance+' | Referral Bonus: '+(u.totalReferralBonus||0)+'<br>Link: '+location.origin+'/?ref='+u.referralCode+'</div>';});list.innerHTML=h;}}async function approveDep(id){if(!confirm('Approve? 10% will go to referrer if exists!'))return;const r=await fetch('/api/admin/approve/'+id,{method:'POST'});const d=await r.json();alert(d.message);load();}async function rejectDep(id){if(!confirm('Reject?'))return;const r=await fetch('/api/admin/reject/'+id,{method:'POST'});const d=await r.json();alert(d.message);load();}async function approveWith(id){if(!confirm('Have you SENT money?'))return;const r=await fetch('/api/admin/withdraw/approve/'+id,{method:'POST'});const d=await r.json();alert(d.message);load();}async function rejectWith(id){if(!confirm('Reject and return balance?'))return;const r=await fetch('/api/admin/withdraw/reject/'+id,{method:'POST'});const d=await r.json();alert(d.message);load();}load();</script></body></html>`); });

app.post('/api/register', async (req,res)=>{
  const {fullName,phone,password,referralCode}=req.body;
  const hashed=await bcrypt.hash(password,10);
  const myCode = genReferralCode(phone);
  let referredById = null;
  if(referralCode){
    try{
      const [refUser] = await pool.promise().query('SELECT id FROM users WHERE referralCode=? OR phone=?',[referralCode, referralCode]);
      if(refUser.length>0) referredById = refUser[0].id;
    }catch(e){}
  }
  pool.query('INSERT INTO users (fullName,phone,password,referralCode,referredBy) VALUES (?,?,?,?,?)',[fullName,phone,hashed,myCode,referredById],(err)=>{
    if(err){
      if(err.code==='ER_DUP_ENTRY')return res.status(400).json({message:'Phone registered'});
      return res.status(500).json({message:err.sqlMessage});
    }
    res.json({message:'Created! Your referral code: '+myCode+' - Login now'});
  });
});
app.post('/api/login', (req,res)=>{pool.query('SELECT * FROM users WHERE phone=?',[req.body.phone], async (err,results)=>{if(err||results.length==0)return res.status(400).json({message:'Not found'});const match=await bcrypt.compare(req.body.password,results[0].password);if(!match)return res.status(400).json({message:'Wrong password'});const u=results[0];res.json({message:'Welcome',user:{id:u.id,fullName:u.fullName,phone:u.phone,balance:u.balance,referralCode:u.referralCode,totalReferralBonus:u.totalReferralBonus}});});});
app.post('/api/deposit', (req,res)=>{pool.query('INSERT INTO deposits (userId,amount,screenshot,status) VALUES (?,?,?,?)',[req.body.userId,req.body.amount,req.body.screenshot,'pending'],(err2)=>{if(err2)return res.status(500).json({message:err2.sqlMessage});res.json({message:'SUCCESS! Deposit submitted!'});});});
app.post('/api/invest', (req,res)=>{
  const {userId, plan, amount}=req.body;
  pool.query('SELECT balance FROM users WHERE id=?',[userId], (err, rows)=>{
    if(err||!rows.length) return res.status(400).json({message:'User not found'});
    if(parseFloat(rows[0].balance) < parseFloat(amount)) return res.status(400).json({message:'Insufficient balance! Deposit first. Balance: '+rows[0].balance});
    pool.query('UPDATE users SET balance=balance-? WHERE id=?',[amount, userId], ()=>{
      pool.query('INSERT INTO investments (userId,plan,amount,claimed,status) VALUES (?,?,?,?,?)',[userId, plan, amount, 0, 'active'], (err2)=>{
        if(err2) return res.status(500).json({message:err2.sqlMessage});
        res.json({message:'Invested '+amount+' in '+plan+'! Earn 5% daily! = '+(amount*0.05)+' per day'});
      });
    });
  });
});
app.post('/api/withdraw', (req,res)=>{
  const {userId, amount, phone}=req.body;
  pool.query('SELECT balance FROM users WHERE id=?',[userId], (err, rows)=>{
    if(err||!rows.length) return res.status(400).json({message:'User not found'});
    if(parseFloat(rows[0].balance) < parseFloat(amount)) return res.status(400).json({message:'Insufficient balance! You have '+rows[0].balance});
    pool.query('UPDATE users SET balance=balance-? WHERE id=?',[amount, userId], ()=>{
      pool.query('INSERT INTO withdraws (userId, amount, phone, status) VALUES (?,?,?,?)',[userId, amount, phone, 'pending'], (err2)=>{
        if(err2) return res.status(500).json({message:err2.sqlMessage});
        res.json({message:'Withdraw request of '+amount+' UGX sent to '+phone});
      });
    });
  });
});
app.get('/api/my-investments/:userId', (req,res)=>{
  pool.query('SELECT * FROM investments WHERE userId=? ORDER BY id DESC',[req.params.userId], (err, results)=>{
    if(err) return res.json([]);
    const enriched = results.map(inv=>{ return {...inv,...calcProfit(inv)}; });
    res.json(enriched);
  });
});
app.post('/api/claim/:id', (req,res)=>{
  pool.query('SELECT * FROM investments WHERE id=?',[req.params.id], (err, rows)=>{
    if(err||!rows.length) return res.status(400).json({message:'Investment not found'});
    const inv = rows[0];
    const calc = calcProfit(inv);
    if(calc.available<=0) return res.status(400).json({message:'Nothing to claim yet! Wait 24h. Days: '+calc.daysPassed});
    pool.query('UPDATE investments SET claimed=claimed+? WHERE id=?',[calc.available, inv.id], ()=>{
      pool.query('UPDATE users SET balance=balance+? WHERE id=?',[calc.available, inv.userId], ()=>{
        if(calc.isCompleted){ pool.query('UPDATE investments SET status=? WHERE id=?',['completed', inv.id], ()=>{}); }
        res.json({message:'SUCCESS! Claimed UGX '+calc.available.toFixed(0)+' to your balance!'});
      });
    });
  });
});
app.get('/api/admin/deposits', (req,res)=>{pool.query('SELECT deposits.*, users.phone, users.referredBy FROM deposits LEFT JOIN users ON deposits.userId=users.id ORDER BY id DESC',(err,results)=>{if(err)return res.json([]);res.json(results);});});
app.get('/api/admin/withdraws', (req,res)=>{pool.query('SELECT withdraws.*, users.phone as userPhone FROM withdraws LEFT JOIN users ON withdraws.userId=users.id ORDER BY id DESC',(err,results)=>{if(err)return res.json([]);res.json(results);});});
app.get('/api/admin/investments', (req,res)=>{pool.query('SELECT investments.*, users.phone FROM investments LEFT JOIN users ON investments.userId=users.id ORDER BY id DESC',(err,results)=>{if(err)return res.json([]);res.json(results);});});
app.get('/api/admin/users', (req,res)=>{pool.query('SELECT id, fullName, phone, referralCode, referredBy, balance, totalReferralBonus FROM users ORDER BY id DESC',(err,results)=>{if(err)return res.json([]);res.json(results);});});

// APPROVE DEPOSIT + 10% REFERRAL BONUS
app.post('/api/admin/approve/:id', (req,res)=>{
  pool.query('SELECT deposits.*, users.referredBy FROM deposits LEFT JOIN users ON deposits.userId=users.id WHERE deposits.id=?',[req.params.id],(err,rows)=>{
    if(err||!rows.length)return res.status(400).json({message:'Not found'});
    if(rows[0].status!=='pending')return res.json({message:'Already processed!'});
    const dep = rows[0];
    pool.query('UPDATE users SET balance=balance+? WHERE id=?',[dep.amount, dep.userId],()=>{
      pool.query('UPDATE deposits SET status=? WHERE id=?',['approved',req.params.id],()=>{
        // REFERRAL BONUS 10%
        if(dep.referredBy){
          const bonus = parseFloat(dep.amount) * REFERRAL_RATE;
          pool.query('UPDATE users SET balance=balance+?, totalReferralBonus=totalReferralBonus+? WHERE id=?',[bonus, bonus, dep.referredBy], ()=>{
            res.json({message:'Approved! User got '+dep.amount+' | Referrer ID '+dep.referredBy+' got 10% = '+bonus+' UGX bonus!'});
          });
        } else {
          res.json({message:'Approved! Balance added. No referrer.'});
        }
      });
    });
  });
});
app.post('/api/admin/reject/:id', (req,res)=>{pool.query('UPDATE deposits SET status=? WHERE id=?',['rejected',req.params.id],()=>{res.json({message:'Rejected'});});});
app.post('/api/admin/withdraw/approve/:id', (req,res)=>{pool.query('SELECT * FROM withdraws WHERE id=?',[req.params.id],(err,rows)=>{if(err||!rows.length)return res.status(400).json({message:'Not found'});if(rows[0].status!=='pending')return res.json({message:'Already processed!'});pool.query('UPDATE withdraws SET status=? WHERE id=?',['approved',req.params.id],()=>{res.json({message:'Approved!'});});});});
app.post('/api/admin/withdraw/reject/:id', (req,res)=>{pool.query('SELECT * FROM withdraws WHERE id=?',[req.params.id],(err,rows)=>{if(err||!rows.length)return res.status(400).json({message:'Not found'});if(rows[0].status!=='pending')return res.json({message:'Already processed!'});pool.query('UPDATE users SET balance=balance+? WHERE id=?',[rows[0].amount,rows[0].userId],()=>{pool.query('UPDATE withdraws SET status=? WHERE id=?',['rejected',req.params.id],()=>{res.json({message:'Rejected! Money returned'});});});});});
app.listen(process.env.PORT||3000,()=>console.log('Running'));
