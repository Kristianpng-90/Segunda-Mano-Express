/* SegundaMano Express — servidor para uso multiusuario.
 * Node.js 18 o superior, sin dependencias externas.
 * Sirve la página (carpeta public), guarda los datos en data/db.json, las fotos públicas en data/uploads
 * y las fotos del chat en data/private (solo las ven los participantes de la conversación).
 *
 * Variables de entorno (todas opcionales; ver LEEME.md):
 *   PORT, DATA_DIR, PUBLIC_URL
 *   GOOGLE_CLIENT_ID                       → activa "Continuar con Google"
 *   WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET → activa la pasarela Wompi (pagos reales o sandbox)
 * Uso: node server.js */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const seed = require("./public/seed.js");
const core = require("./public/core.js");
const shop = require("./public/shop.js");

const env = (k) => String(process.env[k] || "").trim();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOADS = path.join(DATA, "uploads");
const PRIVATE = path.join(DATA, "private");
const DB_FILE = path.join(DATA, "db.json");
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(PRIVATE, { recursive: true });

const GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID");
const GOOGLE_TOKENINFO = env("GOOGLE_TOKENINFO_URL") || "https://oauth2.googleapis.com/tokeninfo";
const WOMPI = {
  pub: env("WOMPI_PUBLIC_KEY"), integrity: env("WOMPI_INTEGRITY_SECRET"), events: env("WOMPI_EVENTS_SECRET"),
  checkout: env("WOMPI_CHECKOUT_URL") || "https://checkout.wompi.co/p/",
};
WOMPI.enabled = !!(WOMPI.pub && WOMPI.integrity);
WOMPI.sandbox = WOMPI.pub.startsWith("pub_test_");
WOMPI.api = env("WOMPI_API_URL") || (WOMPI.sandbox ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1");

/* Colecciones que cada navegador puede modificar (con permisos). "orders" solo la cambia el servidor. */
const COLLS = ["users", "posts", "questions", "convs", "requests", "txs", "deliveries", "reviews", "notifs", "reports"];
const SESSION_DAYS = 7, LOCK_FAILS = 5, LOCK_MIN = 15;

/* ---------- contraseñas: scrypt con sal propia por usuario ---------- */
const LEGACY_SALT = "sme-umb-2026";
function hashPass(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return "s2$" + salt + "$" + crypto.scryptSync(String(p), salt, 32).toString("hex");
}
function verifyPass(p, stored) {
  if (!stored || typeof stored !== "string") return false;
  let calc;
  if (stored.startsWith("s2$")) { const [, salt, h] = stored.split("$"); calc = "s2$" + salt + "$" + crypto.scryptSync(String(p), salt, 32).toString("hex"); }
  else if (stored.startsWith("s1$")) calc = "s1$" + crypto.scryptSync(String(p), LEGACY_SALT, 32).toString("hex");
  else return false;
  const a = Buffer.from(calc), b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- datos ---------- */
let store;
function fresh() { return { version: 1, epoch: Date.now(), db: seed(hashPass), sessions: {}, media: {}, tickets: {} }; }
try { store = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) { store = fresh(); }
for (const c of COLLS) store.db[c] = store.db[c] || [];
store.db.orders = store.db.orders || [];
store.db.resets = store.db.resets || [];
store.db.users.forEach((u) => { u.cart = u.cart || []; u.favs = u.favs || []; });
store.sessions = store.sessions || {};
store.media = store.media || {};
store.tickets = store.tickets || {};
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, DB_FILE);
  }, 200);
}
function bump() { store.version++; persist(); }
persist();

let idCounter = 0;
const newId = () => Date.now() * 100 + (idCounter = (idCounter + 1) % 100);
const ctx = { newId, now: () => Date.now() };
const userById = (id) => store.db.users.find((u) => u.id === id);

/* Estado que recibe cada persona: solo lo público y lo que le pertenece.
 * Nunca incluye contraseñas, sesiones, códigos de recuperación ni datos de otras personas. */
