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

    // 3. Procesar con IA (MODELO ACTUALIZADO)
    // Usamos el mensaje de "Escribiendo..." nativo de Telegram para que se vea más fluido
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const prompt = `
      Analiza: "${message.text}"
      Contexto: Finanzas personales Colombia.
      Reglas:
      - amount: Numero puro (ej: 20000).
      - type: 'expense' (gasto), 'income' (ingreso), 'debt_payment' (pago deuda).
      - tags: Array de strings cortos (ej: ["Finca", "Cerdos"]).
      Salida JSON: { "amount": number, "type": string, "tags": string[] }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      // CAMBIO IMPORTANTE: Usamos el modelo más nuevo y estable
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    // 4. Guardar en Firestore
    await db.collection('artifacts')
            .doc(process.env.NEXT_PUBLIC_APP_ID || 'Finanzas_familia')
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

    await sendTelegramReply(token, chatId, `✅ Guardado: $${analysis.amount.toLocaleString()}\n🏷️ ${analysis.tags.join(', ')}`);
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error(error);
    if (token && chatId) {
      await sendTelegramReply(token, chatId, `🔥 Error: ${error.message}`);
    }
    return res.status(500).send(error.message);
  }
}
