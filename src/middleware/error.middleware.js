export const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  const statusCode =
    err.statusCode ||
    (err.code === "LIMIT_FILE_SIZE" ? 413 : null) ||
    (err.code === "LIMIT_FILE_COUNT" ? 400 : null) ||
    500;

  res.status(statusCode).json({
    success: false,
    message: err.message || "Server Error"
  });
};
