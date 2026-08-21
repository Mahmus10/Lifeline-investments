const express = require('express');
const app = express();
app.get('/', (req,res)=>{ res.send('<h1>LIFELINE IS UP! Fixing database...</h1>'); });
app.get('/dashboard', (req,res)=>{ res.send('<h1>Dashboard Up</h1><a href="/">Home</a>'); });
app.get('/admin', (req,res)=>{ res.send('<h1>Admin Up</h1>'); });
app.listen(process.env.PORT||3000,()=>console.log('MINIMAL RUNNING'));
