import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("bubble_earn.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    coins INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    last_login TEXT,
    streak INTEGER DEFAULT 0,
    referral_code TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    amount INTEGER,
    type TEXT, -- 'earn', 'redeem'
    description TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    amount_coins INTEGER,
    amount_money REAL,
    method TEXT, -- 'EasyPaisa', 'JazzCash'
    account_number TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'rejected'
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

async function startServer() {
  const app = express();
  app.use(express.json());
  const PORT = 3000;

  // Simple "Auth" - in a real app this would be JWT/OAuth
  // For this demo, we'll use a hardcoded user ID or local storage ID
  const getUserId = (req: express.Request) => req.headers["x-user-id"] as string || "default_user";

  // Ensure user exists
  app.use((req, res, next) => {
    const userId = getUserId(req);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) {
      const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      db.prepare("INSERT INTO users (id, referral_code) VALUES (?, ?)").run(userId, referralCode);
    }
    next();
  });

  // API Routes
  app.get("/api/user", (req, res) => {
    const userId = getUserId(req);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    res.json(user);
  });

  app.post("/api/earn", (req, res) => {
    const userId = getUserId(req);
    const { amount, reason } = req.body;
    
    // Anti-cheat: Daily cap (simplified)
    const today = new Date().toISOString().split('T')[0];
    const dailyEarned = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND type = 'earn' AND timestamp >= ?")
      .get(userId, today) as { total: number };
    
    if ((dailyEarned.total || 0) + amount > 500) {
      return res.status(400).json({ error: "Daily earning limit reached" });
    }

    db.transaction(() => {
      db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(amount, userId);
      db.prepare("INSERT INTO transactions (user_id, amount, type, description) VALUES (?, ?, 'earn', ?)")
        .run(userId, amount, reason);
    })();

    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    res.json(updatedUser);
  });

  app.post("/api/redeem", (req, res) => {
    const userId = getUserId(req);
    const { coins, money, method, account } = req.body;

    const user = db.prepare("SELECT coins FROM users WHERE id = ?").get(userId) as { coins: number };
    if (user.coins < coins) {
      return res.status(400).json({ error: "Insufficient coins" });
    }

    if (coins < 2000) {
      return res.status(400).json({ error: "Minimum withdrawal is 2000 coins" });
    }

    db.transaction(() => {
      db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").run(coins, userId);
      db.prepare("INSERT INTO withdrawals (user_id, amount_coins, amount_money, method, account_number) VALUES (?, ?, ?, ?, ?)")
        .run(userId, coins, money, method, account);
      db.prepare("INSERT INTO transactions (user_id, amount, type, description) VALUES (?, ?, 'redeem', ?)")
        .run(userId, -coins, `Withdrawal to ${method}`);
    })();

    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    res.json(updatedUser);
  });

  app.get("/api/history", (req, res) => {
    const userId = getUserId(req);
    const history = db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20").all(userId);
    const withdrawals = db.prepare("SELECT * FROM withdrawals WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20").all(userId);
    res.json({ history, withdrawals });
  });

  app.get("/api/leaderboard", (req, res) => {
    const leaderboard = db.prepare("SELECT id, coins, level FROM users ORDER BY coins DESC LIMIT 10").all();
    res.json(leaderboard);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
