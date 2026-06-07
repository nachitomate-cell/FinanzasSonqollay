/* ===========================================================================
   Finanzas Sonqollay — contabilidad general de la consultora
   Vanilla JS · datos en localStorage (Modo local) o Firebase Firestore (nube).
   =========================================================================== */

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const fmt = (n) => CLP.format(Math.round(n || 0));
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// Categorías por defecto (se siembran como registros editables en el store)
const CATEGORIAS = {
  ingreso: ['Cotización adjudicada', 'Servicios de ingeniería', 'Consultoría', 'Licencias / SaaS', 'Reembolsos', 'Otros ingresos'],
  egreso:  ['Sueldos y honorarios', 'Infraestructura (APS/DB/Hosting)', 'Software y licencias', 'Impuestos', 'Oficina y servicios', 'Marketing', 'Viáticos', 'Otros egresos'],
};
const PALETTE = ['#F77000','#15a35b','#586878','#c98a00','#7c5cff','#0ea5e9','#e0413f','#0d9488','#db2777','#65a30d'];
const DEFAULT_CATS = [
  ...CATEGORIAS.ingreso.map((nombre, i) => ({ nombre, tipo: 'ingreso', color: PALETTE[i % PALETTE.length], oculta: false })),
  ...CATEGORIAS.egreso.map((nombre, i) => ({ nombre, tipo: 'egreso', color: PALETTE[i % PALETTE.length], oculta: false })),
];

// ── Estado ──────────────────────────────────────────────────────────────────
const state = {
  view: 'dashboard',
  ref: new Date(),          // mes/año en foco
  movimientos: [],
  categorias: [],
  search: '',
  filterTipo: 'todos',
  filterEstado: 'todos',
  scope: 'mes',             // mes | anio | rango | todo
  desde: '',
  hasta: '',
  recurrentes: [],
};
let movStore, catStore, recStore;

// Preferencias locales (notificaciones, bloqueo)
const PREFS_KEY = 'finanzas_prefs';
const prefs = Object.assign({ nDue: true, nWeekly: true, nF29: true, nBudget: true }, (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } })());
const savePrefs = () => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));

// ── Capa de datos (adapter genérico por colección) ───────────────────────────
let backend = null;

const LocalBackend = {
  collection(name) {
    const KEY = 'finanzas_' + name;
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
    const write = (arr) => localStorage.setItem(KEY, JSON.stringify(arr));
    let onChange = () => {};
    return {
      async init(cb) { onChange = cb; cb(read()); },
      async add(obj) { const a = read(); a.push({ ...obj, id: name[0] + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) }); write(a); onChange(read()); },
      async update(id, obj) { write(read().map(m => m.id === id ? { ...m, ...obj } : m)); onChange(read()); },
      async remove(id) { write(read().filter(m => m.id !== id)); onChange(read()); },
    };
  },
};

async function makeFirebaseBackend() {
  let config, VAPID_KEY;
  try { ({ firebaseConfig: config, VAPID_KEY } = await import('./firebase-config.js')); }
  catch { return null; }
  if (!config || !config.apiKey) return null; // sin credenciales → Modo local

  const APP = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const AUTH = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const FS = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  const app = APP.initializeApp(config);
  const auth = AUTH.getAuth(app);
  const db = FS.getFirestore(app);
  const uid = await new Promise((res, rej) => AUTH.onAuthStateChanged(auth, u => u ? res(u.uid) : AUTH.signInAnonymously(auth).catch(rej)));

  return {
    isCloud: true,
    collection(name) {
      const col = FS.collection(db, 'users', uid, name);
      return {
        async init(cb) { FS.onSnapshot(col, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))); },
        async add(obj) { await FS.addDoc(col, { ...obj, createdAt: FS.serverTimestamp() }); },
        async update(id, obj) { await FS.updateDoc(FS.doc(col, id), obj); },
        async remove(id) { await FS.deleteDoc(FS.doc(col, id)); },
      };
    },
    async enablePush() {
      if (!VAPID_KEY) throw new Error('sin VAPID');
      const MSG = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js');
      const messaging = MSG.getMessaging(app);
      const reg = await navigator.serviceWorker.getRegistration() || await navigator.serviceWorker.register('./firebase-messaging-sw.js');
      const token = await MSG.getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
      if (token) await FS.setDoc(FS.doc(db, 'users', uid, 'fcmTokens', token), { token, ua: navigator.userAgent, createdAt: FS.serverTimestamp() });
      MSG.onMessage(messaging, (p) => toast(p?.notification?.title || 'Recordatorio'));
    },
  };
}

// ── Utilidades de fecha ───────────────────────────────────────────────────────
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const addDays = (str, n) => { const d = new Date(str + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const ddmm = (str) => { const d = new Date(str + 'T00:00:00'); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; };

// ── Indicadores en vivo (Dólar observado / UF) · mindicador.cl ────────────────
const INDIC_KEY = 'finanzas_indicadores';
const indic = { dolar: null, uf: null, fechaDolar: '', fechaUf: '' };
const rate = (moneda) => moneda === 'USD' ? indic.dolar : moneda === 'UF' ? indic.uf : 1;
const nf = (dec) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: dec, minimumFractionDigits: dec });
const eqUSD = (clp) => indic.dolar ? 'US$ ' + nf(0).format(clp / indic.dolar) : '—';
const eqUF  = (clp) => indic.uf ? 'UF ' + nf(1).format(clp / indic.uf) : '—';
const fmtFX = (n) => '$' + nf(2).format(n); // tipo de cambio con 2 decimales

async function loadIndicadores() {
  try { Object.assign(indic, JSON.parse(localStorage.getItem(INDIC_KEY)) || {}); } catch {}
  try {
    const j = await (await fetch('https://mindicador.cl/api', { cache: 'no-store' })).json();
    if (j.dolar) { indic.dolar = j.dolar.valor; indic.fechaDolar = (j.dolar.fecha || '').slice(0, 10); }
    if (j.uf)    { indic.uf = j.uf.valor;       indic.fechaUf = (j.uf.fecha || '').slice(0, 10); }
    localStorage.setItem(INDIC_KEY, JSON.stringify(indic));
  } catch { /* offline: usa el último valor cacheado */ }
  if (state.view === 'dashboard') render();
  if (!modal.hidden) updateConvHint();
}
function tickerHTML() {
  return `<div class="ticker" id="ticker" title="Tocar para actualizar">
    <div class="tk"><span class="lbl">USD</span> <b>${indic.dolar ? fmtFX(indic.dolar) : '—'}</b></div>
    <div class="tk uf"><span class="lbl">UF</span> <b>${indic.uf ? fmtFX(indic.uf) : '—'}</b></div>
    <span class="tk-date">${indic.fechaUf ? 'al ' + ddmm(indic.fechaUf) : 'sin conexión'}</span>
  </div>`;
}

// ── Selectores derivados ──────────────────────────────────────────────────────
const inMonth = (m, y, mo) => { const x = new Date(m.fecha + 'T00:00:00'); return x.getFullYear() === y && x.getMonth() === mo; };
const monthMovs = () => state.movimientos.filter(m => inMonth(m, state.ref.getFullYear(), state.ref.getMonth()));
const sum = (arr) => arr.reduce((a, m) => a + Number(m.monto || 0), 0);

// Movimientos según el alcance (period scope) elegido en la vista Movimientos
function scopeMovs() {
  const y = state.ref.getFullYear(), mo = state.ref.getMonth();
  return state.movimientos.filter(m => {
    const d = m.fecha || '';
    if (state.scope === 'mes')   return inMonth(m, y, mo);
    if (state.scope === 'anio')  return d.slice(0, 4) === String(y);
    if (state.scope === 'rango') return (!state.desde || d >= state.desde) && (!state.hasta || d <= state.hasta);
    return true; // todo
  });
}