function publicState(u) {
  const db = store.db, uid = u ? u.id : null, admin = !!(u && u.admin);
  const s = {};
  for (const c of COLLS) s[c] = db[c];
  const myConvs = uid ? db.convs.filter((c) => c.buyer === uid || c.seller === uid) : [];
  s.convs = myConvs;
  s.notifs = uid ? db.notifs.filter((n) => n.user === uid) : [];
  s.deliveries = uid ? db.deliveries.filter((d) => d.buyer === uid || d.seller === uid) : [];
  s.orders = uid ? db.orders.filter((o) => o.buyer === uid || o.seller === uid) : [];
  s.txs = uid ? db.txs.filter((t) => t.buyer === uid || t.seller === uid) : [];
  s.reports = admin ? db.reports : uid ? db.reports.filter((r) => r.reporter === uid) : [];
  s.requests = uid ? db.requests.filter((r) => { const p = db.posts.find((x) => x.id === r.post); return r.requester === uid || (p && p.owner === uid); }) : [];
  s.users = db.users.map((x) => {
    if (x.id === uid) { const { pass, ...me } = x; me.hasPass = !!pass; return me; }
    const pub = { id: x.id, name: x.name, city: x.city, role: x.role, admin: x.admin, suspended: x.suspended, since: x.since };
    // El correo y el teléfono solo los ve quien conversa con esa persona y después de que ella los comparte
    if (myConvs.some((c) => (c.buyer === x.id || c.seller === x.id) && c.shared && c.shared[x.id])) { pub.email = x.email; pub.phone = x.phone; }
    return pub;
  });
  return { version: store.version, epoch: store.epoch, state: s };
}

/* ---------- utilidades HTTP ---------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "frame-src https://accounts.google.com https://www.openstreetmap.org",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "form-action 'self' https://checkout.wompi.co",
  "base-uri 'self'", "object-src 'none'",
].join("; ");
function secHeaders(req, extra) {
  const h = Object.assign({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "SAMEORIGIN", "Permissions-Policy": "camera=(self), geolocation=(self), microphone=()" }, extra);
  if (req.headers["x-forwarded-proto"] === "https") h["Strict-Transport-Security"] = "max-age=15552000";
  return h;
}
function send(res, code, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(code, secHeaders(res.req, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, res.cookie ? { "Set-Cookie": res.cookie } : {}, extra)));
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too_big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(new Error("bad_json")); } });
    req.on("error", reject);
  });
}
function serveFile(req, res, file, cache, isHtml) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, secHeaders(req, { "Content-Type": "text/plain; charset=utf-8" })); return res.end("No encontrado"); }
    const h = { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": cache || "no-cache" };
    if (isHtml) h["Content-Security-Policy"] = CSP;
    res.writeHead(200, secHeaders(req, h));
    fs.createReadStream(file).pipe(res);
  });
}
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const isHttps = (req) => req.headers["x-forwarded-proto"] === "https";
const baseUrl = (req) => env("PUBLIC_URL").replace(/\/$/, "") || `${isHttps(req) ? "https" : "http"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
function cookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((c) => { const i = c.indexOf("="); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
const sessionCookie = (req, token, maxAge) => `sme_sid=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;

/* ---------- sesiones: vencen a los 7 días y se cierran al cambiar la contraseña ---------- */
function sessionOf(token) {
  if (!token) return null;
  let s = store.sessions[token];
  if (s == null) return null;
  if (typeof s === "number") s = store.sessions[token] = { uid: s, exp: Date.now() + SESSION_DAYS * 86400000 };
  if (s.exp < Date.now()) { delete store.sessions[token]; persist(); return null; }
  return s;
}
function who(req) {
  const t = req.headers["x-token"] || cookies(req).sme_sid;
  const s = sessionOf(t);
  return s ? userById(s.uid) || null : null;
}
function startSession(req, res, uid) {
  const token = crypto.randomBytes(32).toString("hex");
  store.sessions[token] = { uid, exp: Date.now() + SESSION_DAYS * 86400000 };
  res.cookie = sessionCookie(req, token, SESSION_DAYS * 86400);
  persist();
  return token;
}
const endSessionsOf = (uid) => Object.keys(store.sessions).forEach((t) => { const s = store.sessions[t]; if ((typeof s === "number" ? s : s.uid) === uid) delete store.sessions[t]; });

/* ---------- límites de intentos (evita adivinar contraseñas) ---------- */
const attempts = new Map();
function limited(key, max, minutes) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 60000);
  if (a && a.until && a.until <= Date.now()) attempts.delete(key);
  return 0;
}
function fail(key, max, minutes) {
  const a = attempts.get(key) || { n: 0, until: 0, first: Date.now() };
  if (Date.now() - a.first > minutes * 60000) { a.n = 0; a.first = Date.now(); }
  a.n++;
  if (a.n >= max) { a.until = Date.now() + minutes * 60000; a.n = 0; }
  attempts.set(key, a);
  return max - a.n;
}

