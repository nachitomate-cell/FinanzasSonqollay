/* ===========================================================================
   Finanzas Sonqollay — contabilidad general de la consultora
   Vanilla JS · datos en localStorage (Modo local) o Firebase Firestore (nube).
   =========================================================================== */

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const fmt = (n) => CLP.format(Math.round(n || 0));
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

const CATEGORIAS = {
  ingreso: ['Cotización adjudicada', 'Servicios de ingeniería', 'Consultoría', 'Licencias / SaaS', 'Reembolsos', 'Otros ingresos'],
  egreso:  ['Sueldos y honorarios', 'Infraestructura (APS/DB/Hosting)', 'Software y licencias', 'Impuestos', 'Oficina y servicios', 'Marketing', 'Viáticos', 'Otros egresos'],
};

// ── Estado ──────────────────────────────────────────────────────────────────
const state = {
  view: 'dashboard',
  ref: new Date(),          // mes/año en foco
  movimientos: [],          // todos los movimientos
  search: '',
  filterTipo: 'todos',
  filterEstado: 'todos',
};

// ── Capa de datos (adapter) ──────────────────────────────────────────────────
let backend = null;

const LocalBackend = {
  KEY: 'finanzas_movimientos',
  _read() { try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch { return []; } },
  _write(arr) { localStorage.setItem(this.KEY, JSON.stringify(arr)); },
  async init(onChange) { this._onChange = onChange; onChange(this._read()); },
  async add(obj) { const arr = this._read(); arr.push({ ...obj, id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) }); this._write(arr); this._onChange(this._read()); },
  async update(id, obj) { const arr = this._read().map(m => m.id === id ? { ...m, ...obj } : m); this._write(arr); this._onChange(this._read()); },
  async remove(id) { this._write(this._read().filter(m => m.id !== id)); this._onChange(this._read()); },
};

async function makeFirebaseBackend() {
  let config;
  try { ({ firebaseConfig: config } = await import('./firebase-config.js')); }
  catch { return null; } // no hay config → Modo local

  const APP = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const AUTH = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const FS = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  const app = APP.initializeApp(config);
  const auth = AUTH.getAuth(app);
  const db = FS.getFirestore(app);

  const uid = await new Promise((resolve, reject) => {
    AUTH.onAuthStateChanged(auth, u => u ? resolve(u.uid) : AUTH.signInAnonymously(auth).catch(reject));
  });
  const col = FS.collection(db, 'users', uid, 'movimientos');

  return {
    async init(onChange) {
      FS.onSnapshot(col, snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    },
    async add(obj) { await FS.addDoc(col, { ...obj, createdAt: FS.serverTimestamp() }); },
    async update(id, obj) { await FS.updateDoc(FS.doc(col, id), obj); },
    async remove(id) { await FS.deleteDoc(FS.doc(col, id)); },
  };
}

// ── Selectores derivados ──────────────────────────────────────────────────────
const sameMonth = (m) => {
  const d = new Date(m.fecha + 'T00:00:00');
  return d.getFullYear() === state.ref.getFullYear() && d.getMonth() === state.ref.getMonth();
};
const monthMovs = () => state.movimientos.filter(sameMonth);
const sum = (arr) => arr.reduce((a, m) => a + Number(m.monto || 0), 0);

function monthTotals(movs) {
  const ingresos = movs.filter(m => m.tipo === 'ingreso' && m.estado !== 'pendiente');
  const egresos  = movs.filter(m => m.tipo === 'egreso'  && m.estado !== 'pendiente');
  const porCobrar = movs.filter(m => m.tipo === 'ingreso' && m.estado === 'pendiente');
  const porPagar  = movs.filter(m => m.tipo === 'egreso'  && m.estado === 'pendiente');
  const ivaDebito  = movs.filter(m => m.tipo === 'ingreso' && m.iva).reduce((a, m) => a + Number(m.monto) * 0.19 / 1.19, 0);
  const ivaCredito = movs.filter(m => m.tipo === 'egreso'  && m.iva).reduce((a, m) => a + Number(m.monto) * 0.19 / 1.19, 0);
  const tIn = sum(ingresos), tOut = sum(egresos);
  return { tIn, tOut, balance: tIn - tOut, porCobrar: sum(porCobrar), porPagar: sum(porPagar), iva: ivaDebito - ivaCredito };
}

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
  const recientes = [...movs].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 6);

  content.innerHTML = `
    <div class="kpis">
      <div class="kpi income"><div class="label"><span class="tag"></span>Ingresos del mes</div><div class="value">${fmt(t.tIn)}</div><div class="sub">${movs.filter(m=>m.tipo==='ingreso'&&m.estado!=='pendiente').length} movimientos</div></div>
      <div class="kpi expense"><div class="label"><span class="tag"></span>Egresos del mes</div><div class="value">${fmt(t.tOut)}</div><div class="sub">${movs.filter(m=>m.tipo==='egreso'&&m.estado!=='pendiente').length} movimientos</div></div>
      <div class="kpi balance"><div class="label"><span class="tag"></span>Balance neto</div><div class="value" style="color:${t.balance>=0?'var(--income)':'var(--expense)'}">${fmt(t.balance)}</div><div class="sub">Ingresos − egresos</div></div>
      <div class="kpi pending"><div class="label"><span class="tag"></span>Por cobrar</div><div class="value" style="color:var(--warn)">${fmt(t.porCobrar)}</div><div class="sub">Por pagar: ${fmt(t.porPagar)}</div></div>
    </div>

    <div class="card">
      <div class="row-between"><h3>IVA del mes (estimado)</h3><span class="sub" style="color:var(--muted);font-size:12.5px">Débito − crédito fiscal</span></div>
      <div style="font-size:22px;font-weight:700;color:${t.iva>=0?'var(--ink)':'var(--income)'}">${fmt(t.iva)} ${t.iva>=0?'<span style="font-size:13px;color:var(--muted);font-weight:500">a pagar</span>':'<span style="font-size:13px;color:var(--income);font-weight:500">a favor</span>'}</div>
    </div>

    <div class="card">
      <div class="row-between" style="margin-bottom:8px"><h3>Movimientos recientes</h3><button class="btn-ghost sm" id="goMovs">Ver todos</button></div>
      ${recientes.length ? itemsHTML(recientes) : emptyHTML('Sin movimientos este mes')}
    </div>`;

  $('#goMovs')?.addEventListener('click', () => go('movimientos'));
  wireRows();
}

