import sqlite3 from "sqlite3";
import { open } from "sqlite";

const createDB = async () => {
  const db = await open({ filename: "db.sqlite", driver: sqlite3.Database });
  await db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    address TEXT PRIMARY KEY,
    is_premium INTEGER DEFAULT 0,
    premium_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS nonces (
    address TEXT,
    nonce TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_address TEXT,
    title TEXT,
    body TEXT,
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    owner_address TEXT,
    text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  `);
  console.log("Database initialized (db.sqlite created).");
  await db.close();
};

createDB();
