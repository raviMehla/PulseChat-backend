import rateLimit from "express-rate-limit";

// 1. Global Limiter (General API Protection)
// Protects against basic volumetric DDoS and scraping
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per windowMs
  message: { message: "Too many requests from this IP, please try again later." },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// 2. Auth Limiter (Strict Protection)
// Protects against credential stuffing and brute force password guessing
export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 10, // Start blocking after 10 requests
  message: { message: "Too many login/register attempts, please try again after an hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

// 3. Message Limiter (Anti-Spam Protection)
// Prevents API-level message spam (Note: We will build a separate one for Sockets)
export const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Max 60 messages per minute via HTTP
  message: { message: "You are sending messages too quickly." },
  standardHeaders: true,
  legacyHeaders: false,
});

// 4. Heavy Compute / Media Limiter (Resource Protection)
// Protects endpoints that hit Cloudinary or do heavy DB aggregations (like Search)
export const heavyTaskLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // Max 20 heavy requests per 5 minutes
  message: { message: "Too many media uploads or complex queries, please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});