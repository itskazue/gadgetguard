require('dotenv').config();
const mailer = require('./server/services/mailer');

async function runTest() {
  console.log('Testing SMTP connection with Gmail...');
  console.log('Host:', process.env.SMTP_HOST);
  console.log('Port:', process.env.SMTP_PORT);
  console.log('User:', process.env.SMTP_USER);

  const verify = await mailer.verifySMTP();
  console.log('Verify Result:', verify);

  if (!verify.success) {
    console.error('❌ Verification failed:', verify.error);
    process.exit(1);
  }

  console.log('\nSending Live Test Email to', process.env.SMTP_USER, '...');
  const sendRes = await mailer.sendApprovalEmail({
    studentEmail: process.env.SMTP_USER,
    studentName: 'NCST Test Recipient',
    studentId: '2026-TEST-001',
    gadgetInfo: {
      brand: 'Apple',
      model: 'MacBook Pro 14"',
      category: 'Laptop',
      serialNumber: 'NCST-TEST-SN9988'
    }
  });

  console.log('Send Result:', sendRes);
  if (sendRes.success) {
    console.log('\n🎉 SUCCESS! Real Gmail message sent with Message ID:', sendRes.messageId);
  } else {
    console.error('\n❌ FAILED to send email:', sendRes.error);
  }
}

runTest();
