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
  // Si Telegram manda una actualización sin mensaje de texto (ej: un pin), ignoramos.
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

    // 3. Procesar con IA (Llama 3.3)
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    
    const prompt = `
      Eres un contador experto. Analiza el mensaje: "${message.text}"
      
      Reglas OBLIGATORIAS de clasificación ('type'):
      - 'income': SOLO si el usuario RECIBE dinero. Ej: "Me pagaron", "Nómina", "Ingresó dinero".
      - 'expense': Si el usuario GASTA dinero. IMPORTANTE: "Pago de quincena a [Nombre]" es un GASTO (Salida). "Pagué la tarjeta" es un GASTO.
      - 'debt_payment': Específico para abonos a deudas propias.

      Reglas de extracción:
      - amount: Numero entero sin puntos.
      - tags: Categorías cortas y jerárquicas. Ej: "Pago quincena Omaira" -> ["Hogar", "Empleados", "Omaira"].
      
      Salida JSON: { "amount": number, "type": string, "tags": string[] }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.0,
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    // 4. Lógica de Guardado / Edición
    const APP_COLLECTION = process.env.NEXT_PUBLIC_APP_ID || 'Finanzas_familia';

    // A. SI ES UNA EDICIÓN
    if (req.body.edited_message) {
       console.log(`Buscando mensaje original ID: ${message.message_id}`);
       const snapshot = await db.collection('artifacts')
            .doc(APP_COLLECTION)
            .collection('public')
            .doc('data')
            .collection('consolidated_finances')
            .where('telegram_message_id', '==', message.message_id)
            .get();

       if (!snapshot.empty) {
         // Encontramos el original -> Actualizamos
         await snapshot.docs[0].ref.update({
            originalText: message.text,
            amount: analysis.amount,
            type: analysis.type,
            tags: analysis.tags,
            updatedAt: new Date()
         });
         
         // MENSAJE DE CONFIRMACIÓN DE EDICIÓN
         const typeLabel = analysis.type === 'income' ? 'INGRESO' : 'GASTO';
         await sendTelegramReply(token, chatId, `✏️ Mensaje editado correctamente.\nNueva clasificación: ${typeLabel} - $${analysis.amount.toLocaleString()}`);
         return res.status(200).json({ success: true });
       } else {
         // NO encontramos el original -> MENSAJE DE ERROR EXPLÍCITO
         await sendTelegramReply(token, chatId, `⚠️ Error: No encontré el registro original para editarlo.\n\n🗑️ Por favor elimina el registro incorrecto desde la App Web y envía el mensaje de nuevo.`);
         return res.status(200).send('Edit target not found');
       }
    }

    // B. SI ES UN MENSAJE NUEVO
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

    // MENSAJE DE CONFIRMACIÓN DE NUEVO REGISTRO (CON TIPO EXPLÍCITO)
    let typeLabel = "GASTO 💸";
    if (analysis.type === 'income') typeLabel = "INGRESO 🤑";
    if (analysis.type === 'debt_payment') typeLabel = "PAGO DEUDA 💳";

    await sendTelegramReply(token, chatId, `✅ ${typeLabel} registrado:\n💲 $${analysis.amount.toLocaleString()}\n🏷️ ${analysis.tags.join(', ')}`);
    
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("Error handler:", error);
    if (token && chatId) {
      await sendTelegramReply(token, chatId, `🔥 Error Crítico: ${error.message}`);
    }
    return res.status(500).send(error.message);
  }
}
