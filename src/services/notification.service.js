import admin from "../config/firebase.js";
import User from "../models/User.js"; // Required for Zombie Token cleanup
import { getIO, onlineRegistry } from "../socket.js"; 

/**
 * Handles sending FCM push notifications using the modern HTTP v1 API.
 * Includes Online User Filtering and Stale Token Cleanup.
 */
export const sendPushNotification = async (chat, sender, content, messageType = "text") => {
  try {
    const io = getIO();

    // 1. 🛡️ ARCHITECTURAL UPGRADE: Filter out the sender AND actively connected users
    // We check for active sockets in their cluster-wide personal rooms.
    const onlineCheckPromises = chat.users.map(async (u) => {
      const isSender = String(u._id) === String(sender._id);
      if (isSender) return { user: u, shouldNotify: false };
      
      let isOnline = false;
      try {
        const sockets = await io.in(String(u._id)).fetchSockets();
        isOnline = sockets.some(s => s.data?.platform === "mobile");
      } catch (err) {
        // Fallback to onlineRegistry if cluster query fails
        const platforms = await onlineRegistry.getPlatforms(String(u._id));
        isOnline = platforms.includes("mobile");
      }
      
      return { user: u, shouldNotify: !isOnline };
    });

    const results = await Promise.all(onlineCheckPromises);
    const offlineReceivers = results.filter((r) => r.shouldNotify).map((r) => r.user);

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
    const sendPromises = tokens.map(async (token) => {
      if (token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")) {
        // Expo Push API delivery
        const expoPayload = {
          to: token,
          title: chat.isGroup ? chat.chatName : sender.name,
          body: bodyText,
          data: {
            chatId: String(chat._id),
            type: "new_message",
          },
          sound: "default",
          channelId: "messages",
        };

        try {
          const res = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "Accept-Encoding": "gzip, deflate",
            },
            body: JSON.stringify(expoPayload),
          });

          if (!res.ok) {
            const errText = await res.text();
            console.warn(`Expo push delivery failed for token ${token.substring(0, 10)}... : HTTP ${res.status} - ${errText}`);
            return null;
          }

          const responseData = await res.json();
          if (responseData.errors) {
            console.warn(`Expo push delivery returned errors for token ${token.substring(0, 10)}... :`, responseData.errors);
          } else if (responseData.data) {
            const results = Array.isArray(responseData.data) ? responseData.data : [responseData.data];
            for (const result of results) {
              if (result.status === "error") {
                console.warn(`Expo push delivery status error:`, result.message);
                if (result.details?.error === "DeviceNotRegistered") {
                  // Clean up stale token
                  const userWithDeadToken = offlineReceivers.find(u => u.fcmTokens?.includes(token));
                  if (userWithDeadToken) {
                    await User.findByIdAndUpdate(userWithDeadToken._id, {
                      $pull: { fcmTokens: token }
                    });
                    console.log(`🧹 Cleaned up stale Expo token for user ${userWithDeadToken._id}`);
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error(`Expo push connection error for token ${token.substring(0, 10)}... :`, err.message);
        }
        return null;
      } else {
        // Native FCM delivery
        const payload = {
          notification: {
            title: chat.isGroup ? chat.chatName : sender.name,
            body: bodyText,
          },
          data: {
            chatId: String(chat._id),
            type: "new_message",
          },
          webpush: {
            notification: {
              icon: "/vite.svg",
              badge: "/vite.svg",
            }
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
            const userWithDeadToken = offlineReceivers.find(u => u.fcmTokens?.includes(token));
            
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
      }
    });

    await Promise.all(sendPromises);

  } catch (error) {
    console.error("Notification Service Error:", error);
  }
};