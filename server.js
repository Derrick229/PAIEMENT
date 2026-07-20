require("dotenv").config();
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { kkiapay } = require("@kkiapay-org/nodejs-sdk");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// --- Connexion PostgreSQL (Supabase) ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- Session admin ---
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret-in-env",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 4 },
  })
);

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  return res.redirect("/admin/login.html");
}

// Clé partagée pour les futurs appels ESP32 (capteur de niveau, confirmation de livraison)
function requireEsp32(req, res, next) {
  const key = req.headers["x-esp32-key"];
  if (key && key === process.env.ESP32_API_KEY) return next();
  return res.status(401).json({ error: "Clé ESP32 invalide" });
}

// --- Client KKiaPay (Admin SDK, côté serveur) ---
const k = kkiapay({
  privatekey: process.env.KKIAPAY_PRIVATE_KEY,
  publickey: process.env.KKIAPAY_PUBLIC_KEY,
  secretkey: process.env.KKIAPAY_SECRET_KEY,
  sandbox: process.env.KKIAPAY_SANDBOX !== "false",
});

// --- Email (via l'API Brevo, fonctionne même sur les hébergeurs qui bloquent le SMTP) ---
async function sendReceiptEmail(record) {
  if (!process.env.BREVO_API_KEY || !record.customer_email) return;
  const dateStr = new Date(record.updated_at).toLocaleString("fr-FR");

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          email: process.env.BREVO_SENDER_EMAIL,
          name: "XSMARTPUMP",
        },
        to: [{ email: record.customer_email }],
        subject: "Reçu de votre achat - XSMARTPUMP",
        htmlContent: `
          <p>Merci pour votre achat chez <strong>XSMARTPUMP</strong> !</p>
          <ul>
            <li>Quantité : ${record.quantity_liters} L</li>
            <li>Prix au litre : ${record.price_per_liter} FCFA</li>
            <li>Montant payé : ${record.amount} FCFA</li>
            <li>Date : ${dateStr}</li>
            <li>Référence KKiaPay : ${record.transaction_id}</li>
          </ul>
          <p>Merci de votre confiance.</p>
        `,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Erreur envoi email (Brevo) :", response.status, errText);
    }
  } catch (err) {
    console.error("Erreur envoi email (Brevo) :", err.message || err);
  }
}

