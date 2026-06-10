const express = require("express");
const cors    = require("cors");
const Resend  = require("resend").Resend;

const app    = express();
const resend = new Resend("re_QLJcMAQe_Ni9q8jMWwgFiFco3okBR9sTA");

app.use(cors({
    origin: [
        "https://radiant-cupcake-86895b.netlify.app",
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    methods: ["POST", "GET"],
    allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "20kb" }));

const CATALOG = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => {
        const id  = i + 1;
        const val = parseFloat((59.99 + id * 4.50).toFixed(2));
        return [id, { id, name: `Skatorator Core v${id}`, price: val }];
    })
);

const dedupCache = new Map();
const DEDUP_MS   = 8000;

function dedupKey(email, address, itemIds) {
    return `${email.toLowerCase().trim()}|${address.toLowerCase().trim()}|${itemIds.sort().join(",")}`;
}

app.get("/", (req, res) => res.json({ status: "ok" }));

app.post("/api/orders", async (req, res) => {
    const { name, email, phone, address, items } = req.body || {};

    if (!name    || typeof name    !== "string" || name.trim().length    < 2) return res.status(400).json({ error: "Invalid name." });
    if (!email   || typeof email   !== "string" || !email.includes("@"))      return res.status(400).json({ error: "Invalid email." });
    if (!address || typeof address !== "string" || address.trim().length  < 3) return res.status(400).json({ error: "Invalid address." });
    if (!Array.isArray(items) || items.length === 0)                          return res.status(400).json({ error: "Cart is empty." });
    if (items.length > 30)                                                    return res.status(400).json({ error: "Too many items." });

    const verified = [];
    for (const item of items) {
        const id = parseInt(item.id, 10);
        if (!CATALOG[id]) return res.status(400).json({ error: `Unknown product id: ${item.id}` });
        verified.push(CATALOG[id]);
    }

    const key = dedupKey(email, address, verified.map(i => i.id));
    const now = Date.now();
    if (dedupCache.has(key) && now - dedupCache.get(key) < DEDUP_MS) {
        return res.status(429).json({ error: "Duplicate order detected. Please wait before resubmitting." });
    }
    dedupCache.set(key, now);
    setTimeout(() => dedupCache.delete(key), DEDUP_MS);

    const total    = verified.reduce((s, i) => s + i.price, 0);
    const totalFmt = `$${total.toFixed(2)}`;
    const orderId  = `ORD-${now}-${Math.floor(1000 + Math.random() * 9000)}`;
    const itemList = verified.map(i => `  - ${i.name}  ($${i.price.toFixed(2)})`).join("\n");
    const safeName    = String(name).slice(0, 80);
    const safeAddress = String(address).slice(0, 200);
    const safePhone   = String(phone || "N/A").slice(0, 30);

    console.log(`📦 Order ${orderId} | ${email} | ${totalFmt}`);

    try {
        await resend.emails.send({
            from:    "Skatorator <onboarding@resend.dev>",
            to:      email,
            subject: `🛹 Order Confirmed — ${orderId}`,
            text:    `Hi ${safeName},\n\nYour order has been received!\n\nOrder ref  : ${orderId}\nShip to    : ${safeAddress}\nPhone      : ${safePhone}\n\nITEMS\n─────────────────────────────\n${itemList}\n\nTOTAL (C.O.D.) : ${totalFmt}\n\nPlease have cash ready on delivery.\n\n— Skatorator Deck Lab`
        });
        await resend.emails.send({
            from:    "Skatorator <onboarding@resend.dev>",
            to:      "lachivr@gmail.com",
            subject: `🚨 NEW ORDER — ${orderId}`,
            text:    `New order received.\n\nCustomer   : ${safeName}\nEmail      : ${email}\nPhone      : ${safePhone}\nAddress    : ${safeAddress}\n\nITEMS\n─────────────────────────────\n${itemList}\n\nTOTAL : ${totalFmt}\n\nOrder ref  : ${orderId}`
        });
        console.log(`✉️  Emails sent for ${orderId}`);
        res.json({ ok: true, orderId });
    } catch (err) {
        console.error("Email error:", err.message);
        res.json({ ok: true, orderId, warning: "Email delivery failed." });
    }
});

app.use((req, res) => res.status(404).json({ error: "Not found." }));

app.listen(process.env.PORT || 8080, "0.0.0.0", () =>
    console.log("🚀 Skatorator server running on port", process.env.PORT || 8080)
);
