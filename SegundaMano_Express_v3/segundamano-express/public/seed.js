/* SegundaMano Express — datos de demostración.
 * Lo usan el servidor (Node) y la página cuando se abre sin servidor.
 * hashFn(clave) devuelve la contraseña cifrada que guarda cada modo. */
(function (root) {
  "use strict";
  function seed(hashFn) {
    const D = 86400000, t = Date.now();
    const H = (p) => hashFn(p);
    return {
      seq: 100,
      users: [
        { id: 1, name: "Ana Gómez", email: "ana@ejemplo.com", phone: "3001234567", pass: H("demo1234"), city: "Bogotá", role: "V", admin: false, suspended: false, favs: [], since: t - 60 * D },
        { id: 2, name: "Luis Herrera", email: "luis@ejemplo.com", phone: "3109876543", pass: H("demo1234"), city: "Bogotá", role: "C", admin: false, suspended: false, favs: [], since: t - 45 * D },
        { id: 3, name: "Usuario de Prueba", email: "prueba1@ejemplo.com", phone: "3205551234", pass: H("demo1234"), city: "Bogotá", role: "V", admin: false, suspended: false, favs: [], since: t - 20 * D },
        { id: 4, name: "Administración", email: "admin@segundamano.co", phone: "", pass: H("admin1234"), city: "Bogotá", role: "A", admin: true, suspended: false, favs: [], since: t - 90 * D },
        { id: 5, name: "Marta Rojas", email: "marta@ejemplo.com", phone: "3154443322", pass: H("demo1234"), city: "Chía", role: "D", admin: false, suspended: false, favs: [], since: t - 30 * D },
      ],
      posts: [
        { id: 1, owner: 1, mode: "venta", title: "Bicicleta de montaña rin 29", desc: "Marco de aluminio, 21 cambios Shimano. Llantas nuevas y frenos revisados en septiembre.", cat: "Deportes", cond: "Usado - buen estado", price: 420000, city: "Bogotá", zone: "Suba", imgs: [], status: "activa", at: t - 2 * D },
        { id: 2, owner: 1, mode: "donacion", title: "Cuna de madera con colchón", desc: "Cuna en madera de pino, incluye colchón y protector. Mi hija ya no la usa.", cat: "Bebés", cond: "Usado - buen estado", price: 0, city: "Bogotá", zone: "Kennedy", imgs: [], status: "activa", at: t - 3 * D },
        { id: 3, owner: 1, mode: "venta", title: "Portátil Lenovo ThinkPad T480", desc: "Intel Core i5, 16 GB de RAM y disco SSD de 256 GB. Batería dura unas 4 horas.", cat: "Tecnología", cond: "Usado - como nuevo", price: 950000, city: "Bogotá", zone: "Chapinero", imgs: [], status: "activa", at: t - 1 * D },
        { id: 4, owner: 5, mode: "donacion", title: "Libros de cálculo y física", desc: "Stewart (Cálculo de una variable) y Serway (Física, tomo 1). Con algunas notas a lápiz.", cat: "Libros", cond: "Usado - con detalles", price: 0, city: "Chía", zone: "Centro", imgs: [], status: "activa", at: t - 5 * D },
        { id: 5, owner: 3, mode: "venta", title: "Sofá de dos puestos", desc: "Tela gris, 1,60 m de ancho. Sin manchas. Se entrega en el barrio.", cat: "Hogar", cond: "Usado - buen estado", price: 380000, city: "Bogotá", zone: "Engativá", imgs: [], status: "activa", at: t - 4 * D },
        { id: 6, owner: 5, mode: "donacion", title: "Chaquetas de invierno talla M", desc: "Tres chaquetas impermeables en buen estado, ideales para el frío de la Sabana.", cat: "Ropa", cond: "Usado - buen estado", price: 0, city: "Chía", zone: "Bojacá", imgs: [], status: "activa", at: t - 6 * D },
        { id: 7, owner: 3, mode: "venta", title: "Silla de escritorio ergonómica", desc: "Soporte lumbar ajustable y brazos regulables. Ruedas en perfecto estado.", cat: "Hogar", cond: "Nuevo", price: 210000, city: "Bogotá", zone: "Usaquén", imgs: [], status: "activa", at: t - 8 * D },
        { id: 8, owner: 5, mode: "donacion", title: "Juego de ollas de acero", desc: "Cinco ollas con tapa. Funcionan en estufa de gas y eléctrica.", cat: "Hogar", cond: "Usado - buen estado", price: 0, city: "Chía", zone: "Centro", imgs: [], status: "activa", at: t - 9 * D },
        { id: 9, owner: 3, mode: "venta", title: "Guitarra acústica Yamaha C40", desc: "Incluye estuche blando y afinador. Cuerdas cambiadas hace un mes.", cat: "Música", cond: "Usado - buen estado", price: 300000, city: "Bogotá", zone: "Teusaquillo", imgs: [], status: "activa", at: t - 10 * D },
        { id: 10, owner: 3, mode: "venta", title: "Patineta completa", desc: "Tabla de arce, ejes de 8 pulgadas.", cat: "Deportes", cond: "Usado - con detalles", price: 150000, city: "Bogotá", zone: "Usaquén", imgs: [], status: "cerrada", at: t - 15 * D },
        { id: 11, owner: 1, mode: "venta", title: "Lámpara de pie", desc: "Lámpara de pie con pantalla de tela, 1,50 m.", cat: "Hogar", cond: "Usado - buen estado", price: 90000, city: "Bogotá", zone: "Suba", imgs: [], status: "cerrada", at: t - 12 * D },
        { id: 12, owner: 5, mode: "donacion", title: "Coche para bebé", desc: "Coche plegable con capota.", cat: "Bebés", cond: "Usado - buen estado", price: 0, city: "Chía", zone: "Centro", imgs: [], status: "cerrada", at: t - 20 * D },
        { id: 13, owner: 2, mode: "solicitud", title: "Silla de ruedas para adulto", desc: "Mi papá se operó la rodilla y necesita una silla de ruedas por unos meses. Puedo recogerla.", cat: "Hogar", cond: "", price: 0, city: "Bogotá", zone: "Bosa", imgs: [], status: "activa", at: t - 1.5 * D },
        { id: 14, owner: 2, mode: "solicitud", title: "Útiles escolares para dos niños", desc: "Cuadernos, colores y morrales para niños de primaria. Cualquier ayuda sirve.", cat: "Libros", cond: "", price: 0, city: "Soacha", zone: "Compartir", imgs: [], status: "activa", at: t - 2.5 * D },
      ],
      questions: [
        { id: 1, post: 1, author: 2, text: "¿La talla del marco sirve para alguien de 1,75 m?", answer: "Sí, el marco es talla M, va bien de 1,65 a 1,80 m.", at: t - 1.5 * D },
        { id: 2, post: 3, author: 3, text: "¿Tiene cargador original?", answer: null, at: t - 0.5 * D },
        { id: 3, post: 3, author: 2, text: "¿La batería se puede cambiar fácilmente?", answer: null, at: t - 0.4 * D },
        { id: 4, post: 3, author: 5, text: "¿Lo entregas en Chía o solo en Bogotá?", answer: null, at: t - 0.3 * D },
      ],
      convs: [
        { id: 1, post: 1, buyer: 2, seller: 1, shared: {}, msgs: [
          { from: 2, text: "Hola Ana, me interesa la bicicleta. ¿Podemos vernos el sábado?", at: t - 1.2 * D },
          { from: 1, text: "Claro, Luis. Puedo en el parque de Suba a las 10 a. m.", at: t - 1.1 * D },
        ] },
      ],
      requests: [{ id: 1, post: 2, requester: 2, status: "pendiente", at: t - 0.6 * D }],
      txs: [
        { id: 1, post: 11, seller: 1, buyer: 2, at: t - 7 * D },
        { id: 2, post: 10, seller: 3, buyer: 1, at: t - 14 * D },
        { id: 3, post: 12, seller: 5, buyer: 2, at: t - 18 * D },
      ],
      deliveries: [],
      reviews: [
        { id: 1, tx: 2, from: 1, to: 3, stars: 4, comment: "Todo bien con la entrega, muy puntual.", at: t - 13 * D },
        { id: 2, tx: 3, from: 2, to: 5, stars: 5, comment: "Marta fue muy amable, el coche estaba impecable.", at: t - 17 * D },
      ],
      notifs: [
        { id: 1, user: 1, kind: "solicitud", post: 2, text: "Luis Herrera solicitó tu donación “Cuna de madera con colchón”.", link: "mis-publicaciones", read: false, at: t - 0.6 * D },
        { id: 2, user: 1, kind: "pregunta", post: 3, text: "Usuario de Prueba preguntó en “Portátil Lenovo ThinkPad T480”.", link: "pub-3", read: false, at: t - 0.5 * D },
        { id: 3, user: 1, kind: "pregunta", post: 3, text: "Luis Herrera preguntó en “Portátil Lenovo ThinkPad T480”.", link: "pub-3", read: false, at: t - 0.4 * D },
        { id: 4, user: 1, kind: "pregunta", post: 3, text: "Marta Rojas preguntó en “Portátil Lenovo ThinkPad T480”.", link: "pub-3", read: false, at: t - 0.3 * D },
        { id: 5, user: 2, kind: "resena", post: 11, text: "Ya puedes calificar a Ana Gómez por “Lámpara de pie”.", link: "transacciones", read: false, at: t - 7 * D },
      ],
      reports: [{ id: 1, reporter: 1, type: "post", target: 9, reason: "Información falsa", comment: "La foto no corresponde al modelo C40.", status: "pendiente", action: null, at: t - 0.3 * D }],
      resets: [],
      mails: [],
    };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = seed;
  else root.SME_SEED = seed;
})(typeof self !== "undefined" ? self : this);
