const nodemailer = require('nodemailer');
require('dotenv').config();

const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbx7NYkgEsADcw8U8ISMBe3wFyQi5H2stcWMtiiXOTqmhVqMkTPjMqaRMVa1BaqKHCIe/exec';
const CANONICAL_APP_URL = 'https://ncstgadgetguard.onrender.com';

/**
 * Resolves the application base URL for emails and links.
 * Always resolves to the live Render domain in production or when outgoing emails are generated.
 * Ignores localhost/127.0.0.1 development configuration unless explicitly permitted via ALLOW_LOCAL_EMAIL_URLS=true or NODE_ENV=test_local.
 */
function getAppBaseUrl(req) {
  // 1. If process.env.APP_URL is set and is NOT localhost, use it (production override)
  if (process.env.APP_URL && process.env.APP_URL.trim()) {
    const configured = process.env.APP_URL.trim().replace(/\/+$/, '');
    if (!configured.includes('localhost') && !configured.includes('127.0.0.1')) {
      return configured;
    }
    // Only allow localhost if explicitly opted-in for local tests
    if (process.env.NODE_ENV === 'test_local' || process.env.ALLOW_LOCAL_EMAIL_URLS === 'true') {
      return configured;
    }
  }

  // 2. If req has a non-localhost host (e.g. Render request headers), use it
  if (req) {
    const proto = req.headers?.['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers?.['x-forwarded-host'] || (typeof req.get === 'function' ? req.get('host') : req.headers?.host);
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      return `${proto}://${host}`.replace(/\/+$/, '');
    }
  }

  // 3. If test_local or ALLOW_LOCAL_EMAIL_URLS is set
  if (process.env.NODE_ENV === 'test_local' || process.env.ALLOW_LOCAL_EMAIL_URLS === 'true') {
    return 'http://localhost:3000';
  }

  // 4. Default to canonical live Render URL (prevents localhost leaking into live emails even if run locally with .env)
  return CANONICAL_APP_URL;
}

/**
 * Resolves the absolute URL for the Student Portal.
 * Guaranteed to route to /student/ on the live domain.
 */
function getStudentPortalUrl(customUrl, req) {
  const base = getAppBaseUrl(req);
  if (customUrl && typeof customUrl === 'string' && customUrl.trim()) {
    const trimmed = customUrl.trim();
    try {
      const parsed = new URL(trimmed, base);
      // If a localhost URL is passed in production/normal mode, force canonical host
      if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
          process.env.NODE_ENV !== 'test_local' &&
          process.env.ALLOW_LOCAL_EMAIL_URLS !== 'true') {
        const canonical = new URL(CANONICAL_APP_URL);
        parsed.protocol = canonical.protocol;
        parsed.host = canonical.host;
      }
      if (parsed.pathname === '/' || parsed.pathname === '') {
        parsed.pathname = '/student/';
      } else if (!parsed.pathname.endsWith('/') && !parsed.pathname.includes('.')) {
        parsed.pathname = `${parsed.pathname}/`;
      }
      return parsed.toString();
    } catch (e) {
      return `${base}/student/`;
    }
  }
  return `${base}/student/`;
}

// Create reusable transporter object using SMTP transport (Fallback)
function createTransporter() {
  const user = process.env.SMTP_USER || 'kazinteg1@gmail.com';
  const pass = (process.env.SMTP_PASS || 'grwqbfuqotmtzsgp').replace(/\s+/g, '');

  if (!user || !pass) {
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
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000
  });
}

/**
 * Verify Mail delivery configuration (Webhook & SMTP)
 */
