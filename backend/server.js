const express = require('express');
const app = express();
app.get('/', (req,res)=>{ res.send('<h1>LIFELINE IS UP!</h1>'); });
app.listen(process.env.PORT||3000,()=>console.log('UP'));
