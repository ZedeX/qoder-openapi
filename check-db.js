const Database = require('d:/_program/QoderWork/resources/app.asar.unpacked/node_modules/better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'QoderWork', 'data', 'agents.db');
console.log('DB Path:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', JSON.stringify(tables, null, 2));

  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
    console.log(`\nTable ${t.name} columns:`, cols.map(c => c.name).join(', '));
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${t.name}`).get();
    console.log(`  Row count: ${count.cnt}`);
    if (count.cnt > 0 && count.cnt <= 20) {
      const rows = db.prepare(`SELECT * FROM ${t.name} LIMIT 5`).all();
      for (const row of rows) {
        const str = JSON.stringify(row);
        console.log('  ', str.substring(0, 300));
      }
    }
  }

  db.close();
} catch (e) {
  console.error('Error:', e.message);
}