function monthTotals(movs) {
  const tIn  = sum(movs.filter(m => m.tipo === 'ingreso' && m.estado !== 'pendiente'));
  const tOut = sum(movs.filter(m => m.tipo === 'egreso'  && m.estado !== 'pendiente'));
  const porCobrar = sum(movs.filter(m => m.tipo === 'ingreso' && m.estado === 'pendiente'));
  const porPagar  = sum(movs.filter(m => m.tipo === 'egreso'  && m.estado === 'pendiente'));
  const ivaDebito  = movs.filter(m => m.tipo === 'ingreso' && m.iva).reduce((a, m) => a + Number(m.monto) * 0.19 / 1.19, 0);
  const ivaCredito = movs.filter(m => m.tipo === 'egreso'  && m.iva).reduce((a, m) => a + Number(m.monto) * 0.19 / 1.19, 0);
  return { tIn, tOut, balance: tIn - tOut, porCobrar, porPagar, iva: ivaDebito - ivaCredito };
}

// Recordatorios: pendientes con fecha de vencimiento
function reminders() {
  const today = todayStr(), lim = addDays(today, 7);
  const pend = state.movimientos.filter(m => m.estado === 'pendiente' && m.vence);
  return {
    venc: pend.filter(m => m.vence < today).sort((a, b) => a.vence.localeCompare(b.vence)),
    prox: pend.filter(m => m.vence >= today && m.vence <= lim).sort((a, b) => a.vence.localeCompare(b.vence)),
  };
}

// Categorías
const visibleCats = (tipo) => { const l = state.categorias.filter(c => c.tipo === tipo && !c.oculta); return l.length ? l : DEFAULT_CATS.filter(c => c.tipo === tipo); };
const catColor = (nombre) => state.categorias.find(c => c.nombre === nombre)?.color || 'var(--steel)';

// ── Render ────────────────────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const content = $('#content');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render() {
  $('#periodLabel').textContent = `${MESES[state.ref.getMonth()]} ${state.ref.getFullYear()}`;
  document.querySelectorAll('.nav-item, .bn-item').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  ({ dashboard: renderDashboard, movimientos: renderMovimientos, flujo: renderFlujo, categorias: renderCategorias }[state.view])();
}

function renderDashboard() {
  const movs = monthMovs();
  const t = monthTotals(movs);
  const recientes = [...movs].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 6);
  const rem = reminders();

  content.innerHTML = `
    ${tickerHTML()}
    <div class="kpis">
      <div class="kpi income"><div class="label"><span class="tag"></span>Ingresos del mes</div><div class="value">${fmt(t.tIn)}</div><div class="sub">≈ ${eqUSD(t.tIn)} · ${eqUF(t.tIn)}</div></div>
      <div class="kpi expense"><div class="label"><span class="tag"></span>Egresos del mes</div><div class="value">${fmt(t.tOut)}</div><div class="sub">≈ ${eqUSD(t.tOut)} · ${eqUF(t.tOut)}</div></div>
      <div class="kpi balance"><div class="label"><span class="tag"></span>Balance neto</div><div class="value" style="color:${t.balance>=0?'var(--income)':'var(--expense)'}">${fmt(t.balance)}</div><div class="sub">≈ ${eqUSD(t.balance)} · ${eqUF(t.balance)}</div></div>
      <div class="kpi pending"><div class="label"><span class="tag"></span>Por cobrar</div><div class="value" style="color:var(--warn)">${fmt(t.porCobrar)}</div><div class="sub">Por pagar: ${fmt(t.porPagar)}</div></div>
    </div>

    ${(rem.venc.length || rem.prox.length) ? `
    <div class="card rem-card">
      <div class="row-between" style="margin-bottom:6px"><h3>Recordatorios</h3><span class="sub" style="color:var(--muted);font-size:12.5px">${rem.venc.length} vencido(s) · ${rem.prox.length} por vencer</span></div>
      ${[...rem.venc, ...rem.prox].slice(0, 6).map(m => {
        const venc = m.vence < todayStr();
        const cobro = m.tipo === 'ingreso';
        return `<div class="rem-item" data-id="${m.id}">
          <span class="rem-when ${venc?'venc':'prox'}">${venc?'Vencido':'Vence'} ${ddmm(m.vence)}</span>
          <div class="rem-main"><b>${cobro?'Cobrar':'Pagar'}: ${esc(m.descripcion || m.categoria)}</b><span>${esc(m.contraparte || m.categoria)}</span></div>
          <span class="rem-amt" style="color:${cobro?'var(--income)':'var(--expense)'}">${fmt(m.monto)}</span>
        </div>`;
      }).join('')}
    </div>` : ''}

    <div class="card">
      <div class="row-between"><h3>IVA del mes (estimado)</h3><span class="sub" style="color:var(--muted);font-size:12.5px">Débito − crédito fiscal</span></div>
      <div style="font-size:22px;font-weight:700;color:${t.iva>=0?'var(--ink)':'var(--income)'}">${fmt(t.iva)} ${t.iva>=0?'<span style="font-size:13px;color:var(--muted);font-weight:500">a pagar</span>':'<span style="font-size:13px;color:var(--income);font-weight:500">a favor</span>'}</div>
    </div>

    <div class="card">
      <div class="row-between" style="margin-bottom:8px"><h3>Movimientos recientes</h3><button class="btn-ghost sm" id="goMovs">Ver todos</button></div>
      ${recientes.length ? itemsHTML(recientes) : emptyHTML('Sin movimientos este mes')}
    </div>`;

  $('#goMovs')?.addEventListener('click', () => go('movimientos'));
  $('#ticker')?.addEventListener('click', () => { toast('Actualizando indicadores…'); loadIndicadores(); });
  wireRows();
}

function renderMovimientos() {
  let movs = scopeMovs();
  if (state.filterTipo !== 'todos') movs = movs.filter(m => m.tipo === state.filterTipo);
  if (state.filterEstado !== 'todos') movs = movs.filter(m => (m.estado || 'pagado') === state.filterEstado);
  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    movs = movs.filter(m => [m.descripcion, m.categoria, m.contraparte, m.documento].some(v => (v || '').toLowerCase().includes(q)));
  }
  movs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  content.innerHTML = `
    <div class="toolbar">
      <input type="search" id="search" placeholder="Buscar descripción, cliente, documento…" value="${esc(state.search)}" />
      <select id="fScope">
        <option value="mes">Mes actual</option>
        <option value="anio">Este año</option>
        <option value="todo">Todo el historial</option>
        <option value="rango">Rango personalizado</option>
      </select>
      <select id="fTipo">
        <option value="todos">Todos los tipos</option>
        <option value="ingreso">Ingresos</option>
        <option value="egreso">Egresos</option>
      </select>
      <select id="fEstado">
        <option value="todos">Todos los estados</option>
        <option value="pagado">Pagado / Cobrado</option>
        <option value="pendiente">Pendiente</option>
      </select>
    </div>
    <div class="toolbar" id="rangeRow" ${state.scope==='rango'?'':'hidden'}>
      <label class="field" style="flex:1">Desde <input type="date" id="fDesde" value="${state.desde}" /></label>
      <label class="field" style="flex:1">Hasta <input type="date" id="fHasta" value="${state.hasta}" /></label>
    </div>
    <div class="row-between" style="margin:2px 2px 12px"><span class="sub" style="color:var(--muted);font-size:13px">${movs.length} movimiento(s) · ${fmt(sum(movs))}</span></div>
    ${movs.length ? itemsHTML(movs) : emptyHTML('Sin movimientos con estos filtros')}`;

  const s = $('#search');
  s.addEventListener('input', () => { state.search = s.value; const p = s.selectionStart; renderMovimientos(); const ns = $('#search'); ns.focus(); ns.setSelectionRange(p, p); });
  $('#fScope').value = state.scope; $('#fTipo').value = state.filterTipo; $('#fEstado').value = state.filterEstado;
  $('#fScope').addEventListener('change', e => { state.scope = e.target.value; renderMovimientos(); });
  $('#fTipo').addEventListener('change', e => { state.filterTipo = e.target.value; renderMovimientos(); });
  $('#fEstado').addEventListener('change', e => { state.filterEstado = e.target.value; renderMovimientos(); });
  $('#fDesde')?.addEventListener('change', e => { state.desde = e.target.value; renderMovimientos(); });
  $('#fHasta')?.addEventListener('change', e => { state.hasta = e.target.value; renderMovimientos(); });
  wireRows();
}

