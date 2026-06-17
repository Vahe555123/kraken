import { readFile } from 'node:fs/promises';

let messaging = null;

export async function initFirebase() {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) {
    console.log('[Firebase] FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled');
    return;
  }
  try {
    let serviceAccount;
    try { serviceAccount = JSON.parse(sa); }
    catch { serviceAccount = JSON.parse(await readFile(sa, 'utf8')); }

    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');

    if (!getApps().length) {
      initializeApp({ credential: cert(serviceAccount) });
    }
    messaging = getMessaging();
    console.log('[Firebase] FCM ready');
  } catch (e) {
    console.warn('[Firebase] init failed (push disabled):', e.message);
  }
}

export async function sendPush(deviceToken, title, body) {
  if (!messaging || !deviceToken) return false;
  try {
    await messaging.send({
      token: deviceToken,
      notification: { title, body },
      android: {
        priority: 'high',
        notification: { sound: 'default', channel_id: 'chat_messages' },
      },
    });
    return true;
  } catch (e) {
    console.error('[Firebase] sendPush error:', e?.message);
    return false;
  }
}

export function isFirebaseReady() { return !!messaging; }
