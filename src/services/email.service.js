import { Resend } from 'resend';

// 🛡️ ARCHITECTURAL UPGRADE: Initialize the Resend HTTP Client
// This communicates securely over Port 443 (HTTPS), bypassing all cloud SMTP firewalls.
const resend = new Resend(process.env.RESEND_API_KEY);

// ==========================================
// SEND OTP EMAIL
// ==========================================
export const sendDeletionOTP = async (userEmail, otp) => {
  try {
    const { data, error } = await resend.emails.send({
      // NOTE: Until you verify a custom domain (e.g., security@pulsechat.com), 
      // Resend uses a default onboarding address.
      from: 'PulseChat Security <onboarding@resend.dev>', 
      to: userEmail,
      subject: 'Critical: Account Deletion Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #333; border-radius: 8px; background-color: #111; color: #eee;">
          <h2 style="color: #ef4444; border-bottom: 1px solid #333; padding-bottom: 10px;">Account Deletion Request</h2>
          <p>We received a request to permanently delete your account. If you initiated this, please use the verification code below:</p>
          <div style="background-color: #000; padding: 15px; text-align: center; font-size: 24px; letter-spacing: 5px; font-weight: bold; border-radius: 4px; margin: 20px 0; border: 1px solid #ef4444;">
            ${otp}
          </div>
          <p style="color: #aaa; font-size: 12px;">This code expires in 15 minutes. If you did not request this, please ignore this email and change your password immediately.</p>
        </div>
      `,
    });

    // Handle API-level rejections (e.g., invalid email, rate limits)
    if (error) {
      console.error("Resend API Rejected the Payload:", error);
      throw new Error("Failed to dispatch email via Resend");
    }

    console.log(`✉️ Deletion OTP successfully dispatched. Resend ID: ${data.id}`);
    return true;
    
  } catch (error) {
    // Catch absolute network failures
    console.error("Email Delivery Pipeline Failed:", error.message);
    throw error;
  }
};