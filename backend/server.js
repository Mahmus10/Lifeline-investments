const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// MySQL connection - Railway gives MYSQL_URL
const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10
});

// FIX DATABASE - Drop old wrong table and create correct one
pool.query(`DROP TABLE IF EXISTS users`, (err) => {
  console.log('Dropped old users table if existed');

  pool.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fullName VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    balance DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if(err) console.log('Create users error:', err);
    else console.log('Users table created correctly with phone!');
  });
});

pool.query(`CREATE TABLE IF NOT EXISTS deposits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT,
  amount DECIMAL(10,2),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, phone, password } = req.body;
    if(!fullName ||!phone ||!password) return res.status(400).json({message: 'All fields required'});

    const hashed = await bcrypt.hash(password, 10);

    pool.query('INSERT INTO users (fullName, phone, password) VALUES (?,?,?)',
      [fullName, phone, hashed],
      (err, result) => {
        if(err) {
          console.log('Register DB error:', err);
          if(err.code === 'ER_DUP_ENTRY') return res.status(400).json({message: 'Phone already registered'});
          return res.status(500).json({message: 'Database error: ' + err.message});
        }
        res.json({message: 'Account created successfully!'});
      }
    );
  } catch(e) {
    res.status(500).json({message: 'Server error'});
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  pool.query('SELECT * FROM users WHERE phone =?', [phone], async (err, results) => {
    if(err) return res.status(500).json({message: 'Database error'});
    if(results.length === 0) return res.status(400).json({message: 'Phone not found'});

    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if(!match) return res.status(400).json({message: 'Wrong password'});

    res.json({message: 'Login success', user: {id: user.id, fullName: user.fullName, phone: user.phone, balance: user.balance}});
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Lifeline Backend running on ' + PORT));
