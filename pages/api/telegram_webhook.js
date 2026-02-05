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

    // Feedback de "Escribiendo..."
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const APP_COLLECTION = process.env.NEXT_PUBLIC_APP_ID || 'Finanzas_familia';

    // ==========================================
    // CASO 1: CORRECCIÓN POR RESPUESTA (REPLY)
    // ==========================================
    if (message.reply_to_message) {
      // Buscamos el mensaje original al que se está respondiendo
      const originalMsgId = message.reply_to_message.message_id;
      
      const snapshot = await db.collection('artifacts')
            .doc(APP_COLLECTION)
            .collection('public')
            .doc('data')
            .collection('consolidated_finances')
            .where('telegram_message_id', '==', originalMsgId)
            .get();

      if (!snapshot.empty) {
        const docRef = snapshot.docs[0].ref;
        const originalData = snapshot.docs[0].data();

        // Prompt especial para CORRECCIONES INTELIGENTES
        const correctionPrompt = `
          Eres un asistente contable corrigiendo un registro existente.
          
          DATOS ORIGINALES:
          - Texto: "${originalData.originalText}"
          - Monto Actual: ${originalData.amount}
          - Tags Actuales: ${originalData.tags.join(', ')}

          INSTRUCCIÓN DEL USUARIO (Corrección): "${message.text}"

          OBJETIVO: Generar el nuevo JSON actualizado combinando los datos originales con la instrucción.
          
          REGLAS:
          1. Si la instrucción cambia la categoría (ej: "Es Iglesia", "Ponlo en Transporte"), actualiza los 'tags' manteniendo la jerarquía estricta.
          2. Si la instrucción cambia el monto (ej: "Eran 50mil"), actualiza 'amount'.
          3. Si la instrucción aclara detalles (ej: "Fue en D1"), agrégalo a los tags.
          4. Mantén la estructura de Tags estricta: [Macro, Sub, Detalle].
          
          Salida JSON: { "amount": number, "type": "income"|"expense"|"debt_payment", "tags": string[] }
        `;

        const completion = await groq.chat.completions.create({
          messages: [{ role: "user", content: correctionPrompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.0,
          response_format: { type: "json_object" }
        });

        const updatedAnalysis = JSON.parse(completion.choices[0].message.content);

        // Actualizar en BD
        await docRef.update({
          amount: updatedAnalysis.amount,
          type: updatedAnalysis.type,
          tags: updatedAnalysis.tags,
          updatedAt: new Date(),
          correctionNote: message.text // Guardamos qué pidió el usuario para historial
        });

        await sendTelegramReply(token, chatId, `🔄 *CORRECCIÓN APLICADA*\n\nAntes: ${originalData.tags[0]} ($${originalData.amount})\nAhora: ${updatedAnalysis.tags[0]} ($${updatedAnalysis.amount.toLocaleString()})\n📂 ${updatedAnalysis.tags.join(' > ')}`, message.message_id);
        return res.status(200).json({ success: true });

      } else {
        // Si responde a un mensaje que no es un gasto registrado (ej: responde al bot)
        await sendTelegramReply(token, chatId, `⚠️ No puedo corregir esto.\n\nPara modificar un gasto, debes hacer **Responder (Reply)** directamente al mensaje TUYO donde escribiste el gasto original (no al mensaje del bot).`, message.message_id);
        return res.status(200).send('Target not found');
      }
    }

    // ==========================================
    // CASO 2: EDICIÓN DE MENSAJE (EDIT)
    // ==========================================
    if (req.body.edited_message) {
       // ... (Misma lógica de edición nativa que ya teníamos)
       const snapshot = await db.collection('artifacts')
            .doc(APP_COLLECTION)
            .collection('public')
            .doc('data')
            .collection('consolidated_finances')
            .where('telegram_message_id', '==', message.message_id)
            .get();

       if (!snapshot.empty) {
         // Re-analizar el texto editado
         const editPrompt = `Analiza gasto: "${message.text}". Reglas estrictas tags [Macro, Sub]. JSON: {amount, type, tags}`;
         const editCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: editPrompt }],
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
         
         await sendTelegramReply(token, chatId, `✏️ *EDITADO*\n📂 ${editAnalysis.tags.join(' > ')}`, message.message_id);
         return res.status(200).json({ success: true });
       }
       return res.status(200).send('Edit target not found');
    }

    // ==========================================
    // CASO 3: MENSAJE NUEVO (REGISTRO NORMAL)
    // ==========================================
    const prompt = `
      Eres un contador experto. Analiza el mensaje: "${message.text}"
      
      OBJETIVO: Clasificar y etiquetar garantizando que NUNCA falten los nombres o entidades clave.

      1. REGLA DE ORO (Categoría Macro):
         La PRIMERA etiqueta ('tags[0]') DEBE ser una de estas:
         - "Hogar", "Transporte", "Alimentación", "Iglesia", "Finca", "Salud", "Educación", "Ocio", "Deudas", "Otros".

      2. REGLA DE ENTIDADES (OBLIGATORIA):
         Si menciona "Sofi", "Omaira", "Tania", "Iglesia" o "Finca", ese nombre DEBE estar en los tags.
         Ej: "Gasolina carro sofi" -> ["Transporte", "Gasolina", "Sofi"].

      Salida JSON: { "amount": number, "type": "income" | "expense" | "debt_payment", "tags": string[] }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.0,
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

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

    let typeLabel = analysis.type === 'income' ? "INGRESO 🤑" : "GASTO 💸";
    await sendTelegramReply(token, chatId, `✅ *${typeLabel} REGISTRADO*\n\n💰 $${analysis.amount.toLocaleString()}\n📂 ${analysis.tags.join(' > ')}\n\n_💡 Para corregir: Responde (Reply) a este mensaje con la corrección._`, message.message_id);
    
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("Error handler:", error);
    // Solo respondemos errores si no es una edición silenciosa
    if (token && chatId && !req.body.edited_message) {
      await sendTelegramReply(token, chatId, `🔥 Error: ${error.message}`);
    }
    return res.status(500).send(error.message);
  }
}
