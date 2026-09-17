const mysql = require('mysql2/promise');
const fs = require('fs');

require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'admin',
  database: process.env.DB_NAME || 'skillsphere',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,

  ssl: process.env.DB_SSL_CA
    ? {
        ca: fs.readFileSync(process.env.DB_SSL_CA)
      }
    : undefined,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ✅ NEW: Test DB connection once at startup
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log("✅ MySQL Database connected successfully");
    connection.release();
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
  }
}

testConnection();

module.exports = pool;
