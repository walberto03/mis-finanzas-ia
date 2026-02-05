import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Groq from 'groq-sdk';

// Función auxiliar para responder a Telegram
async function sendTelegramReply(token, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text })
    });
  } catch (e) {
    console.error("Error enviando respuesta a Telegram", e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST');
  
  const message = req.body.message || req.body.edited_message;
  if (!message) return res.status(200).send('OK');

  const chatId = message.chat.id;
  const token = process.env.TELEGRAM_BOT_TOKEN;

  try {
    // 1. Inicializar Firebase
    if (getApps().length === 0) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        initializeApp({ credential: cert(serviceAccount) });
      } catch (jsonError) {
        await sendTelegramReply(token, chatId, "🚨 Error JSON en Vercel. Revisa FIREBASE_SERVICE_ACCOUNT.");
        return res.status(500).send('Invalid JSON');
      }
    }
    const db = getFirestore();

    // 2. Verificar Identidad
    const userId = message.from.id.toString();
    const ALLOWED_USERS = {
      [process.env.TELEGRAM_ID_HUSBAND]: 'Yo',
      [process.env.TELEGRAM_ID_WIFE]: 'Esposa'
    };
    
    const senderName = ALLOWED_USERS[userId];

    if (!senderName) {
      await sendTelegramReply(token, chatId, `⚠️ Acceso Denegado.\nTu ID real es: ${userId}`);
      return res.status(200).send('Unauthorized');
    }

    // 3. Procesar con IA
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    
    // --- PROMPT BLINDADO: LISTA CERRADA DE CATEGORÍAS ---
    const prompt = `
      Eres un contador experto. Analiza el mensaje: "${message.text}"
      
      OBJETIVO: Clasificar y etiquetar con una jerarquía estricta para evitar filtros desordenados.

      1. REGLA DE ORO (Categoría Macro):
         La PRIMERA etiqueta ('tags[0]') DEBE ser obligatoriamente una de estas:
         - "Hogar"
         - "Transporte"
         - "Alimentación"
         - "Salud"
         - "Educación"
         - "Ocio"
         - "Mascotas/Finca"
         - "Deudas"
         - "Otros"

      2. REGLAS ESPECÍFICAS DE TRANSPORTE:
         - "Gasolina", "Tanqueada", "Gas": -> ["Transporte", "Combustible"]
         - "Lavada", "Lavado", "Limpieza", "Aspirada": -> ["Transporte", "Limpieza"] (NO usar 'Mantenimiento').
         - "Aceite", "Taller", "Revisión", "Llantas", "Repuesto", "Mecánico": -> ["Transporte", "Mantenimiento"].
         - "Parqueadero": -> ["Transporte", "Parqueadero"].
         - "Papeles", "Seguro", "Soat": -> ["Transporte", "Legales"].

      3. PROHIBICIONES:
         - NUNCA pongas como primera etiqueta: "Pago", "Quincena", "Mensualidad", "Compra", "Lavada".
         - NUNCA inventes categorías macro nuevas fuera de la lista de la regla 1.

      REGLAS DE TIPO ('type'):
      - 'income': Entradas de dinero.
      - 'expense': Salidas de dinero.
      - 'debt_payment': Abonos a deuda.

      Salida JSON: { "amount": number, "type": "income" | "expense" | "debt_payment", "tags": string[] }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.0,
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    // 4. Guardar / Editar
    const APP_COLLECTION = process.env.NEXT_PUBLIC_APP_ID || 'Finanzas_familia';

    if (req.body.edited_message) {
       const snapshot = await db.collection('artifacts')
            .doc(APP_COLLECTION)
            .collection('public')
            .doc('data')
            .collection('consolidated_finances')
            .where('telegram_message_id', '==', message.message_id)
            .get();

       if (!snapshot.empty) {
         await snapshot.docs[0].ref.update({
            originalText: message.text,
            amount: analysis.amount,
            type: analysis.type,
            tags: analysis.tags,
            updatedAt: new Date()
         });
         
         const typeLabel = analysis.type === 'income' ? 'INGRESO 🤑' : 'GASTO 💸';
         await sendTelegramReply(token, chatId, `✏️ ACTUALIZADO CORRECTAMENTE\n\n${typeLabel}: $${analysis.amount.toLocaleString()}\n📂 ${analysis.tags.join(' > ')}`);
         return res.status(200).json({ success: true });
       } else {
         await sendTelegramReply(token, chatId, `⚠️ No encontré el mensaje original para editarlo. Por favor bórralo en la Web y envíalo de nuevo.`);
         return res.status(200).send('Edit target not found');
       }
    }

    await db.collection('artifacts')
            .doc(APP_COLLECTION)
            .collection('public')
            .doc('data')
            .collection('consolidated_finances')
            .add({
              originalText: message.text,
              amount: analysis.amount,
              type: analysis.type,
              tags: analysis.tags,
              sender: senderName,
              createdAt: new Date(),
              telegram_message_id: message.message_id, 
              source: 'telegram_bot'
            });

    let typeLabel = "GASTO 💸";
    if (analysis.type === 'income') typeLabel = "INGRESO 🤑";
    if (analysis.type === 'debt_payment') typeLabel = "ABONO DEUDA 💳";

    await sendTelegramReply(token, chatId, `✅ ${typeLabel} REGISTRADO\n\n💰 $${analysis.amount.toLocaleString()}\n📂 ${analysis.tags.join(' > ')}`);
    
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("Error handler:", error);
    if (token && chatId) {
      await sendTelegramReply(token, chatId, `🔥 Error: ${error.message}`);
    }
    return res.status(500).send(error.message);
  }
}
