Crypto Premium Backend (on-chain USDT verification)
==================================================

Files included:
- server.js        : main Express server (ESM)
- init_db.js       : creates db.sqlite with required tables
- package.json     : dependencies + scripts
- db.sqlite        : created automatically by init_db.js
- .env.example     : sample environment variables

Quick start (local):
1) Copy .env.example to .env and set values (RPC_URL, MY_RECEIVE_WALLET, JWT_SECRET)
2) npm install
3) npm run init-db
4) npm start
