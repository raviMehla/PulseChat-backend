/**
 * sanitize.middleware.js — Input Sanitization Middleware
 *
 * Protects against:
 *  - NoSQL Injection: strips MongoDB operator keys ($where, $regex, etc.) from req.body, req.query, req.params
 *  - XSS: strips <script> tags and dangerous HTML from string values in the request body
 *
 * Applied globally BEFORE route handlers in server.js.
 */

const MONGO_OPERATOR_REGEX = /^\$/;
const SCRIPT_TAG_REGEX = /<\s*\/?\s*script[^>]*>/gi;
const IFRAME_TAG_REGEX = /<\s*\/?\s*iframe[^>]*>/gi;
const ON_EVENT_REGEX = /\bon\w+\s*=/gi; // onerror=, onclick=, etc.

/**
 * Recursively sanitizes an object by:
 * 1. Removing keys that start with "$" (NoSQL injection prevention)
 * 2. Stripping dangerous HTML from string values (XSS prevention)
 */
function sanitizeValue(value) {
  if (typeof value === 'string') {
    return value
      .replace(SCRIPT_TAG_REGEX, '')
      .replace(IFRAME_TAG_REGEX, '')
      .replace(ON_EVENT_REGEX, '');
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value !== null && typeof value === 'object') {
    return sanitizeObject(value);
  }

  return value;
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const cleaned = {};
  for (const key of Object.keys(obj)) {
    // Drop any key starting with "$" — prevents $where, $gt injection etc.
    if (MONGO_OPERATOR_REGEX.test(key)) {
      continue;
    }
    cleaned[key] = sanitizeValue(obj[key]);
  }
  return cleaned;
}

/**
 * Express middleware — sanitizes req.body, req.query, req.params
 */
export const sanitizeInputs = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }

  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeObject(req.params);
  }

  next();
};
