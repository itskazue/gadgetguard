const nodemailer = require('nodemailer');
require('dotenv').config();

// Create reusable transporter object using SMTP transport
function createTransporter() {
  const user = process.env.SMTP_USER || 'kazinteg1@gmail.com';
  const pass = (process.env.SMTP_PASS || 'grwqbfuqotmtzsgp').replace(/\s+/g, '');

  if (!user || !pass) {
    console.warn('⚠️ SMTP Warning: SMTP_USER or SMTP_PASS is missing. Emails will be logged to console.');
    return null;
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

/**
 * Verify SMTP connection configuration
 */
async function verifySMTP() {
  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'SMTP credentials not configured.' };
  }
  try {
    await transporter.verify();
    return { success: true, message: 'SMTP server is ready to deliver messages.' };
  } catch (error) {
    console.error('SMTP Verification Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send a custom or test email
 */
async function sendMail({ to, subject, html, text }) {
  const transporter = createTransporter();
  const senderName = process.env.SYSTEM_SENDER_NAME || 'NCST GadgetGuard Campus Security';
  const senderEmail = process.env.SMTP_USER || 'kazinteg1@gmail.com';

  if (!transporter) {
    console.log(`\n📧 [SIMULATED EMAIL - NO SMTP CONFIGURED]`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${text || html}\n`);
    return { success: true, simulated: true };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to,
      subject,
      text: text || 'Please view this email in an HTML-compatible client.',
      html
    });
    console.log(`✅ Email sent successfully to ${to} (Message ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 1. Send Account & Gadget Approved Email (When OSA verifies and approves)
 */
async function sendApprovalEmail({ studentEmail, studentName, studentId, gadgetInfo, loginUrl }) {
  const portalUrl = loginUrl || process.env.APP_URL || 'http://localhost:3000';
  const subject = '🛡️ NCST GadgetGuard: Device Registration & Account Approved';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #142a6d 0%, #1e3a8a 50%, #2563eb 100%); padding: 32px 24px; text-align: center; color: white; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0 0; opacity: 0.9; font-size: 13px; }
    .content { padding: 32px 28px; }
    .badge-approved { display: inline-block; background: #dcfce7; color: #15803d; font-weight: 700; font-size: 12px; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; margin-bottom: 16px; }
    .greeting { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px; }
    .message { font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .card-title { font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 0; margin-bottom: 14px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
    .btn-container { text-align: center; margin: 28px 0 20px 0; }
    .btn { background: #142a6d; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 10px; display: inline-block; box-shadow: 0 4px 12px rgba(20, 42, 109, 0.25); }
    .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    .footer p { margin: 4px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ NCST GADGETGUARD</h1>
      <p>Campus Asset Tracking & Device Recovery Infrastructure</p>
    </div>
    <div class="content">
      <span class="badge-approved">✓ Registration Verified & Approved</span>
      <h2 class="greeting">Hello, ${studentName}!</h2>
      <p class="message">
        Great news! Your account and device registration have been officially <strong>verified and approved</strong> by the Office of Student Affairs (OSA). Your student account is now fully active and accessible.
      </p>

      <div class="card">
        <div class="card-title">🔑 Account & Login Information</div>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b;">🎓 Student ID:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: 600; text-align: right;">${studentId}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">📧 Registered Email:</td>
            <td style="padding: 6px 0; color: #142a6d; font-weight: 600; text-align: right;">${studentEmail}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">✅ Account Status:</td>
            <td style="padding: 6px 0; color: #16a34a; font-weight: 700; text-align: right;">ACTIVE & VERIFIED</td>
          </tr>
        </table>
      </div>

      ${gadgetInfo ? `
      <div class="card" style="border-left: 4px solid #142a6d;">
        <div class="card-title">📱 Registered Device Information</div>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Device:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: 600; text-align: right;">${gadgetInfo.brand} ${gadgetInfo.model}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Category:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: 600; text-align: right;">${gadgetInfo.category || 'Gadget'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Serial / IMEI:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: 600; text-align: right;">${gadgetInfo.serialNumber || 'N/A'}</td>
          </tr>
        </table>
        <p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;">
          🎯 <em>Your official security QR code is ready in your Student Portal. You can download and save it to your device.</em>
        </p>
      </div>
      ` : ''}

      <div class="btn-container">
        <a href="${portalUrl}" class="btn" target="_blank">Access Student Portal 🚀</a>
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.5; text-align: center; margin-top: 24px;">
        💡 <em>Reminder: Use the password you designated upon registration. If you ever need assistance, please visit the Office of Student Affairs (OSA Room 1109).</em>
      </p>
    </div>
    <div class="footer">
      <p><strong>Office of Student Affairs (OSA) — National College of Science and Technology</strong></p>
      <p>This is an automated notification from the NCST GadgetGuard System. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>
  `;

  return sendMail({ to: studentEmail, subject, html });
}

/**
 * 2. Send Pre-Registration Acknowledgement Email (Upon initial submission)
 */
async function sendPreRegistrationEmail({ studentEmail, studentName, studentId, deviceName }) {
  const subject = '🛡️ NCST GadgetGuard: Registration Application Received';
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #142a6d 0%, #1e293b 100%); padding: 28px 24px; text-align: center; color: white; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 800; }
    .content { padding: 30px 24px; }
    .greeting { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 0; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0; }
    .footer { background: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ NCST GADGETGUARD</h1>
      <p style="margin:4px 0 0 0; font-size:13px; opacity:0.85;">Registration Application Acknowledgement</p>
    </div>
    <div class="content">
      <h2 class="greeting">Hello, ${studentName}!</h2>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        We have successfully received your registration application for the <strong>NCST GadgetGuard Campus Asset Tracking System</strong>.
      </p>

      <div class="card">
        <p style="margin: 4px 0; color: #334155;"><strong>🎓 Student ID:</strong> ${studentId}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>📧 Email:</strong> ${studentEmail}</p>
        ${deviceName ? `<p style="margin: 4px 0; color: #334155;"><strong>📱 Device:</strong> ${deviceName}</p>` : ''}
        <p style="margin: 4px 0; color: #d97706; font-weight: 700;"><strong>⏳ Status:</strong> Pending Face-to-Face Verification at OSA</p>
      </div>

      <p style="color: #475569; font-size: 14px; line-height: 1.6;">
        Please proceed to the <strong>Office of Student Affairs (Room 1109)</strong> with your physical Student ID and registered device to complete verification. You will receive an approval confirmation email once your account is activated.
      </p>
    </div>
    <div class="footer">
      <p>Office of Student Affairs (OSA) — NCST GadgetGuard Notification</p>
    </div>
  </div>
</body>
</html>
  `;

  return sendMail({ to: studentEmail, subject, html });
}

module.exports = {
  verifySMTP,
  sendMail,
  sendApprovalEmail,
  sendPreRegistrationEmail
};
