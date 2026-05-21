// ==========================================
// SEND OTP EMAIL — ACCOUNT DELETION
// ==========================================
export const sendDeletionOTP = async (userEmail, otp) => {
  try {
    const payload = {
      sender: {
        email: process.env.EMAIL_USER,
        name: 'PulseChat Security'
      },
      to: [
        { email: userEmail }
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

// ==========================================
// SEND OTP EMAIL — PASSWORD RESET
// ==========================================
export const sendPasswordResetOTP = async (userEmail, otp) => {
  try {
    const payload = {
      sender: {
        email: process.env.EMAIL_USER,
        name: 'PulseChat'
      },
      to: [{ email: userEmail }],
      subject: 'PulseChat — Password Reset Code',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #333; border-radius: 8px; background-color: #111; color: #eee;">
          <h2 style="color: #7C6EF7; border-bottom: 1px solid #333; padding-bottom: 10px;">Password Reset Request</h2>
          <p>We received a request to reset your PulseChat password. Use the code below to set a new password:</p>
          <div style="background-color: #000; padding: 15px; text-align: center; font-size: 32px; letter-spacing: 8px; font-weight: bold; border-radius: 4px; margin: 20px 0; border: 1px solid #7C6EF7; color: #7C6EF7;">
            ${otp}
          </div>
          <p>This code expires in <strong>15 minutes</strong>.</p>
          <p style="color: #aaa; font-size: 12px;">If you did not request a password reset, you can safely ignore this email. Your password will not be changed.</p>
        </div>
      `
    };

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
      console.error("❌ Brevo API Rejected Password Reset Email:", errorData);
      throw new Error(`Failed to dispatch reset email: ${errorData.message}`);
    }

    console.log(`✅ Password Reset OTP dispatched to ${userEmail} via Brevo HTTP.`);
    return true;

  } catch (error) {
    console.error("Password Reset Email Failed:", error.message);
    throw error;
  }
};