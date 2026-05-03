import admin from "../config/firebase.js";

/**
 * Handles sending FCM multicast push notifications.
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

    // 4. Construct Payload
    const payload = {
      notification: {
        title: chat.isGroup ? chat.chatName : sender.name,
        body: bodyText,
      },
      data: {
        chatId: String(chat._id),
        type: "new_message",
      },
      tokens: tokens,
    };

    // 5. Fire and Forget (🛡️ FIX: Used legacy sendMulticast for v10 and below compatibility)
    if (admin.messaging && typeof admin.messaging().sendMulticast === 'function') {
      admin.messaging().sendMulticast(payload)
        .then(res => {
          if (res.failureCount > 0) {
            console.warn(`FCM: ${res.failureCount} tokens failed delivery.`);
          }
        })
        .catch(err => console.error("FCM Delivery Error:", err));
    } else {
      console.warn("FCM SDK Warning: sendMulticast method not found. Ensure firebase-admin is correctly configured.");
    }

  } catch (error) {
    console.error("Notification Service Error:", error);
  }
};