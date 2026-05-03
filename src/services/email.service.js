import nodemailer from "nodemailer";

// Initialize the SMTP Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

// ==========================================
// SEND OTP EMAIL
// ==========================================
export const sendDeletionOTP = async (userEmail, otp) => {
  try {
    const mailOptions = {
      from: `"Jahangir Mehla Inc. Security" <${process.env.EMAIL_USER}>`,
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

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Email Delivery Failed:", error);
    throw new Error("Failed to send verification email");
  }
};