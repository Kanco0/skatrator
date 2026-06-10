/* =============================================
   SKATORATOR — server.js
   Secure backend: prices are server-side only.
   No customer data is stored anywhere.
   ============================================= */

const express    = require("express");
const cors       = require("cors");
const nodemailer = require("nodemailer");

const app = express();

/* ---- CORS: only allow your Live Server origin ---- */
app.use(cors({
    origin: [
        "https://radiant-cupcake-86895b.netlify.app",
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    methods: ["POST"],
    allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "20kb" }));  /* cap payload size */

/* ---- SERVER-SIDE CATALOG (source of truth for prices) ---- */
const CATALOG = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => {
        const id  = i + 1;
        const val = parseFloat((59.99 + id * 4.50).toFixed(2));
        return [id, { id, name: `Skatorator Core v${id}`, price: val }];
    })
);

/* ---- EMAIL TRANSPORT ---- */
const mailer = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "lachivr@gmail.com",
        pass: "epor apne gkxo weak"  /* App password */
    }
});

/* ---- IN-MEMORY DEDUP CACHE (auto-expires) ---- */
const dedupCache = new Map();
const DEDUP_MS   = 8000;  /* 8 seconds */

function dedupKey(email, address, itemIds) {
    return `${email.toLowerCase().trim()}|${address.toLowerCase().trim()}|${itemIds.sort().join(",")}`;
}

/* =====================
   POST /api/orders
===================== */
app.post("/api/orders", async (req, res) => {
    const { name, email, phone, address, items } = req.body || {};

    /* ---- Input validation ---- */
    if (!name    || typeof name    !== "string" || name.trim().length    < 2) return res.status(400).json({ error: "Invalid name." });
    if (!email   || typeof email   !== "string" || !email.includes("@"))      return res.status(400).json({ error: "Invalid email." });
    if (!address || typeof address !== "string" || address.trim().length  < 3) return res.status(400).json({ error: "Invalid address." });
    if (!Array.isArray(items) || items.length === 0)                          return res.status(400).json({ error: "Cart is empty." });
    if (items.length > 30)                                                    return res.status(400).json({ error: "Too many items." });

    /* ---- Sanitise & verify items against server catalog ---- */
    const verified = [];
    for (const item of items) {
        const id = parseInt(item.id, 10);
        if (!CATALOG[id]) { return res.status(400).json({ error: `Unknown product id: ${item.id}` }); }
        verified.push(CATALOG[id]);
    }

    /* ---- Deduplication: reject if same order within window ---- */
    const key = dedupKey(email, address, verified.map(i => i.id));
    const now = Date.now();
    if (dedupCache.has(key) && now - dedupCache.get(key) < DEDUP_MS) {
        console.warn("⚠️  Duplicate order blocked:", key);
        return res.status(429).json({ error: "Duplicate order detected. Please wait before resubmitting." });
    }
    dedupCache.set(key, now);
    setTimeout(() => dedupCache.delete(key), DEDUP_MS);

    /* ---- Calculate total server-side (cannot be tampered) ---- */
    const total    = verified.reduce((s, i) => s + i.price, 0);
    const totalFmt = `$${total.toFixed(2)}`;
    const orderId  = `ORD-${now}-${Math.floor(1000 + Math.random() * 9000)}`;
    const itemList = verified.map(i => `  - ${i.name}  ($${i.price.toFixed(2)})`).join("\n");

    console.log(`📦 Order ${orderId} | ${email} | ${totalFmt}`);

    /* ---- Send emails ---- */
    const safeName    = String(name).slice(0, 80);
    const safeAddress = String(address).slice(0, 200);
    const safePhone   = String(phone || "N/A").slice(0, 30);

    const customerMail = {
        from:    '"Skatorator Deck Lab" <lachivr@gmail.com>',
        to:      email,
        subject: `🛹 Order Confirmed — ${orderId}`,
        text:
`Hi ${safeName},

Your order has been received and is being prepared for delivery.

ORDER DETAILS
─────────────────────────────
Order ref  : ${orderId}
Ship to    : ${safeAddress}
Phone      : ${safePhone}

ITEMS
─────────────────────────────
${itemList}

TOTAL (C.O.D.)  : ${totalFmt}

Please have cash ready on delivery.

— Skatorator Deck Lab`
    };

    const adminMail = {
        from:    '"Skatorator System" <lachivr@gmail.com>',
        to:      "lachivr@gmail.com",
        subject: `🚨 NEW ORDER — ${orderId}`,
        text:
`New cash-on-delivery order received.

Customer   : ${safeName}
Email      : ${email}
Phone      : ${safePhone}
Address    : ${safeAddress}

ITEMS
─────────────────────────────
${itemList}

TOTAL : ${totalFmt}

Order ref  : ${orderId}`
    };

    try {
        await Promise.all([
            mailer.sendMail(customerMail),
            mailer.sendMail(adminMail)
        ]);
        console.log(`✉️  Emails sent for ${orderId}`);
        res.json({ ok: true, orderId });
    } catch (err) {
        console.error("Email error:", err.message);
        /* Still return 200 so the receipt shows — order was valid */
        res.json({ ok: true, orderId, warning: "Email delivery failed." });
    }
});
/* ---- Health check for Railway ---- */
app.get("/", (req, res) => res.json({ status: "ok" }));
/* ---- Catch-all for unknown routes ---- */
app.use((req, res) => res.status(404).json({ error: "Not found." }));

app.listen(process.env.PORT || 8080, "0.0.0.0", () =>
    console.log("🚀 Skatorator server running on port", process.env.PORT || 8080)
);