function renderMovimientos() {
  let movs = monthMovs();
  if (state.filterTipo !== 'todos') movs = movs.filter(m => m.tipo === state.filterTipo);
  if (state.filterEstado !== 'todos') movs = movs.filter(m => (m.estado || 'pagado') === state.filterEstado);
  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    movs = movs.filter(m => [m.descripcion, m.categoria, m.contraparte, m.documento].some(v => (v || '').toLowerCase().includes(q)));
  }
  movs.sort((a, b) => b.fecha.localeCompare(a.fecha));

  content.innerHTML = `
    <div class="toolbar">
      <input type="search" id="search" placeholder="Buscar descripción, cliente, documento…" value="${esc(state.search)}" />
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
    ${movs.length ? itemsHTML(movs) : emptyHTML('Sin movimientos con estos filtros')}`;

  const s = $('#search');
  s.addEventListener('input', () => { state.search = s.value; const p = s.selectionStart; renderMovimientos(); const ns = $('#search'); ns.focus(); ns.setSelectionRange(p, p); });
  $('#fTipo').value = state.filterTipo; $('#fEstado').value = state.filterEstado;
  $('#fTipo').addEventListener('change', e => { state.filterTipo = e.target.value; renderMovimientos(); });
  $('#fEstado').addEventListener('change', e => { state.filterEstado = e.target.value; renderMovimientos(); });
  wireRows();
}

function itemsHTML(movs) {
  return `<ul class="mlist">${movs.map(m => {
    const inc = m.tipo === 'ingreso';
    const d = new Date(m.fecha + 'T00:00:00');
    const fch = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
    const meta = [m.categoria, m.contraparte].filter(Boolean).map(esc).join(' · ');
    const pend = (m.estado || 'pagado') === 'pendiente';
    return `<li class="mitem" data-id="${m.id}">
      <div class="mi-ic ${inc?'in':'out'}">${inc?'↑':'↓'}</div>
      <div class="mi-main">
        <div class="mi-title">${esc(m.descripcion || m.categoria)}</div>
        <div class="mi-meta">${meta}${meta ? ' · ' : ''}${fch}</div>
      </div>
      <div class="mi-right">
        <div class="mi-amt ${inc?'in':'out'}">${inc?'+':'−'}${fmt(m.monto)}</div>
        ${pend ? '<span class="pill pendiente">Pendiente</span>' : ''}
      </div>
    </li>`;
  }).join('')}</ul>`;
}

