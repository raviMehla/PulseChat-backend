import express from "express";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

/**
 * GET /api/call/ice-servers
 * 
 * Returns fresh TURN/STUN ICE server credentials from Metered.
 * Protected — only authenticated users can request credentials.
 * 
 * Why backend? To keep your METERED_API_KEY secret.
 * Metered credentials are time-limited (TTL-based), so fetching fresh
 * ones per call ensures they are always valid.
 */
router.get("/ice-servers", protect, async (req, res) => {
  try {
    const appName = process.env.METERED_APP_NAME;
    const apiKey  = process.env.METERED_API_KEY;

    if (!appName || !apiKey) {
      // Graceful fallback — return only Google STUN so calls still work on simple networks
      console.warn("[TURN] Metered credentials not configured. Falling back to STUN only.");
      return res.status(200).json({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" }
        ]
      });
    }

    // Fetch fresh credentials from Metered API
    const meteredUrl = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`;
    const response = await fetch(meteredUrl);

    if (!response.ok) {
      throw new Error(`Metered API returned ${response.status}: ${response.statusText}`);
    }

    const iceServers = await response.json();

    // Always prepend Google STUN as a fast first-hop fallback
    const finalIceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      ...iceServers
    ];

    return res.status(200).json({ iceServers: finalIceServers });

  } catch (err) {
    console.error("[TURN] Failed to fetch Metered ICE servers:", err.message);

    // Graceful degradation — still return STUN so calls work on open networks
    return res.status(200).json({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });
  }
});

export default router;
