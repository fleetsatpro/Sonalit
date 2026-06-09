/**
 * Firebase Cloud Messaging helper (Task 4.1)
 *
 * Sends push notifications to guardian devices via FCM.
 * Requires: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY env vars.
 * Gracefully no-ops if Firebase is not configured.
 */
const logger = require('./logger');

let firebaseApp = null;

function getApp() {
  if (firebaseApp) return firebaseApp;
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    return null;
  }
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length) {
      firebaseApp = admin.apps[0];
    } else {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: FIREBASE_PROJECT_ID,
          clientEmail: FIREBASE_CLIENT_EMAIL,
          privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }
    logger.info('Firebase Admin SDK initialized');
    return firebaseApp;
  } catch (err) {
    logger.warn('Firebase Admin SDK init failed: ' + err.message);
    return null;
  }
}

/**
 * Send a data-only FCM push to a device by its FCM registration token.
 * Returns true on success, false on failure (never throws).
 *
 * @param {string} fcmToken - Device FCM registration token
 * @param {string} title    - Notification title (used in notification payload)
 * @param {string} body     - Notification body
 * @param {Object} data     - Key-value data payload (string values only)
 */
async function sendPush(fcmToken, title, body, data = {}) {
  if (!fcmToken) return false;
  const app = getApp();
  if (!app) return false;
  try {
    const admin = require('firebase-admin');
    const stringData = {};
    for (const [k, v] of Object.entries(data)) {
      stringData[k] = String(v);
    }
    await admin.messaging(app).send({
      token: fcmToken,
      notification: { title, body },
      data: stringData,
      android: {
        priority: 'high',
        notification: { channelId: 'guardian_tracking' },
      },
    });
    logger.info(`FCM push sent to token=${fcmToken.slice(0, 8)}...`);
    return true;
  } catch (err) {
    logger.warn(`FCM push failed: ${err.message}`);
    return false;
  }
}

/**
 * Send command push to a device — data-only so Android onMessageReceived
 * fires even when the app is in background, triggering an immediate heartbeat.
 */
async function sendCommandPush(fcmToken, commandType, commandId) {
  if (!fcmToken) return false;
  const app = getApp();
  if (!app) return false;
  try {
    const admin = require('firebase-admin');
    await admin.messaging(app).send({
      token: fcmToken,
      // No notification field — data-only wakes background onMessageReceived
      data: { type: 'command', command_type: commandType, command_id: String(commandId) },
      android: { priority: 'high' },
    });
    logger.info(`FCM command push sent to token=${fcmToken.slice(0, 8)}... type=${commandType}`);
    return true;
  } catch (err) {
    logger.warn(`FCM command push failed: ${err.message}`);
    return false;
  }
}

/**
 * Send panic acknowledgment push to the triggering device.
 */
async function sendPanicAck(fcmToken, panicId) {
  return sendPush(fcmToken, 'SOS Received', 'Your SOS alert has been received by fleet management.', {
    type: 'panic_ack',
    panic_id: panicId,
  });
}

module.exports = { sendPush, sendCommandPush, sendPanicAck };
