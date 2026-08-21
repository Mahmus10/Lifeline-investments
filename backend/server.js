const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const app = express();
app.use(cors());
app.use(express.json({limit:'20mb'}));
process.on('uncaughtException', e=>console.log(e));

const pool = mysql.createPool({
 host:process.env.MYSQLHOST,
 user:process.env.MYSQLUSER,
 password:process.env.MYSQLPASSWORD,
 database:process.env.MYSQLDATABASE,
 port:process.env.MYSQLPORT
});

setTimeout(()=>{
 pool.query("CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(100), phone VARCHAR(20) UNIQUE, password VARCHAR(255), balance DECIMAL(10,2) DEFAULT 0, referralCode VARCHAR(20), referredBy INT DEFAULT NULL, totalReferralBonus DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
 pool.query("CREATE TABLE IF NOT EXISTS deposits (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount DECIMAL(10,2), screenshot LONGTEXT, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
 pool.query("CREATE TABLE IF NOT EXISTS investments (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, plan VARCHAR(50), amount DECIMAL(10,2), claimed DECIMAL(10,2) DEFAULT 0, status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
 pool.query("CREATE TABLE IF NOT EXISTS withdraws (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, amount DECIMAL(10,2), phone VARCHAR(20), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
},2000);

function calc(inv){
 let m=30;
 let diff=Math.floor((new Date()-new Date(inv.created_at))/86400000);
 let d=diff>m?m:diff;
 let t=inv.amount*0.05*d;
 let a=t-(inv.claimed||0);
 if(a<0) a=0;
 return {days:d,tot:t,avail:a,max:m};
}
function gen(p){return 'LIFE'+p.slice(-4)+Math.floor(10+Math.random()*90);}

app.get('/',(req,res)=>{
 res.send(`
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#1a1a1a;padding:20px;border-radius:12px;width:90%;max-width:350px}h1{color:#0f8;text-align:center}input{width:100%;padding:10px;margin:6px 0;border-radius:6px;border:none}button{width:100%;padding:10px;background:#0f8;border:none;border-radius:6px;font-weight:bold}</style>
</head><body><div class="box"><h1>LIFELINE</h1><p style="text-align:center;color:#fa0">5% Daily +10% Referral</p>
<input id="n" placeholder="Full Name"><input id="ph" placeholder="Phone"><input id="pw" type="password" placeholder="Password"><input id="rc" placeholder="Referral Code">
<button onclick="reg()">Register</button><p id="m"></p><hr>
<input id="lph" placeholder="Phone"><input id="lpw" type="password" placeholder="Password"><button onclick="log()">Login</button><p id="m2"></p>
</div><script>
let rc=document.getElementById('rc');
let u=new URLSearchParams(location.search).get('ref');
if(u) rc.value=u;
async function reg(){
 let r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fullName:document.getElementById('n').value,phone:document.getElementById('ph').value,password:document.getElementById('pw').value,referralCode:rc.value})});
 let d=await r.json(); document.getElementById('m').innerText=d.message;
}
async function log(){
 let r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:document.getElementById('lph').value,password:document.getElementById('lpw').value})});
 let d=await r.json(); document.getElementById('m2').innerText=d.message;
 if(r.ok){localStorage.setItem('user',JSON.stringify(d.user));location.href='/dashboard';}
}
</script></body></html>
`);
});

app.get('/dashboard',(req,res)=>{
 res.send(`
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#0a0a0a;color:#fff;font-family:sans-serif;padding:10px}.card{background:#1a1a1a;padding:15px;border-radius:12px;max-width:450px;margin:auto}button{padding:8px;margin:3px;border:none;border-radius:6px;font-weight:bold}.g{background:#0f8}.o{background:#fa0}.b{background:#0af;color:#fff}.r{background:#f44;color:#fff}.p{background:#a0f;color:#fff}.inv{border:1px solid #0f8;padding:10px;margin:8px 0;border-radius:8px}input{width:100%;padding:8px;margin:5px 0;border-radius:6px;border:none}</style>
</head><body><div class="card"><h2 id="w">Welcome</h2><p>Bal: <b id="bal">0</b> | Bonus: <b id="bon">0</b></p>
<p>Link: <input id="lnk" readonly style="font-size:10px"><button class="b" onclick="copy()">Copy Referral</button></p>
<button class="g" onclick="show('dB')">Deposit</button><button class="g" onclick="show('iB')">Invest</button><button class="o" onclick="show('wB')">Withdraw</button><button class="b" onclick="loadInv()">Profit</button><button class="p" onclick="loadHis()">History</button><button class="r" onclick="localStorage.clear();location.href='/'">Logout</button>
<div id="dB" style="display:none"><h3>Deposit 0740383797</h3><input id="am" type="number" placeholder="Amount"><input type="file" accept="image/*" id="fileIn"><img id="pr" style="display:none;max-width:100%"><button class="g" onclick="dep()">Submit</button></div>
<div id="iB" style="display:none"><h3>Plans 5% x30</h3><button class="g" onclick="inv('Starter',20000)">Starter 20k</button><button class="g" onclick="inv('Pro',50000)">Pro 50k</button><button class="g" onclick="inv('VIP',100000)">VIP 100k</button></div>
<div id="wB" style="display:none"><input id="wA" placeholder="Amount"><input id="wP" placeholder="Airtel No"><button class="o" onclick="withd()">Request</button></div>
<div id="my"></div><div id="hB" style="display:none"><h3>History</h3><div id="hL"></div></div>
</div><script>
let u=JSON.parse(localStorage.getItem('user')||'{}');
if(!u.phone) location.href='/';
document.getElementById('w').innerText='Hi '+u.fullName;
document.getElementById('bal').innerText=u.balance;
document.getElementById('bon').innerText=u.totalReferralBonus||0;
document.getElementById('lnk').value=location.origin+'/?ref='+(u.referralCode||'');
let sc='';
document.getElementById('fileIn').addEventListener('change',function(){let r=new FileReader();r.onload=function(e){sc=e.target.result;let pr=document.getElementById('pr');pr.src=sc;pr.style.display='block';};r.readAsDataURL(this.files[0]);});
function show(id){document.getElementById('dB').style.display='none';document.getElementById('iB').style.display='none';document.getElementById('wB').style.display='none';document.getElementById(id).style.display='block';}
function copy(){let l=document.getElementById('lnk');l.select();document.execCommand('copy');alert('Copied');}
async function inv(p,a){let r=await fetch('/api/invest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id,plan:p,amount:a})});let d=await r.json();alert(d.message);loadInv();}
async function dep(){let am=document.getElementById('am').value; if(!sc){alert('Select screenshot');return;} let r=await fetch('/api/deposit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id,amount:am,screenshot:sc})});let d=await r.json();alert(d.message);}
async function withd(){let r=await fetch('/api/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id,amount:document.getElementById('wA').value,phone:document.getElementById('wP').value})});let d=await r.json();alert(d.message);}
async function loadInv(){let r=await fetch('/api/my-investments/'+u.id);let d=await r.json();let h='';let tot=0;d.forEach(function(x){tot+=x.avail;h+='<div class=inv>'+x.plan+' '+x.amount+' Day '+x.days+'/'+x.max+' Avail '+x.avail.toFixed(0)+(x.avail>0?' <button class=g onclick=cl('+x.id+')>CLAIM</button>':'')+'</div>';});document.getElementById('my').innerHTML='<b>Total: '+tot.toFixed(0)+'</b>'+h;}
async function cl(id){let r=await fetch('/api/claim/'+id,{method:'POST'});let d=await r.json();alert(d.message);location.reload();}
async function loadHis(){document.getElementById('hB').style.display='block';let r=await fetch('/api/history/'+u.id);let d=await r.json();let h='';d.forEach(function(t){h+='<div style=background:#222;padding:8px;margin:4px;border-radius:6px>'+t.type+' '+t.amount+' '+t.status+'<br><small>'+new Date(t.created_at).toLocaleString()+'</small></div>';});document.getElementById('hL').innerHTML=h||'No history';}
</script></body></html>
`);
});

app.get('/admin',(req,res)=>{
 res.send('<h1>Admin</h1><p><a href="/api/admin/deposits">View Deposits JSON</a></p><p><a href="/api/admin/withdraws">View Withdraws JSON</a></p><p><a href="/api/admin/users">View Users JSON</a></p>');
});

app.post('/api/register',async(req,res)=>{
 try{
  let fullName=req.body.fullName; let phone=req.body.phone; let password=req.body.password; let referralCode=req.body.referralCode;
  let hash=await bcrypt.hash(password,10);
  let myCode=gen(phone);
  function go(refId){
   pool.query('INSERT INTO users (fullName,phone,password,referralCode,referredBy) VALUES (?,?,?,?,?)',[fullName,phone,hash,myCode,refId],(e)=>{
    if(e){ if(e.code==='ER_DUP_ENTRY') return res.status(400).json({message:'Phone exists'}); return res.status(500).json({message:e.sqlMessage}); }
    res.json({message:'Created '+myCode});
   });
  }
  if(referralCode){
   pool.query('SELECT id FROM users WHERE referralCode=?',[referralCode],(e,r)=>{
    let ref=null; if(r && r.length) ref=r[0].id; go(ref);
   });
  }else go(null);
 }catch(e){res.status(500).json({message:e.message});}
});

app.post('/api/login',(req,res)=>{
 pool.query('SELECT * FROM users WHERE phone=?',[req.body.phone],async(e,r)=>{
  if(e||!r.length) return res.status(400).json({message:'Not found'});
  let ok=await bcrypt.compare(req.body.password,r[0].password);
  if(!ok) return res.status(400).json({message:'Wrong'});
  let u=r[0];
  res.json({message:'Welcome',user:{id:u.id,fullName:u.fullName,phone:u.phone,balance:u.balance,referralCode:u.referralCode,totalReferralBonus:u.totalReferralBonus}});
 });
});

app.post('/api/deposit',(req,res)=>{
 pool.query('INSERT INTO deposits (userId,amount,screenshot,status) VALUES (?,?,?,?)',[req.body.userId,req.body.amount,req.body.screenshot,'pending'],(e)=>{
  if(e) return res.status(500).json({message:e.sqlMessage});
  res.json({message:'Submitted'});
 });
});

app.post('/api/invest',(req,res)=>{
 let userId=req.body.userId; let plan=req.body.plan; let amount=req.body.amount;
 pool.query('SELECT balance FROM users WHERE id=?',[userId],(e,r)=>{
  if(e||!r.length) return res.status(400).json({message:'No user'});
  if(parseFloat(r[0].balance)<amount) return res.status(400).json({message:'Low bal '+r[0].balance});
  pool.query('UPDATE users SET balance=balance-? WHERE id=?',[amount,userId],()=>{
   pool.query('INSERT INTO investments (userId,plan,amount) VALUES (?,?,?)',[userId,plan,amount],(e2)=>{
    if(e2) return res.status(500).json({message:e2.sqlMessage});
    res.json({message:'Invested'});
   });
  });
 });
});

app.post('/api/withdraw',(req,res)=>{
 let userId=req.body.userId; let amount=req.body.amount; let phone=req.body.phone;
 pool.query('SELECT balance FROM users WHERE id=?',[userId],(e,r)=>{
  if(e||!r.length) return res.status(400).json({message:'No user'});
  if(parseFloat(r[0].balance)<amount) return res.status(400).json({message:'Low'});
  pool.query('UPDATE users SET balance=balance-? WHERE id=?',[amount,userId],()=>{
   pool.query('INSERT INTO withdraws (userId,amount,phone) VALUES (?,?,?)',[userId,amount,phone],()=>{res.json({message:'Requested'});});
  });
 });
});

app.get('/api/my-investments/:userId',(req,res)=>{
 pool.query('SELECT * FROM investments WHERE userId=?',[req.params.userId],(e,r)=>{
  if(e) return res.json([]);
  let out=r.map(function(x){let c=calc(x);return Object.assign({},x,{days:c.days,avail:c.avail,tot:c.tot,max:c.max});});
  res.json(out);
 });
});

app.post('/api/claim/:id',(req,res)=>{
 pool.query('SELECT * FROM investments WHERE id=?',[req.params.id],(e,r)=>{
  if(!r.length) return res.status(400).json({message:'Not found'});
  let c=calc(r[0]);
  if(c.avail<=0) return res.status(400).json({message:'Nothing'});
  pool.query('UPDATE investments SET claimed=claimed+? WHERE id=?',[c.avail,r[0].id],()=>{
   pool.query('UPDATE users SET balance=balance+? WHERE id=?',[c.avail,r[0].userId],()=>{
    res.json({message:'Claimed '+c.avail.toFixed(0)});
   });
  });
 });
});

app.get('/api/history/:userId',(req,res)=>{
 let id=req.params.userId;
 pool.query("(SELECT id,'deposit' as type,amount,status,created_at FROM deposits WHERE userId=?) UNION ALL (SELECT id,'withdraw' as type,amount,status,created_at FROM withdraws WHERE userId=?) UNION ALL (SELECT id,'investment' as type,amount,status,created_at FROM investments WHERE userId=?) ORDER BY created_at DESC LIMIT 100",[id,id,id],(e,r)=>{
  if(e) return res.json([]); res.json(r);
 });
});

app.get('/api/admin/deposits',(req,res)=>{
 pool.query('SELECT deposits.*,users.phone,users.referredBy FROM deposits LEFT JOIN users ON deposits.userId=users.id ORDER BY id DESC',(e,r)=>{res.json(r||[]);});
});
app.get('/api/admin/withdraws',(req,res)=>{
 pool.query('SELECT * FROM withdraws ORDER BY id DESC',(e,r)=>{res.json(r||[]);});
});
app.get('/api/admin/users',(req,res)=>{
 pool.query('SELECT id,fullName,phone,referralCode,referredBy,balance,totalReferralBonus FROM users ORDER BY id DESC',(e,r)=>{res.json(r||[]);});
});

app.post('/api/admin/approve/:id',(req,res)=>{
 pool.query('SELECT deposits.*,users.referredBy FROM deposits LEFT JOIN users ON deposits.userId=users.id WHERE deposits.id=?',[req.params.id],(e,r)=>{
  if(!r.length) return res.json({message:'Not found'});
  let d=r[0]; if(d.status!=='pending') return res.json({message:'Done'});
  pool.query('UPDATE users SET balance=balance+? WHERE id=?',[d.amount,d.userId],()=>{
   pool.query('UPDATE deposits SET status="approved" WHERE id=?',[req.params.id],()=>{
    if(d.referredBy){
     let b=d.amount*0.10;
     pool.query('UPDATE users SET balance=balance+?,totalReferralBonus=totalReferralBonus+? WHERE id=?',[b,b,d.referredBy],()=>{res.json({message:'Approved +bonus '+b});});
    }else res.json({message:'Approved'});
   });
  });
 });
});

app.post('/api/admin/reject/:id',(req,res)=>{
 pool.query('UPDATE deposits SET status="rejected" WHERE id=?',[req.params.id],()=>{res.json({message:'Rejected'});});
});

app.post('/api/admin/withdraw/approve/:id',(req,res)=>{
 pool.query('UPDATE withdraws SET status="approved" WHERE id=?',[req.params.id],()=>{res.json({message:'Approved'});});
});

app.post('/api/admin/withdraw/reject/:id',(req,res)=>{
 pool.query('SELECT * FROM withdraws WHERE id=?',[req.params.id],(e,r)=>{
  if(!r.length) return res.json({message:'Not found'});
  pool.query('UPDATE users SET balance=balance+? WHERE id=?',[r[0].amount,r[0].userId],()=>{
   pool.query('UPDATE withdraws SET status="rejected" WHERE id=?',[req.params.id],()=>{res.json({message:'Rejected & returned'});});
  });
 });
});

app.listen(process.env.PORT||3000,()=>console.log('LIFELINE LIVE'));
