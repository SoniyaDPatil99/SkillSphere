const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function setup() {
  console.log('\n🔧 SkillSphere Setup Starting...\n');

  // Create .env if not exists
  if (!fs.existsSync('.env')) {
    const envContent = `PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=skillsphere
JWT_SECRET=skillsphere_super_secret_jwt_key_2024
`;
    fs.writeFileSync('.env', envContent);
    console.log('✅ .env file created — please update DB_PASSWORD before continuing\n');
    process.exit(0);
  }

  try {
    // Connect without DB first
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    });

    // Create database
    await conn.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
    await conn.query(`USE ${process.env.DB_NAME}`);

    // Run schema
    const schema = fs.readFileSync('./schema.sql', 'utf8');
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      await conn.query(stmt);
    }

    await conn.end();
    console.log('✅ Database and tables created successfully!');
    console.log('✅ Setup complete! Run: npm start\n');
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    console.log('\nMake sure MySQL is running and .env credentials are correct.\n');
  }
}

setup();
