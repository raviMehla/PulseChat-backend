import jwt from 'jsonwebtoken';

// Add tokenVersion as the second parameter
export const generateToken = (id, tokenVersion = 0) => {
  return jwt.sign(
    { id, tokenVersion }, // Inject it into the payload
    process.env.JWT_SECRET, 
    { expiresIn: '30d' }
  );
};