function itemsHTML(movs) {
  return `<ul class="mlist">${movs.map(m => {
    const inc = m.tipo === 'ingreso';
    const meta = [m.categoria, m.contraparte].filter(Boolean).map(esc).join(' · ');
    const pend = (m.estado || 'pagado') === 'pendiente';
    return `<li class="mitem" data-id="${m.id}">
      <div class="mi-swipe-bg"><span class="ok">${pend ? (inc?'✓ Cobrado':'✓ Pagado') : '↩ Pendiente'}</span><span>🗑 Eliminar</span></div>
      <div class="mi-fg">
        <div class="mi-ic ${inc?'in':'out'}">${inc?'↑':'↓'}</div>
        <div class="mi-main">
          <div class="mi-title">${esc(m.descripcion || m.categoria)}${m.comprobante?'<span class="mi-clip">📎</span>':''}</div>
          <div class="mi-meta">${meta}${meta ? ' · ' : ''}${ddmm(m.fecha)}</div>
        </div>
        <div class="mi-right">
          <div class="mi-amt ${inc?'in':'out'}">${inc?'+':'−'}${fmt(m.monto)}</div>
          ${m.moneda && m.moneda !== 'CLP' ? `<span class="fx-badge">${m.moneda} ${nf(m.moneda==='UF'?1:0).format(m.montoOrig||0)}</span>` : ''}
          ${pend ? '<span class="pill pendiente">Pendiente</span>' : ''}
        </div>
      </div>
    </li>`;
  }).join('')}</ul>`;
}

function renderFlujo() {
  const y = state.ref.getFullYear();
  const rows = [];
  for (let mo = 0; mo < 12; mo++) {
    const t = monthTotals(state.movimientos.filter(m => inMonth(m, y, mo)));
    rows.push({ label: MESES[mo].slice(0, 3), ...t });
  }
  const max = Math.max(1, ...rows.map(r => Math.max(r.tIn, r.tOut)));
  const totIn = rows.reduce((a, r) => a + r.tIn, 0), totOut = rows.reduce((a, r) => a + r.tOut, 0);

  content.innerHTML = `
    <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi income"><div class="label"><span class="tag"></span>Ingresos ${y}</div><div class="value">${fmt(totIn)}</div></div>
      <div class="kpi expense"><div class="label"><span class="tag"></span>Egresos ${y}</div><div class="value">${fmt(totOut)}</div></div>
      <div class="kpi balance"><div class="label"><span class="tag"></span>Balance ${y}</div><div class="value" style="color:${totIn-totOut>=0?'var(--income)':'var(--expense)'}">${fmt(totIn-totOut)}</div></div>
    </div>
    <div class="card">
      <div class="row-between" style="margin-bottom:10px">
        <h3>Flujo de caja</h3>
        <div class="period" style="gap:4px"><button class="icon-btn" id="prevYear">‹</button><strong>${y}</strong><button class="icon-btn" id="nextYear">›</button></div>
      </div>
      <div class="legend"><span class="in">Ingresos</span><span class="out">Egresos</span></div>
      ${rows.map(r => `
        <div class="bar-row">
          <div>${r.label}</div>
          <div>
            <div class="bar-track"><div class="bar-fill in" style="width:${r.tIn/max*100}%"></div></div>
            <div class="bar-track" style="margin-top:4px"><div class="bar-fill out" style="width:${r.tOut/max*100}%"></div></div>
          </div>
          <div class="amt" style="color:${r.balance>=0?'var(--income)':'var(--expense)'}">${fmt(r.balance)}</div>
        </div>`).join('')}
    </div>`;

  $('#prevYear').addEventListener('click', () => { state.ref = new Date(y - 1, state.ref.getMonth(), 1); render(); });
  $('#nextYear').addEventListener('click', () => { state.ref = new Date(y + 1, state.ref.getMonth(), 1); render(); });
}

function renderCategorias() {
  const movs = monthMovs();
  const build = (tipo) => {
    const map = {};
    movs.filter(m => m.tipo === tipo && m.estado !== 'pendiente').forEach(m => { map[m.categoria] = (map[m.categoria] || 0) + Number(m.monto || 0); });
    const items = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return { items, tot: items.reduce((a, [, v]) => a + v, 0) };
  };
  const ing = build('ingreso'), egr = build('egreso');
  const block = (titulo, data) => `
    <div class="card">
      <div class="row-between" style="margin-bottom:10px"><h3>${titulo}</h3><strong>${fmt(data.tot)}</strong></div>
      ${data.items.length ? data.items.map(([name, v]) => `
        <div class="cat-row" style="grid-template-columns:1fr">
          <div>
            <div style="display:flex;justify-content:space-between"><span class="cat-name">${esc(name)}</span><span class="cat-amt">${fmt(v)} <span style="color:var(--muted);font-weight:500;font-size:12px">(${data.tot?Math.round(v/data.tot*100):0}%)</span></span></div>
            <div class="cat-meter"><i style="width:${data.tot?v/data.tot*100:0}%;background:${catColor(name)}"></i></div>
          </div>
        </div>`).join('') : emptyHTML('Sin datos')}
    </div>`;
  const buds = budgetStatus().sort((a, b) => b.pct - a.pct);
  const budCard = buds.length ? `<div class="card"><h3>Presupuestos del mes</h3>${buds.map(b => {
    const cls = b.pct >= 1 ? 'over' : b.pct >= 0.8 ? 'warn' : '';
    return `<div class="bud-row"><div class="bud-head"><span>${esc(b.nombre)}</span><span>${fmt(b.gasto)} / ${fmt(b.presupuesto)} · ${Math.round(b.pct*100)}%</span></div><div class="bud-bar ${cls}"><i style="width:${Math.min(100, b.pct*100)}%"></i></div></div>`;
  }).join('')}</div>` : '';
  content.innerHTML = `
    <div class="row-between" style="margin-bottom:14px"><h3 style="font-size:15px">Análisis del mes</h3><button class="btn-ghost sm" id="mgrCatBtn">⚙ Administrar categorías</button></div>
    ${budCard}
    ${block('Ingresos por categoría', ing)}
    ${block('Egresos por categoría', egr)}`;
  $('#mgrCatBtn').addEventListener('click', openCatModal);
}

function emptyHTML(msg) {
  return `<div class="empty"><div class="big">∅</div><p>${msg}</p><button class="btn-primary" onclick="document.getElementById('newBtn').click()">+ Registrar movimiento</button></div>`;
}

