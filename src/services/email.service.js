import nodemailer from "nodemailer";

// 🛡️ ARCHITECTURAL UPGRADE: Explicit Cloud-Ready SMTP Configuration
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587, // Use 587 for STARTTLS which is more firewall-friendly than 465
  secure: false, // STARTTLS will be used instead of SSL/TLS on port 587
  //port: 465,
  //secure: true, // Use SSL/TLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD, // MUST be a Google App Password
  },
  // Optional: Add a timeout to fail fast rather than hanging for 120 seconds
  connectionTimeout: 10000, // Fail after 10 seconds if no connection
});

// Verify connection on boot
transporter.verify((error, success) => {
  if (error) {
    console.warn("SMTP Connection Warning:", error.message);
  } else {
    console.log("🟢 SMTP Server is ready to take messages");
  }
});

// ==========================================
// SEND OTP EMAIL
// ==========================================
export const sendDeletionOTP = async (userEmail, otp) => {
  try {
    const mailOptions = {
      from: `"PulseChat Security" <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: "Critical: Account Deletion Verification Code",
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
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ Deletion OTP sent to ${userEmail} (${info.messageId})`);
    return true;
  } catch (error) {
    console.error("Email Delivery Failed:", error);
    throw new Error("Failed to send verification email");
  }
};