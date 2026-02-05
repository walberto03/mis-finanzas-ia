import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Groq from 'groq-sdk';

// Función auxiliar para responder a Telegram
// AHORA RETORNA EL ID DEL MENSAJE ENVIADO PARA GUARDARLO
async function sendTelegramReply(token, chatId, text, replyToId = null) {
  try {
    const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
    if (replyToId) payload.reply_to_message_id = replyToId;
    
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    return data.result?.message_id; // Retornamos el ID
  } catch (e) {
    console.error("Error enviando respuesta a Telegram", e);
    return null;
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
      await sendTelegramReply(token, chatId, `⚠️ *Acceso Denegado*\nTu ID: \`${userId}\``);
      return res.status(200).send('Unauthorized');
    }

    // Feedback
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const APP_COLLECTION = process.env.NEXT_PUBLIC_APP_ID || 'Finanzas_familia';

    // ---------------------------------------------------------
    // PROMPT MAESTRO
    // ---------------------------------------------------------
    const generatePrompt = (text, isCorrection = false) => `
      Eres un contador experto analizando: "${text}"
      ${isCorrection ? 'ESTO ES UNA CORRECCIÓN. IGNORA CLASIFICACIONES PREVIAS SI CONTRADICEN ESTA.' : ''}

      --- REGLAS PRIORITARIAS ---
      1. "INGRESO", "RECIBÍ", "COBRÉ": Clasifica como 'income'.
      2. "GASTO", "PAGUÉ", "SALIDA", "COMPRA": Clasifica como 'expense'.
      3. "Arriendo": Si no se especifica, 'expense'. Si dice "cobro", 'income'.

      --- ETIQUETAS ('tags') [Macro, Sub, Detalle] ---
      Usa la lista oficial de Macros:
      [Hogar, Transporte, Alimentación, Iglesia, Finca, Salud, Educación, Ocio, Deudas, Inversión, Ingresos]

      Ejemplos:
      - "Iglesia compra aseo" -> ["Iglesia", "Aseo", "Compra"]
      - "Gasolina carro sofi" -> ["Transporte", "Gasolina", "Sofi"]

      Salida JSON: { "amount": number, "type": "income"|"expense"|"debt_payment", "tags": string[] }
    `;

    // ==========================================
    // CASO 1: RESPUESTA (REPLY) -> CORREGIR O BORRAR
    // ==========================================
    if (message.reply_to_message) {
      const targetId = message.reply_to_message.message_id;
      
      // INTENTO 1: Buscar por ID del mensaje original del usuario
      let snapshot = await db.collection('artifacts').doc(APP_COLLECTION).collection('public').doc('data').collection('consolidated_finances')
        .where('telegram_message_id', '==', targetId).get();

      // INTENTO 2: Buscar por ID de la respuesta del bot (Si el usuario respondió al bot)
      if (snapshot.empty) {
         snapshot = await db.collection('artifacts').doc(APP_COLLECTION).collection('public').doc('data').collection('consolidated_finances')
        .where('bot_reply_id', '==', targetId).get();
      }

      if (!snapshot.empty) {
        const docRef = snapshot.docs[0].ref;
        
        // --- SUB-CASO: ELIMINAR ---
        const textLower = message.text.toLowerCase().trim();
        if (['borrar', 'eliminar', 'quitar', 'delete', 'borralo'].includes(textLower)) {
           await docRef.delete();
           await sendTelegramReply(token, chatId, `🗑️ *REGISTRO ELIMINADO*`, message.message_id);
           return res.status(200).json({ success: true });
        }

        // --- SUB-CASO: CORREGIR ---
        const originalData = snapshot.docs[0].data();
        const combinedText = `Texto Original: "${originalData.originalText}". Corrección: "${message.text}"`;
        
        const completion = await groq.chat.completions.create({
          messages: [{ role: "user", content: generatePrompt(combinedText, true) }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.0,
          response_format: { type: "json_object" }
        });

        const updatedAnalysis = JSON.parse(completion.choices[0].message.content);

        await docRef.update({
          amount: updatedAnalysis.amount,
          type: updatedAnalysis.type,
          tags: updatedAnalysis.tags,
          updatedAt: new Date(),
          correctionNote: message.text
        });

        const typeLabel = updatedAnalysis.type === 'income' ? 'INGRESO 🤑' : 'GASTO 💸';
        await sendTelegramReply(token, chatId, `🔄 *CORREGIDO A ${typeLabel}*\n\n💰 $${updatedAnalysis.amount.toLocaleString()}\n📂 ${updatedAnalysis.tags.join(' > ')}`, message.message_id);
        return res.status(200).json({ success: true });
      } else {
        // Si no se encuentra nada
        // Evitamos responder si el usuario está hablando con otra persona respondiendo mensajes viejos
        // Pero si es reciente, avisamos.
        await sendTelegramReply(token, chatId, `⚠️ No encontré el registro para corregir.\nIntenta responder al mensaje del Bot de confirmación.`, message.message_id);
        return res.status(200).send('Target not found');
      }
    }

    // ==========================================
    // CASO 2: EDICIÓN DE MENSAJE (EDIT)
    // ==========================================
    if (req.body.edited_message) {
       const snapshot = await db.collection('artifacts').doc(APP_COLLECTION).collection('public').doc('data').collection('consolidated_finances').where('telegram_message_id', '==', message.message_id).get();

       if (!snapshot.empty) {
         // Re-analizar texto editado
         const editCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: generatePrompt(message.text, false) }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
         });
         const editAnalysis = JSON.parse(editCompletion.choices[0].message.content);

         await snapshot.docs[0].ref.update({
            originalText: message.text,
            amount: editAnalysis.amount,
            type: editAnalysis.type,
            tags: editAnalysis.tags,
            updatedAt: new Date()
         });
         
         const typeLabel = editAnalysis.type === 'income' ? 'INGRESO 🤑' : 'GASTO 💸';
         await sendTelegramReply(token, chatId, `✏️ *EDITADO A ${typeLabel}*\n\n💰 $${editAnalysis.amount.toLocaleString()}\n📂 ${editAnalysis.tags.join(' > ')}`, message.message_id);
         return res.status(200).json({ success: true });
       }
       return res.status(200).send('Edit target not found');
    }

    // ==========================================
    // CASO 3: NUEVO MENSAJE
    // ==========================================
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: generatePrompt(message.text, false) }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.0,
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    // Guardamos el documento PRIMERO para tener la referencia
    const docRef = await db.collection('artifacts').doc(APP_COLLECTION).collection('public').doc('data').collection('consolidated_finances').add({
      originalText: message.text,
      amount: analysis.amount,
      type: analysis.type,
      tags: analysis.tags,
      sender: senderName,
      createdAt: new Date(),
      telegram_message_id: message.message_id, 
      source: 'telegram_bot'
    });

    let typeLabel = analysis.type === 'income' ? "INGRESO 🤑" : (analysis.type === 'debt_payment' ? "ABONO 💳" : "GASTO 💸");
    
    // Enviamos respuesta y CAPTURAMOS su ID
    const botReplyId = await sendTelegramReply(token, chatId, `✅ *${typeLabel} REGISTRADO*\n\n💰 $${analysis.amount.toLocaleString()}\n📂 ${analysis.tags.join(' > ')}\n\n_💡 Tips:\n✏️ Edita para corregir.\n↩️ Responde "Borrar" a este mensaje para eliminar._`, message.message_id);
    
    // Actualizamos el documento con el ID de la respuesta del bot
    // Esto permite que si el usuario responde a ESTE mensaje del bot, podamos encontrar el registro.
    if (botReplyId) {
        await docRef.update({ bot_reply_id: botReplyId });
    }
    
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("Error handler:", error);
    if (token && chatId && !req.body.edited_message) {
      await sendTelegramReply(token, chatId, `🔥 Error: ${error.message}`);
    }
    return res.status(500).send(error.message);
  }
}