/* ---------- fusión de cambios enviados por cada navegador, con permisos ---------- */
const msgKey = (m) => `${m.from}|${m.at}|${m.text}|${m.url || ""}|${m.lat || ""}`;
function cleanMsg(m, uid) {
  if (!m || typeof m !== "object") return null;
  const out = { from: Number(m.from), at: Number(m.at) || Date.now(), text: String(m.text || "").slice(0, 600) };
  if (out.from !== uid && out.from !== 0) return null;
  if (m.contact) out.contact = true;
  if (m.type === "image") {
    if (!/^(media|uploads)\/[a-f0-9-]+\.(jpg|png|webp)$/.test(String(m.url || ""))) return null;
    out.type = "image"; out.url = m.url;
  } else if (m.type === "location") {
    const lat = Number(m.lat), lng = Number(m.lng);
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;
    out.type = "location"; out.lat = Math.round(lat * 1e6) / 1e6; out.lng = Math.round(lng * 1e6) / 1e6;
    if (m.acc) out.acc = Math.round(Number(m.acc)) || 0;
  }
  return out;
}
function mergeRecord(coll, cur, inc, uid) {
  for (const k of Object.keys(inc)) {
    if (coll === "convs" && k === "msgs" && Array.isArray(inc.msgs)) {
      cur.msgs = cur.msgs || [];
      const seen = new Set(cur.msgs.map(msgKey));
      inc.msgs.forEach((raw) => { const m = cleanMsg(raw, uid); if (m && !seen.has(msgKey(m))) { cur.msgs.push(m); seen.add(msgKey(m)); } });
      cur.msgs.sort((a, b) => a.at - b.at);
    } else if (coll === "convs" && k === "shared") cur.shared = Object.assign({}, cur.shared, inc.shared && inc.shared[uid] ? { [uid]: true } : {});
    else cur[k] = inc[k];
  }
}
const pick = (o, keys) => { const r = { id: o.id }; keys.forEach((k) => { if (k in o) r[k] = o[k]; }); return r; };
/* Devuelve el registro permitido (o null si la persona no puede hacer ese cambio) */
function allowed(coll, user, cur, inc) {
  const uid = user.id, db = store.db;
  const postOf = (id) => db.posts.find((p) => p.id === id);
  switch (coll) {
    case "users":
      delete inc.pass; delete inc.email; delete inc.admin; delete inc.google; delete inc.googleEmail; delete inc.hasPass;
      if (!cur) return null;
      if (inc.id === uid) { delete inc.suspended; if (inc.role && !["C", "V", "D"].includes(inc.role) && !user.admin) delete inc.role; return inc; }
      return user.admin ? pick(inc, ["suspended"]) : null;
    case "posts": {
      if (!cur) return inc.owner === uid && ["venta", "donacion", "solicitud"].includes(inc.mode) ? inc : null;
      if (cur.owner === uid) { delete inc.owner; return inc; }
      if (user.admin) return pick(inc, ["status"]);
      // Quien recibe en una entrega acordada puede cerrarla o cancelarla (HUI-12)
      const dl = db.deliveries.find((d) => d.post === cur.id && d.buyer === uid);
      if (dl && ["cerrada", "activa"].includes(inc.status) && cur.status === "reservada") return pick(inc, ["status"]);
      return null;
    }
    case "questions":
      if (!cur) return inc.author === uid ? inc : null;
      { const p = postOf(cur.post); return p && p.owner === uid ? pick(inc, ["answer"]) : null; }
    case "convs":
      if (!cur) return (inc.buyer === uid || inc.seller === uid) ? inc : null;
      return (cur.buyer === uid || cur.seller === uid) ? pick(inc, ["msgs", "shared"]) : null;
    case "requests":
      if (!cur) return inc.requester === uid ? inc : null;
      { const p = postOf(cur.post); return cur.requester === uid || (p && p.owner === uid) ? pick(inc, ["status"]) : null; }
    case "txs":
      return !cur && (inc.buyer === uid || inc.seller === uid) ? inc : null;
    case "deliveries":
      if (!cur) return (inc.seller === uid || inc.buyer === uid) ? inc : null;
      if (cur.seller !== uid && cur.buyer !== uid) return null;
      delete inc.seller; delete inc.buyer; delete inc.post; return inc;
    case "reviews":
      return !cur && inc.from === uid ? inc : null;
    case "notifs":
      if (!cur) return inc;
      return cur.user === uid ? pick(inc, ["read"]) : null;
    case "reports":
      if (!cur) return inc.reporter === uid ? inc : null;
      return user.admin ? inc : null;
  }
  return null;
}
function applyUpserts(user, upserts) {
  let changed = 0;
  for (const coll of COLLS) {
    const list = Array.isArray(upserts[coll]) ? upserts[coll] : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object" || raw.id == null) continue;
      const arr = store.db[coll];
      const cur = arr.find((x) => x.id === raw.id);
      const inc = allowed(coll, user, cur, Object.assign({}, raw));
      if (!inc) continue;
      if (coll === "posts" && cur && cur.mode === "venta" && Number(inc.price) < Number(cur.price)) {
        // HUI-11: aviso de baja de precio a quienes tienen el artículo en favoritos
        store.db.users.filter((x) => x.id !== cur.owner && (x.favs || []).includes(cur.id)).forEach((x) => store.db.notifs.push({ id: newId(), user: x.id, kind: "otro", post: cur.id, text: `Bajó el precio de “${inc.title || cur.title}” en tus favoritos: ahora $ ${Number(inc.price).toLocaleString("es-CO")}.`, link: `pub-${cur.id}`, read: false, at: Date.now() }));
      }
      if (coll === "posts" && inc.stock != null) inc.stock = Math.max(0, Math.min(999, parseInt(inc.stock, 10) || 0));
      if (coll === "users" && inc.cart) inc.cart = (Array.isArray(inc.cart) ? inc.cart : []).filter((c) => c && Number.isInteger(c.post) && Number.isInteger(c.qty) && c.qty > 0 && c.qty < 100).slice(0, 50);
      if (cur) mergeRecord(coll, cur, inc, user.id);
      else if (coll !== "users") {
        if (coll === "convs") { const msgs = inc.msgs || []; inc.msgs = []; mergeRecord(coll, inc, { msgs }, user.id); inc.shared = {}; }
        arr.push(inc);
      }
      changed++;
    }
  }
  if (changed) bump();
}

