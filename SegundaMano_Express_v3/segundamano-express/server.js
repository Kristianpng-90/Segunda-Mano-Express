/* SegundaMano Express — servidor para uso multiusuario.
 * Node.js 18 o superior, sin dependencias externas.
 * Sirve la página (carpeta public), guarda los datos en data/db.json y las fotos en data/uploads.
 * Uso: node server.js   (puerto 3000, o el que indique la variable PORT) */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const seed = require("./public/seed.js");
const core = require("./public/core.js");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOADS = path.join(DATA, "uploads");
const DB_FILE = path.join(DATA, "db.json");
fs.mkdirSync(UPLOADS, { recursive: true });

const COLLS = ["users", "posts", "questions", "convs", "requests", "txs", "deliveries", "reviews", "notifs", "reports"];
const SALT = "sme-umb-2026";
const hashPass = (p) => "s1$" + crypto.scryptSync(String(p), SALT, 32).toString("hex");

/* ---------- datos ---------- */
let store;
function fresh() { return { version: 1, epoch: Date.now(), db: seed(hashPass), sessions: {} }; }
try { store = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) { store = fresh(); }
for (const c of COLLS) store.db[c] = store.db[c] || [];
store.db.resets = store.db.resets || [];
store.sessions = store.sessions || {};
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

/* Estado público: nunca incluye contraseñas, sesiones ni códigos de recuperación */
function publicState() {
  const s = {};
  for (const c of COLLS) s[c] = store.db[c];
  s.users = store.db.users.map(({ pass, ...u }) => u);
  return { version: store.version, epoch: store.epoch, state: s };
}

/* ---------- utilidades HTTP ---------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too_big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("No encontrado"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": cache || "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
}
const who = (req) => { const t = req.headers["x-token"]; return t && store.sessions[t] ? store.db.users.find((u) => u.id === store.sessions[t]) : null; };
function startSession(uid) { const token = crypto.randomBytes(24).toString("hex"); store.sessions[token] = uid; return token; }

/* ---------- fusión de cambios enviados por cada navegador ---------- */
const msgKey = (m) => `${m.from}|${m.at}|${m.text}`;
function mergeRecord(coll, cur, inc) {
  for (const k of Object.keys(inc)) {
    if (coll === "convs" && k === "msgs" && Array.isArray(cur.msgs)) {
      const seen = new Set(cur.msgs.map(msgKey));
      inc.msgs.forEach((m) => { if (!seen.has(msgKey(m))) cur.msgs.push(m); });
      cur.msgs.sort((a, b) => a.at - b.at);
    } else if (coll === "convs" && k === "shared") cur.shared = Object.assign({}, cur.shared, inc.shared);
    else cur[k] = inc[k];
  }
}
function applyUpserts(user, upserts) {
  let changed = 0;
  for (const coll of COLLS) {
    const list = Array.isArray(upserts[coll]) ? upserts[coll] : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object" || raw.id == null) continue;
      const inc = Object.assign({}, raw);
      if (coll === "users") {
        // Cada persona solo cambia su propio perfil; el administrador puede suspender cuentas
        delete inc.pass; delete inc.email; delete inc.admin;
        if (inc.id !== user.id && !user.admin) continue;
        if (inc.id !== user.id) { const allowed = { id: inc.id, suspended: inc.suspended }; Object.keys(inc).forEach((k) => delete inc[k]); Object.assign(inc, allowed); }
        else delete inc.suspended;
      }
      const arr = store.db[coll];
      const cur = arr.find((x) => x.id === inc.id);
      if (cur) mergeRecord(coll, cur, inc);
      else if (coll !== "users") arr.push(inc);
      changed++;
    }
  }
  if (changed) bump();
}

/* ---------- rutas ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    if (p === "/api/state" && req.method === "GET") {
      const v = Number(url.searchParams.get("v"));
      if (v && v === store.version) return send(res, 200, { same: true, version: v, epoch: store.epoch });
      return send(res, 200, publicState());
    }
    if (p.startsWith("/api/") && req.method === "POST") {
      const body = await readBody(req, p === "/api/upload" ? 6 * 1024 * 1024 : 2 * 1024 * 1024);
      if (p === "/api/register") {
        const r = core.register(store.db, body, hashPass, newId);
        if (r.errors) return send(res, 400, { errors: r.errors });
        const token = startSession(r.user.id); bump();
        return send(res, 200, { uid: r.user.id, token, ...publicState() });
      }
      if (p === "/api/login") {
        const r = core.login(store.db, body.email, body.pass, hashPass);
        if (r.error) return send(res, 401, { error: r.error });
        const token = startSession(r.user.id); persist();
        return send(res, 200, { uid: r.user.id, token });
      }
      if (p === "/api/logout") { delete store.sessions[req.headers["x-token"]]; persist(); return send(res, 200, { ok: true }); }
      if (p === "/api/reset/request") { const r = core.resetRequest(store.db, body.email); persist(); return send(res, r.error ? 400 : 200, r); }
      if (p === "/api/reset/confirm") {
        const r = core.resetConfirm(store.db, body, hashPass);
        if (r.ok) { const u = store.db.users.find((x) => x.email === String(body.email).trim().toLowerCase()); Object.keys(store.sessions).forEach((t) => { if (store.sessions[t] === u.id) delete store.sessions[t]; }); }
        persist();
        return send(res, r.ok ? 200 : 400, r);
      }
      const u = who(req);
      if (!u) return send(res, 401, { error: "Tu sesión terminó. Inicia sesión de nuevo." });
      if (u.suspended) return send(res, 403, { error: "Esta cuenta está suspendida por moderación." });
      if (p === "/api/sync") { applyUpserts(u, body.upserts || {}); return send(res, 200, publicState()); }
      if (p === "/api/upload") {
        const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(body.data || ""));
        if (!m) return send(res, 400, { error: "La imagen no es válida." });
        const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
        fs.writeFileSync(path.join(UPLOADS, name), Buffer.from(m[2], "base64"));
        return send(res, 200, { url: "uploads/" + name });
      }
      if (p === "/api/demo-reset") {
        if (!u.admin) return send(res, 403, { error: "Solo el administrador puede restablecer los datos." });
        const keep = store.version; store = fresh(); store.version = keep + 1; persist();
        return send(res, 200, publicState());
      }
      return send(res, 404, { error: "Ruta no encontrada" });
    }
    if (p.startsWith("/uploads/")) {
      const f = path.join(UPLOADS, path.basename(p));
      return serveFile(res, f, "public, max-age=31536000, immutable");
    }
    let rel = decodeURIComponent(p === "/" ? "/index.html" : p);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    return serveFile(res, file);
  } catch (e) {
    if (e.message === "too_big") return send(res, 413, { error: "El archivo es demasiado grande." });
    console.error(e);
    return send(res, 500, { error: "Error en el servidor." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log("\n  SegundaMano Express está funcionando");
  console.log(`  En este computador:   http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  Desde el celular (misma red Wi-Fi):   http://${ip}:${PORT}`));
  console.log("\n  Deja esta ventana abierta mientras la usan. Ctrl + C para apagar.\n");
});
