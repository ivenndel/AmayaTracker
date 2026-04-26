const express = require("express");
const app = express();
app.use(express.json());

const BOT_TOKEN = "8607382207:AAExX038hGcX_7bxDoIHoXp1U4-0Z8z0ziM"// set this in your environment
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── In-memory database (swap with real DB later) ───────────────────────────
const inventory = {
  Protein: 40,
  Creatine: 25,
  Whey: 15,
};

// Track users waiting for confirmation: { chatId: { action, product, qty } }
const pendingConfirmations = {};

// ─── Send a Telegram message ─────────────────────────────────────────────────
async function sendMessage(chatId, text, parseMode = "HTML") {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
}

// ─── Main webhook handler ─────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // always reply 200 to Telegram first

  const message = req.body?.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const upper = text.toUpperCase();

  // ── Handle YES/NO for pending confirmations ──────────────────────────────
  if (upper === "YES" || upper === "NO") {
    const pending = pendingConfirmations[chatId];
    if (!pending) {
      await sendMessage(chatId, "ℹ️ No pending action to confirm.");
      return;
    }
    delete pendingConfirmations[chatId];

    if (upper === "NO") {
      await sendMessage(chatId, "❌ Action cancelled.");
      return;
    }

    // Execute the confirmed action
    const { action, product, qty } = pending;

    if (action === "ADD") {
      inventory[product] = (inventory[product] || 0) + qty;
      let reply = `✅ Added <b>${qty}</b> ${product}\n📦 Current stock: <b>${inventory[product]}</b>`;
      await sendMessage(chatId, reply);
      if (inventory[product] < 10) {
        await sendMessage(chatId, `⚠️ <b>Low Stock Alert!</b>\n${product} is now at <b>${inventory[product]}</b> units.`);
      }
    }

    if (action === "OUT") {
      inventory[product] -= qty;
      let reply = `➖ Removed <b>${qty}</b> ${product}\n📦 Remaining stock: <b>${inventory[product]}</b>`;
      await sendMessage(chatId, reply);
      if (inventory[product] < 10) {
        await sendMessage(chatId, `⚠️ <b>Low Stock Alert!</b>\n${product} is now at <b>${inventory[product]}</b> units.`);
      }
    }
    return;
  }

  // ── Parse ADD / OUT / CHECK commands ─────────────────────────────────────
  const parts = text.split(":");
  const action = parts[0]?.toUpperCase().trim();

  if (action === "CHECK") {
    const rawProduct = parts[1]?.trim();
    if (!rawProduct) {
      await sendMessage(chatId, "❌ Usage: <code>CHECK:ProductName</code>");
      return;
    }
    const found = Object.keys(inventory).find(
      (k) => k.toLowerCase() === rawProduct.toLowerCase()
    );
    if (!found) {
      await sendMessage(chatId, "❌ Product not found. Please check spelling.");
      return;
    }
    const qty = inventory[found];
    let reply = `📦 <b>${found}</b> Stock: <b>${qty}</b>`;
    if (qty < 10) reply += "\n⚠️ Low stock!";
    await sendMessage(chatId, reply);
    return;
  }

  if (action === "ADD" || action === "OUT") {
    if (parts.length < 3) {
      await sendMessage(chatId, `❌ Usage: <code>${action}:Product:Qty</code>`);
      return;
    }

    const product = parts[1].trim();
    const qtyRaw = parts[2].trim();

    if (!/^\d+$/.test(qtyRaw)) {
      await sendMessage(chatId, "❌ Invalid quantity. Please use numbers only.");
      return;
    }

    const qty = parseInt(qtyRaw, 10);
    if (qty <= 0) {
      await sendMessage(chatId, "❌ Quantity must be greater than 0.");
      return;
    }

    if (action === "OUT") {
      const found = Object.keys(inventory).find(
        (k) => k.toLowerCase() === product.toLowerCase()
      );
      if (!found) {
        await sendMessage(chatId, "❌ Product not found. Please check spelling.");
        return;
      }
      if (inventory[found] < qty) {
        await sendMessage(chatId, `❌ Not enough stock. Only <b>${inventory[found]}</b> units available.`);
        return;
      }
    }

    if (action === "ADD" && !inventory.hasOwnProperty(product)) {
      inventory[product] = 0;
    }

    // Store pending and ask for confirmation
    const exactProduct = Object.keys(inventory).find(
      (k) => k.toLowerCase() === product.toLowerCase()
    ) || product;

    pendingConfirmations[chatId] = { action, product: exactProduct, qty };

    const verb = action === "ADD" ? "add" : "remove";
    await sendMessage(
      chatId,
      `You are about to <b>${verb}</b> <b>${qty}</b> ${exactProduct}.\n\nReply <b>YES</b> to confirm or <b>NO</b> to cancel.`
    );
    return;
  }

  // Unknown command
  await sendMessage(
    chatId,
    "❓ Unknown command.\n\nAvailable commands:\n<code>ADD:Product:Qty</code>\n<code>OUT:Product:Qty</code>\n<code>CHECK:Product</code>"
  );
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.send("Inventory bot is running ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