async function verifySMTP() {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;
  if (webhookUrl) {
    return { success: true, method: 'HTTPS_WEBHOOK', message: 'Google Apps Script HTTPS Mail Webhook is operational.' };
  }
  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email delivery not configured.' };
  }
  try {
    await transporter.verify();
    return { success: true, method: 'SMTP', message: 'SMTP server is ready to deliver messages.' };
  } catch (error) {
    console.error('SMTP Verification Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send a custom or test email (Primary: Google HTTPS Webhook, Fallback: Direct SMTP)
 */
async function sendMail({ to, subject, html, text }) {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

  // 1. Primary Method: Google Apps Script Webhook (Port 443 HTTPS - 100% reliable on Render)
  if (webhookUrl) {
    try {
      console.log(`📡 Dispatching email via Google HTTPS Webhook to ${to}...`);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject,
          html: html || text,
          text: text || ''
        })
      });

      const resText = await response.text();
      let resJson = {};
      try {
        resJson = JSON.parse(resText);
      } catch (e) {
        resJson = { success: response.ok, raw: resText };
      }

      if (response.ok && (resJson.success !== false)) {
        console.log(`✅ [Google HTTPS Webhook] Email payload dispatched to webhook for ${to} (HTTP accepted)`);
        return { success: true, method: 'HTTPS_WEBHOOK', dispatched: true, details: resJson };
      } else {
        console.warn(`⚠️ Google Webhook responded with error:`, resJson);
      }
    } catch (whErr) {
      console.error(`⚠️ Webhook delivery failed, attempting SMTP fallback:`, whErr.message);
    }
  }

  // 2. Fallback Method: SMTP Direct Socket
  const transporter = createTransporter();
  const senderName = process.env.SYSTEM_SENDER_NAME || 'NCST GadgetGuard Campus Security';
  const senderEmail = process.env.SMTP_USER || 'kazinteg1@gmail.com';

  if (!transporter) {
    console.warn(`⚠️ [Mailer] No email transport configured for delivery to ${to}`);
    return { success: false, error: 'No email transport configured' };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to,
      subject,
      text: text || 'Please view this email in an HTML-compatible client.',
      html
    });
    console.log(`✅ [SMTP] Email sent successfully to ${to} (Message ID: ${info.messageId})`);
    return { success: true, method: 'SMTP', messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 1. Send Account & Gadget Approved Email (When OSA verifies and approves)
 */
function generateApprovalEmailPayload({ studentEmail, studentName, studentId, gadgetInfo, loginUrl, req }) {
  const portalUrl = getStudentPortalUrl(loginUrl, req);
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

  return { to: studentEmail, subject, html, portalUrl };
}

async function sendApprovalEmail(options) {
  const payload = generateApprovalEmailPayload(options);
  return sendMail(payload);
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

/**
 * 3. Send Password Reset Email (15-Minute Expiry)
 * Branded official NCST email with single-use security token and Cubicle 8 notice
 */
function generatePasswordResetEmailPayload({ to, name, resetUrl, role, req }) {
  const subject = '🔐 NCST GadgetGuard: Password Reset Request';
  const roleLabel = role === 'osa_admin' ? 'OSA Administrator' : 'Student';
  const finalResetUrl = resetUrl || `${getAppBaseUrl(req)}/reset-password.html`;

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
    .badge-security { display: inline-block; background: #fef3c7; color: #92400e; font-weight: 700; font-size: 12px; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; margin-bottom: 16px; border: 1px solid #fde68a; }
    .greeting { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px; }
    .message { font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
    .btn-container { text-align: center; margin: 28px 0; }
    .btn { background: #142a6d; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 10px; display: inline-block; box-shadow: 0 4px 12px rgba(20, 42, 109, 0.25); }
    .notice-box { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #2563eb; border-radius: 10px; padding: 14px 18px; font-size: 13px; color: #334155; line-height: 1.5; margin: 20px 0; }
    .help-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 14px 18px; font-size: 13px; color: #1e40af; line-height: 1.5; margin: 20px 0; }
    .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    .footer p { margin: 4px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ NCST GADGETGUARD</h1>
      <p>Official Campus Asset Tracking & Account Security</p>
    </div>
    <div class="content">
      <span class="badge-security">🔐 Password Reset Verification</span>
      <h2 class="greeting">Hello, ${name}!</h2>
      <p class="message">
        We received a request to reset the password for your NCST GadgetGuard <strong>${roleLabel}</strong> account associated with <strong>${to}</strong>.
      </p>

      <div class="btn-container">
        <a href="${finalResetUrl}" class="btn" target="_blank">Reset My Password &rarr;</a>
      </div>

      <div class="notice-box">
        ⏱️ <strong>Time Sensitive:</strong> This reset link is single-use and will automatically expire in <strong>15 minutes</strong>. If the link expires, you will need to request a new one.
      </div>

      <div class="help-box">
        🏢 <strong>In-Person Assistance:</strong> If you cannot access your school email or require in-person identity verification, please proceed to <strong>Cubicle 8, Multipurpose Building</strong>.
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 24px;">
        🔒 If you did not make this request, you can safely ignore this email. Your current password remains secure, and no changes have been made to your account.
      </p>
    </div>
    <div class="footer">
      <p><strong>Office of Student Affairs (OSA) • National College of Science and Technology</strong></p>
      <p>Automated security notification. Never share your password or reset link with anyone.</p>
    </div>
  </div>
</body>
</html>
  `;

  return { to, subject, html, resetUrl: finalResetUrl };
}

async function sendPasswordResetEmail(options) {
  const payload = generatePasswordResetEmailPayload(options);

  // Respect owner authorization rule: do not dispatch external reset emails without owner approval
  if (process.env.SEND_RESET_EMAILS !== 'true') {
    console.log(`📡 [Password Reset Mailer] Real email dispatch held for ${options.to} (SEND_RESET_EMAILS != true, awaiting owner approval).`);
    return { success: true, held: true, dispatched: false, message: 'Email dispatch held awaiting owner approval.', payload };
  }

  return sendMail(payload);
}

module.exports = {
  CANONICAL_APP_URL,
  getAppBaseUrl,
  getStudentPortalUrl,
  generateApprovalEmailPayload,
  generatePasswordResetEmailPayload,
  verifySMTP,
  sendMail,
  sendApprovalEmail,
  sendPreRegistrationEmail,
  sendPasswordResetEmail
};

