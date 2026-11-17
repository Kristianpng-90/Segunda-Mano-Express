/* SegundaMano Express — reglas de compra, pedidos y pagos.
 * Las usa el servidor (fuente de verdad en el modo compartido) y la página cuando se abre sin servidor.
 * Estados del pedido: pendiente → pagado → en_proceso → completado (o cancelado).
 * Seguridad: nunca se guarda el número completo de la tarjeta ni el CVC; solo la marca y los últimos 4 dígitos. */
(function (root) {
  "use strict";
  const SHIPPING_FEE = 12000;
  const STATUS_TXT = { pendiente: "Pendiente de pago", pagado: "Pagado", en_proceso: "En proceso", completado: "Completado", cancelado: "Cancelado" };
  const SHIP_METHODS = { persona: "Entrega en persona (se coordina por el chat)", domicilio: "Envío a domicilio" };
  /* Pasarela de pruebas: solo acepta tarjetas de prueba para que nadie escriba una tarjeta real */
  const TEST_CARDS = { "4242424242424242": "aprobada", "5555555555554444": "aprobada", "4000000000000002": "rechazada" };
  const CITIES = ["Bogotá", "Medellín", "Cali", "Barranquilla", "Bucaramanga", "Chía", "Soacha", "Zipaquirá", "Mosquera", "Funza"];

  const stockOf = (p) => (p && Number.isInteger(p.stock) && p.stock >= 0 ? p.stock : 1);
  const findPost = (db, id) => db.posts.find((p) => p.id === id);
  const findUser = (db, id) => db.users.find((u) => u.id === id);
  const money = (n) => "$ " + Number(n).toLocaleString("es-CO");
  const first = (db, id) => { const u = findUser(db, id); return u ? u.name.split(" ")[0] : "Usuario"; };
  const code = (id) => "SME-" + String(id).slice(-6).padStart(6, "0");

  function luhn(n) {
    let s = 0, alt = false;
    for (let i = n.length - 1; i >= 0; i--) { let d = Number(n[i]); if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; }
    return s % 10 === 0;
  }
  function brandOf(n) {
    if (/^4/.test(n)) return "Visa";
    if (/^(5[1-5]|2[2-7])/.test(n)) return "Mastercard";
    if (/^3[47]/.test(n)) return "American Express";
    return "Tarjeta";
  }
  function notify(db, ctx, userId, text, link, kind, postId) {
    db.notifs.push({ id: ctx.newId(), user: userId, kind, post: postId || null, text, link, read: false, at: ctx.now() });
  }
  function convFor(db, ctx, postId, buyer, seller) {
    let cv = db.convs.find((c) => c.post === postId && c.buyer === buyer);
    if (!cv) { cv = { id: ctx.newId(), post: postId, buyer, seller, shared: {}, msgs: [] }; db.convs.push(cv); }
    return cv;
  }
  function sysMsg(db, ctx, o, text) {
    const cv = convFor(db, ctx, o.items[0].post, o.buyer, o.seller);
    cv.msgs.push({ from: 0, text, at: ctx.now() });
    o.conv = cv.id;
    return cv;
  }
  function log(o, ctx, status, by, note) {
    o.history = o.history || [];
    o.history.push({ status, at: ctx.now(), by, note: note || "" });
  }

  /* ---------- 1. Crear pedidos a partir del carrito o de "Comprar ahora" ----------
   * Un pedido por vendedor (como en los marketplaces); todos comparten el mismo número de compra (group). */
  function createOrders(db, buyerId, v, ctx) {
    db.orders = db.orders || [];
    const buyer = findUser(db, buyerId);
    if (!buyer) return { error: "Inicia sesión para comprar." };
    if (buyer.admin) return { error: "La cuenta de administración no puede hacer compras." };
    const items = Array.isArray(v.items) ? v.items : [];
    if (!items.length) return { error: "Tu carrito está vacío. Agrega un artículo para continuar." };
    const s = v.shipping || {};
    const ship = {
      name: String(s.name || "").trim(), phone: String(s.phone || "").replace(/[\s-]/g, ""),
      method: String(s.method || ""), address: String(s.address || "").trim(), zone: String(s.zone || "").trim(),
      city: String(s.city || ""), notes: String(s.notes || "").trim().slice(0, 200),
    };
    const errors = {};
    if (ship.name.length < 3) errors.name = "Escribe el nombre de quien recibe.";
    if (!/^\+?\d{7,13}$/.test(ship.phone)) errors.phone = "Escribe un teléfono de contacto válido (7 a 13 dígitos).";
    if (!SHIP_METHODS[ship.method]) errors.method = "Elige cómo quieres recibir el artículo.";
    if (!CITIES.includes(ship.city)) errors.city = "Selecciona la ciudad o municipio.";
    if (ship.method === "domicilio" && ship.address.length < 5) errors.address = "Escribe la dirección de entrega (ej.: Calle 145 # 91-19, apto 302).";
    if (ship.method === "persona" && ship.zone.length < 3) errors.zone = "Escribe el barrio o punto de referencia para coordinar la entrega.";
    if (Object.keys(errors).length) return { errors };

    const merged = new Map();
    for (const it of items) {
      const pid = Number(it && it.post), qty = Number(it && it.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { error: "La cantidad de un artículo no es válida." };
      merged.set(pid, (merged.get(pid) || 0) + qty);
    }
    const lines = [];
    for (const [pid, qty] of merged) {
      const p = findPost(db, pid);
      if (!p || p.status === "eliminada") return { error: "Uno de los artículos ya no existe. Quítalo del carrito." };
      if (p.mode !== "venta") return { error: `“${p.title}” no está a la venta (es ${p.mode === "donacion" ? "una donación" : "una solicitud"}).` };
      if (p.owner === buyerId) return { error: `No puedes comprar tu propia publicación (“${p.title}”).` };
      const owner = findUser(db, p.owner);
      if (p.status !== "activa" || !owner || owner.suspended) return { error: `“${p.title}” ya no está disponible. Quítalo del carrito.` };
      const st = stockOf(p);
      if (qty > st) return { error: `Solo ${st === 1 ? "queda 1 unidad" : `quedan ${st} unidades`} de “${p.title}”.` };
      lines.push({ p, qty });
    }
    const group = ctx.newId();
    const bySeller = new Map();
    lines.forEach((l) => { const k = l.p.owner; if (!bySeller.has(k)) bySeller.set(k, []); bySeller.get(k).push(l); });
    const orders = [];
    for (const [seller, ls] of bySeller) {
      const id = ctx.newId();
      const its = ls.map(({ p, qty }) => ({ post: p.id, title: p.title, price: p.price, qty, img: (p.imgs || [])[0] || "", cat: p.cat }));
      const subtotal = its.reduce((a, b) => a + b.price * b.qty, 0);
      const shipping = ship.method === "domicilio" ? SHIPPING_FEE : 0;
      const o = { id, code: code(id), group, buyer: buyerId, seller, items: its, subtotal, shipping, total: subtotal + shipping, status: "pendiente", ship, payment: null, at: ctx.now(), history: [] };
      log(o, ctx, "pendiente", buyerId, "Pedido creado");
      db.orders.push(o); orders.push(o);
    }
    return { group, orders };
  }

  /* Revisa que todo siga disponible justo antes de cobrar */
  function stockProblem(db, orders) {
    const need = new Map();
    orders.forEach((o) => o.items.forEach((it) => need.set(it.post, (need.get(it.post) || 0) + it.qty)));
    for (const [pid, qty] of need) {
      const p = findPost(db, pid);
      if (!p || p.status !== "activa") return `Mientras pagabas, “${p ? p.title : "un artículo"}” dejó de estar disponible. No se hizo ningún cobro; cancela este pedido y revisa tu carrito.`;
      if (stockOf(p) < qty) return `Ya no hay suficientes unidades de “${p.title}”. No se hizo ningún cobro; cancela este pedido y revisa tu carrito.`;
    }
    return "";
  }
  function pendingOf(db, buyerId, group) {
    const orders = (db.orders || []).filter((o) => o.group === group && o.buyer === buyerId);
    if (!orders.length) return { error: "No encontramos esta compra." };
    const pend = orders.filter((o) => o.status === "pendiente");
    if (!pend.length) return { error: "Esta compra ya no tiene pagos pendientes.", done: true };
    return { orders: pend, amount: pend.reduce((a, o) => a + o.total, 0) };
  }

  /* ---------- 2. Pago aprobado: descuenta unidades, avisa al vendedor y abre el chat ---------- */
  function markPaid(db, orders, payment, ctx) {
    const buyerId = orders[0].buyer, buyer = findUser(db, buyerId);
    for (const o of orders) {
      if (o.status !== "pendiente") continue;
      o.items.forEach((it) => {
        const p = findPost(db, it.post);
        if (!p) return;
        p.stock = Math.max(0, stockOf(p) - it.qty);
        if (p.stock === 0) p.status = "vendida";
      });
      o.status = "pagado"; o.paidAt = ctx.now(); o.payment = payment;
      log(o, ctx, "pagado", buyerId, `${payment.method}${payment.last4 ? " " + payment.brand + " •••• " + payment.last4 : ""} · ref. ${payment.ref}`);
      const names = o.items.map((it) => `${it.qty} × ${it.title}`).join(", ");
      const cv = sysMsg(db, ctx, o, `🛒 Compra pagada (${o.code}): ${names} por ${money(o.total)}. ${o.ship.method === "domicilio" ? `Envío a ${o.ship.address}, ${o.ship.city}.` : "Coordinen aquí la fecha y el lugar de la entrega."}`);
      notify(db, ctx, o.seller, `${buyer ? buyer.name : "Un comprador"} pagó el pedido ${o.code} (${names}). Prepáralo y márcalo “En proceso”.`, "mis-ventas", "venta", o.items[0].post);
      notify(db, ctx, buyerId, `Pago aprobado. Tu pedido ${o.code} quedó en estado Pagado. Puedes escribirle a ${first(db, o.seller)} por el chat.`, `chat-${cv.id}`, "pedido", o.items[0].post);
    }
    if (buyer) {
      const bought = new Set(orders.flatMap((o) => o.items.map((it) => it.post)));
      buyer.cart = (buyer.cart || []).filter((c) => !bought.has(c.post));
    }
    return { ok: true, group: orders[0].group };
  }

  /* ---------- 3. Pasarela de pruebas (cuando no hay credenciales de Wompi) ---------- */
  function validateCard(card) {
    const c = card || {}, errors = {};
    const number = String(c.number || "").replace(/[\s-]/g, "");
    const name = String(c.name || "").trim(), exp = String(c.exp || "").trim(), cvc = String(c.cvc || "").trim();
    if (!/^\d{13,19}$/.test(number) || !luhn(number)) errors.number = "El número de la tarjeta no es válido. Revísalo.";
    if (name.length < 3) errors.name = "Escribe el nombre como aparece en la tarjeta.";
    const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(exp);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) errors.exp = "Escribe la fecha de vencimiento como MM/AA.";
    else {
      const d = new Date(), y = d.getFullYear() % 100, mo = d.getMonth() + 1;
      if (Number(m[2]) < y || (Number(m[2]) === y && Number(m[1]) < mo)) errors.exp = "La tarjeta está vencida.";
    }
    const amex = /^3[47]/.test(number);
    if (!(amex ? /^\d{4}$/ : /^\d{3}$/).test(cvc)) errors.cvc = amex ? "El código de seguridad tiene 4 dígitos." : "El código de seguridad (CVC) tiene 3 dígitos.";
    return { errors, number };
  }
  function payTest(db, buyerId, group, card, ctx) {
    const pg = pendingOf(db, buyerId, group);
    if (pg.error) return pg;
    const { errors, number } = validateCard(card);
    if (Object.keys(errors).length) return { errors };
    const verdict = TEST_CARDS[number];
    if (!verdict) return { errors: { number: "La pasarela está en modo de pruebas y solo acepta las tarjetas de prueba (por ejemplo 4242 4242 4242 4242). No escribas tarjetas reales." } };
    const problem = stockProblem(db, pg.orders);
    if (problem) return { error: problem };
    const last4 = number.slice(-4), brand = brandOf(number);
    if (verdict === "rechazada") {
      pg.orders.forEach((o) => { o.attempts = (o.attempts || []).concat({ at: ctx.now(), result: "rechazado", brand, last4 }); });
      return { declined: true, error: `El banco rechazó la tarjeta ${brand} terminada en ${last4} (fondos insuficientes). No se hizo ningún cobro: intenta con otra tarjeta.` };
    }
    const ref = "PRB-" + String(ctx.newId()).slice(-8);
    return markPaid(db, pg.orders, { provider: "pruebas", ref, method: "Tarjeta", brand, last4, at: ctx.now() }, ctx);
  }

  /* ---------- 4. Cambios de estado ---------- */
  function setStatus(db, userId, orderId, action, ctx, note) {
    const o = (db.orders || []).find((x) => x.id === orderId);
    const u = findUser(db, userId);
    if (!o || !u || (o.buyer !== userId && o.seller !== userId)) return { error: "No encontramos este pedido." };
    const isB = o.buyer === userId, isS = o.seller === userId;
    const names = o.items.map((it) => it.title).join(", ");
    if (action === "procesar") {
      if (!isS) return { error: "Solo quien vende puede marcar el pedido en proceso." };
      if (o.status !== "pagado") return { error: "Solo los pedidos pagados pueden pasar a En proceso." };
      o.status = "en_proceso"; o.processAt = ctx.now(); log(o, ctx, "en_proceso", userId, note);
      sysMsg(db, ctx, o, `📦 ${first(db, o.seller)} marcó el pedido ${o.code} como En proceso${note ? `: “${note}”` : "."}`);
      notify(db, ctx, o.buyer, `Tu pedido ${o.code} (${names}) está En proceso.`, "mis-pedidos", "pedido", o.items[0].post);
      return { ok: true };
    }
    if (action === "completar") {
      if (!isB) return { error: "Solo quien compra confirma que recibió el pedido." };
      if (o.status !== "en_proceso" && o.status !== "pagado") return { error: "Este pedido no se puede completar en su estado actual." };
      o.status = "completado"; o.doneAt = ctx.now(); log(o, ctx, "completado", userId, "Recibido por el comprador");
      o.items.forEach((it) => db.txs.push({ id: ctx.newId(), post: it.post, seller: o.seller, buyer: o.buyer, order: o.id, at: ctx.now() }));
      sysMsg(db, ctx, o, `✅ ${first(db, o.buyer)} confirmó que recibió el pedido ${o.code}. Compra completada.`);
      notify(db, ctx, o.seller, `${u.name} confirmó que recibió el pedido ${o.code}. Venta completada.`, "mis-ventas", "venta", o.items[0].post);
      notify(db, ctx, o.buyer, `Pedido ${o.code} completado. Ya puedes calificar a ${findUser(db, o.seller).name}.`, "mis-pedidos", "resena", o.items[0].post);
      return { ok: true };
    }
    if (action === "cancelar") {
      if (o.status === "pendiente" && isB) {
        o.status = "cancelado"; o.cancelAt = ctx.now(); o.cancelBy = userId; log(o, ctx, "cancelado", userId, note || "Cancelado antes de pagar");
        return { ok: true };
      }
      if (o.status === "pagado" && isS) {
        const reason = String(note || "").trim();
        if (reason.length < 5) return { error: "Escribe el motivo de la cancelación (mínimo 5 caracteres)." };
        o.items.forEach((it) => {
          const p = findPost(db, it.post);
          if (!p) return;
          p.stock = stockOf(p) + it.qty;
          if (p.status === "vendida") p.status = "activa";
        });
        o.status = "cancelado"; o.cancelAt = ctx.now(); o.cancelBy = userId; o.cancelReason = reason;
        o.payment = Object.assign({}, o.payment, { refund: o.payment && o.payment.provider === "pruebas" ? "reembolsado" : "pendiente" });
        log(o, ctx, "cancelado", userId, reason);
        sysMsg(db, ctx, o, `❌ ${first(db, o.seller)} canceló el pedido ${o.code}. Motivo: “${reason}”.`);
        notify(db, ctx, o.buyer, `${u.name} canceló tu pedido ${o.code}. Motivo: “${reason}”. ${o.payment.refund === "reembolsado" ? "El pago se reversó." : "El reembolso se gestiona en la pasarela de pagos."}`, "mis-pedidos", "pedido", o.items[0].post);
        return { ok: true };
      }
      return { error: o.status === "pendiente" ? "Solo quien compra puede cancelar un pedido sin pagar." : o.status === "pagado" ? "Solo quien vende puede cancelar un pedido pagado (con reembolso)." : "Este pedido ya no se puede cancelar." };
    }
    return { error: "Acción no válida." };
  }

  const api = { SHIPPING_FEE, STATUS_TXT, SHIP_METHODS, TEST_CARDS, stockOf, luhn, brandOf, createOrders, pendingOf, stockProblem, markPaid, validateCard, payTest, setStatus, code };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SME_SHOP = api;
})(typeof self !== "undefined" ? self : this);
