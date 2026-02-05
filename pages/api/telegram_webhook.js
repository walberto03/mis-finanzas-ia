// api/telegram_webhook.js
// VERSIÓN 2.0: Soporte para editar mensajes

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Groq from 'groq-sdk';

// 1. Configuración de Firebase Admin
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error('Falta FIREBASE_SERVICE_ACCOUNT en variables de entorno');
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (initializeApp.apps.length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// 2. Configuración Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 3. IDs Autorizados
const ALLOWED_USERS = {
  [process.env.TELEGRAM_ID_HUSBAND]: 'Yo',
  [process.env.TELEGRAM_ID_WIFE]: 'Esposa'
};

// --- EL CEREBRO DE LA IA ---
async function analyzeTextWithAI(text) {
  const prompt = `
    Analiza este mensaje financiero.
    Contexto: Pareja colombiana. Gastos hogar, finca, salud.
    Mensaje: "${text}"
    Reglas:
    1. 'amount': Numero.
    2. 'type': 'expense', 'income', 'debt_payment'.
    3. 'tags': Array strings (Ej: ["Finca", "Cerdos"]).
    Responde SOLO JSON.
  `;
  const completion = await groq.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "llama3-8b-8192",
    temperature: 0.1,
    response_format: { type: "json_object" }
  });
  return JSON.parse(completion.choices[0].message.content);
}

// --- MANEJADOR DEL WEBHOOK ---
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST');

  // DETECTAR SI ES EDICIÓN: Telegram envía 'edited_message' en lugar de 'message'
  const message = req.body.message || req.body.edited_message;
  const isEdit = !!req.body.edited_message;

  if (!message || !message.text) return res.status(200).send('OK (No text)');
  
  const userId = message.from.id.toString();
  const senderName = ALLOWED_USERS[userId];

  if (!senderName) return res.status(200).send('Unauthorized');

  try {
    // 1. Analizar con IA (sea nuevo o editado, necesitamos re-calcular)
    const analysis = await analyzeTextWithAI(message.text);
    const collectionRef = db.collection('artifacts')
                            .doc(process.env.NEXT_PUBLIC_APP_ID || 'finance-app-advanced')
                            .collection('public')
                            .doc('data')
                            .collection('consolidated_finances');

    let responseEmoji = "✅";
    let actionText = "Guardado";

    if (isEdit) {
      // LOGICA DE EDICIÓN: Buscar el mensaje original por su ID de Telegram
      const snapshot = await collectionRef.where('telegram_message_id', '==', message.message_id).limit(1).get();
      
      if (!snapshot.empty) {
        // Actualizamos el documento existente
        const docRef = snapshot.docs[0].ref;
        await docRef.update({
          originalText: message.text,
          amount: analysis.amount,
          type: analysis.type,
          tags: analysis.tags,
          updatedAt: new Date()
        });
        responseEmoji = "✏️";
        actionText = "Corregido";
      } else {
        // Si no encontramos el original (raro), no hacemos nada para evitar duplicados
        return res.status(200).send('Original not found');
      }
    } else {
      // LOGICA DE NUEVO MENSAJE
      await collectionRef.add({
        originalText: message.text,
        amount: analysis.amount,
        type: analysis.type,
        tags: analysis.tags,
        sender: senderName,
        createdAt: new Date(),
        telegram_message_id: message.message_id, // IMPORTANTE: Guardamos el ID para poder editarlo después
        source: 'telegram_bot'
      });
    }

    // 2. Confirmar a Telegram
    const replyText = `${responseEmoji} ${actionText}: $${analysis.amount.toLocaleString()}\n🏷️ ${analysis.tags.join(', ')}`;
    
    // Solo enviamos respuesta si es nuevo. Si es edición, Telegram actualiza silenciosamente o mandamos un mensaje nuevo si prefieres.
    // Para no ser molestos en ediciones, podemos enviar un mensaje normal.
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: replyText,
        reply_to_message_id: message.message_id // Respondemos al mensaje específico
      })
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).send('Error');
  }
}
