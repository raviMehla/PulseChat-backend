/*
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: result.error.errors[0].message
    });
  }

  req.body = result.data;
  next();
};
*/

export const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);

  if (error) {
    return res.status(400).json({
      message: error.details?.[0]?.message || "Validation error"
    });
  }

  next();
};