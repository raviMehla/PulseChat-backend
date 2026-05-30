export const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  const statusCode =
    err.statusCode ||
    (err.code === "LIMIT_FILE_SIZE" ? 413 : null) ||
    (err.code === "LIMIT_FILE_COUNT" ? 400 : null) ||
    500;

  // 🛡️ SECURITY: Prevent sensitive information leakage (like DB paths, keys) in production
  const message =
    process.env.NODE_ENV === "production" && statusCode === 500
      ? "An unexpected error occurred on the server. Please try again later."
      : err.message || "Server Error";

  res.status(statusCode).json({
    success: false,
    message
  });
};
