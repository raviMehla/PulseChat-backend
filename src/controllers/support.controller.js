import { sendSupportTicketEmail } from '../services/email.service.js';

// =====================================
// CREATE SUPPORT TICKET
// =====================================
export const createSupportTicket = async (req, res) => {
  try {
    const { category, description } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ message: 'Description is required.' });
    }

    const validCategories = ['Bug Report', 'Account Issue', 'Feature Request', 'Other'];
    const safeCategory = validCategories.includes(category) ? category : 'Other';

    // Generate human-readable ticket ID
    const ticketId = `TKT-${Math.floor(10000 + Math.random() * 90000)}`;
    const userEmail = req.user?.email || 'Unknown';

    // Fire-and-forget email — don't block the response
    sendSupportTicketEmail({
      ticketId,
      category: safeCategory,
      description: description.trim(),
      userEmail
    }).catch(err => console.error('[Support] Email dispatch failed silently:', err.message));

    res.status(201).json({
      success: true,
      ticketId,
      message: 'Your ticket has been submitted. We will review it shortly.'
    });

  } catch (error) {
    console.error('Support Ticket Error:', error);
    res.status(500).json({ message: 'Failed to submit support ticket. Please try again.' });
  }
};
