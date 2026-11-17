# SegundaMano Express — Sprints 1, 2 y 3

Prototipo funcional de Patrones y Metodologías (UMB). Incluye las 13 historias de usuario, funciona en el celular como una web normal (con cámara para las fotos) y lo pueden usar varias personas al mismo tiempo, cada una desde su dispositivo.

## Qué trae

| Sprint | Historias |
|---|---|
| 1 y 2 | HUI 1 registro y rol · HUI 2 publicar · HUI 3 catálogo y búsqueda · HUI 4 chat · HUI 5 solicitudes de donación · HUI 6 preguntas públicas · HUI 7 reseñas · HUI 8 notificaciones · HUI 9 reportes y moderación |
| 3 | **HUI 10** editar, pausar, reactivar y eliminar publicaciones · **HUI 11** lista de favoritos · **HUI 12** estado de la entrega (Acordada → Entregada, cancelación con motivo) · **HUI 13** recuperar la contraseña con código de 6 dígitos |
| Extra | Uso desde el celular (menú, formularios y chat adaptados) · botón **📷 Tomar foto** que abre la cámara · hasta 4 fotos por publicación con galería · se puede **instalar como app** · **multiusuario**: todos ven los mismos datos y el chat se actualiza solo |

## Cuentas de demostración

| Rol | Correo | Contraseña |
|---|---|---|
| Vendedora | ana@ejemplo.com | demo1234 |
| Comprador | luis@ejemplo.com | demo1234 |
| Donante | marta@ejemplo.com | demo1234 |
| Vendedor | prueba1@ejemplo.com | demo1234 |
| Administrador | admin@segundamano.co | admin1234 |

Cualquier persona puede crear su propia cuenta en **Crear cuenta**.

## Opción 1 — En un computador, para usarla entre varios con la misma red Wi-Fi

1. Instala **Node.js** (versión LTS) desde https://nodejs.org si no lo tienes.
2. Descomprime la carpeta.
3. Windows: doble clic en **iniciar-windows.bat**. Mac o Linux: abre una terminal en la carpeta y ejecuta `./iniciar-mac-linux.sh` (o `node server.js`).
4. Se abre la página en `http://localhost:3000`. En la ventana negra aparece otra dirección como `http://192.168.1.25:3000`: ábrela desde los celulares conectados **al mismo Wi-Fi**.
5. Deja la ventana abierta mientras la usan. Los datos quedan guardados en la carpeta `data`.

Si Windows pregunta por el firewall, elige **Permitir acceso** para que los celulares puedan entrar.

## Opción 2 — Publicarla en internet (cualquier persona, desde cualquier red, con https)

Con https además se puede **instalar como app** en el celular.

1. Sube la carpeta a un repositorio de GitHub (por ejemplo `Kristianpng-90/segundamano-express`).
2. Entra a https://render.com con tu cuenta de GitHub → **New → Web Service** → elige el repositorio.
3. Configura: Runtime **Node**, Build command: *(vacío)*, Start command: `node server.js`, plan **Free**.
4. Render te da una dirección como `https://segundamano-express.onrender.com`. Esa es la que comparten.

Ten en cuenta que en el plan gratuito de Render la página se "duerme" después de 15 minutos sin uso (la primera visita tarda unos 50 segundos en despertar) y los datos nuevos se borran cuando se reinicia; vuelven los datos de demostración. Para la presentación, ábrela unos minutos antes.

## Opción 3 — Solo abrir el archivo

Doble clic en `public/index.html`. Funciona completa, pero en **modo local**: los datos se guardan solo en ese navegador y no se comparten. Abajo, en el pie de página, siempre dice en qué modo está.

## Probar las historias del Sprint 3 (escenarios Gherkin)

- **HUI 10:** entra como Ana → Mis publicaciones → **Editar** en la bicicleta → precio `380000` → Guardar → "Publicación actualizada". Con `abc` sale "El precio solo puede tener números…". También están **Pausar**, **Reactivar** y **Eliminar** (pide confirmación).
- **HUI 11:** entra como Luis → toca el corazón ♡ de la guitarra → el contador de **♥ Favoritos** muestra 1. Sin sesión, el corazón lleva a iniciar sesión y, al entrar, la guitarra queda guardada.
- **HUI 12:** Ana abre el chat con Luis → **Acordar entrega** (fecha y lugar) → Ana pulsa **Entregué** y Luis pulsa **Recibí** (en **Entregas**) → queda **Entregada** y Luis ve **Calificar** en Mis compras. Para el escenario alternativo, cualquiera pulsa **Cancelar entrega**, escribe el motivo y la publicación vuelve al catálogo.
- **HUI 13:** en Iniciar sesión → **¿Olvidaste tu contraseña?** → correo `luis@ejemplo.com` → el código aparece en el **correo de demostración** (el prototipo no envía correos reales) → nueva contraseña `nueva1234` dos veces → "Contraseña actualizada". Tres códigos incorrectos bloquean el código.

## Archivos

```
server.js            servidor (Node 18+, sin instalar paquetes)
public/index.html    la aplicación
public/core.js       reglas de cuentas y recuperación (las usan el servidor y la página)
public/seed.js       datos de demostración
public/sw.js, manifest.webmanifest, icons/   instalación como app
data/                se crea solo: base de datos (db.json) y fotos subidas
```

El administrador puede restablecer los datos de demostración con el botón del pie de página.