/* ---------- imágenes: se comprueba que de verdad sean JPG, PNG o WEBP ---------- */
function decodeImage(data) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ""));
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  const jpg = buf[0] === 0xff && buf[1] === 0xd8, png = buf.slice(0, 4).toString("hex") === "89504e47";
  const webp = buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP";
  if (!(jpg || png || webp)) return null;
  return { buf, ext: jpg ? "jpg" : png ? "png" : "webp" };
}

/* ---------- Google: se verifica el token con Google antes de crear o abrir la cuenta ---------- */
async function verifyGoogle(credential) {
  if (!GOOGLE_CLIENT_ID) throw new Error("El acceso con Google no está configurado en este servidor.");
  if (!credential || typeof credential !== "string" || credential.length > 4096) throw new Error("No recibimos la respuesta de Google.");
  const r = await fetch(GOOGLE_TOKENINFO + "?id_token=" + encodeURIComponent(credential));
  if (!r.ok) throw new Error("Google no validó el inicio de sesión. Intenta de nuevo.");
  const t = await r.json();
  if (t.aud !== GOOGLE_CLIENT_ID) throw new Error("El token no corresponde a esta aplicación.");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(t.iss)) throw new Error("El token no fue emitido por Google.");
  if (Number(t.exp) * 1000 < Date.now()) throw new Error("La sesión de Google venció. Intenta de nuevo.");
  if (!(t.email_verified === true || t.email_verified === "true")) throw new Error("Tu correo de Google no está verificado.");
  return { sub: String(t.sub), email: String(t.email).toLowerCase(), name: String(t.name || t.given_name || String(t.email).split("@")[0]).slice(0, 60) };
}

