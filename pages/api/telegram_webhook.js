import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Groq from 'groq-sdk';

// Función auxiliar para responder a Telegram pase lo que pase
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
  // Si es solo un ping de Telegram sin mensaje de texto, retornamos OK
  if (!message) return res.status(200).send('OK');

  const chatId = message.chat.id;
  const token = process.env.TELEGRAM_BOT_TOKEN;

  try {
    // 1. Verificar Variables Críticas
    if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN en Vercel");
    if (!process.env.GROQ_API_KEY) throw new Error("Falta GROQ_API_KEY en Vercel");
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Falta FIREBASE_SERVICE_ACCOUNT en Vercel");

    // 2. Inicializar Firebase (Punto crítico de fallos JSON)
    if (getApps().length === 0) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        initializeApp({ credential: cert(serviceAccount) });
      } catch (jsonError) {
        await sendTelegramReply(token, chatId, "🚨 Error Crítico: Tu variable FIREBASE_SERVICE_ACCOUNT en Vercel tiene un error de formato (JSON inválido). Revisa que no falten llaves { } o comillas.");
        return res.status(500).send('Invalid JSON');
      }
    }
    const db = getFirestore();

    // 3. Verificar Identidad
    const userId = message.from.id.toString();
    const ALLOWED_USERS = {
      [process.env.TELEGRAM_ID_HUSBAND]: 'Yo',
      [process.env.TELEGRAM_ID_WIFE]: 'Esposa'
    };
    
    const senderName = ALLOWED_USERS[userId];

    if (!senderName) {
      // MODO DEBUG: Avisar al usuario cuál es su ID para que lo corrija
      await sendTelegramReply(token, chatId, `⚠️ Acceso Denegado.\nTu ID real es: ${userId}\nEn Vercel pusiste: ${process.env.TELEGRAM_ID_HUSBAND} y ${process.env.TELEGRAM_ID_WIFE}`);
      return res.status(200).send('Unauthorized');
    }

    // 4. Procesar con IA
    await sendTelegramReply(token, chatId, "⏳ Procesando..."); // Feedback inmediato

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const prompt = `
      Analiza: "${message.text}"
      Contexto: Finanzas personales Colombia.
      Salida JSON: { "amount": number, "type": "expense"|"income"|"debt_payment", "tags": string[] }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama3-8b-8192",
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    // 5. Guardar en Firestore
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
      await sendTelegramReply(token, chatId, `🔥 Error del Sistema: ${error.message}`);
    }
    return res.status(500).send(error.message);
  }
}
