import admin from "../config/firebase.js";
import User from "../models/User.js"; // Required for Zombie Token cleanup
// 🛡️ IMPORTANT: Ensure your socket.js file exports 'userSocketMap'
import { userSocketMap } from "../socket.js"; 

/**
 * Handles sending FCM push notifications using the modern HTTP v1 API.
 * Includes Online User Filtering and Stale Token Cleanup.
 */
export const sendPushNotification = async (chat, sender, content, messageType = "text") => {
  try {
    // 1. 🛡️ ARCHITECTURAL UPGRADE: Filter out the sender AND actively connected users
    const offlineReceivers = chat.users.filter((u) => {
      const isSender = String(u._id) === String(sender._id);
      
      // Check if the user is currently in our Socket memory map
      // If they are online, we DO NOT send an FCM push to avoid the "double buzz"
      const isOnline = userSocketMap && userSocketMap[String(u._id)];
      
      return !isSender && !isOnline;
    });

    if (offlineReceivers.length === 0) return; // Everyone is online, abort FCM overhead!

    // 2. Flatten and deduplicate tokens for offline users only
    let tokens = offlineReceivers.flatMap((u) => u.fcmTokens || []);
    tokens = Array.from(new Set(tokens));

    if (tokens.length === 0) return;

    // 3. Format the body text dynamically
    let bodyText = content && content.length > 50 ? content.substring(0, 50) + "..." : content;
    if (messageType === "image") bodyText = "Sent an image 🖼️";
    if (messageType === "video") bodyText = "Sent a video 🎥";
    if (messageType === "file" && !content) bodyText = "Sent a file 📁";

    // 4. Dispatch the payloads
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
        token: token,
      };

      return admin.messaging().send(payload).catch(async (err) => {
        console.warn(`FCM delivery failed for token ${token.substring(0, 10)}... :`, err.code);
        
        // 5. 🛡️ ARCHITECTURAL UPGRADE: Zombie Token Cleanup
        if (
          err.code === 'messaging/invalid-registration-token' || 
          err.code === 'messaging/registration-token-not-registered'
        ) {
          // Locate the user who owns this dead token
          const userWithDeadToken = offlineReceivers.find(u => u.fcmTokens.includes(token));
          
          if (userWithDeadToken) {
            // Delete the token from MongoDB to save future bandwidth
            await User.findByIdAndUpdate(userWithDeadToken._id, {
              $pull: { fcmTokens: token }
            });
            console.log(`🧹 Cleaned up stale FCM token for user ${userWithDeadToken._id}`);
          }
        }
        return null;
      });
    });

    await Promise.all(sendPromises);

  } catch (error) {
    console.error("Notification Service Error:", error);
  }
};