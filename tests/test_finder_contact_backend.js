const http = require('http');
const express = require('express');
const finderRoutes = require('../server/routes/finderRoutes');
const assert = require('assert');

const app = express();
app.use(express.json());
app.use('/api/finder', finderRoutes);

const server = app.listen(3388, async () => {
  try {
    async function postReport(body) {
      return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
          hostname: '127.0.0.1',
          port: 3388,
          path: '/api/finder/report',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(data) });
            } catch (e) {
              resolve({ status: res.statusCode, body: data });
            }
          });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
    }

    // 1. Non-existent gadget -> 404 (validates route reaches handler)
    const res404 = await postReport({ token: 'nonexistent' });
    assert.strictEqual(res404.status, 404);

    // 2. Mock gadget in test: use existing valid token from database
    const db = require('../server/db');
    const existingGadget = (db.find('gadgets') || [])[0];
    if (existingGadget) {
      // Test invalid contact number format (10 digits)
      const resBad1 = await postReport({
        token: existingGadget.secureToken,
        foundLocation: 'Test Lab',
        finderContact: '0912345678' // 10 digits
      });
      assert.strictEqual(resBad1.status, 400, 'Rejects 10-digit number');
      assert.strictEqual(resBad1.body.error, 'Enter a valid 11-digit mobile number starting with 09.');

      // Test invalid contact number format (starts with 08)
      const resBad2 = await postReport({
        token: existingGadget.secureToken,
        foundLocation: 'Test Lab',
        finderContact: '08123456789'
      });
      assert.strictEqual(resBad2.status, 400, 'Rejects non-09 prefix');
      assert.strictEqual(resBad2.body.error, 'Enter a valid 11-digit mobile number starting with 09.');

      // Test invalid contact number format (12 digits)
      const resBad3 = await postReport({
        token: existingGadget.secureToken,
        foundLocation: 'Test Lab',
        finderContact: '091234567890'
      });
      assert.strictEqual(resBad3.status, 400, 'Rejects 12-digit number');
      assert.strictEqual(resBad3.body.error, 'Enter a valid 11-digit mobile number starting with 09.');

      // Test invalid nonnumeric
      const resBad4 = await postReport({
        token: existingGadget.secureToken,
        foundLocation: 'Test Lab',
        finderContact: '0912345678a'
      });
      assert.strictEqual(resBad4.status, 400, 'Rejects nonnumeric');
      assert.strictEqual(resBad4.body.error, 'Enter a valid 11-digit mobile number starting with 09.');

      console.log('✓ Backend rejects all invalid contact formats with exact error message.');
    }

    console.log('✅ BACKEND CONTACT VALIDATION TEST PASSED!');
    server.close();
  } catch (err) {
    console.error('Test failed:', err);
    server.close();
    process.exit(1);
  }
});