const openMov = (id) => openModal(state.movimientos.find(m => m.id === id));
function wireRows() {
  content.querySelectorAll('.mitem[data-id]').forEach(attachSwipe);
  content.querySelectorAll('.rem-item[data-id]').forEach(el => el.addEventListener('click', () => openMov(el.dataset.id)));
}
function attachSwipe(li) {
  const fg = li.querySelector('.mi-fg'); const id = li.dataset.id;
  let x0 = 0, y0 = 0, dx = 0, active = false, moved = false;
  fg.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; dx = 0; active = true; moved = false; li.classList.add('swiping'); });
  fg.addEventListener('pointermove', e => {
    if (!active) return;
    const ddx = e.clientX - x0, ddy = e.clientY - y0;
    if (!moved && Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return;
    if (Math.abs(ddy) > Math.abs(ddx)) { active = false; fg.style.transform = ''; li.classList.remove('swiping'); return; }
    moved = true; dx = Math.max(-140, Math.min(140, ddx)); fg.style.transform = `translateX(${dx}px)`;
    if (e.cancelable) e.preventDefault();
  });
  const end = () => {
    if (!active) return; active = false; li.classList.remove('swiping'); fg.style.transform = '';
    if (moved && Math.abs(dx) >= 90) {
      const m = state.movimientos.find(x => x.id === id); if (!m) return;
      if (dx > 0) { const np = (m.estado || 'pagado') === 'pendiente' ? 'pagado' : 'pendiente'; movStore.update(id, { estado: np, vence: np === 'pendiente' ? (m.vence || '') : '' }); toast(np === 'pagado' ? 'Marcado como pagado/cobrado' : 'Marcado como pendiente'); }
      else if (confirm('¿Eliminar este movimiento?')) movStore.remove(id);
    }
  };
  fg.addEventListener('pointerup', end); fg.addEventListener('pointercancel', end);
  fg.addEventListener('click', () => { if (!moved) openMov(id); });
}

// ── Modal movimiento ──────────────────────────────────────────────────────────
const modal = $('#modal');
let currentComprobante = null;

function fillCategorias(tipo, selected) {
  const sel = $('#f_categoria');
  const list = visibleCats(tipo);
  sel.innerHTML = list.map(c => `<option>${esc(c.nombre)}</option>`).join('');
  if (selected) {
    if (!list.some(c => c.nombre === selected)) sel.insertAdjacentHTML('afterbegin', `<option>${esc(selected)}</option>`);
    sel.value = selected;
  }
}
function toggleVence() { $('#venceField').hidden = $('#f_estado').value !== 'pendiente'; }
function updateMontoCur() { $('#montoCur').textContent = '(' + $('#f_moneda').value + ')'; }
function updateConvHint() {
  const cur = $('#f_moneda')?.value; if (!cur) return;
  const hint = $('#convHint');
  if (cur === 'CLP') { hint.hidden = true; return; }
  const r = rate(cur), val = Number($('#f_monto').value || 0);
  hint.hidden = false;
  if (!r) { hint.innerHTML = '⚠ Sin valor de cambio disponible. Conectate para traer USD/UF.'; return; }
  const fch = ddmm(cur === 'UF' ? indic.fechaUf : indic.fechaDolar);
  hint.innerHTML = `≈ <b>${fmt(val * r)} CLP</b> &nbsp;·&nbsp; TC ${cur} ${fmtFX(r)}${fch ? ' (' + fch + ')' : ''}`;
}
function setComprobante(dataURL) {
  currentComprobante = dataURL || null;
  $('#attachPreview').hidden = !dataURL;
  $('#attachBtn').hidden = !!dataURL;
  if (dataURL) $('#attachImg').src = dataURL;
}
function openModal(mov) {
  modal.hidden = false;
  $('#modalTitle').textContent = mov ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#deleteBtn').hidden = !mov;
  const tipo = mov?.tipo || 'ingreso';
  document.querySelector(`input[name="tipo"][value="${tipo}"]`).checked = true;
  fillCategorias(tipo, mov?.categoria);
  $('#f_id').value = mov?.id || '';
  $('#f_fecha').value = mov?.fecha || todayStr();
  $('#f_moneda').value = mov?.moneda || 'CLP';
  $('#f_monto').value = mov?.montoOrig ?? mov?.monto ?? '';
  updateMontoCur(); updateConvHint();
  $('#f_descripcion').value = mov?.descripcion || '';
  $('#f_contraparte').value = mov?.contraparte || '';
  $('#f_documento').value = mov?.documento || '';
  $('#f_medio').value = mov?.medio || 'Transferencia';
  $('#f_estado').value = mov?.estado || 'pagado';
  $('#f_iva').checked = mov?.iva ?? true;
  $('#f_vence').value = mov?.vence || '';
  toggleVence();
  setComprobante(mov?.comprobante || null);
}
function closeModal() { modal.hidden = true; }

document.querySelectorAll('input[name="tipo"]').forEach(r => r.addEventListener('change', e => fillCategorias(e.target.value)));
$('#f_estado').addEventListener('change', toggleVence);
$('#f_moneda').addEventListener('change', () => { updateMontoCur(); updateConvHint(); });
$('#f_monto').addEventListener('input', updateConvHint);
$('#attachBtn').addEventListener('click', () => $('#f_file').click());
$('#attachRemove').addEventListener('click', () => { $('#f_file').value = ''; setComprobante(null); });
$('#attachImg').addEventListener('click', () => openImg(currentComprobante));
$('#f_file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try { setComprobante(await compressImage(file)); } catch { toast('No se pudo procesar la imagen'); }
});

function compressImage(file, maxDim = 1200, quality = 0.6) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxDim) { const r = maxDim / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = rej; img.src = url;
  });
}

$('#movForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const estado = $('#f_estado').value;
  const moneda = $('#f_moneda').value;
  const montoOrig = Number($('#f_monto').value || 0);
  const r = rate(moneda);
  if (moneda !== 'CLP' && !r) return toast('No hay tipo de cambio disponible. Conectate para traer USD/UF.');
  const obj = {
    tipo: document.querySelector('input[name="tipo"]:checked').value,
    fecha: $('#f_fecha').value,
    moneda,
    montoOrig,
    tc: moneda === 'CLP' ? 1 : r,
    monto: moneda === 'CLP' ? montoOrig : Math.round(montoOrig * r),
    categoria: $('#f_categoria').value,
    descripcion: $('#f_descripcion').value.trim(),
    contraparte: $('#f_contraparte').value.trim(),
    documento: $('#f_documento').value.trim(),
    medio: $('#f_medio').value,
    estado,
    iva: $('#f_iva').checked,
    vence: estado === 'pendiente' ? ($('#f_vence').value || '') : '',
    comprobante: currentComprobante || '',
  };
  const id = $('#f_id').value;
  try {
    if (id) await movStore.update(id, obj); else await movStore.add(obj);
    closeModal(); toast(id ? 'Movimiento actualizado' : 'Movimiento guardado');
  } catch (err) { toast('Error al guardar: ' + err.message); }
});
$('#deleteBtn').addEventListener('click', async () => {
  const id = $('#f_id').value;
  if (id && confirm('¿Eliminar este movimiento?')) { await movStore.remove(id); closeModal(); toast('Movimiento eliminado'); }
});

// ── Visor de comprobante ──────────────────────────────────────────────────────
function openImg(src) { if (!src) return; $('#imgFull').src = src; $('#imgViewer').hidden = false; }
$('#imgClose').addEventListener('click', () => $('#imgViewer').hidden = true);
$('#imgViewer').addEventListener('click', e => { if (e.target === $('#imgViewer')) $('#imgViewer').hidden = true; });