function renderFlujo() {
  // Últimos 6 meses
  const rows = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(state.ref.getFullYear(), state.ref.getMonth() - i, 1);
    const movs = state.movimientos.filter(m => { const x = new Date(m.fecha + 'T00:00:00'); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth(); });
    const t = monthTotals(movs);
    rows.push({ label: `${MESES[d.getMonth()].slice(0,3)} ${String(d.getFullYear()).slice(2)}`, tIn: t.tIn, tOut: t.tOut, bal: t.balance });
  }
  const max = Math.max(1, ...rows.map(r => Math.max(r.tIn, r.tOut)));

  content.innerHTML = `
    <div class="card">
      <h3>Flujo de caja — últimos 6 meses</h3>
      <div class="legend"><span class="in">Ingresos</span><span class="out">Egresos</span></div>
      ${rows.map(r => `
        <div class="bar-row">
          <div>${r.label}</div>
          <div>
            <div class="bar-track"><div class="bar-fill in" style="width:${r.tIn/max*100}%"></div></div>
            <div class="bar-track" style="margin-top:4px"><div class="bar-fill out" style="width:${r.tOut/max*100}%"></div></div>
          </div>
          <div class="amt" style="color:${r.bal>=0?'var(--income)':'var(--expense)'}">${fmt(r.bal)}</div>
        </div>`).join('')}
    </div>
    <div class="card">
      <h3>Acumulado del período visible</h3>
      <div class="bar-row" style="grid-template-columns:120px 1fr auto">
        <div>Saldo neto 6 m</div><div></div>
        <div class="amt" style="color:${sum2(rows)>=0?'var(--income)':'var(--expense)'}">${fmt(sum2(rows))}</div>
      </div>
    </div>`;
}
const sum2 = (rows) => rows.reduce((a, r) => a + r.bal, 0);

function renderCategorias() {
  const movs = monthMovs();
  const build = (tipo) => {
    const map = {};
    movs.filter(m => m.tipo === tipo && m.estado !== 'pendiente').forEach(m => { map[m.categoria] = (map[m.categoria] || 0) + Number(m.monto || 0); });
    const items = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const tot = items.reduce((a, [, v]) => a + v, 0) || 1;
    return { items, tot };
  };
  const ing = build('ingreso'), egr = build('egreso');
  const block = (titulo, data, color) => `
    <div class="card">
      <div class="row-between" style="margin-bottom:10px"><h3>${titulo}</h3><strong>${fmt(data.tot===1&&!data.items.length?0:data.tot)}</strong></div>
      ${data.items.length ? data.items.map(([name, v]) => `
        <div class="cat-row" style="grid-template-columns:1fr">
          <div>
            <div style="display:flex;justify-content:space-between"><span class="cat-name">${esc(name)}</span><span class="cat-amt">${fmt(v)} <span style="color:var(--muted);font-weight:500;font-size:12px">(${Math.round(v/data.tot*100)}%)</span></span></div>
            <div class="cat-meter"><i style="width:${v/data.tot*100}%;background:${color}"></i></div>
          </div>
        </div>`).join('') : emptyHTML('Sin datos')}
    </div>`;
  content.innerHTML = block('Ingresos por categoría', ing, 'var(--income)') + block('Egresos por categoría', egr, 'var(--expense)');
}

function emptyHTML(msg) {
  return `<div class="empty"><div class="big">∅</div><p>${msg}</p><button class="btn-primary" onclick="document.getElementById('newBtn').click()">+ Registrar movimiento</button></div>`;
}

function wireRows() {
  content.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => openModal(state.movimientos.find(m => m.id === el.dataset.id))));
}

