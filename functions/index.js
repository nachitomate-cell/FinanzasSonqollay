/* Recordatorios de cobros/pagos pendientes — Finanzas Sonqollay.
   Schedule diario 09:00 (America/Santiago): para cada usuario, busca movimientos
   con estado "pendiente" cuya fecha de vencimiento esté vencida o caiga en los
   próximos 3 días, y envía un push consolidado a sus tokens FCM. */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const fmtCLP = (n) => '$' + Math.round(n || 0).toLocaleString('es-CL');
const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const numero = (m) => Number(m.monto || 0);

async function sendToUser(userRef, title, body) {
  const tokensSnap = await userRef.collection('fcmTokens').get();
  const tokens = tokensSnap.docs.map(d => d.id);
  if (!tokens.length) return;
  const res = await admin.messaging().sendEachForMulticast({ tokens, notification: { title, body } });
  res.responses.forEach((r, i) => {
    if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error?.code)) {
      userRef.collection('fcmTokens').doc(tokens[i]).delete().catch(() => {});
    }
  });
}

exports.dailyDueReminders = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Santiago' },
  async () => {
    const now = new Date();
    const today = dayStr(now);
    const in3 = dayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3));

    const users = await db.collection('users').listDocuments();
    for (const userRef of users) {
      const movsSnap = await userRef.collection('movimientos')
        .where('estado', '==', 'pendiente').get();

      const due = movsSnap.docs.map(d => d.data())
        .filter(m => m.vence && m.vence <= in3);
      if (!due.length) continue;

      const venc = due.filter(m => m.vence < today);
      const cobrar = due.filter(m => m.tipo === 'ingreso');
      const pagar = due.filter(m => m.tipo === 'egreso');
      const partes = [];
      if (cobrar.length) partes.push(`${cobrar.length} por cobrar (${fmtCLP(cobrar.reduce((a, m) => a + Number(m.monto || 0), 0))})`);
      if (pagar.length) partes.push(`${pagar.length} por pagar (${fmtCLP(pagar.reduce((a, m) => a + Number(m.monto || 0), 0))})`);

      const tokensSnap = await userRef.collection('fcmTokens').get();
      const tokens = tokensSnap.docs.map(d => d.id);
      if (!tokens.length) continue;

      const res = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: 'Finanzas Sonqollay — recordatorios',
          body: `${venc.length} vencido(s). ${partes.join(' · ')}`,
        },
      });
      // Limpiar tokens inválidos
      res.responses.forEach((r, i) => {
        if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error?.code)) {
          userRef.collection('fcmTokens').doc(tokens[i]).delete().catch(() => {});
        }
      });
    }
  }
);

// Resumen semanal — lunes 09:00 (America/Santiago): balance de la semana pasada.
exports.weeklySummary = onSchedule(
  { schedule: '0 9 * * 1', timeZone: 'America/Santiago' },
  async () => {
    const now = new Date();
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const from = dayStr(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7));
    const to = dayStr(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1));

    const users = await db.collection('users').listDocuments();
    for (const userRef of users) {
      const snap = await userRef.collection('movimientos').get();
      const ms = snap.docs.map(d => d.data()).filter(m => m.fecha >= from && m.fecha <= to && m.estado !== 'pendiente');
      if (!ms.length) continue;
      const tIn = ms.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + numero(m), 0);
      const tOut = ms.filter(m => m.tipo === 'egreso').reduce((a, m) => a + numero(m), 0);
      await sendToUser(userRef, 'Resumen semanal', `La semana pasada: ingresos ${fmtCLP(tIn)}, egresos ${fmtCLP(tOut)}. Balance ${fmtCLP(tIn - tOut)}.`);
    }
  }
);

// Recordatorio F29 / IVA — día 12 09:00: IVA estimado del mes anterior.
exports.monthlyF29Reminder = onSchedule(
  { schedule: '0 9 12 * *', timeZone: 'America/Santiago' },
  async () => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const ym = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

    const users = await db.collection('users').listDocuments();
    for (const userRef of users) {
      const snap = await userRef.collection('movimientos').get();
      const ms = snap.docs.map(d => d.data()).filter(m => (m.fecha || '').slice(0, 7) === ym);
      const debito = ms.filter(m => m.tipo === 'ingreso' && m.iva).reduce((a, m) => a + numero(m) * 0.19 / 1.19, 0);
      const credito = ms.filter(m => m.tipo === 'egreso' && m.iva).reduce((a, m) => a + numero(m) * 0.19 / 1.19, 0);
      await sendToUser(userRef, 'Recordatorio F29 / IVA', `Declara el F29 de ${meses[prev.getMonth()]}. IVA estimado: ${fmtCLP(debito - credito)}.`);
    }
  }
);
