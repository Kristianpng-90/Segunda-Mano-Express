/* SegundaMano Express — reglas de cuentas compartidas por el servidor y la página.
 * HUI-01 registro e inicio de sesión · HUI-13 recuperación de contraseña.
 * Validación estricta de correo, contraseñas seguras y mensajes claros. */
(function (root) {
  "use strict";
  /* Correo: usuario con letras, números y . _ % + - (sin puntos seguidos ni al inicio o final), dominio con extensión de 2+ letras */
  const EMAIL_OK = /^[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
  const validEmail = (e) => typeof e === "string" && e.length <= 254 && e.split("@")[0].length <= 64 && EMAIL_OK.test(e);
  const CODE_MINUTES = 15, MAX_TRIES = 3;
  const COMMON = ["12345678", "123456789", "1234567890", "password", "password1", "password123", "contraseña", "contrasena", "contrasena1", "qwerty123", "qwertyui", "abc12345", "abcd1234", "11111111", "00000000", "iloveyou", "colombia1", "colombia123", "segundamano", "admin123", "admin1234", "1q2w3e4r", "asdf1234", "passw0rd", "demo1234", "bogota123", "teamo123", "12341234", "qwerty12"];

  /* Contraseña segura: 8 a 64 caracteres, letras y números, no común y sin el usuario del correo */
  function passwordError(pass, email) {
    pass = String(pass || "");
    if (!pass) return "Escribe una contraseña.";
    if (pass.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    if (pass.length > 64) return "La contraseña puede tener máximo 64 caracteres.";
    if (!/[a-zA-ZñÑáéíóúÁÉÍÓÚ]/.test(pass) || !/\d/.test(pass)) return "La contraseña debe combinar letras y números.";
    if (/^(.)\1+$/.test(pass) || COMMON.includes(pass.toLowerCase())) return "Esa contraseña es muy común y fácil de adivinar. Elige otra.";
    const local = String(email || "").split("@")[0].toLowerCase();
    if (local.length >= 4 && pass.toLowerCase().includes(local)) return "La contraseña no puede contener tu correo.";
    return "";
  }

  function register(db, v, hashFn, newId) {
    const errors = {};
    const name = String(v.name || "").trim().replace(/\s+/g, " "), email = String(v.email || "").trim().toLowerCase();
    const pass = String(v.pass || ""), city = String(v.city || ""), role = String(v.role || "");
    const phone = String(v.phone || "").replace(/[\s-]/g, "");
    if (name.length < 3) errors.name = "Escribe tu nombre completo.";
    else if (name.length > 60 || !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]+$/.test(name)) errors.name = "El nombre solo puede tener letras y espacios.";
    if (!email) errors.email = "Escribe tu correo electrónico.";
    else if (!validEmail(email)) errors.email = "El correo no tiene un formato válido (ejemplo: nombre@correo.com).";
    else if (db.users.some((u) => u.email === email)) errors.email = "Ya existe una cuenta con este correo. Inicia sesión, usa “Continuar con Google” o recupera tu contraseña.";
    const pe = passwordError(pass, email);
    if (pe) errors.pass = pe;
    if (v.pass2 !== undefined && !pe && String(v.pass2) !== pass) errors.pass2 = "Las contraseñas no coinciden.";
    if (!city) errors.city = "Selecciona tu ciudad o municipio.";
    if (!["C", "V", "D"].includes(role)) errors.role = "Elige con qué rol quieres empezar.";
    if (phone && !/^\+?\d{7,13}$/.test(phone)) errors.phone = "El teléfono solo puede tener números (7 a 13 dígitos).";
    if (Object.keys(errors).length) return { errors };
    const u = { id: newId(), name, email, phone, pass: hashFn(pass), city, role, admin: false, suspended: false, favs: [], cart: [], since: Date.now() };
    db.users.push(u);
    return { user: u };
  }

  /* verifyFn(clave, guardada) → true/false. Mismo mensaje si el correo no existe o la clave está mal (no revela cuentas). */
  function login(db, email, pass, verifyFn) {
    email = String(email || "").trim().toLowerCase();
    if (!email) return { error: "Escribe tu correo electrónico.", field: "email" };
    if (!validEmail(email)) return { error: "El correo no tiene un formato válido (ejemplo: nombre@correo.com).", field: "email" };
    if (!pass) return { error: "Escribe tu contraseña.", field: "pass" };
    const u = db.users.find((x) => x.email === email);
    if (u && !u.pass && u.google) return { error: "Esta cuenta se creó con Google. Usa “Continuar con Google” o crea una contraseña en “¿Olvidaste tu contraseña?”." };
    if (!u || !verifyFn(String(pass), u.pass)) return { error: "El correo o la contraseña no coinciden. Revisa los datos e intenta de nuevo.", failed: true };
    if (u.suspended) return { error: "Esta cuenta está suspendida por moderación. Escribe a soporte para revisarla." };
    return { user: u };
  }

  /* Siempre responde igual, exista o no el correo, para no revelar qué cuentas existen.
   * "demo" es el correo simulado que la página muestra porque el prototipo no envía correos reales. */
  function resetRequest(db, email) {
    email = String(email || "").trim().toLowerCase();
    if (!validEmail(email)) return { error: "Escribe un correo válido (ejemplo: nombre@correo.com)." };
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
    const pe = passwordError(pass, email);
    if (pe) errors.pass = pe === "Escribe una contraseña." ? "Escribe la nueva contraseña." : pe;
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

  const api = { register, login, resetRequest, resetConfirm, passwordError, validEmail, CODE_MINUTES, MAX_TRIES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SME_CORE = api;
})(typeof self !== "undefined" ? self : this);
