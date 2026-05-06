// 🛡️ ARCHITECTURAL UPGRADE: Native HTTP Fetch API via Brevo
// Bypasses Render SMTP Blocks (Port 443) AND allows single-sender Gmail verification

// ==========================================
// SEND OTP EMAIL
// ==========================================
export const sendDeletionOTP = async (userEmail, otp) => {
  try {
    const payload = {
      sender: {
        email: process.env.EMAIL_USER, // Your verified Gmail address
        name: 'PulseChat Security'
      },
      to: [
        { email: userEmail } // Sends to ANY user in your database
      ],
      subject: 'Critical: Account Deletion Verification Code',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #333; border-radius: 8px; background-color: #111; color: #eee;">
          <h2 style="color: #ef4444; border-bottom: 1px solid #333; padding-bottom: 10px;">Account Deletion Request</h2>
          <p>We received a request to permanently delete your account. If you initiated this, please use the verification code below:</p>
          <div style="background-color: #000; padding: 15px; text-align: center; font-size: 24px; letter-spacing: 5px; font-weight: bold; border-radius: 4px; margin: 20px 0; border: 1px solid #ef4444;">
            ${otp}
          </div>
          <p style="color: #aaa; font-size: 12px;">This code expires in 15 minutes. If you did not request this, please ignore this email and change your password immediately.</p>
        </div>
      `
    };

    // Native Node.js Fetch to Brevo's REST API
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("❌ Brevo API Rejected the Payload:", errorData);
      throw new Error(`Failed to dispatch email: ${errorData.message}`);
    }

    console.log(`✅ Production Deletion OTP successfully dispatched to ${userEmail} via Brevo HTTP.`);
    return true;
    
  } catch (error) {
    console.error("Email Delivery Pipeline Failed:", error.message);
    throw error;
  }
};