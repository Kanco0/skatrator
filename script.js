/* =============================================
   SKATORATOR — script.js
   ============================================= */

const BOARDS = Array.from({ length: 10 }, (_, i) => {
    const id = i + 1;
    return {
        id,
        name:       `Skatorator Core v${id}`,
        priceVal:   parseFloat((59.99 + id * 4.50).toFixed(2)),
        priceLabel: `$${(59.99 + id * 4.50).toFixed(2)}`,
        image:      `images/board${id}.jpg`,
        desc:       `Premium setup variant #${id}. Handcrafted execution with carbon-infused construction, high-impact resilience, and ultra-responsive pop mechanics.`
    };
});

/* ---- State ---- */
let cart            = [];         // { board } objects
let focusedBoard    = null;
let orderLocked     = false;      // anti-double-submit lock
let lastOrderSig    = null;       // dedup signature
let lastOrderTime   = 0;
const DEDUP_MS      = 6000;       // 6 s dedup window

/* ---- DOM references (grabbed once) ---- */
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

document.addEventListener("DOMContentLoaded", () => {

    /* DOM */
    const grid            = document.getElementById("shop-grid");
    const emptyState      = $("empty-state");
    const searchInput     = $("search-input");

    const focusPanel      = $("focus-panel");
    const focusImg        = $("focus-img");
    const focusName       = $("focus-name");
    const focusPrice      = $("focus-price");
    const focusDesc       = $("focus-desc");
    const closeFocusBtn   = $("close-focus-btn");
    const addToCartBtn    = $("add-to-cart-btn");

    const cartBtn         = $("cart-btn");
    const cartCount       = $("cart-count");
    const cartModal       = $("cart-modal");
    const closeCartBtn    = $("close-cart-btn");
    const cartList        = $("cart-list");
    const cartTotal       = $("cart-total");
    const checkoutBtn     = $("checkout-btn");

    const checkoutModal   = $("checkout-modal");
    const closeCheckoutBtn= $("close-checkout-btn");
    const checkoutForm    = $("checkout-form");
    const checkoutTotal   = $("checkout-total");
    const placeOrderBtn   = $("place-order-btn");

    const receiptModal    = $("receipt-modal");
    const receiptBody     = $("receipt-body");
    const closeReceiptBtn = $("close-receipt-btn");

    /* =====================
       BUILD PRODUCT GRID
    ===================== */
    BOARDS.forEach(board => {
        const card = document.createElement("div");
        card.className  = "board-card";
        card.tabIndex   = 0;
        card.setAttribute("data-id", board.id);
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", `View ${board.name}`);

        card.innerHTML = `
            <div class="card-img-wrap">
                <img src="${board.image}" alt="${board.name}" loading="lazy"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                <span class="card-missing" style="display:none">No image</span>
            </div>
            <div class="card-name">${board.name}</div>
            <div class="card-price">${board.priceLabel}</div>
        `;

        const open = () => openFocus(board);
        card.addEventListener("click", open);
        card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });

        grid.appendChild(card);
    });

    /* =====================
       SEARCH FILTER
    ===================== */
    searchInput.addEventListener("input", () => {
        const q = searchInput.value.toLowerCase().trim();
        let visible = 0;
        $$(".board-card").forEach((card, i) => {
            const b   = BOARDS[i];
            const hit = !q || b.name.toLowerCase().includes(q) || b.desc.toLowerCase().includes(q);
            card.style.display = hit ? "" : "none";
            if (hit) visible++;
        });
        emptyState.classList.toggle("hidden", visible > 0);
    });

    /* =====================
       FOCUS PANEL
    ===================== */
    function openFocus(board) {
        focusedBoard      = board;
        focusImg.src      = board.image;
        focusImg.alt      = board.name;
        focusName.textContent  = board.name;
        focusPrice.textContent = board.priceLabel;
        focusDesc.textContent  = board.desc;
        focusPanel.classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    closeFocusBtn.addEventListener("click", () => focusPanel.classList.add("hidden"));

    addToCartBtn.addEventListener("click", () => {
        if (!focusedBoard) return;
        cart.push({ ...focusedBoard });
        renderCart();
        focusPanel.classList.add("hidden");
    });

    /* =====================
       CART
    ===================== */
    cartBtn.addEventListener("click", () => cartModal.classList.remove("hidden"));
    closeCartBtn.addEventListener("click", () => cartModal.classList.add("hidden"));

    function renderCart() {
        /* count badge */
        cartCount.textContent = cart.length;

        /* list */
        if (cart.length === 0) {
            cartList.innerHTML = `<p class="cart-empty">No items yet.</p>`;
            cartTotal.textContent = "$0.00";
            return;
        }

        cartList.innerHTML = "";
        cart.forEach((item, idx) => {
            const row = document.createElement("div");
            row.className = "cart-row";
            row.innerHTML = `
                <div class="cart-row-img">
                    <img src="${item.image}" alt="${item.name}"
                         onerror="this.style.display='none'">
                </div>
                <div class="cart-row-info">
                    <h4>${item.name}</h4>
                    <span>${item.priceLabel}</span>
                </div>
                <button class="remove-btn" data-idx="${idx}" aria-label="Remove ${item.name}">Remove</button>
            `;
            cartList.appendChild(row);
        });

        cartList.querySelectorAll(".remove-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                cart.splice(parseInt(btn.dataset.idx), 1);
                renderCart();
            });
        });

        const sum = cart.reduce((s, i) => s + i.priceVal, 0);
        cartTotal.textContent = `$${sum.toFixed(2)}`;
    }

    /* =====================
       CHECKOUT OPEN
    ===================== */
    checkoutBtn.addEventListener("click", () => {
        if (cart.length === 0) { alert("Your cart is empty!"); return; }
        cartModal.classList.add("hidden");
        checkoutModal.classList.remove("hidden");
        const sum = cart.reduce((s, i) => s + i.priceVal, 0);
        checkoutTotal.textContent = `$${sum.toFixed(2)}`;
    });

    closeCheckoutBtn.addEventListener("click", () => checkoutModal.classList.add("hidden"));

    /* =====================
       FORM SUBMIT → ORDER
    ===================== */
    checkoutForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        /* ---- anti-double-submit lock ---- */
        if (orderLocked) return;

        /* ---- client-side validation ---- */
        const nameEl    = $("f-name");
        const emailEl   = $("f-email");
        const phoneEl   = $("f-phone");
        const addressEl = $("f-address");

        [nameEl, emailEl, addressEl].forEach(el => el.classList.remove("error"));

        let valid = true;
        if (!nameEl.value.trim())    { nameEl.classList.add("error");    valid = false; }
        if (!emailEl.value.trim() || !emailEl.value.includes("@"))
                                      { emailEl.classList.add("error");   valid = false; }
        if (!addressEl.value.trim()) { addressEl.classList.add("error"); valid = false; }
        if (!valid) return;

        const name    = nameEl.value.trim();
        const email   = emailEl.value.trim();
        const phone   = phoneEl.value.trim() || "N/A";
        const address = addressEl.value.trim();

        /* ---- deduplication check ---- */
        const itemIds = cart.map(i => i.id).sort().join(",");
        const sig     = `${email.toLowerCase()}|${address.toLowerCase()}|${itemIds}`;
        const now     = Date.now();

        if (sig === lastOrderSig && now - lastOrderTime < DEDUP_MS) {
            alert("This order was already submitted. Please wait a moment before trying again.");
            return;
        }

        /* ---- lock UI ---- */
        orderLocked = true;
        placeOrderBtn.disabled    = true;
        placeOrderBtn.textContent = "Placing order…";

        /* ---- snapshot cart before any clearing ---- */
        const snapshot   = [...cart];
        const totalLabel = checkoutTotal.textContent;
        const orderId    = `ORD-${now}`;

        /* ---- fire & forget to backend (receipt shows regardless) ---- */
        try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    await fetch("https://proactive-surprise-production-d72e.up.railway.app/api/orders", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        signal:  controller.signal,
        body:    JSON.stringify({
            name, email, phone, address,
            items: snapshot.map(i => ({ id: i.id, name: i.name }))
        })
    });
    clearTimeout(timeout);
} catch (err) {
    console.warn("Backend unreachable:", err.message);
}

        /* ---- record dedup signature ---- */
        lastOrderSig  = sig;
        lastOrderTime = now;

        /* ---- build receipt HTML (no sensitive data stored anywhere) ---- */
        receiptBody.innerHTML = `
<strong>>>> SKATORATOR DISPATCH LOG <<<</strong>
─────────────────────────────────────
<strong>ORDER REF  :</strong> ${orderId}
<strong>DESTINATION:</strong> ${address}
<strong>CLIENT     :</strong> ${name} &lt;${email}&gt;
─────────────────────────────────────
<strong>ITEMS:</strong>
${snapshot.map(i => `  • ${i.name}  (${i.priceLabel})`).join("\n")}
─────────────────────────────────────
<strong>TOTAL      :</strong> ${totalLabel}  (C.O.D.)
═════════════════════════════════════
STATUS: Dispatched ✓
        `.trim().replace(/\n/g, "<br>");

        /* ---- hide checkout, show receipt (with tiny delay for CSS transition) ---- */
        checkoutModal.classList.add("hidden");
        setTimeout(() => receiptModal.classList.remove("hidden"), 320);

        /* ---- reset state ---- */
        cart = [];
        renderCart();
        checkoutForm.reset();
        [nameEl, emailEl, addressEl].forEach(el => el.classList.remove("error"));

        /* ---- unlock ---- */
        placeOrderBtn.disabled    = false;
        placeOrderBtn.textContent = "Place Order";
        orderLocked = false;
    });

    /* =====================
       CLOSE RECEIPT
    ===================== */
    closeReceiptBtn.addEventListener("click", () => {
        receiptModal.classList.add("hidden");
    });

    /* =====================
       CLOSE MODALS ON BACKDROP CLICK
    ===================== */
    cartModal.addEventListener("click", e => {
        if (e.target === cartModal) cartModal.classList.add("hidden");
    });
    checkoutModal.addEventListener("click", e => {
        if (e.target === checkoutModal) checkoutModal.classList.add("hidden");
    });
    receiptModal.addEventListener("click", e => {
        if (e.target === receiptModal) receiptModal.classList.add("hidden");
    });

    /* =====================
       KEYBOARD: ESC closes modals
    ===================== */
    document.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        if (!receiptModal.classList.contains("hidden"))  { receiptModal.classList.add("hidden");  return; }
        if (!checkoutModal.classList.contains("hidden")) { checkoutModal.classList.add("hidden"); return; }
        if (!cartModal.classList.contains("hidden"))     { cartModal.classList.add("hidden");     return; }
        if (!focusPanel.classList.contains("hidden"))    { focusPanel.classList.add("hidden");    return; }
    });

    /* initial render */
    renderCart();
});
