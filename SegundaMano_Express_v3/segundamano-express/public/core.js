/* SegundaMano Express — reglas de cuentas compartidas por el servidor y la página.
 * HUI-01 registro e inicio de sesión · HUI-13 recuperación de contraseña. */
(function (root) {
  "use strict";
  const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const CODE_MINUTES = 15, MAX_TRIES = 3;

  function register(db, v, hashFn, newId) {
    const errors = {};
    const name = String(v.name || "").trim(), email = String(v.email || "").trim().toLowerCase();
    const pass = String(v.pass || ""), city = String(v.city || ""), role = String(v.role || "");
    const phone = String(v.phone || "").replace(/[\s-]/g, "");
    if (name.length < 3) errors.name = "Escribe tu nombre completo.";
    if (!email) errors.email = "Escribe tu correo electrónico.";
    else if (!EMAIL_OK.test(email)) errors.email = "El correo no tiene un formato válido (ejemplo: nombre@correo.com).";
    else if (db.users.some((u) => u.email === email)) errors.email = "Ya existe una cuenta con este correo. Inicia sesión o usa otro.";
    if (!pass) errors.pass = "Escribe una contraseña.";
    else if (pass.length < 8) errors.pass = "La contraseña debe tener al menos 8 caracteres.";
    if (!city) errors.city = "Selecciona tu ciudad o municipio.";
    if (!["C", "V", "D"].includes(role)) errors.role = "Elige con qué rol quieres empezar.";
    if (phone && !/^\+?\d{7,13}$/.test(phone)) errors.phone = "El teléfono solo puede tener números (7 a 13 dígitos).";
    if (Object.keys(errors).length) return { errors };
    const u = { id: newId(), name, email, phone, pass: hashFn(pass), city, role, admin: false, suspended: false, favs: [], since: Date.now() };
    db.users.push(u);
    return { user: u };
  }

  function login(db, email, pass, hashFn) {
    email = String(email || "").trim().toLowerCase();
    const u = db.users.find((x) => x.email === email && x.pass === hashFn(String(pass || "")));
    if (!u) return { error: "El correo o la contraseña no coinciden. Revisa los datos e intenta de nuevo." };
    if (u.suspended) return { error: "Esta cuenta está suspendida por moderación. Escribe a soporte para revisarla." };
    return { user: u };
  }

  /* Siempre responde igual, exista o no el correo, para no revelar qué cuentas existen.
   * "demo" es el correo simulado que la página muestra porque el prototipo no envía correos reales. */
  function resetRequest(db, email) {
    email = String(email || "").trim().toLowerCase();
    if (!EMAIL_OK.test(email)) return { error: "Escribe un correo válido (ejemplo: nombre@correo.com)." };
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.resets = (db.resets || []).filter((r) => r.email !== email);
    if (db.users.some((u) => u.email === email)) db.resets.push({ email, code, exp: Date.now() + CODE_MINUTES * 60000, tries: 0, blocked: false });
    return { ok: true, demo: { to: email, code, minutes: CODE_MINUTES } };
  }

  function resetConfirm(db, v, hashFn) {
    const email = String(v.email || "").trim().toLowerCase(), code = String(v.code || "").trim();
    const pass = String(v.pass || ""), pass2 = String(v.pass2 || "");
    const errors = {};
    if (!/^\d{6}$/.test(code)) errors.code = "Escribe el código de 6 dígitos que te llegó al correo.";
    if (!pass) errors.pass = "Escribe la nueva contraseña.";
    else if (pass.length < 8) errors.pass = "La contraseña debe tener al menos 8 caracteres.";
    if (pass && pass2 !== pass) errors.pass2 = "Las contraseñas no coinciden.";
    if (Object.keys(errors).length) return { errors };
    const r = (db.resets || []).find((x) => x.email === email);
    if (!r) return { errors: { code: "Código incorrecto. Solicita un código nuevo." } };
    if (r.blocked) return { errors: { code: "Este código se bloqueó por demasiados intentos. Solicita un código nuevo." }, blocked: true };
    if (Date.now() > r.exp) return { errors: { code: "El código venció (vale 15 minutos). Solicita uno nuevo." }, blocked: true };
    if (r.code !== code) {
      r.tries++;
      if (r.tries >= MAX_TRIES) { r.blocked = true; return { errors: { code: "Código incorrecto. Por seguridad bloqueamos el código: solicita uno nuevo." }, blocked: true }; }
      const left = MAX_TRIES - r.tries;
      return { errors: { code: `Código incorrecto. Te ${left === 1 ? "queda 1 intento" : `quedan ${left} intentos`}.` } };
    }
    const u = db.users.find((x) => x.email === email);
    u.pass = hashFn(pass);
    db.resets = db.resets.filter((x) => x !== r);
    return { ok: true };
  }

  const api = { register, login, resetRequest, resetConfirm, CODE_MINUTES, MAX_TRIES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SME_CORE = api;
})(typeof self !== "undefined" ? self : this);