// ── Gestor de categorías ──────────────────────────────────────────────────────
const catModal = $('#catModal');
let catMgrTipo = 'ingreso';
function openCatModal() { catModal.hidden = false; renderCatModal(); }
function renderCatModal() {
  const list = state.categorias.filter(c => c.tipo === catMgrTipo).sort((a, b) => a.nombre.localeCompare(b.nombre));
  $('#catBody').innerHTML = `
    <div class="seg tipo-seg">
      <label class="seg-opt income"><input type="radio" name="catTipo" value="ingreso" ${catMgrTipo==='ingreso'?'checked':''}/> <span>Ingresos</span></label>
      <label class="seg-opt expense"><input type="radio" name="catTipo" value="egreso" ${catMgrTipo==='egreso'?'checked':''}/> <span>Egresos</span></label>
    </div>
    <div class="cat-mgr-add">
      <input type="color" class="swatch" id="newCatColor" value="${PALETTE[0]}" />
      <input type="text" id="newCatName" placeholder="Nueva categoría…" maxlength="40" />
      <button class="btn-primary" id="addCatBtn">Agregar</button>
    </div>
    <ul class="cat-mgr-list">
      ${list.map(c => `<li class="cat-mgr-row ${c.oculta?'oculta':''}" data-id="${c.id}">
        <button class="cat-dot" data-act="color" style="background:${esc(c.color||'#586878')}" title="Cambiar color"></button>
        <span class="cn" data-act="rename" title="Renombrar">${esc(c.nombre)}${Number(c.presupuesto)>0?` <span class="muted-inline">· ${fmt(c.presupuesto)}/mes</span>`:''}</span>
        <button class="icon-btn" data-act="bud" title="Presupuesto mensual">💰</button>
        <button class="icon-btn" data-act="hide" title="${c.oculta?'Mostrar':'Ocultar'}">${c.oculta?'🙈':'👁'}</button>
        <button class="icon-btn" data-act="del" title="Eliminar">🗑</button>
      </li>`).join('') || '<p class="sub" style="color:var(--muted);padding:8px 0">Sin categorías. Agregá una arriba.</p>'}
    </ul>`;

  document.querySelectorAll('input[name="catTipo"]').forEach(r => r.addEventListener('change', e => { catMgrTipo = e.target.value; renderCatModal(); }));
  $('#addCatBtn').addEventListener('click', async () => {
    const nombre = $('#newCatName').value.trim(); if (!nombre) return;
    await catStore.add({ nombre, tipo: catMgrTipo, color: $('#newCatColor').value, oculta: false });
    toast('Categoría agregada');
  });
  $('#catBody').querySelectorAll('.cat-mgr-row').forEach(row => {
    const id = row.dataset.id, cat = state.categorias.find(c => c.id === id);
    row.querySelector('[data-act="color"]').addEventListener('click', () => {
      const inp = document.createElement('input'); inp.type = 'color'; inp.value = cat.color || '#586878';
      inp.addEventListener('change', () => catStore.update(id, { color: inp.value }));
      inp.click();
    });
    row.querySelector('[data-act="rename"]').addEventListener('click', () => {
      const nombre = prompt('Nuevo nombre:', cat.nombre); if (nombre && nombre.trim()) catStore.update(id, { nombre: nombre.trim() });
    });
    row.querySelector('[data-act="bud"]').addEventListener('click', () => {
      const v = prompt(`Presupuesto mensual para "${cat.nombre}" (CLP · 0 para quitar):`, cat.presupuesto || '');
      if (v !== null) catStore.update(id, { presupuesto: Number(v) || 0 });
    });
    row.querySelector('[data-act="hide"]').addEventListener('click', () => catStore.update(id, { oculta: !cat.oculta }));
    row.querySelector('[data-act="del"]').addEventListener('click', () => { if (confirm(`¿Eliminar la categoría "${cat.nombre}"?`)) catStore.remove(id); });
  });
}
$('#catClose').addEventListener('click', () => catModal.hidden = true);
catModal.addEventListener('click', e => { if (e.target === catModal) catModal.hidden = true; });

// ── Navegación / eventos globales ──────────────────────────────────────────────
function go(view) { state.view = view; render(); window.scrollTo({ top: 0 }); }
document.querySelectorAll('.nav-item, .bn-item').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
$('#newBtn').addEventListener('click', () => openModal(null));
$('#fab').addEventListener('click', () => openQuick());
$('#cfgBtn').addEventListener('click', openCfg);
$('#modalClose').addEventListener('click', closeModal);
$('#cancelBtn').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { ['#modal','#catModal','#quickModal','#cfgModal','#recModal','#imgViewer'].forEach(s => { const el = $(s); if (el && !el.hidden) el.hidden = true; }); } });

$('#prevMonth').addEventListener('click', () => { state.ref = new Date(state.ref.getFullYear(), state.ref.getMonth() - 1, 1); render(); });
$('#nextMonth').addEventListener('click', () => { state.ref = new Date(state.ref.getFullYear(), state.ref.getMonth() + 1, 1); render(); });
$('#todayBtn').addEventListener('click', () => { state.ref = new Date(); render(); });

// Menú exportar
const exportMenu = $('#exportMenu');
$('#exportBtn').addEventListener('click', (e) => { e.stopPropagation(); exportMenu.hidden = !exportMenu.hidden; });
document.addEventListener('click', () => exportMenu.hidden = true);
exportMenu.addEventListener('click', e => { const t = e.target.dataset.exp; if (t) { exportMenu.hidden = true; doExport(t); } });

let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2600); }

// ── Exportación: CSV / Excel / PDF ──────────────────────────────────────────────
function exportSet() {
  // Exporta el período en foco según el alcance elegido en Movimientos.
  const movs = (state.view === 'movimientos' ? scopeMovs() : monthMovs()).slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  let etiqueta;
  if (state.view === 'movimientos' && state.scope === 'anio') etiqueta = String(state.ref.getFullYear());
  else if (state.view === 'movimientos' && state.scope === 'todo') etiqueta = 'historico';
  else if (state.view === 'movimientos' && state.scope === 'rango') etiqueta = `${state.desde||'inicio'}_a_${state.hasta||'hoy'}`;
  else etiqueta = `${state.ref.getFullYear()}-${String(state.ref.getMonth()+1).padStart(2,'0')}`;
  return { movs, etiqueta };
}
const COLS = ['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Contraparte', 'Documento', 'Medio', 'Estado', 'Vence', 'IVA', 'Moneda', 'Monto orig.', 'Tipo cambio', 'Monto CLP'];
const rowOf = (m) => [m.fecha, m.tipo, m.categoria, m.descripcion, m.contraparte, m.documento, m.medio, m.estado, m.vence, m.iva ? 'Sí' : 'No', m.moneda || 'CLP', Number(m.montoOrig ?? m.monto ?? 0), Number(m.tc || 1), Number(m.monto || 0)];

function doExport(kind) {
  const { movs } = exportSet();
  if (!movs.length) return toast('No hay movimientos para exportar');
  if (kind === 'csv') return exportCSV(movs);
  if (kind === 'xlsx') return exportXLSX(movs);
  if (kind === 'pdf') return exportPDF(movs);
}

function exportCSV(movs) {
  const { etiqueta } = exportSet();
  const lines = movs.map(m => rowOf(m).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
  const csv = '﻿' + [COLS.join(';'), ...lines].join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `finanzas-sonqollay-${etiqueta}.csv`);
  toast('CSV exportado');
}

const _scripts = {};
const loadScript = (src) => _scripts[src] || (_scripts[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); }));