/* ---------- Wompi: checkout web con firma de integridad y verificación con la API ---------- */
function wompiReference(group) { return `SME-${group}-${crypto.randomBytes(3).toString("hex")}`; }
function groupFromRef(ref) { const m = /^SME-(\d+)-[a-f0-9]+$/.exec(String(ref || "")); return m ? Number(m[1]) : null; }
async function wompiTransaction(id) {
  const r = await fetch(`${WOMPI.api}/transactions/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error("No pudimos consultar la transacción en Wompi.");
  return (await r.json()).data;
}
/* Aplica el resultado de una transacción de Wompi a los pedidos de la compra */
function applyWompi(tx) {
  const group = groupFromRef(tx && tx.reference);
  if (!group) return { error: "Referencia de pago desconocida." };
  const orders = store.db.orders.filter((o) => o.group === group && o.wompiRef === tx.reference);
  if (!orders.length) return { error: "No encontramos la compra de este pago." };
  const pend = orders.filter((o) => o.status === "pendiente");
  orders.forEach((o) => { o.wompiTx = tx.id; o.wompiStatus = tx.status; });
  if (!pend.length) return { ok: true, group, status: tx.status };
  const cents = pend.reduce((a, o) => a + o.total * 100, 0);
  if (tx.status === "APPROVED") {
    if (Number(tx.amount_in_cents) !== cents || tx.currency !== "COP") return { error: "El valor pagado no coincide con la compra." };
    const pm = tx.payment_method || {}, extra = pm.extra || {};
    const method = { CARD: "Tarjeta", PSE: "PSE", NEQUI: "Nequi", BANCOLOMBIA_TRANSFER: "Botón Bancolombia" }[tx.payment_method_type] || tx.payment_method_type || "Wompi";
    shop.markPaid(store.db, pend, { provider: "wompi", ref: tx.id, method, brand: extra.brand || "", last4: extra.last_four || "", at: Date.now(), sandbox: WOMPI.sandbox }, ctx);
    bump();
  } else if (["DECLINED", "VOIDED", "ERROR"].includes(tx.status)) {
    pend.forEach((o) => { o.attempts = (o.attempts || []).concat({ at: Date.now(), result: tx.status.toLowerCase(), provider: "wompi" }); });
    bump();
  } else persist();
  return { ok: true, group, status: tx.status };
}

/* ---------- rutas ---------- */
const server = http.createServer(async (req, res) => {
  res.req = req;
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    if (p === "/api/state" && req.method === "GET") {
      const u = who(req), hadToken = !!req.headers["x-token"];
      const v = Number(url.searchParams.get("v"));
      if (v && v === store.version && (u || !hadToken)) return send(res, 200, { same: true, version: v, epoch: store.epoch });
      return send(res, 200, Object.assign(publicState(u), { auth: !!u || !hadToken }));
    }
    if (p === "/api/config" && req.method === "GET") {
      return send(res, 200, { googleClientId: GOOGLE_CLIENT_ID || null, payments: WOMPI.enabled ? "wompi" : "pruebas", wompiSandbox: WOMPI.enabled ? WOMPI.sandbox : null, shippingFee: shop.SHIPPING_FEE });
    }
    /* Wompi devuelve al comprador aquí con ?id=<transacción> */
    if (p === "/api/wompi/return" && req.method === "GET") {
      let group = null;
      try { if (WOMPI.enabled && url.searchParams.get("id")) { const r = applyWompi(await wompiTransaction(url.searchParams.get("id"))); group = r.group; } } catch (e) { console.error(e.message); }
      res.writeHead(302, secHeaders(req, { Location: group ? `/#compra-${group}` : "/#mis-pedidos" }));
      return res.end();
    }
    /* Fotos del chat: solo para quienes participan en la conversación (cookie de sesión) */
    if (p.startsWith("/media/") && req.method === "GET") {
      const name = path.basename(p), meta = store.media[name], u = who(req);
      const cv = meta && store.db.convs.find((c) => c.id === meta.conv);
      if (!u || !cv || (cv.buyer !== u.id && cv.seller !== u.id)) { res.writeHead(403, secHeaders(req, { "Content-Type": "text/plain; charset=utf-8" })); return res.end("Sin permiso"); }
      return serveFile(req, res, path.join(PRIVATE, name), "private, max-age=86400");
    }
    if (p.startsWith("/api/") && req.method === "POST") {
      const body = await readBody(req, p === "/api/upload" ? 6 * 1024 * 1024 : 256 * 1024);
      if (p === "/api/wompi/events") {
        // Webhook de Wompi: se valida la firma (checksum) con el secreto de eventos
        if (!WOMPI.enabled || !WOMPI.events) return send(res, 404, { error: "No configurado" });
        const sig = body.signature || {}, props = Array.isArray(sig.properties) ? sig.properties : [];
        const val = (k) => k.split(".").reduce((o, x) => (o == null ? o : o[x]), body.data);
        const calc = crypto.createHash("sha256").update(props.map(val).join("") + body.timestamp + WOMPI.events).digest("hex");
        if (!sig.checksum || calc !== String(sig.checksum).toLowerCase()) return send(res, 401, { error: "Firma inválida" });
        if (body.event === "transaction.updated" && body.data && body.data.transaction) applyWompi(body.data.transaction);
        return send(res, 200, { ok: true });
      }
      const ip = ipOf(req);
      if (p === "/api/register") {
        if (limited("reg:" + ip)) return send(res, 429, { error: "Demasiados registros desde esta conexión. Intenta más tarde." });
        const r = core.register(store.db, body, hashPass, newId);
        if (r.errors) return send(res, 400, { errors: r.errors });
        fail("reg:" + ip, 10, 60);
        const token = startSession(req, res, r.user.id); bump();
        return send(res, 200, { uid: r.user.id, token, ...publicState(r.user) });
      }
      if (p === "/api/login") {
        const email = String(body.email || "").trim().toLowerCase();
        const wait = limited("login:" + email) || limited("ip:" + ip);
        if (wait) return send(res, 429, { error: `Por seguridad bloqueamos el inicio de sesión por demasiados intentos fallidos. Intenta de nuevo en ${wait} ${wait === 1 ? "minuto" : "minutos"} o recupera tu contraseña.` });
        const r = core.login(store.db, email, body.pass, verifyPass);
        if (r.error) {
          if (r.failed) {
            fail("ip:" + ip, 20, LOCK_MIN);
            const left = fail("login:" + email, LOCK_FAILS, LOCK_MIN);
            if (left === LOCK_FAILS) return send(res, 429, { error: `Por seguridad bloqueamos el inicio de sesión de esta cuenta durante ${LOCK_MIN} minutos por demasiados intentos fallidos. Puedes recuperar tu contraseña.` });
            if (left <= 2) r.error += ` Te ${left === 1 ? "queda 1 intento" : `quedan ${left} intentos`} antes de un bloqueo temporal.`;
          }
          return send(res, 401, { error: r.error, field: r.field });
        }
        attempts.delete("login:" + email);
        if (r.user.pass.startsWith("s1$")) r.user.pass = hashPass(body.pass);
        const token = startSession(req, res, r.user.id);
        return send(res, 200, { uid: r.user.id, token });
      }
      if (p === "/api/auth/google") {
        let g;
        try { g = await verifyGoogle(body.credential); } catch (e) { return send(res, 401, { error: e.message }); }
        let u = store.db.users.find((x) => x.google === g.sub) || store.db.users.find((x) => x.email === g.email);
        if (u) {
          if (u.suspended) return send(res, 403, { error: "Esta cuenta está suspendida por moderación." });
          const linked = !u.google;
          if (u.google && u.google !== g.sub) return send(res, 409, { error: "Este correo ya está vinculado a otra cuenta de Google." });
          u.google = g.sub; u.googleEmail = g.email;
          const token = startSession(req, res, u.id); bump();
          return send(res, 200, { uid: u.id, token, linked });
        }
        // Cuenta nueva: se pide el rol y la ciudad antes de crearla
        const ticket = crypto.randomBytes(24).toString("hex");
        store.tickets[ticket] = Object.assign({ exp: Date.now() + 10 * 60000 }, g);
        persist();
        return send(res, 200, { needsProfile: true, ticket, name: g.name, email: g.email });
      }
      if (p === "/api/auth/google/complete") {
        const t = store.tickets[String(body.ticket || "")];
        if (!t || t.exp < Date.now()) return send(res, 400, { error: "La verificación con Google venció. Pulsa de nuevo “Continuar con Google”." });
        const errors = {};
        if (!["C", "V", "D"].includes(body.role)) errors.role = "Elige con qué rol quieres empezar.";
        if (!body.city) errors.city = "Selecciona tu ciudad o municipio.";
        if (Object.keys(errors).length) return send(res, 400, { errors });
        if (store.db.users.some((x) => x.email === t.email || x.google === t.sub)) return send(res, 409, { error: "Ya existe una cuenta con este correo. Pulsa “Continuar con Google” para entrar." });
        const u = { id: newId(), name: t.name, email: t.email, phone: "", pass: null, google: t.sub, googleEmail: t.email, city: String(body.city), role: body.role, admin: false, suspended: false, favs: [], cart: [], since: Date.now() };
        store.db.users.push(u);
        delete store.tickets[String(body.ticket)];
        const token = startSession(req, res, u.id); bump();
        return send(res, 200, { uid: u.id, token, ...publicState(u) });
      }
      if (p === "/api/logout") {
        const t = req.headers["x-token"] || cookies(req).sme_sid;
        delete store.sessions[t]; persist();
        res.cookie = sessionCookie(req, "", 0);
        return send(res, 200, { ok: true });
      }
      if (p === "/api/reset/request") {
        if (limited("rst:" + ip)) return send(res, 429, { error: "Demasiadas solicitudes. Intenta más tarde." });
        fail("rst:" + ip, 15, 15);
        const r = core.resetRequest(store.db, body.email); persist(); return send(res, r.error ? 400 : 200, r);
      }
      if (p === "/api/reset/confirm") {
        const r = core.resetConfirm(store.db, body, hashPass);
        if (r.ok) { const u = store.db.users.find((x) => x.email === String(body.email).trim().toLowerCase()); endSessionsOf(u.id); attempts.delete("login:" + u.email); }
        persist();
        return send(res, r.ok ? 200 : 400, r);
      }

      /* ----- desde aquí todas las rutas requieren sesión ----- */
      const u = who(req);
      if (!u) return send(res, 401, { error: "Tu sesión terminó. Inicia sesión de nuevo." });
      if (u.suspended) return send(res, 403, { error: "Esta cuenta está suspendida por moderación." });
      if (!cookies(req).sme_sid && req.headers["x-token"]) res.cookie = sessionCookie(req, req.headers["x-token"], SESSION_DAYS * 86400);
      if (p === "/api/session") return send(res, 200, { ok: true, uid: u.id });
      if (p === "/api/sync") { applyUpserts(u, body.upserts || {}); return send(res, 200, publicState(u)); }
      if (p === "/api/upload") {
        const img = decodeImage(body.data);
        if (!img) return send(res, 400, { error: "La imagen no es válida (usa JPG, PNG o WEBP)." });
        const name = `${crypto.randomUUID()}.${img.ext}`;
        if (body.conv != null) {
          const cv = store.db.convs.find((c) => c.id === Number(body.conv));
          if (!cv || (cv.buyer !== u.id && cv.seller !== u.id)) return send(res, 403, { error: "Solo los participantes pueden enviar fotos en esta conversación." });
          fs.writeFileSync(path.join(PRIVATE, name), img.buf);
          store.media[name] = { conv: cv.id, by: u.id, at: Date.now() }; persist();
          return send(res, 200, { url: "media/" + name });
        }
        fs.writeFileSync(path.join(UPLOADS, name), img.buf);
        return send(res, 200, { url: "uploads/" + name });
      }
      if (p === "/api/auth/google/link") {
        let g;
        try { g = await verifyGoogle(body.credential); } catch (e) { return send(res, 401, { error: e.message }); }
        const other = store.db.users.find((x) => x.id !== u.id && (x.google === g.sub || x.email === g.email));
        if (other) return send(res, 409, { error: "Esa cuenta de Google ya pertenece a otro usuario de SegundaMano Express." });
        u.google = g.sub; u.googleEmail = g.email; bump();
        return send(res, 200, publicState(u));
      }
      if (p === "/api/auth/google/unlink") {
        if (!u.pass) return send(res, 400, { error: "Primero crea una contraseña (en “¿Olvidaste tu contraseña?”) para no quedarte sin forma de entrar." });
        delete u.google; delete u.googleEmail; bump();
        return send(res, 200, publicState(u));
      }
      /* ----- compras y pagos ----- */
      if (p === "/api/orders") {
        const r = shop.createOrders(store.db, u.id, body, ctx);
        if (r.errors || r.error) return send(res, 400, r);
        bump();
        return send(res, 200, Object.assign({ group: r.group }, publicState(u)));
      }
      let m;
      if ((m = /^\/api\/checkout\/(\d+)\/pay$/.exec(p))) {
        if (WOMPI.enabled) return send(res, 400, { error: "Este servidor cobra con Wompi. Usa el botón “Pagar con Wompi”." });
        const r = shop.payTest(store.db, u.id, Number(m[1]), body.card, ctx);
        if (r.errors) return send(res, 400, r);
        if (r.error) { if (r.declined) bump(); return send(res, r.declined ? 402 : 400, Object.assign(r, publicState(u))); }
        bump();
        return send(res, 200, Object.assign(r, publicState(u)));
      }
      if ((m = /^\/api\/checkout\/(\d+)\/wompi$/.exec(p))) {
        if (!WOMPI.enabled) return send(res, 400, { error: "La pasarela Wompi no está configurada." });
        const group = Number(m[1]), pg = shop.pendingOf(store.db, u.id, group);
        if (pg.error) return send(res, 400, pg);
        const problem = shop.stockProblem(store.db, pg.orders);
        if (problem) return send(res, 400, { error: problem });
        const reference = wompiReference(group), cents = pg.amount * 100;
        pg.orders.forEach((o) => { o.wompiRef = reference; });
        persist();
        const signature = crypto.createHash("sha256").update(`${reference}${cents}COP${WOMPI.integrity}`).digest("hex");
        const q = new URLSearchParams({ "public-key": WOMPI.pub, currency: "COP", "amount-in-cents": String(cents), reference, "signature:integrity": signature, "redirect-url": baseUrl(req) + "/api/wompi/return", "customer-data:email": u.email, "customer-data:full-name": u.name });
        return send(res, 200, { url: WOMPI.checkout + "?" + q.toString(), reference });
      }
      if ((m = /^\/api\/checkout\/(\d+)\/verify$/.exec(p))) {
        if (!WOMPI.enabled) return send(res, 400, { error: "La pasarela Wompi no está configurada." });
        const o = store.db.orders.find((x) => x.group === Number(m[1]) && x.buyer === u.id && x.wompiTx);
        if (!o) return send(res, 400, { error: "Todavía no hay un pago registrado para esta compra." });
        const r = applyWompi(await wompiTransaction(o.wompiTx));
        return send(res, r.error ? 400 : 200, Object.assign(r, publicState(u)));
      }
      if ((m = /^\/api\/orders\/(\d+)\/status$/.exec(p))) {
        const r = shop.setStatus(store.db, u.id, Number(m[1]), String(body.action || ""), ctx, String(body.note || "").slice(0, 200));
        if (r.error) return send(res, 400, r);
        bump();
        return send(res, 200, Object.assign(r, publicState(u)));
      }
      if (p === "/api/demo-reset") {
        if (!u.admin) return send(res, 403, { error: "Solo el administrador puede restablecer los datos." });
        const keep = store.version; store = fresh(); store.version = keep + 1; persist();
        res.cookie = sessionCookie(req, "", 0);
        return send(res, 200, publicState(null));
      }
      return send(res, 404, { error: "Ruta no encontrada" });
    }
    if (p.startsWith("/api/")) return send(res, 405, { error: "Método no permitido" });
    if (p.startsWith("/uploads/")) {
      const f = path.join(UPLOADS, path.basename(p));
      return serveFile(req, res, f, "public, max-age=31536000, immutable");
    }
    let rel;
    try { rel = decodeURIComponent(p === "/" ? "/index.html" : p); } catch (e) { rel = "/x"; }
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    return serveFile(req, res, file, null, file.endsWith(".html"));
  } catch (e) {
    if (e.message === "too_big") return send(res, 413, { error: "El archivo es demasiado grande." });
    if (e.message === "bad_json") return send(res, 400, { error: "Solicitud no válida." });
    console.error(e);
    return send(res, 500, { error: "Error en el servidor. Intenta de nuevo." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log("\n  SegundaMano Express está funcionando");
  console.log(`  En este computador:   http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  Desde el celular (misma red Wi-Fi):   http://${ip}:${PORT}`));
  console.log(`  Pagos: ${WOMPI.enabled ? `Wompi (${WOMPI.sandbox ? "sandbox de pruebas" : "producción"})` : "pasarela de pruebas (configura WOMPI_PUBLIC_KEY y WOMPI_INTEGRITY_SECRET para Wompi)"}`);
  console.log(`  Google: ${GOOGLE_CLIENT_ID ? "activado" : "desactivado (configura GOOGLE_CLIENT_ID)"}`);
  console.log("\n  Deja esta ventana abierta mientras la usan. Ctrl + C para apagar.\n");
});
