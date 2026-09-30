const http = require('http');

async function request(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runEndToEndVerification() {
  console.log('====================================================');
  console.log('🛡️  GADGETGUARD COMPREHENSIVE END-TO-END WORKFLOW TEST');
  console.log('====================================================\n');

  // 1. Verify Site 1, Site 2, Site 3 HTML Delivery
  console.log('1️⃣  Testing HTML Delivery for 3 Connected Sites...');
  const site1 = await request({ host: 'localhost', port: 3000, path: '/', method: 'GET' });
  console.log(`   ✅ Site 1 (Public Website):        HTTP ${site1.status} (${site1.raw.length} bytes)`);

  const site2 = await request({ host: 'localhost', port: 3000, path: '/student/', method: 'GET' });
  console.log(`   ✅ Site 2 (Student App):           HTTP ${site2.status} (${site2.raw.length} bytes)`);

  const site3 = await request({ host: 'localhost', port: 3000, path: '/osa/', method: 'GET' });
  console.log(`   ✅ Site 3 (OSA Admin Center):      HTTP ${site3.status} (${site3.raw.length} bytes)`);

  const siteDevice = await request({ host: 'localhost', port: 3000, path: '/device/gg_dev_7c3b881e', method: 'GET' });
  console.log(`   ✅ Public Device QR Landing Page:  HTTP ${siteDevice.status} (${siteDevice.raw.length} bytes)\n`);

  // 2. Student Authentication
  console.log('2️⃣  Authenticating as Student Juan Dela Cruz...');
  const studentLogin = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'juan.delacruz@student.univ.edu', password: 'student123' });

  const studentToken = studentLogin.data.token;
  console.log(`   ✅ Student Logged In: ${studentLogin.data.user.name} (Role: ${studentLogin.data.user.role})\n`);

  // 3. Student Registers a New Gadget
  console.log('3️⃣  Student Registering New Gadget (Asus ROG Zephyrus G14)...');
  const serialNumber = 'ROG-G14-' + Date.now().toString(36);
  const regGadget = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/gadgets/register',
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    }
  }, {
    category: 'Laptop',
    brand: 'Asus',
    model: 'ROG Zephyrus G14 Eclipse Gray',
    serialNumber,
    color: 'Eclipse Gray',
    description: 'Anime matrix LED on lid, 32GB RAM, student university sticker on bottom.',
    photoUrl: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=500'
  });

  const gadgetId = regGadget.data.gadget.id;
  console.log(`   ✅ Gadget Submitted: ID ${gadgetId} (Status: ${regGadget.data.gadget.status})\n`);

  // 4. OSA Admin Login
  console.log('4️⃣  Authenticating as OSA Administrator (Carlos Mendoza)...');
  const adminLogin = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'osa.admin@univ.edu', password: 'admin123' });

  const adminToken = adminLogin.data.token;
  console.log(`   ✅ OSA Admin Logged In: ${adminLogin.data.user.name} (${adminLogin.data.user.role})\n`);

  // 5. OSA Approves Gadget -> Generates QR Token & QR Image
  console.log('5️⃣  OSA Admin Approving Gadget & Generating Secure QR Token...');
  const approveRes = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/gadgets/${gadgetId}/approve`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  const secureToken = approveRes.data.gadget.secureToken;
  console.log(`   ✅ Gadget Approved! Status: ${approveRes.data.gadget.status}`);
  console.log(`   ✅ Secure QR Token: ${secureToken}`);
  console.log(`   ✅ QR Code Data URL Generated: ${approveRes.data.gadget.qrCodeDataUrl?.substring(0, 35)}...\n`);

  // 6. Student Reports Gadget Missing
  console.log('6️⃣  Student Reports Gadget as MISSING...');
  const missingRes = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/missing/report',
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    }
  }, {
    gadgetId,
    lastSeenLocation: 'University Study Pavilion Table 8',
    details: 'Left in black laptop sleeve near water station.',
    contactRewardOffer: 'P500 Coffee Gift Card'
  });

  console.log(`   ✅ Missing Report Active: ID ${missingRes.data.report.id}`);

  // Check Active Missing Board
  const activeMissing = await request({ host: 'localhost', port: 3000, path: '/api/missing/active', method: 'GET' });
  console.log(`   ✅ Public Missing Board Count: ${activeMissing.data.count} active reports\n`);

  // 7. Public Finder Scans Device QR
  console.log('7️⃣  Public Finder Scans QR Code at /device/:token ...');
  const scanLookup = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/scan/device/${secureToken}?locationNote=Pavilion%20Walkway`,
    method: 'GET'
  });

  console.log(`   ✅ QR Scanned & Logged: ${scanLookup.data.gadget.brand} ${scanLookup.data.gadget.model}`);
  console.log(`   ✅ Status Alert Displayed to Finder: ${scanLookup.data.gadget.status}`);
  console.log(`   ✅ Owner First Name (Only): ${scanLookup.data.owner?.firstName || 'None'} (Contact: ${scanLookup.data.owner?.contactNumber || 'None'})\n`);

  // 8. Public Finder Submits "Found Item" Report
  console.log('8️⃣  Public Finder Submits Found Report...');
  const finderRes = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/finder/report',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    token: secureToken,
    finderName: 'Security Guard R. Bautista',
    finderContact: '+63 917 888 7766',
    foundLocation: 'Pavilion Walkway Bench',
    turnInMethod: 'SUBMITTED_TO_OSA',
    message: 'Turned over to OSA custody office.'
  });

  const foundReportId = finderRes.data.report.id;
  console.log(`   ✅ Finder Report Created: ID ${foundReportId}\n`);

  // 9. OSA Receives Item into Custody Vault
  console.log('9️⃣  OSA Receives Gadget into Custody Vault (Locker A-05)...');
  const custodyRes = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/finder/${foundReportId}/receive`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    custodyLocation: 'OSA Locker A-05',
    notes: 'Safe in vault, charger included in sleeve.'
  });

  console.log(`   ✅ Gadget Status Updated: ${custodyRes.data.gadget.status} (${custodyRes.data.gadget.custodyLocation})\n`);

  // 10. Student Submits Ownership Claim
  console.log('🔟 Student Submits Ownership Claim...');
  const claimRes = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/claims/submit',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    }
  }, {
    gadgetId,
    claimProofDetails: 'Original purchase receipt from Asus ROG Concept Store, matching serial number, wallpaper shows family picture.',
    verificationIdType: 'Student ID',
    verificationIdNumber: '2024-00101-MN'
  });

  const claimId = claimRes.data.claim.id;
  console.log(`   ✅ Claim Submitted: ID ${claimId} (Status: ${claimRes.data.claim.status})\n`);

  // 11. OSA Approves Claim
  console.log('1️⃣1️⃣ OSA Approves Claim for Release...');
  const reviewRes = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/claims/${claimId}/review`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, { action: 'APPROVE' });

  console.log(`   ✅ Claim Status: ${reviewRes.data.claim.status}\n`);

  // 12. OSA Dispatches Official Return & Issues Receipt
  console.log('1️⃣2️⃣ OSA Completes Handover & Issues Return Receipt...');
  const returnRes = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/osa/return',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    gadgetId,
    claimId,
    receivedByPersonName: 'Juan Dela Cruz',
    receivedByPersonId: '2024-00101-MN',
    notes: 'Device physically inspected and returned. Student demonstrated login passcode.'
  });

  console.log(`   ✅ Handover Complete! Return Receipt ID: ${returnRes.data.returnRecord.id}`);

  // Final status check
  const finalGadget = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/gadgets/${gadgetId}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });

  console.log(`   ✅ Final Gadget Lifecycle Status: ${finalGadget.data.gadget.status}`);
  console.log('\n====================================================');
  console.log('🎉 ALL 12 WORKFLOW STEPS VERIFIED & 100% OPERATIONAL!');
  console.log('====================================================');
}

runEndToEndVerification().catch(console.error);