async function exportXLSX(movs) {
  toast('Generando Excel…');
  try {
    await loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
    const { etiqueta } = exportSet();
    const data = [COLS, ...movs.map(rowOf)];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = COLS.map((c, i) => ({ wch: i === 3 ? 32 : i === 4 ? 20 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
    XLSX.writeFile(wb, `finanzas-sonqollay-${etiqueta}.xlsx`);
    toast('Excel exportado');
  } catch (e) { toast('Error al exportar Excel'); }
}

async function exportPDF(movs) {
  toast('Generando PDF…');
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    const { etiqueta } = exportSet();
    const t = monthTotals(movs);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor('#F77000'); doc.text('Finanzas Sonqollay', 14, 18);
    doc.setFontSize(11); doc.setTextColor('#586878');
    doc.text(`Reporte de movimientos — ${etiqueta}`, 14, 26);
    doc.setFontSize(10); doc.setTextColor('#1b232b');
    doc.text(`Ingresos: ${fmt(t.tIn)}    Egresos: ${fmt(t.tOut)}    Balance: ${fmt(t.balance)}`, 14, 34);
    doc.text(`Por cobrar: ${fmt(t.porCobrar)}    Por pagar: ${fmt(t.porPagar)}    IVA estimado: ${fmt(t.iva)}`, 14, 40);
    doc.setTextColor('#586878');
    doc.text(`Tipo de cambio: USD ${indic.dolar?fmtFX(indic.dolar):'—'}  ·  UF ${indic.uf?fmtFX(indic.uf):'—'}${indic.fechaUf?' (al '+ddmm(indic.fechaUf)+')':''}`, 14, 46);
    doc.autoTable({
      startY: 52,
      head: [['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Contraparte', 'Estado', 'Moneda', 'Monto CLP']],
      body: movs.map(m => [m.fecha, m.tipo, m.categoria, m.descripcion || '', m.contraparte || '', m.estado || 'pagado', m.moneda || 'CLP', fmt(m.monto)]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [88, 104, 120] },
      columnStyles: { 7: { halign: 'right' } },
    });
    doc.save(`finanzas-sonqollay-${etiqueta}.pdf`);
    toast('PDF exportado');
  } catch (e) { toast('Error al exportar PDF'); }
}

function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }

// ── Recordatorios / notificaciones ──────────────────────────────────────────────
$('#bellBtn').addEventListener('click', enableReminders);
async function enableReminders() {
  if (!('Notification' in window)) return toast('Tu navegador no soporta notificaciones');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast('Permiso de notificaciones denegado');
  localStorage.setItem('finanzas_notif', '1');
  $('#bellBtn').classList.add('on');
  if (backend?.enablePush) { try { await backend.enablePush(); toast('Recordatorios push activados'); notifyAll(true); return; } catch {} }
  toast('Recordatorios activados');
  notifyAll(true);
}
function notifyDue(force = false) {
  if (localStorage.getItem('finanzas_notif') !== '1' || Notification.permission !== 'granted') return;
  if (!force && localStorage.getItem('finanzas_notif_day') === todayStr()) return;
  const { venc, prox } = reminders();
  if (!venc.length && !prox.length) return;
  localStorage.setItem('finanzas_notif_day', todayStr());
  const cobrar = [...venc, ...prox].filter(m => m.tipo === 'ingreso'), pagar = [...venc, ...prox].filter(m => m.tipo === 'egreso');
  const partes = [];
  if (cobrar.length) partes.push(`${cobrar.length} por cobrar (${fmt(sum(cobrar))})`);
  if (pagar.length) partes.push(`${pagar.length} por pagar (${fmt(sum(pagar))})`);
  showNotif('Recordatorios de cobros/pagos', `${venc.length} vencido(s). ${partes.join(' · ')}`, 'due', [{ action: 'open', title: 'Ver pendientes' }]);
}

// ── PWA: install + service worker ──────────────────────────────────────────────
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#installBtn').hidden = true; });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

// ── Registro rápido (2 toques) ────────────────────────────────────────────────
const quickModal = $('#quickModal');
let quickAmt = '', quickTipo = 'egreso', quickCat = null;
function openQuick(tipo) {
  quickTipo = tipo || 'egreso'; quickAmt = ''; quickCat = null;
  document.querySelector(`input[name="qtipo"][value="${quickTipo}"]`).checked = true;
  renderQuickChips(); updateQAmount(); quickModal.hidden = false;
}
function updateQAmount() { $('#qAmount').textContent = fmt(Number(quickAmt || 0)); }
function renderQuickChips() {
  const cats = visibleCats(quickTipo);
  if (!quickCat || !cats.some(c => c.nombre === quickCat)) quickCat = cats[0]?.nombre;
  $('#qChips').innerHTML = cats.map(c => `<button type="button" class="chip ${c.nombre===quickCat?'sel':''}" data-cat="${esc(c.nombre)}"><span class="cd" style="background:${esc(c.color||'#586878')}"></span>${esc(c.nombre)}</button>`).join('');
  $('#qChips').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { quickCat = b.dataset.cat; renderQuickChips(); }));
}
$('#keypad').addEventListener('click', e => {
  const k = e.target.dataset.k; if (!k) return;
  if (k === 'back') quickAmt = quickAmt.slice(0, -1);
  else if ((quickAmt + k).replace(/^0+/, '').length <= 12) quickAmt = (quickAmt === '0' ? '' : quickAmt) + k;
  updateQAmount();
});
document.querySelectorAll('input[name="qtipo"]').forEach(r => r.addEventListener('change', e => { quickTipo = e.target.value; quickCat = null; renderQuickChips(); }));
$('#quickSave').addEventListener('click', async () => {
  const monto = Number(quickAmt || 0);
  if (!monto) return toast('Ingresá un monto');
  await movStore.add({ tipo: quickTipo, fecha: todayStr(), moneda: 'CLP', montoOrig: monto, tc: 1, monto, categoria: quickCat, descripcion: '', contraparte: '', documento: '', medio: 'Transferencia', estado: 'pagado', iva: true, vence: '', comprobante: '' });
  quickModal.hidden = true; toast('Guardado');
});
$('#quickMore').addEventListener('click', () => {
  quickModal.hidden = true; openModal(null);
  document.querySelector(`input[name="tipo"][value="${quickTipo}"]`).checked = true;
  fillCategorias(quickTipo, quickCat);
  $('#f_monto').value = quickAmt; updateConvHint();
});
$('#quickClose').addEventListener('click', () => quickModal.hidden = true);
quickModal.addEventListener('click', e => { if (e.target === quickModal) quickModal.hidden = true; });

// ── Ajustes ───────────────────────────────────────────────────────────────────
const cfgModal = $('#cfgModal');
function openCfg() { cfgModal.hidden = false; renderCfg(); }
function renderCfg() {
  const sw = (id, on, label, desc) => `<div class="cfg-row"><div class="cfg-txt"><b>${label}</b><span>${desc}</span></div><label class="switch"><input type="checkbox" id="${id}" ${on?'checked':''}/><span class="sl"></span></label></div>`;
  $('#cfgBody').innerHTML = `
    <div class="cfg-section">
      <h4>Seguridad</h4>
      ${sw('cfgLock', LOCK.enabled(), 'Bloqueo con PIN', 'Pide un PIN al abrir la app')}
      ${LOCK.enabled() ? sw('cfgBio', !!LOCK.bio(), 'Huella / Face ID', 'Desbloqueo biométrico del dispositivo') : ''}
    </div>
    <div class="cfg-section">
      <h4>Notificaciones</h4>
      <div class="cfg-row"><div class="cfg-txt"><b>Permiso de notificaciones</b><span>${('Notification' in window) && Notification.permission==='granted' ? 'Activado' : 'Tocá para activar'}</span></div><button class="btn-ghost sm" id="cfgEnableNotif">Activar</button></div>
      ${sw('cfgDue', prefs.nDue, 'Cobros / pagos vencidos', 'Avisa de pendientes por vencer')}
      ${sw('cfgWeekly', prefs.nWeekly, 'Resumen semanal', 'Cada lunes, balance de la semana')}
      ${sw('cfgF29', prefs.nF29, 'Recordatorio F29 / IVA', 'Día 12, con el IVA estimado')}
      ${sw('cfgBudget', prefs.nBudget, 'Alerta de presupuesto', 'Si superás un presupuesto del mes')}
    </div>
    <div class="cfg-section">
      <h4>Automatización</h4>
      <div class="cfg-row"><div class="cfg-txt"><b>Movimientos recurrentes</b><span>Sueldos, arriendo, suscripciones</span></div><button class="btn-ghost sm" id="cfgRec">Gestionar</button></div>
    </div>
    <div class="cfg-section">
      <h4>Datos</h4>
      <div class="cfg-row"><div class="cfg-txt"><b>Modo</b><span>${backend?.isCloud ? 'Nube (Firebase) — sincronizado' : 'Local (este dispositivo)'}</span></div></div>
    </div>`;

  $('#cfgEnableNotif').addEventListener('click', enableReminders);
  $('#cfgRec').addEventListener('click', openRec);
  $('#cfgLock').addEventListener('change', async e => {
    if (e.target.checked) { const ok = await setPin(); if (!ok) { e.target.checked = false; return; } toast('Bloqueo activado'); }
    else { if (confirm('¿Desactivar el bloqueo?')) { localStorage.removeItem('finanzas_lock'); localStorage.removeItem('finanzas_pinhash'); localStorage.removeItem('finanzas_bio'); toast('Bloqueo desactivado'); } }
    renderCfg();
  });
  $('#cfgBio')?.addEventListener('change', async e => {
    if (e.target.checked) { const ok = await bioRegister(); if (!ok) e.target.checked = false; else toast('Biometría activada'); }
    else { localStorage.removeItem('finanzas_bio'); }
  });
  [['cfgDue','nDue'],['cfgWeekly','nWeekly'],['cfgF29','nF29'],['cfgBudget','nBudget']].forEach(([id, key]) =>
    $('#' + id).addEventListener('change', e => { prefs[key] = e.target.checked; savePrefs(); }));
}
$('#cfgClose').addEventListener('click', () => cfgModal.hidden = true);
cfgModal.addEventListener('click', e => { if (e.target === cfgModal) cfgModal.hidden = true; });

