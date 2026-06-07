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
  estado (Pagado/Cobrado o Pendiente) y marca de **afecto a IVA (19%)**.
- **Resumen** mensual: ingresos, egresos, balance neto, por cobrar/pagar e
  **IVA estimado** (débito − crédito fiscal).
- **Flujo de caja**: comparativo de ingresos vs. egresos de los últimos 6 meses.
- **Por categoría**: desglose porcentual de ingresos y egresos del mes.
- **Navegación por mes** y **exportación a CSV** (Excel, separador `;`).
- **PWA**: instalable en escritorio/móvil, app shell cacheada para uso offline.

## Modo de datos

| Modo | Cuándo | Dónde viven los datos |
|------|--------|-----------------------|
| **Local** (por defecto) | Sin configurar nada | `localStorage` del navegador |
| **Nube** (opcional) | Al crear `firebase-config.js` | Firestore `users/{uid}/movimientos` |

Sin configuración funciona de inmediato en **Modo local** (indicador en el
sidebar). El badge pasa a **"Nube (Firebase)"** cuando detecta credenciales.

## Correr local

```bash
# cualquier servidor estático sirve; por ejemplo:
python -m http.server 8080
# abrir http://localhost:8080
```

> Abrir el `index.html` con `file://` no registra el service worker ni el
> import dinámico; usá un servidor local.

## Activar sincronización en la nube (opcional)

1. Firebase Console → crear proyecto → agregar **App web** y copiar el config.
2. Copiar `firebase-config.example.js` como **`firebase-config.js`** y pegar los
   valores. (Está en `.gitignore`, no se sube al repo.)
3. **Authentication** → habilitar el método **Anónimo**.
4. **Firestore Database** → crear, y publicar las reglas de `firestore.rules`.

## Deploy (Firebase Hosting)

`firebase.json` y `.firebaserc` ya vienen configurados (proyecto
`finanzas-sonqollay`, ajustá el nombre si usás otro).

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only hosting
firebase deploy --only firestore:rules
```

## Estructura

```
index.html              UI (sidebar + topbar + vistas + modal)
styles.css              estilos de marca Sonqollay
app.js                  lógica + capa de datos (local / Firebase)
sw.js                   service worker (offline)
manifest.webmanifest    PWA
firebase-config.example.js   plantilla de credenciales
firestore.rules         reglas de seguridad (datos por usuario)
firebase.json / .firebaserc  hosting + firestore
logo.png                logo de marca
```
