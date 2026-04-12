const db = require('./db');
const fs = require('fs');

async function debug() {
  try {
    const [fields] = await db.query('DESCRIBE skills');
    fs.writeFileSync('schema_dump.json', JSON.stringify(fields, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

debug();