// ── Movimientos recurrentes ────────────────────────────────────────────────────
const recModal = $('#recModal');
function openRec() { recModal.hidden = false; renderRec(); }
function renderRec() {
  const cats = [...visibleCats('egreso'), ...visibleCats('ingreso')];
  $('#recBody').innerHTML = `
    <div class="seg tipo-seg">
      <label class="seg-opt expense"><input type="radio" name="rtipo" value="egreso" checked/> <span>Gasto</span></label>
      <label class="seg-opt income"><input type="radio" name="rtipo" value="ingreso"/> <span>Ingreso</span></label>
    </div>
    <label class="field">Descripción <input type="text" id="rDesc" maxlength="80" placeholder="Ej. Arriendo oficina" /></label>
    <div class="grid2">
      <label class="field">Monto (CLP) <input type="number" id="rMonto" min="0" step="1" inputmode="numeric" /></label>
      <label class="field">Día del mes <input type="number" id="rDia" min="1" max="28" value="1" /></label>
    </div>
    <label class="field">Categoría <select id="rCat">${cats.map(c => `<option>${esc(c.nombre)}</option>`).join('')}</select></label>
    <div class="modal-foot"><span class="spacer"></span><button class="btn-primary" id="rAdd">Agregar recurrente</button></div>
    <h4 style="margin:8px 0;color:var(--muted);font-size:12.5px;text-transform:uppercase;letter-spacing:.5px">Activos</h4>
    ${state.recurrentes.length ? state.recurrentes.map(r => `
      <div class="rec-row" data-id="${r.id}">
        <div class="mi-ic ${r.tipo==='ingreso'?'in':'out'}">${r.tipo==='ingreso'?'↑':'↓'}</div>
        <div class="rec-main"><b>${esc(r.descripcion || r.categoria)}</b><span>${esc(r.categoria)} · día ${r.dia} · ${fmt(r.monto)}</span></div>
        <button class="btn-ghost sm" data-act="now">Repetir hoy</button>
        <label class="switch"><input type="checkbox" data-act="toggle" ${r.activo?'checked':''}/><span class="sl"></span></label>
        <button class="icon-btn" data-act="del">🗑</button>
      </div>`).join('') : '<p class="sub" style="color:var(--muted);padding:6px 0">Sin recurrentes todavía.</p>'}`;

  document.querySelectorAll('input[name="rtipo"]').forEach(r => r.addEventListener('change', () => {
    const tipo = document.querySelector('input[name="rtipo"]:checked').value;
    $('#rCat').innerHTML = visibleCats(tipo).map(c => `<option>${esc(c.nombre)}</option>`).join('');
  }));
  $('#rAdd').addEventListener('click', async () => {
    const tipo = document.querySelector('input[name="rtipo"]:checked').value;
    const monto = Number($('#rMonto').value || 0); if (!monto) return toast('Ingresá un monto');
    await recStore.add({ tipo, descripcion: $('#rDesc').value.trim(), monto, dia: Math.min(28, Math.max(1, Number($('#rDia').value || 1))), categoria: $('#rCat').value, moneda: 'CLP', activo: true });
    toast('Recurrente agregado');
  });
  $('#recBody').querySelectorAll('.rec-row').forEach(row => {
    const id = row.dataset.id, r = state.recurrentes.find(x => x.id === id);
    row.querySelector('[data-act="toggle"]').addEventListener('change', e => recStore.update(id, { activo: e.target.checked }));
    row.querySelector('[data-act="del"]').addEventListener('click', () => { if (confirm('¿Eliminar este recurrente?')) recStore.remove(id); });
    row.querySelector('[data-act="now"]').addEventListener('click', async () => {
      await movStore.add({ tipo: r.tipo, fecha: todayStr(), moneda: 'CLP', montoOrig: r.monto, tc: 1, monto: r.monto, categoria: r.categoria, descripcion: r.descripcion || r.categoria, contraparte: '', documento: '', medio: 'Transferencia', estado: 'pagado', iva: true, vence: '', comprobante: '', recId: r.id });
      toast('Movimiento creado');
    });
  });
}
$('#recClose').addEventListener('click', () => recModal.hidden = true);
recModal.addEventListener('click', e => { if (e.target === recModal) recModal.hidden = true; });

async function generateRecurrentes() {
  const ym = todayStr().slice(0, 7), dnum = new Date().getDate();
  for (const r of state.recurrentes) {
    if (!r.activo || dnum < (r.dia || 1)) continue;
    if (state.movimientos.some(m => m.recId === r.id && (m.fecha || '').slice(0, 7) === ym)) continue;
    await movStore.add({ tipo: r.tipo, fecha: `${ym}-${String(r.dia || 1).padStart(2, '0')}`, moneda: 'CLP', montoOrig: r.monto, tc: 1, monto: r.monto, categoria: r.categoria, descripcion: r.descripcion || r.categoria, contraparte: '', documento: '', medio: 'Transferencia', estado: 'pagado', iva: true, vence: '', comprobante: '', recId: r.id });
  }
}

