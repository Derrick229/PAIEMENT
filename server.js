require("dotenv").config();
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { kkiapay } = require("@kkiapay-org/nodejs-sdk");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret-in-env",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 4, // 4 heures
    },
  })
);

// Middleware : bloque l'accès si l'admin n'est pas connecté
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  return res.redirect("/admin/login.html");
}

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "transactions.json");

// --- Petite "base de données" JSON (suffisant pour une démo sandbox) ---
function readDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {
    return [];
  }
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// --- Client KKiaPay (Admin SDK, coté serveur) ---
const k = kkiapay({
  privatekey: process.env.KKIAPAY_PRIVATE_KEY,
  publickey: process.env.KKIAPAY_PUBLIC_KEY,
  secretkey: process.env.KKIAPAY_SECRET_KEY,
  sandbox: process.env.KKIAPAY_SANDBOX !== "false",
});

// Le frontend a besoin de la clé PUBLIQUE et du mode sandbox pour ouvrir le widget.
// (la clé privée/secrète ne quittent jamais le serveur)
app.get("/api/config", (req, res) => {
  res.json({
    publicKey: process.env.KKIAPAY_PUBLIC_KEY,
    sandbox: process.env.KKIAPAY_SANDBOX !== "false",
  });
});

// --- Authentification admin ---
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password && password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Mot de passe incorrect" });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Page de connexion (publique)
app.get("/admin/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "login.html"));
});

// Page admin protégée (le tableau de l'historique)
app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "dashboard.html"));
});

// Historique des transactions (protégé — les plus récentes en premier)
app.get("/api/transactions", requireAdmin, (req, res) => {
  const data = readDB().sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json(data);
});

// Appelé par le frontend juste après que le widget KKiaPay renvoie un transactionId.
// On NE FAIT JAMAIS confiance au statut renvoyé côté client : on revérifie côté serveur.
app.post("/api/transactions/verify", async (req, res) => {
  const { transactionId, description } = req.body;

  if (!transactionId) {
    return res.status(400).json({ error: "transactionId manquant" });
  }

  try {
    const result = await k.verify(transactionId);
    // result contient notamment : status ("SUCCESS" | "FAILED" | "PENDING"),
    // amount, fees, source, transactionId, performedAt, reason (si échec), etc.

    const db = readDB();
    const existingIndex = db.findIndex(
      (t) => t.transactionId === transactionId
    );

    const record = {
      transactionId,
      amount: result.amount,
      status: result.status, // SUCCESS | FAILED | PENDING
      source: result.source || null,
      reason: result.reason || null,
      description: description || null,
      createdAt:
        existingIndex >= 0 ? db[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      db[existingIndex] = record;
    } else {
      db.push(record);
    }
    writeDB(db);

    res.json(record);
  } catch (err) {
    console.error("Erreur de vérification KKiaPay :", err.message || err);
    res.status(500).json({ error: "Impossible de vérifier la transaction" });
  }
});

// (Optionnel mais recommandé en production) Webhook KKiaPay :
// à configurer dans le dashboard KKiaPay avec une URL publique (ex: via ngrok en local).
// Cela permet d'être notifié même si l'utilisateur ferme l'onglet avant la vérification côté client.
app.post("/api/kkiapay/webhook", async (req, res) => {
  const { transactionId } = req.body;
  if (!transactionId) return res.sendStatus(400);

  try {
    const result = await k.verify(transactionId);
    const db = readDB();
    const idx = db.findIndex((t) => t.transactionId === transactionId);
    const record = {
      transactionId,
      amount: result.amount,
      status: result.status,
      source: result.source || null,
      reason: result.reason || null,
      description: idx >= 0 ? db[idx].description : null,
      createdAt: idx >= 0 ? db[idx].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) db[idx] = record;
    else db.push(record);
    writeDB(db);
    res.sendStatus(200);
  } catch (err) {
    console.error("Erreur webhook :", err.message || err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
