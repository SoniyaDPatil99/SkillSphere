require('dotenv').config();
const db = require('./db');

async function migrate() {
  try {
    console.log('Running SkillSphere DB migration...');

    await db.query(`
      CREATE TABLE IF NOT EXISTS mentor_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        skill_name VARCHAR(150) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ mentor_requests table ready');

    // Add is_delivered column to messages if missing
    try {
      await db.query(`ALTER TABLE messages ADD COLUMN is_delivered BOOLEAN DEFAULT FALSE`);
      console.log('✅ messages.is_delivered column added');
    } catch(e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
      console.log('ℹ️  messages.is_delivered already exists');
    }

    // Add is_deleted column to messages if missing
    try {
      await db.query(`ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE`);
      console.log('✅ messages.is_deleted column added');
    } catch(e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
      console.log('ℹ️  messages.is_deleted already exists');
    }

    for (const col of [
      { name: 'proof_file', type: "VARCHAR(255)" },
      { name: 'teaching_mode', type: "ENUM('Online', 'Offline', 'Both')" },
      { name: 'availability', type: "ENUM('Weekdays', 'Weekend', 'Both')" },
      { name: 'price_type', type: "ENUM('Free', 'Paid', 'Skill Exchange')" },
      { name: 'price_value', type: "VARCHAR(50)" },
      { name: 'demo_session', type: "BOOLEAN DEFAULT FALSE" },
      { name: 'is_draft', type: "BOOLEAN DEFAULT FALSE" },
      { name: 'status', type: "ENUM('pending', 'approved', 'rejected') DEFAULT 'pending'" }
    ]) {
      try {
        await db.query(`ALTER TABLE skills ADD COLUMN ${col.name} ${col.type}`);
        console.log(`✅ skills.${col.name} column added`);
      } catch(e) {
        if (e.code !== 'ER_DUP_FIELDNAME') throw e;
        console.log(`ℹ️  skills.${col.name} already exists`);
      }
    }

    // Add last_seen column to users if missing
    try {
      await db.query(`ALTER TABLE users ADD COLUMN last_seen TIMESTAMP NULL DEFAULT NULL`);
      console.log('✅ users.last_seen column added');
    } catch(e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
      console.log('ℹ️  users.last_seen already exists');
    }

    console.log('\n🎉 Migration complete! All tables and columns are up to date.\n');
    process.exit(0);
  } catch(err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  }
}

migrate();
