import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// === DB INIT ===
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
`);

// === CONFIG ===
const MY_RECEIVE_WALLET = (process.env.MY_RECEIVE_WALLET || "").toLowerCase();
const USDT_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const MIN_AMOUNT = Number(process.env.MIN_AMOUNT_USDT || "10"); // default 10 USDT
if(!process.env.RPC_URL) console.warn("Warning: RPC_URL not set in .env (required for on-chain checks)");
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "");

// === AUTH endpoints (nonce + verify using signature) ===
app.get("/auth/nonce", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "Missing address" });
  const nonce = "Login nonce: " + Math.floor(Math.random() * 1e9) + "-" + Date.now();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min
  await db.run("INSERT INTO nonces(address, nonce, expires_at) VALUES(?,?,?)", [address.toLowerCase(), nonce, expires]);
  res.json({ nonce });
});

app.post("/auth/verify", async (req, res) => {
  try {
    const { address, signature } = req.body;
    if(!address || !signature) return res.status(400).json({ error: "Missing params" });
    const row = await db.get("SELECT nonce, expires_at FROM nonces WHERE address = ? ORDER BY created_at DESC LIMIT 1", [address.toLowerCase()]);
    if(!row) return res.status(400).json({ error: "Nonce not found" });
    if(new Date(row.expires_at) < new Date()) return res.status(400).json({ error: "Nonce expired" });
    const recovered = ethers.verifyMessage(row.nonce, signature);
    if(recovered.toLowerCase() !== address.toLowerCase()) return res.status(401).json({ error: "Invalid signature" });
    // create user if not exists
    await db.run("INSERT OR IGNORE INTO users(address) VALUES(?)", [address.toLowerCase()]);
    const token = jwt.sign({ address: address.toLowerCase() }, process.env.JWT_SECRET || "change-me", { expiresIn: "7d" });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// Middleware to verify JWT
function authMiddleware(req, res, next){
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({ error: "Missing token" });
  const token = auth.replace("Bearer ","");
  try{
    const payload = jwt.verify(token, process.env.JWT_SECRET || "change-me");
    req.user = payload;
    next();
  } catch(e){
    return res.status(401).json({ error: "Invalid token" });
  }
}

// === Check payment on-chain for USDT transfers to your wallet ===
app.get("/check-payment/:address", authMiddleware, async (req, res) => {
  const userAddress = req.params.address.toLowerCase();
  if(!MY_RECEIVE_WALLET) return res.status(500).json({ error: "Server not configured with MY_RECEIVE_WALLET" });
  try {
    // Minimal ABI for Transfer event
    const abi = ["event Transfer(address indexed from, address indexed to, uint256 value)"];
    const contract = new ethers.Contract(USDT_CONTRACT, abi, provider);
    // Create filter for transfers from userAddress to our receive wallet
    const filter = contract.filters.Transfer(userAddress, MY_RECEIVE_WALLET);
    // Query recent events (you can adjust fromBlock)
    const fromBlock = Math.max(0, (await provider.getBlockNumber()) - 5000);
    const events = await contract.queryFilter(filter, fromBlock, "latest");
    let paid = false;
    for(const e of events){
      const amount = Number(e.args.value) / 1e6; // USDT 6 decimals
      if(amount >= MIN_AMOUNT){ paid = true; break; }
    }
    if(paid){
      await db.run("UPDATE users SET is_premium = 1, premium_until = datetime('now','+30 days') WHERE address = ?", [userAddress]);
      return res.json({ success: true, message: "Payment found, premium activated" });
    } else {
      return res.json({ success: false, message: "No valid payment found" });
    }
  } catch(err){
    console.error("check-payment error", err);
    return res.status(500).json({ error: "Error checking payment" });
  }
});

// status endpoint
app.get("/status/:address", async (req, res) => {
  const row = await db.get("SELECT address, is_premium, premium_until, created_at FROM users WHERE address = ?", [req.params.address.toLowerCase()]);
  if(!row) return res.json({ address: req.params.address.toLowerCase(), is_premium:0 });
  res.json(row);
});

// simple posts endpoints (example)
await db.exec(`
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

app.post("/posts", authMiddleware, async (req, res) => {
  const { title, body, image_url } = req.body;
  const owner = req.user.address;
  const result = await db.run("INSERT INTO posts(owner_address,title,body,image_url) VALUES(?,?,?,?)", [owner, title, body, image_url]);
  res.json({ id: result.lastID });
});

app.get("/posts", async (req, res) => {
  const rows = await db.all("SELECT * FROM posts ORDER BY created_at DESC");
  res.json(rows);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=> console.log(`Server listening on ${PORT}`));