// ── Modal ─────────────────────────────────────────────────────────────────────
const modal = $('#modal');
function fillCategorias(tipo) {
  const sel = $('#f_categoria');
  sel.innerHTML = CATEGORIAS[tipo].map(c => `<option>${c}</option>`).join('');
}
function openModal(mov) {
  modal.hidden = false;
  $('#modalTitle').textContent = mov ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#deleteBtn').hidden = !mov;
  const tipo = mov?.tipo || 'ingreso';
  document.querySelector(`input[name="tipo"][value="${tipo}"]`).checked = true;
  fillCategorias(tipo);
  $('#f_id').value = mov?.id || '';
  $('#f_fecha').value = mov?.fecha || new Date().toISOString().slice(0, 10);
  $('#f_monto').value = mov?.monto ?? '';
  $('#f_categoria').value = mov?.categoria || CATEGORIAS[tipo][0];
  $('#f_descripcion').value = mov?.descripcion || '';
  $('#f_contraparte').value = mov?.contraparte || '';
  $('#f_documento').value = mov?.documento || '';
  $('#f_medio').value = mov?.medio || 'Transferencia';
  $('#f_estado').value = mov?.estado || 'pagado';
  $('#f_iva').checked = mov?.iva ?? true;
}
function closeModal() { modal.hidden = true; }

document.querySelectorAll('input[name="tipo"]').forEach(r => r.addEventListener('change', e => {
  const cur = $('#f_categoria').value;
  fillCategorias(e.target.value);
}));

$('#movForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const obj = {
    tipo: document.querySelector('input[name="tipo"]:checked').value,
    fecha: $('#f_fecha').value,
    monto: Number($('#f_monto').value || 0),
    categoria: $('#f_categoria').value,
    descripcion: $('#f_descripcion').value.trim(),
    contraparte: $('#f_contraparte').value.trim(),
    documento: $('#f_documento').value.trim(),
    medio: $('#f_medio').value,
    estado: $('#f_estado').value,
    iva: $('#f_iva').checked,
  };
  const id = $('#f_id').value;
  try {
    if (id) await backend.update(id, obj); else await backend.add(obj);
    closeModal(); toast(id ? 'Movimiento actualizado' : 'Movimiento guardado');
  } catch (err) { toast('Error al guardar: ' + err.message); }
});
$('#deleteBtn').addEventListener('click', async () => {
  const id = $('#f_id').value;
  if (id && confirm('¿Eliminar este movimiento?')) { await backend.remove(id); closeModal(); toast('Movimiento eliminado'); }
});

// ── Navegación / eventos globales ──────────────────────────────────────────────
function go(view) { state.view = view; render(); window.scrollTo({ top: 0 }); }
document.querySelectorAll('.nav-item, .bn-item').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
$('#newBtn').addEventListener('click', () => openModal(null));
$('#fab').addEventListener('click', () => openModal(null));
$('#modalClose').addEventListener('click', closeModal);
$('#cancelBtn').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

$('#prevMonth').addEventListener('click', () => { state.ref = new Date(state.ref.getFullYear(), state.ref.getMonth() - 1, 1); render(); });
$('#nextMonth').addEventListener('click', () => { state.ref = new Date(state.ref.getFullYear(), state.ref.getMonth() + 1, 1); render(); });
$('#todayBtn').addEventListener('click', () => { state.ref = new Date(); render(); });
$('#exportBtn').addEventListener('click', exportCSV);

let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2600); }

function exportCSV() {
  const movs = [...monthMovs()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!movs.length) return toast('No hay movimientos para exportar');
  const head = ['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Contraparte', 'Documento', 'Medio', 'Estado', 'IVA', 'Monto'];
  const lines = movs.map(m => [m.fecha, m.tipo, m.categoria, m.descripcion, m.contraparte, m.documento, m.medio, m.estado, m.iva ? 'Sí' : 'No', m.monto]
    .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
  const csv = '﻿' + [head.join(';'), ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `finanzas-sonqollay-${state.ref.getFullYear()}-${String(state.ref.getMonth()+1).padStart(2,'0')}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('CSV exportado');
}

// ── PWA: install + service worker ──────────────────────────────────────────────
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#installBtn').hidden = true; });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

// ── Arranque ────────────────────────────────────────────────────────────────────
(async function init() {
  try { backend = await makeFirebaseBackend(); } catch { backend = null; }
  if (backend) {
    $('#syncState').classList.add('cloud');
    $('#syncLabel').textContent = 'Nube (Firebase)';
    const chip = $('#syncChip');
    chip.classList.add('cloud');
    chip.innerHTML = '<span class="dot"></span>Nube';
  } else {
    backend = LocalBackend;
  }
  await backend.init((data) => { state.movimientos = data; render(); });
  render();
})();
