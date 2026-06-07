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
