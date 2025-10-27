import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import sqlite3 from "sqlite3";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// === INIT DB ===
const db = new sqlite3.Database("./db.sqlite", (err) => {
  if (err) console.error("❌ Errore apertura DB:", err);
  else console.log("✅ Database connesso");
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      address TEXT PRIMARY KEY,
      is_premium INTEGER DEFAULT 0,
      premium_until TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nonces (
      address TEXT,
      nonce TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_address TEXT,
      title TEXT,
      body TEXT,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER,
      owner_address TEXT,
      text TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

// === CONFIG ===
const MY_RECEIVE_WALLET = (process.env.MY_RECEIVE_WALLET || "").toLowerCase();
const USDT_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const MIN_AMOUNT = Number(process.env.MIN_AMOUNT_USDT || "10");
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "");

// === AUTH ===
app.get("/auth/nonce", (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "Missing address" });
  const nonce = "Login nonce: " + Math.floor(Math.random() * 1e9) + "-" + Date.now();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.run(
    "INSERT INTO nonces(address, nonce, expires_at) VALUES(?,?,?)",
    [address.toLowerCase(), nonce, expires],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ nonce });
    }
  );
});

app.post("/auth/verify", (req, res) => {
  const { address, signature } = req.body;
  if (!address || !signature) return res.status(400).json({ error: "Missing params" });

  db.get(
    "SELECT nonce, expires_at FROM nonces WHERE address = ? ORDER BY created_at DESC LIMIT 1",
    [address.toLowerCase()],
    (err, row) => {
      if (err || !row) return res.status(400).json({ error: "Nonce not found" });
      if (new Date(row.expires_at) < new Date())
        return res.status(400).json({ error: "Nonce expired" });

      const recovered = ethers.verifyMessage(row.nonce, signature);
      if (recovered.toLowerCase() !== address.toLowerCase())
        return res.status(401).json({ error: "Invalid signature" });

      db.run("INSERT OR IGNORE INTO users(address) VALUES(?)", [address.toLowerCase()]);
      const token = jwt.sign(
        { address: address.toLowerCase() },
        process.env.JWT_SECRET || "change-me",
        { expiresIn: "7d" }
      );
      res.json({ token });
    }
  );
});

// === AUTH middleware ===
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });
  const token = auth.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "change-me");
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// === CHECK PAYMENT ===
app.get("/check-payment/:address", authMiddleware, async (req, res) => {
  const userAddress = req.params.address.toLowerCase();
 // TEST: forza premium per un indirizzo specifico
if (userAddress === "0xa73897662DC6e7f8F67691859EcA8A0C28994046".toLowerCase()) {
  return res.json({
    success: true,
    is_premium: true,
    premium_until: "2099-12-31",
    message: "✅ Modalità test: account premium simulato"
  });
}


  if (!MY_RECEIVE_WALLET)
    return res.status(500).json({ error: "Server missing MY_RECEIVE_WALLET" });

  try {
    const abi = ["event Transfer(address indexed from, address indexed to, uint256 value)"];
    const contract = new ethers.Contract(USDT_CONTRACT, abi, provider);
    const fromBlock = Math.max(0, (await provider.getBlockNumber()) - 5000);
    const events = await contract.queryFilter(
      contract.filters.Transfer(userAddress, MY_RECEIVE_WALLET),
      fromBlock,
      "latest"
    );

    let paid = false;
    for (const e of events) {
      const amount = Number(e.args.value) / 1e6;
      if (amount >= MIN_AMOUNT) {
        paid = true;
        break;
      }
    }

    if (paid) {
      db.run(
        "UPDATE users SET is_premium = 1, premium_until = datetime('now','+30 days') WHERE address = ?",
        [userAddress]
      );
      res.json({ success: true, message: "Payment found, premium activated" });
    } else {
      res.json({ success: false, message: "No valid payment found" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error checking payment" });
  }
});

// === STATUS ===
app.get("/status/:address", (req, res) => {
  db.get(
    "SELECT address, is_premium, premium_until, created_at FROM users WHERE address = ?",
    [req.params.address.toLowerCase()],
    (err, row) => {
      if (!row) return res.json({ address: req.params.address.toLowerCase(), is_premium: 0 });
      res.json(row);
    }
  );
});

// === POSTS ===
app.post("/posts", authMiddleware, (req, res) => {
  const { title, body, image_url } = req.body;
  const owner = req.user.address;
  db.run(
    "INSERT INTO posts(owner_address,title,body,image_url) VALUES(?,?,?,?)",
    [owner, title, body, image_url],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.get("/posts", (req, res) => {
  db.all("SELECT * FROM posts ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server online on port ${PORT}`));
