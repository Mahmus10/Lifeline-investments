const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

// Railway auto gives you these env variables
const db = mysql.createConnection({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT
});

db.connect(err => {
  if(err) console.log("DB Error:", err);
  else console.log("MySQL Connected!");
});

// Auto create users table
db.query(`CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100),
  email VARCHAR(100) UNIQUE,
  password VARCHAR(255)
)`);

// REGISTER
app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  db.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", 
  [name, email, password], (err) => {
    if(err) return res.status(400).json({error: "Email already exists"});
    res.status(201).json({message: "Register Success! ✅"});
  });
});

// LOGIN
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.query("SELECT * FROM users WHERE email = ? AND password = ?", 
  [email, password], (err, results) => {
    if(err) return res.status(500).json({error: err.message});
    if(results.length > 0) {
      res.json({message: "Login Success! ✅"});
    } else {
      res.status(401).json({error: "Invalid email or password"});
    }
  });
});

app.get('/', (req, res) => res.send("Lifeline API is Running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