// --- Réglages (prix au litre, stock) ---
async function getSetting(key, fallback) {
  const { rows } = await pool.query("select value from settings where key = $1", [key]);
  return rows.length ? rows[0].value : fallback;
}
async function setSetting(key, value) {
  await pool.query(
    `insert into settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, String(value)]
  );
}

// Le frontend public a besoin : clé publique kkiapay, mode sandbox, prix au litre actuel
app.get("/api/config", async (req, res) => {
  try {
    const pricePerLiter = await getSetting("price_per_liter", "500");
    res.json({
      publicKey: process.env.KKIAPAY_PUBLIC_KEY,
      sandbox: process.env.KKIAPAY_SANDBOX !== "false",
      pricePerLiter: parseFloat(pricePerLiter),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- Étape 1 : le client choisit une quantité -> on crée une commande "PENDING" ---
// Le prix est calculé ICI, côté serveur, à partir du prix réel en base (le client ne peut pas le trafiquer)
app.post("/api/orders/create", async (req, res) => {
  const { quantityLiters, customerEmail, description } = req.body;
  const qty = parseFloat(quantityLiters);

  if (!qty || qty <= 0) {
    return res.status(400).json({ error: "Quantité invalide" });
  }

  try {
    const pricePerLiter = parseFloat(await getSetting("price_per_liter", "500"));
    const amount = Math.round(qty * pricePerLiter);
    const orderId = "ORD-" + crypto.randomBytes(6).toString("hex");

    await pool.query(
      `insert into transactions
        (order_id, quantity_liters, price_per_liter, amount, status, customer_email, description)
       values ($1, $2, $3, $4, 'PENDING', $5, $6)`,
      [orderId, qty, pricePerLiter, amount, customerEmail || null, description || null]
    );

    res.json({ orderId, amount, pricePerLiter, quantityLiters: qty });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossible de créer la commande" });
  }
});

// --- Étape 2 : après le widget KKiaPay, on vérifie réellement le paiement ---
app.post("/api/transactions/verify", async (req, res) => {
  const { orderId, transactionId } = req.body;
  if (!orderId || !transactionId) {
    return res.status(400).json({ error: "orderId ou transactionId manquant" });
  }

  try {
    const { rows } = await pool.query("select * from transactions where order_id = $1", [orderId]);
    if (!rows.length) return res.status(404).json({ error: "Commande introuvable" });
    const order = rows[0];

    const result = await k.verify(transactionId);
    // Sécurité : le montant réellement payé doit correspondre au montant attendu de la commande
    const amountMatches = Math.abs(parseFloat(result.amount) - parseFloat(order.amount)) < 1;
    const finalStatus = amountMatches ? result.status : "FAILED";

    const { rows: updated } = await pool.query(
      `update transactions
       set transaction_id = $1, status = $2, source = $3, reason = $4, updated_at = now()
       where order_id = $5
       returning *`,
      [transactionId, finalStatus, result.source || null, result.reason || null, orderId]
    );

    const record = updated[0];
    if (record.status === "SUCCESS") {
      sendReceiptEmail(record); // ne bloque pas la réponse si ça échoue
    }

    res.json(record);
  } catch (err) {
    console.error("Erreur de vérification KKiaPay :", err.message || err);
    res.status(500).json({ error: "Impossible de vérifier la transaction" });
  }
});

// --- Historique admin, avec filtres date / statut / recherche ---
app.get("/api/transactions", requireAdmin, async (req, res) => {
  const { from, to, status, search } = req.query;
  const conditions = [];
  const values = [];

  if (from) {
    values.push(from);
    conditions.push(`created_at >= $${values.length}`);
  }
  if (to) {
    values.push(to + " 23:59:59");
    conditions.push(`created_at <= $${values.length}`);
  }
  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(transaction_id ilike $${values.length} or customer_email ilike $${values.length} or order_id ilike $${values.length})`);
  }

  const where = conditions.length ? "where " + conditions.join(" and ") : "";
  try {
    const { rows } = await pool.query(
      `select * from transactions ${where} order by created_at desc limit 500`,
      values
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- Statistiques pour les graphiques admin ---
app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const byDay = await pool.query(`
      select to_char(created_at, 'YYYY-MM-DD') as day,
             sum(case when status = 'SUCCESS' then amount else 0 end) as revenue,
             count(*) filter (where status = 'SUCCESS') as success_count,
             count(*) filter (where status = 'FAILED') as failed_count
      from transactions
      where created_at >= now() - interval '30 days'
      group by day
      order by day asc
    `);

    const totals = await pool.query(`
      select
        count(*) filter (where status = 'SUCCESS') as total_success,
        count(*) filter (where status = 'FAILED') as total_failed,
        coalesce(sum(amount) filter (where status = 'SUCCESS'), 0) as total_revenue,
        coalesce(sum(quantity_liters) filter (where status = 'SUCCESS'), 0) as total_quantity_sold
      from transactions
    `);

    res.json({ byDay: byDay.rows, totals: totals.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- Réglages admin : prix au litre + stock ---
app.get("/api/admin/settings", requireAdmin, async (req, res) => {
  try {
    const pricePerLiter = await getSetting("price_per_liter", "500");
    const tankRemaining = await getSetting("tank_remaining_liters", "0");
    const tankCapacity = await getSetting("tank_capacity_liters", "1000");
    res.json({
      pricePerLiter: parseFloat(pricePerLiter),
      tankRemainingLiters: parseFloat(tankRemaining),
      tankCapacityLiters: parseFloat(tankCapacity),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/admin/settings", requireAdmin, async (req, res) => {
  const { pricePerLiter, tankRemainingLiters, tankCapacityLiters } = req.body;
  try {
    if (pricePerLiter !== undefined) await setSetting("price_per_liter", pricePerLiter);
    if (tankRemainingLiters !== undefined) await setSetting("tank_remaining_liters", tankRemainingLiters);
    if (tankCapacityLiters !== undefined) await setSetting("tank_capacity_liters", tankCapacityLiters);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- Marquer une commande comme livrée (manuel pour l'instant, ESP32 plus tard) ---
app.post("/api/admin/transactions/:orderId/delivered", requireAdmin, async (req, res) => {
  const { orderId } = req.params;
  try {
    const { rows } = await pool.query("select * from transactions where order_id = $1", [orderId]);
    if (!rows.length) return res.status(404).json({ error: "Commande introuvable" });
    const order = rows[0];

    const { rows: updated } = await pool.query(
      `update transactions set delivered = true, quantity_delivered = $1, updated_at = now()
       where order_id = $2 returning *`,
      [order.quantity_liters, orderId]
    );

    // On décrémente le stock restant de la quantité livrée (en attendant le vrai capteur ESP32)
    const tankRemaining = parseFloat(await getSetting("tank_remaining_liters", "0"));
    await setSetting("tank_remaining_liters", Math.max(0, tankRemaining - order.quantity_liters));

    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
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

app.get("/admin/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "login.html"));
});
app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "dashboard.html"));
});

// --- Réservé aux futurs appels de l'ESP32 (capteur de niveau du réservoir) ---
app.post("/api/esp32/tank-level", requireEsp32, async (req, res) => {
  const { tankRemainingLiters } = req.body;
  if (tankRemainingLiters === undefined) return res.status(400).json({ error: "Valeur manquante" });
  await setSetting("tank_remaining_liters", tankRemainingLiters);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