// ── Bloqueo con PIN / biometría ────────────────────────────────────────────────
const lockScreen = $('#lockScreen');
const LOCK = {
  enabled: () => localStorage.getItem('finanzas_lock') === '1',
  pin: () => localStorage.getItem('finanzas_pinhash'),
  bio: () => localStorage.getItem('finanzas_bio'),
};
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
let pinBuf = '', pinStep = 'unlock', pinTemp = '', pinCb = null;
(function buildLockPad() {
  const pad = $('#lockPad');
  pad.innerHTML = [1,2,3,4,5,6,7,8,9].map(n => `<button type="button" data-d="${n}">${n}</button>`).join('')
    + `<button type="button" class="flat" data-act="bio2">👆</button><button type="button" data-d="0">0</button><button type="button" class="flat" data-act="back">⌫</button>`;
  pad.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.d != null) pinPush(b.dataset.d);
    else if (b.dataset.act === 'back') { pinBuf = pinBuf.slice(0, -1); paintDots(); }
    else if (b.dataset.act === 'bio2') $('#bioBtn').click();
  });
})();
function paintDots(err) {
  $('#pinDots').querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < pinBuf.length));
  $('#lockTitle').classList.toggle('err', !!err);
}
async function pinPush(d) {
  if (pinBuf.length >= 4) return;
  pinBuf += d; paintDots();
  if (pinBuf.length < 4) return;
  const val = pinBuf; pinBuf = '';
  if (pinStep === 'unlock') {
    if (await sha(val) === LOCK.pin()) hideLock(); else { setTimeout(() => { paintDots(true); $('#lockTitle').textContent = 'PIN incorrecto'; }, 80); }
  } else if (pinStep === 'set') {
    pinTemp = val; pinStep = 'confirm'; $('#lockTitle').textContent = 'Repetí el PIN'; setTimeout(paintDots, 60);
  } else if (pinStep === 'confirm') {
    if (val === pinTemp) { localStorage.setItem('finanzas_pinhash', await sha(val)); localStorage.setItem('finanzas_lock', '1'); lockScreen.hidden = true; pinCb && pinCb(true); pinCb = null; }
    else { pinStep = 'set'; $('#lockTitle').textContent = 'No coincide, creá el PIN'; setTimeout(() => paintDots(true), 60); }
  }
}
function showLock(step) { pinStep = step; pinBuf = ''; pinTemp = ''; $('#lockTitle').textContent = step === 'set' ? 'Creá un PIN (4 dígitos)' : 'Ingresá tu PIN'; $('#lockTitle').classList.remove('err'); paintDots(); $('#bioBtn').hidden = !(step === 'unlock' && LOCK.bio()); lockScreen.hidden = false; }
function hideLock() { lockScreen.hidden = true; }
function setPin() { return new Promise(res => { pinCb = res; showLock('set'); }); }
function maybeLock() { if (LOCK.enabled() && LOCK.pin()) showLock('unlock'); }
$('#bioBtn').addEventListener('click', async () => { if (await bioVerify()) hideLock(); else toast('No se pudo verificar'); });

async function bioRegister() {
  if (!window.PublicKeyCredential) { toast('Este dispositivo no soporta biometría'); return false; }
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Finanzas Sonqollay' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'finanzas', displayName: 'Finanzas Sonqollay' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    }});
    localStorage.setItem('finanzas_bio', btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
    return true;
  } catch { toast('No se pudo registrar la biometría'); return false; }
}
async function bioVerify() {
  const id = LOCK.bio(); if (!id) return false;
  try {
    await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: Uint8Array.from(atob(id), c => c.charCodeAt(0)) }],
      userVerification: 'required', timeout: 60000,
    }});
    return true;
  } catch { return false; }
}
// Auto-bloqueo al volver a la app tras 30 s en segundo plano
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (LOCK.enabled() && LOCK.pin() && lockScreen.hidden && hiddenAt && Date.now() - hiddenAt > 30000) maybeLock();
});

// ── Notificaciones inteligentes (local; Cloud Functions en Modo nube) ───────────
async function showNotif(title, body, tag, actions) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { const reg = await navigator.serviceWorker.getRegistration(); if (reg?.showNotification) return reg.showNotification(title, { body, tag, icon: 'logo.png', badge: 'logo.png', actions: actions || [] }); } catch {}
  try { new Notification(title, { body, tag, icon: 'logo.png' }); } catch {}
}
const mondayOf = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
function rangeTotals(from, to) {
  const ms = state.movimientos.filter(m => m.fecha >= from && m.fecha <= to && m.estado !== 'pendiente');
  return { tIn: sum(ms.filter(m => m.tipo === 'ingreso')), tOut: sum(ms.filter(m => m.tipo === 'egreso')) };
}
function notifyWeekly() {
  if (Notification?.permission !== 'granted') return;
  const thisMon = mondayOf(new Date());
  if (localStorage.getItem('finanzas_n_weekly') === thisMon) return;
  localStorage.setItem('finanzas_n_weekly', thisMon);
  const t = rangeTotals(addDays(thisMon, -7), addDays(thisMon, -1));
  if (!t.tIn && !t.tOut) return;
  showNotif('Resumen semanal', `La semana pasada: ingresos ${fmt(t.tIn)}, egresos ${fmt(t.tOut)}. Balance ${fmt(t.tIn - t.tOut)}.`, 'weekly');
}
function notifyF29() {
  if (Notification?.permission !== 'granted') return;
  const now = new Date(), dnum = now.getDate(), ym = todayStr().slice(0, 7);
  if (dnum < 12 || dnum > 25) return;
  if (localStorage.getItem('finanzas_n_f29') === ym) return;
  localStorage.setItem('finanzas_n_f29', ym);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const t = monthTotals(state.movimientos.filter(m => inMonth(m, prev.getFullYear(), prev.getMonth())));
  showNotif('Recordatorio F29 / IVA', `Declara el F29 de ${MESES[prev.getMonth()]}. IVA estimado: ${fmt(t.iva)}.`, 'f29');
}
function budgetStatus() {
  const movs = monthMovs();
  return state.categorias.filter(c => Number(c.presupuesto) > 0).map(c => {
    const gasto = sum(movs.filter(m => m.tipo === c.tipo && m.categoria === c.nombre && m.estado !== 'pendiente'));
    return { ...c, gasto, pct: gasto / c.presupuesto };
  });
}
function notifyBudget() {
  if (Notification?.permission !== 'granted') return;
  const over = budgetStatus().filter(b => b.pct >= 1);
  if (!over.length) return;
  if (localStorage.getItem('finanzas_n_budget') === todayStr()) return;
  localStorage.setItem('finanzas_n_budget', todayStr());
  showNotif('Presupuesto superado', over.map(b => `${b.nombre}: ${Math.round(b.pct*100)}%`).join(' · '), 'budget');
}
function notifyAll(force) {
  if (localStorage.getItem('finanzas_notif') !== '1') return;
  if (prefs.nDue) notifyDue(force);
  if (prefs.nWeekly) notifyWeekly();
  if (prefs.nF29) notifyF29();
  if (prefs.nBudget) notifyBudget();
}

// ── Arranque ────────────────────────────────────────────────────────────────────
(async function init() {
  maybeLock(); // pantalla de bloqueo antes de mostrar datos
  try { backend = await makeFirebaseBackend(); } catch { backend = null; }
  if (backend) {
    $('#syncState').classList.add('cloud'); $('#syncLabel').textContent = 'Nube (Firebase)';
    const chip = $('#syncChip'); chip.classList.add('cloud'); chip.innerHTML = '<span class="dot"></span>Nube';
  } else {
    backend = LocalBackend;
  }
  if (localStorage.getItem('finanzas_notif') === '1') $('#bellBtn').classList.add('on');

  movStore = backend.collection('movimientos');
  catStore = backend.collection('categorias');
  recStore = backend.collection('recurrentes');

  let loadedRec = false, loadedMov = false, genDone = false;
  const tryGen = () => { if (loadedRec && loadedMov && !genDone) { genDone = true; generateRecurrentes(); } };

  await catStore.init((data) => {
    state.categorias = data;
    if (!data.length && !localStorage.getItem('finanzas_cats_seeded')) {
      localStorage.setItem('finanzas_cats_seeded', '1');
      DEFAULT_CATS.forEach(c => catStore.add(c));
    }
    if (state.view === 'categorias') render();
    if (!catModal.hidden) renderCatModal();
  });
  await recStore.init((data) => { state.recurrentes = data; loadedRec = true; tryGen(); if (!recModal.hidden) renderRec(); });
  await movStore.init((data) => { state.movimientos = data; render(); notifyAll(); loadedMov = true; tryGen(); });
  render();
  loadIndicadores();

  // Atajos PWA (?quick=egreso|ingreso)
  const q = new URLSearchParams(location.search).get('quick');
  if (q === 'egreso' || q === 'ingreso') { openQuick(q); history.replaceState({}, '', location.pathname); }
})();
