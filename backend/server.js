const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());
app.use(cors());

// LIFELINE INVESTMENTS SETTINGS
const ADMIN_PHONE = "0740383797";
const DAILY_RATE = 0.05; // 5%
const MIN_DEPOSIT = 20000;
const MIN_WITHDRAW = 5000;
const MIN_INTEREST_WITHDRAW = 3000;
const LOCK_DAYS = 8;
const REF_BONUS = 0.04; // 4%
const JWT_SECRET = "lifeline_secret_2026";

const db = mysql.createConnection(process.env.DATABASE_URL);

app.get('/', (req,res) => res.send("Lifeline Investments API Running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lifeline API on ${PORT}`));
