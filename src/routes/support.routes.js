import express from 'express';
import { protect } from '../middleware/auth.middleware.js';
import { createSupportTicket } from '../controllers/support.controller.js';

const router = express.Router();

// POST /api/support/ticket — Submit a help desk ticket
router.post('/ticket', protect, createSupportTicket);

export default router;
