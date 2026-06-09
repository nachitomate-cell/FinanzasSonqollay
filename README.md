# Finanzas Sonqollay

**Contabilidad general** de la consultora **Sonqollay**: ingresos y egresos,
cotizaciones adjudicadas, gastos, flujo de caja, IVA estimado y facturación en
**CLP**. PWA instalable que funciona **offline** y, opcionalmente, sincroniza en
la nube con **Firebase**.

Parte del ecosistema Sonqollay junto a *Aura BIM* (`dbsonqollay`) y *SonqollayAPP*
(CRM/cotizaciones). Comparte la marca: naranja `#F77000` + gris pizarra `#586878`.

## Funcionalidades

- **Movimientos** (ABM): ingreso/egreso con fecha, monto CLP, categoría,
  contraparte (cliente/proveedor), documento (factura/boleta), medio de pago,
  estado (Pagado/Cobrado o Pendiente), **fecha de vencimiento** (cobro/pago) y
  marca de **afecto a IVA (19%)**.
- **Comprobantes con cámara**: adjuntá la foto de la boleta/factura al
  movimiento (se comprime en el dispositivo). Para uso en terreno: registrás el
  gasto y le tomas la foto en el momento. Indicador 📎 en la lista y visor a
  pantalla completa.
- **Recordatorios de cobros/pagos**: tablero de pendientes vencidos / por vencer
  y **notificaciones** (locales en el navegador, o **push FCM** en Modo nube).
- **Categorías personalizables**: crear, renombrar, recolorear, ocultar y
  eliminar categorías por tipo (⚙ en la vista *Por categoría*).
- **Resumen** mensual: ingresos, egresos, balance neto, por cobrar/pagar e
  **IVA estimado** (débito − crédito fiscal).
- **Flujo de caja anual**: 12 meses del año con totales (ingresos/egresos/balance).
- **Por categoría**: desglose porcentual con el color de cada categoría.
- **Búsqueda global y filtros**: por tipo, estado y **alcance** (mes / año /
  todo el historial / **rango de fechas** personalizado).
- **Multimoneda en vivo (Dólar / UF)**: ticker con el **dólar observado** y la
  **UF** del día (fuente [mindicador.cl](https://mindicador.cl), valores
  oficiales que se publican una vez al día; se cachean para uso offline). Puedes
  cargar un movimiento en **USD** o **UF** y se **convierte y guarda en CLP**
  automáticamente (se conserva la moneda, el monto original y el tipo de cambio
  usado). Los KPIs muestran su equivalente en USD/UF.
- **Exportación**: **CSV**, **Excel (.xlsx)** y **PDF** (reporte con resumen,
  tipo de cambio del día y tabla), respetando el período/alcance seleccionado.
- **Registro rápido (2 toques)**: botón flotante → teclado numérico grande +
  chips de categoría para anotar un gasto en segundos. Atajos del ícono PWA
  ("Nuevo gasto" / "Nuevo ingreso") y **swipe** en la lista (deslizar → marcar
  pagado/cobrado o eliminar).
- **Movimientos recurrentes**: sueldos, arriendo, suscripciones que se generan
  solos cada mes (o "repetir hoy" con un toque). Ajustes → Recurrentes.
- **Presupuestos por categoría**: monto mensual con barra de avance y alerta al
  superarlo. Se define con 💰 en el gestor de categorías.
- **Bloqueo con PIN / huella**: pantalla de bloqueo al abrir y auto-bloqueo al
  volver tras 30 s; PIN (hash SHA-256) y biometría (WebAuthn). Ajustes → Seguridad.
- **Suite de notificaciones**: vencimientos, **resumen semanal**, **recordatorio
  F29/IVA** (con el monto) y **alerta de presupuesto**; locales en el navegador y
  **push FCM** en Modo nube (Cloud Functions `weeklySummary`, `monthlyF29Reminder`).
  Se configuran en Ajustes → Notificaciones.
- **PWA**: instalable en escritorio/móvil, app shell cacheada para uso offline.

## Modo de datos

| Modo | Cuándo | Dónde viven los datos |
|------|--------|-----------------------|
| **Local** (por defecto) | Sin configurar nada | `localStorage` del navegador |
| **Nube** (opcional) | Al crear `firebase-config.js` | Firestore `users/{uid}/{movimientos,categorias,fcmTokens}` |

Sin configuración funciona de inmediato en **Modo local** (indicador en el
sidebar). El badge pasa a **"Nube (Firebase)"** cuando detecta credenciales.
Las **fotos de comprobantes** se guardan comprimidas (JPEG, base64) dentro del
movimiento en ambos modos.

## Correr local

```bash
# cualquier servidor estático sirve; por ejemplo:
python -m http.server 8080
# abrir http://localhost:8080
```

> Abrir el `index.html` con `file://` no registra el service worker ni el
> import dinámico; usa un servidor local.

## Activar sincronización en la nube (opcional)

1. Firebase Console → crear proyecto → agregar **App web** y copiar el config.
2. Editar **`firebase-config.js`** y reemplazar `firebaseConfig = null` por el
   objeto con tus valores. (La config web de Firebase no es secreta, por eso se
   versiona; la seguridad va por las reglas de Firestore.)
3. **Authentication** → habilitar el método **Anónimo**.
4. **Firestore Database** → crear, y publicar las reglas de `firestore.rules`.

## Deploy (Firebase Hosting)

`firebase.json` y `.firebaserc` ya vienen configurados (proyecto
`finanzas-sonqollay`, ajusta el nombre si usas otro).

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only hosting
firebase deploy --only firestore:rules
```

## Recordatorios push (FCM) — opcional, solo Modo nube

Los recordatorios funcionan como **notificación local** del navegador sin nada
extra (botón 🔔). Para **push real** que llegue aunque la app esté cerrada:

1. Copiar `firebase-config-compat.js` desde `firebase-config-compat.example.js`
   (mismos valores; está en `.gitignore`).
2. Firebase Console → **Cloud Messaging** → *Web Push certificates* → copiar la
   **VAPID key** en `VAPID_KEY` de `firebase-config.js`.
3. Desplegar las Cloud Functions (proyecto en plan **Blaze**):
   ```bash
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```
   La función `dailyDueReminders` corre **todos los días 09:00 (America/Santiago)**
   y envía un push consolidado de cobros/pagos vencidos o por vencer (3 días).

## Estructura

```
index.html              UI (sidebar + topbar + vistas + modales)
styles.css              estilos de marca Sonqollay
app.js                  lógica + capa de datos (local / Firebase)
sw.js                   service worker (offline)
firebase-messaging-sw.js     service worker de FCM (push)
manifest.webmanifest    PWA
firebase-config.example.js · firebase-config-compat.example.js   plantillas
firestore.rules         reglas de seguridad (datos por usuario)
firebase.json / .firebaserc  hosting + firestore + functions
functions/              Cloud Function de recordatorios (dailyDueReminders)
icon-*.png              iconos de marca (192/512 + maskable) y apple-touch-icon
```
