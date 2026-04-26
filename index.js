const express = require("express");
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const pendingConfirmations = {};

// ─── Auto-register webhook on startup ────────────────────────────────────────
async function registerWebhook() {
  if (!RAILWAY_URL) { console.log("No RAILWAY_PUBLIC_DOMAIN set, skipping webhook registration"); return; }
  const webhookUrl = `https://${RAILWAY_URL}/webhook`;
  const res = await fetch(`${TELEGRAM_API}/setWebhook?url=${webhookUrl}`);
  const data = await res.json();
  console.log("Webhook registration:", data);
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────
async function getStock(product) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/inventory?product=eq.${encodeURIComponent(product)}&select=stock`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const data = await res.json();
  return data.length > 0 ? data[0].stock : null;
}

async function setStock(product, stock) {
  await fetch(`${SUPABASE_URL}/rest/v1/inventory?product=eq.${encodeURIComponent(product)}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ stock }),
  });
}

async function createProduct(product) {
  await fetch(`${SUPABASE_URL}/rest/v1/inventory`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ product, stock: 0 }),
  });
}

// ─── Telegram helper ──────────────────────────────────────────────────────────
async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

// ─── Webhook handler ──────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const message = req.body?.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const upper = text.toUpperCase();

  if (upper === "YES" || upper === "NO") {
    const pending = pendingConfirmations[chatId];
    if (!pending) { await sendMessage(chatId, "ℹ️ No pending action to confirm."); return; }
    delete pendingConfirmations[chatId];

    if (upper === "NO") { await sendMessage(chatId, "❌ Action cancelled."); return; }

    const { action, product, qty } = pending;
    const currentStock = await getStock(product);

    if (action === "ADD") {
      const newStock = (currentStock || 0) + qty;
      await setStock(product, newStock);
      await sendMessage(chatId, `✅ Added <b>${qty}</b> ${product}\n📦 Current stock: <b>${newStock}</b>`);
      if (newStock < 10) await sendMessage(chatId, `⚠️ <b>Low Stock Alert!</b>\n${product} is now at <b>${newStock}</b> units.`);
    }

    if (action === "OUT") {
      const newStock = currentStock - qty;
      await setStock(product, newStock);
      await sendMessage(chatId, `➖ Removed <b>${qty}</b> ${product}\n📦 Remaining stock: <b>${newStock}</b>`);
      if (newStock < 10) await sendMessage(chatId, `⚠️ <b>Low Stock Alert!</b>\n${product} is now at <b>${newStock}</b> units.`);
    }
    return;
  }

  const parts = text.split(":");
  const action = parts[0]?.toUpperCase().trim();

  if (action === "CHECK") {
    const rawProduct = parts[1]?.trim();
    if (!rawProduct) { await sendMessage(chatId, "❌ Usage: <code>CHECK:ProductName</code>"); return; }
    const stock = await getStock(rawProduct);
    if (stock === null) { await sendMessage(chatId, "❌ Product not found. Please check spelling."); return; }
    let reply = `📦 <b>${rawProduct}</b> Stock: <b>${stock}</b>`;
    if (stock < 10) reply += "\n⚠️ Low stock!";
    await sendMessage(chatId, reply);
    return;
  }

  if (action === "ADD" || action === "OUT") {
    if (parts.length < 3) { await sendMessage(chatId, `❌ Usage: <code>${action}:Product:Qty</code>`); return; }

    const product = parts[1].trim();
    const qtyRaw = parts[2].trim();

    if (!/^\d+$/.test(qtyRaw)) { await sendMessage(chatId, "❌ Invalid quantity. Please use numbers only."); return; }
    const qty = parseInt(qtyRaw, 10);
    if (qty <= 0) { await sendMessage(chatId, "❌ Quantity must be greater than 0."); return; }

    const currentStock = await getStock(product);

    if (action === "OUT") {
      if (currentStock === null) { await sendMessage(chatId, "❌ Product not found. Please check spelling."); return; }
      if (currentStock < qty) { await sendMessage(chatId, `❌ Not enough stock. Only <b>${currentStock}</b> units available.`); return; }
    }

    if (action === "ADD" && currentStock === null) {
      await createProduct(product);
      await sendMessage(chatId, `ℹ️ <b>${product}</b> is a new product. Creating with 0 stock.`);
    }

    pendingConfirmations[chatId] = { action, product, qty };
    const verb = action === "ADD" ? "add" : "remove";
    await sendMessage(chatId, `You are about to <b>${verb}</b> <b>${qty}</b> ${product}.\n\nReply <b>YES</b> to confirm or <b>NO</b> to cancel.`);
    return;
  }

  await sendMessage(chatId, "❓ Unknown command.\n\nAvailable commands:\n<code>ADD:Product:Qty</code>\n<code>OUT:Product:Qty</code>\n<code>CHECK:Product</code>");
});

app.get("/", (req, res) => res.send("Inventory bot is running ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  registerWebhook();
});
