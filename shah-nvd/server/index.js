import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const GAMES_FILE = path.join(DATA_DIR, "games.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const PORT = 3001;

const app = express();
app.use(express.json());

async function ensureFile(filePath) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "[]", "utf8");
  }
}

async function ensureDataFiles() {
  await Promise.all([
    ensureFile(GAMES_FILE),
    ensureFile(USERS_FILE),
    ensureFile(SESSIONS_FILE),
  ]);
}

async function readArray(filePath) {
  await ensureFile(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeArray(filePath, value) {
  await ensureFile(filePath);
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  const [salt, hashHex] = String(passwordHash).split(":");
  if (!salt || !hashHex) return false;
  const incomingHash = scryptSync(password, salt, 64);
  const storedHash = Buffer.from(hashHex, "hex");
  if (incomingHash.length !== storedHash.length) return false;
  return timingSafeEqual(incomingHash, storedHash);
}

function extractToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

async function authMiddleware(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const sessions = await readArray(SESSIONS_FILE);
    const session = sessions.find((item) => item.token === token);
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const users = await readArray(USERS_FILE);
    const user = users.find((item) => item.id === session.userId);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    req.user = { id: user.id, username: user.username };
    req.token = token;
    next();
  } catch (error) {
    console.error("Auth failed:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (username.length < 3 || username.length > 30) {
      res.status(400).json({ error: "Username must be between 3 and 30 characters" });
      return;
    }

    if (!/^[A-Za-z0-9_]+$/.test(username)) {
      res.status(400).json({ error: "Username can contain only letters, numbers, and _" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const users = await readArray(USERS_FILE);
    const existing = users.find(
      (item) => String(item.username).toLowerCase() === username.toLowerCase()
    );
    if (existing) {
      res.status(409).json({ error: "Username already exists" });
      return;
    }

    const newUser = {
      id: randomBytes(16).toString("hex"),
      username,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };

    await writeArray(USERS_FILE, [...users, newUser]);

    const sessions = await readArray(SESSIONS_FILE);
    const token = randomBytes(32).toString("hex");
    const newSession = {
      token,
      userId: newUser.id,
      createdAt: new Date().toISOString(),
    };
    await writeArray(SESSIONS_FILE, [...sessions, newSession]);

    res.status(201).json({
      token,
      user: { id: newUser.id, username: newUser.username },
    });
  } catch (error) {
    console.error("Failed to register user:", error);
    res.status(500).json({ error: "Failed to register" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const users = await readArray(USERS_FILE);
    const user = users.find(
      (item) => String(item.username).toLowerCase() === username.toLowerCase()
    );
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const sessions = await readArray(SESSIONS_FILE);
    const token = randomBytes(32).toString("hex");
    const newSession = {
      token,
      userId: user.id,
      createdAt: new Date().toISOString(),
    };
    await writeArray(SESSIONS_FILE, [...sessions, newSession]);

    res.json({
      token,
      user: { id: user.id, username: user.username },
    });
  } catch (error) {
    console.error("Failed to login:", error);
    res.status(500).json({ error: "Failed to login" });
  }
});

app.post("/api/auth/logout", authMiddleware, async (req, res) => {
  try {
    const sessions = await readArray(SESSIONS_FILE);
    const remainingSessions = sessions.filter((session) => session.token !== req.token);
    await writeArray(SESSIONS_FILE, remainingSessions);
    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to logout:", error);
    res.status(500).json({ error: "Failed to logout" });
  }
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/games", authMiddleware, async (req, res) => {
  try {
    const games = await readArray(GAMES_FILE);
    const userGames = games.filter((game) => game.userId === req.user.id);
    res.json(userGames);
  } catch (error) {
    console.error("Failed to load games:", error);
    res.status(500).json({ error: "Failed to load games" });
  }
});

app.post("/api/games", authMiddleware, async (req, res) => {
  try {
    const { result, detail, endedAt } = req.body ?? {};

    if (!["Win", "Loss", "Draw"].includes(result)) {
      res.status(400).json({ error: "Invalid result" });
      return;
    }

    if (typeof detail !== "string" || detail.length === 0) {
      res.status(400).json({ error: "Invalid detail" });
      return;
    }

    if (typeof endedAt !== "string" || endedAt.length === 0) {
      res.status(400).json({ error: "Invalid endedAt" });
      return;
    }

    const games = await readArray(GAMES_FILE);
    const newEntry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      userId: req.user.id,
      result,
      detail,
      endedAt,
      createdAt: new Date().toISOString(),
    };

    await writeArray(GAMES_FILE, [newEntry, ...games]);
    res.status(201).json(newEntry);
  } catch (error) {
    console.error("Failed to store game:", error);
    res.status(500).json({ error: "Failed to store game" });
  }
});

ensureDataFiles()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Game history API listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize storage:", error);
    process.exit(1);
  });
