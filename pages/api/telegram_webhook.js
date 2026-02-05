import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Groq from 'groq-sdk';

// Función auxiliar para responder a Telegram
async function sendTelegramReply(token, chatId, text, replyToId = null) {
  try {
    const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
    if (replyToId) payload.reply_to_message_id = replyToId;
    
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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
    // DEFINICIÓN DEL PROMPT MAESTRO (Usado en Nuevo, Edición y Corrección)
    // ---------------------------------------------------------
    const generatePrompt = (text, isCorrection = false) => `
      Eres un contador experto analizando: "${text}"
      ${isCorrection ? 'ESTO ES UNA CORRECCIÓN DEL USUARIO. TUS REGLAS ANTERIORES NO IMPORTAN TANTO COMO LA INTENCIÓN ACTUAL.' : ''}

      --- REGLAS DE ORO (PRIORIDAD ALTA) ---
      1. SI EL TEXTO DICE "INGRESO", "RECIBÍ", "COBRÉ", "ENTRÓ": Clasifica SIEMPRE como 'income'.
      2. SI EL TEXTO DICE "GASTO", "PAGUÉ", "SALIDA", "COMPRA": Clasifica SIEMPRE como 'expense'.
      3. "Arriendo": Si no especifica, asume 'expense'. PERO si dice "cobro arriendo" o "ingreso arriendo", es 'income'.

      --- CLASIFICACIÓN ('type') ---
      - 'income': Entradas de dinero.
      - 'expense': Salidas de dinero.
      - 'debt_payment': Abonos a deudas (Tarjetas, créditos).

      --- ETIQUETAS ('tags') [Macro, Sub, Detalle] ---
      Usa la lista oficial de Macros:
      [Hogar, Transporte, Alimentación, Iglesia, Finca, Salud, Educación, Ocio, Deudas, Inversión, Ingresos]

      Ejemplos:
      - "Iglesia compra aseo" -> ["Iglesia", "Aseo", "Compra"] (La entidad 'Iglesia' manda sobre 'Hogar').
      - "Gasolina carro sofi" -> ["Transporte", "Gasolina", "Sofi"].
      - "Arriendo local 3" (si es ingreso) -> ["Ingresos", "Arriendo", "Local 3"].

      Salida JSON: { "amount": number, "type": "income"|"expense"|"debt_payment", "tags": string[] }
    `;

    // ==========================================
    // CASO 1: CORRECCIÓN POR RESPUESTA (REPLY)
    // ==========================================
    if (message.reply_to_message) {
      const originalMsgId = message.reply_to_message.message_id;
      const snapshot = await db.collection('artifacts').doc(APP_COLLECTION).collection('public').doc('data').collection('consolidated_finances').where('telegram_message_id', '==', originalMsgId).get();

      if (!snapshot.empty) {
        const docRef = snapshot.docs[0].ref;
        const originalData = snapshot.docs[0].data();
        
        // Combinamos el texto original con la corrección para darle contexto total a la IA
        const combinedText = `Texto Original: "${originalData.originalText}". Corrección del usuario: "${message.text}"`;
        
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
      }
    }

    // ==========================================
    // CASO 2 & 3: EDICIÓN O NUEVO MENSAJE
    // ==========================================
    
    // Analizar con el Prompt Maestro
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: generatePrompt(message.text, false) }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.0,
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    // Lógica de Guardado/Actualización
    if (req.body.edited_message) {
       const snapshot = await db.collection('artifacts').doc(APP_COLLECTION).collection('public').doc('data').collection('consolidated_finances').where('telegram_message_id', '==', message.message_id).get();

       if (!snapshot.empty) {
         await snapshot.docs[0].ref.update({
            originalText: message.text,
            amount: analysis.amount,
            type: analysis.type,
            tags: analysis.tags,
            updatedAt: new Date()
         });
         const typeLabel = analysis.type === 'income' ? 'INGRESO 🤑' : 'GASTO 💸';
         await sendTelegramReply(token, chatId, `✏️ *EDITADO A ${typeLabel}*\n\n💰 $${analysis.amount.toLocaleString()}\n📂 ${analysis.tags.join(' > ')}`, message.message_id);
         return res.status(200).json({ success: true });
       }
       // Si no encuentra el original en edición, no hace nada para evitar duplicados molestos
       return res.status(200).send('Edit target not found');
    }

    // Nuevo Registro
    await db.collection('artifacts').doc(APP_COLLECTION).collection('public').doc('data').collection('consolidated_finances').add({
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
    await sendTelegramReply(token, chatId, `✅ *${typeLabel} REGISTRADO*\n\n💰 $${analysis.amount.toLocaleString()}\n📂 ${analysis.tags.join(' > ')}`, message.message_id);
    
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("Error handler:", error);
    if (token && chatId && !req.body.edited_message) {
      await sendTelegramReply(token, chatId, `🔥 Error: ${error.message}`);
    }
    return res.status(500).send(error.message);
  }
}
