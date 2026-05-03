import admin from "../config/firebase.js";

/**
 * Handles sending FCM push notifications using the modern HTTP v1 API fallback.
 * @param {Object} chat - The populated chat object.
 * @param {Object} sender - The user object sending the message.
 * @param {String} content - The text content of the message.
 * @param {String} messageType - The type of message (text, image, video).
 */
export const sendPushNotification = async (chat, sender, content, messageType = "text") => {
  try {
    // 1. Filter out the sender from receivers
    const receivers = chat.users.filter(
      (u) => String(u._id) !== String(sender._id)
    );

    // 2. Flatten and deduplicate tokens
    let tokens = receivers.flatMap((u) => u.fcmTokens || []);
    tokens = Array.from(new Set(tokens));

    if (tokens.length === 0) return;

    // 3. Format the body text dynamically
    let bodyText = content && content.length > 50 ? content.substring(0, 50) + "..." : content;
    if (messageType === "image") bodyText = "Sent an image 📷";
    if (messageType === "video") bodyText = "Sent a video 🎥";
    if (messageType === "file" && !content) bodyText = "Sent a file 📎";

    // 4. 🛡️ ARCHITECTURAL FIX: Bypass the dead /batch API by mapping individual sends.
    // This utilizes the modern HTTP v1 API under the hood, avoiding SDK version conflicts.
    const sendPromises = tokens.map((token) => {
      const payload = {
        notification: {
          title: chat.isGroup ? chat.chatName : sender.name,
          body: bodyText,
        },
        data: {
          chatId: String(chat._id),
          type: "new_message",
        },
        token: token, // Target single token
      };

      // Fire the individual send request and catch isolated failures safely
      return admin.messaging().send(payload).catch((err) => {
        console.warn(`FCM delivery failed for token ${token.substring(0, 10)}... :`, err.message);
        return null; // Resolve the promise as null so Promise.all does not fail
      });
    });

    // 5. Execute all network requests concurrently
    await Promise.all(sendPromises);

  } catch (error) {
    console.error("Notification Service Error:", error);
  }
};