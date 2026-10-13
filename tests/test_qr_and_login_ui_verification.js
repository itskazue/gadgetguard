/**
 * Verification Test: QR Improvements & Student Login UI Text
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');

console.log('--- RUNNING QR IMPROVEMENTS & STUDENT LOGIN UI VERIFICATION ---');

// 1. Verify public/index.html
const indexHtmlPath = path.join(rootDir, 'public', 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// A. Student Login Modal Text
assert(indexHtml.includes('Student Sign In'), 'index.html must have heading "Student Sign In"');
assert(indexHtml.includes('Sign in using your NCST Student ID or school email.'), 'index.html must have description "Sign in using your NCST Student ID or school email."');
assert(indexHtml.includes('Student ID or School Email'), 'index.html must have label "Student ID or School Email"');
assert(indexHtml.includes('placeholder="e.g. 2024-XXXXX or name@ncst.edu.ph"'), 'index.html must have placeholder "e.g. 2024-XXXXX or name@ncst.edu.ph"');
assert(indexHtml.includes('Password'), 'index.html must preserve Password label');
assert(indexHtml.includes('Forgot password?'), 'index.html must preserve Forgot password? link');
assert(indexHtml.includes('Sign In to Student Portal'), 'index.html must preserve "Sign In to Student Portal"');
assert(indexHtml.includes('Need Help With Your Account?'), 'index.html must have "Need Help With Your Account?"');
assert(indexHtml.includes('For assistance with your Student ID, NCST school email, or account password, please visit Cubicle 8, Multipurpose Building.'), 'index.html must have Cubicle 8 assistance text');
assert(!indexHtml.includes('NCST Student Database Ready:'), 'index.html must NOT contain obsolete "NCST Student Database Ready:" notice');
assert(!indexHtml.includes('official NCST Student Information System'), 'index.html must NOT claim synchronization with official SIS');

// B. OSA Surrender Anchor & Navigation
assert(indexHtml.includes('id="osa-surrender"'), 'index.html must contain id="osa-surrender" anchor');
assert(indexHtml.includes('href="/campus-poster.html"'), 'index.html must link to /campus-poster.html');
console.log('✅ PASS: public/index.html text and anchors verified');

// 2. Verify Campus Awareness Poster
const posterHtmlPath = path.join(rootDir, 'public', 'campus-poster.html');
assert(fs.existsSync(posterHtmlPath), 'campus-poster.html must exist');
const posterHtml = fs.readFileSync(posterHtmlPath, 'utf8');

assert(posterHtml.includes('LOST A GADGET?'), 'campus-poster.html must include "LOST A GADGET?"');
assert(posterHtml.includes('FOUND ONE?'), 'campus-poster.html must include "FOUND ONE?"');
assert(posterHtml.includes('/assets/campus_qr.png'), 'campus-poster.html must reference campus_qr.png');
assert(posterHtml.includes('https://ncstgadgetguard.onrender.com/'), 'campus-poster.html must display public URL');
assert(posterHtml.includes('Register Devices'), 'campus-poster.html must include device registration guidance');
assert(posterHtml.includes('Report Missing'), 'campus-poster.html must include missing reporting guidance');
assert(posterHtml.includes('Surrender Found Items'), 'campus-poster.html must include found item surrender guidance');
assert(posterHtml.includes('Office of Student Affairs (OSA)'), 'campus-poster.html must mention OSA');
assert(posterHtml.includes('Student Center Bldg, Room 1109'), 'campus-poster.html must mention Room 1109');
assert(posterHtml.includes('@page') && posterHtml.includes('size: A4 portrait'), 'campus-poster.html must define A4 portrait print rules');
console.log('✅ PASS: public/campus-poster.html verified');

// 3. Verify Campus QR Asset
const qrAssetPath = path.join(rootDir, 'public', 'assets', 'campus_qr.png');
assert(fs.existsSync(qrAssetPath), 'public/assets/campus_qr.png must exist');
const qrStat = fs.statSync(qrAssetPath);
assert(qrStat.size > 1000, 'campus_qr.png must be a non-empty image file');
console.log('✅ PASS: public/assets/campus_qr.png asset verified (' + qrStat.size + ' bytes)');

// 4. Verify OSA Device QR Sticker & Layout in public/osa/index.html
const osaHtmlPath = path.join(rootDir, 'public', 'osa', 'index.html');
const osaHtml = fs.readFileSync(osaHtmlPath, 'utf8');

const stickerBoxStartIndex = osaHtml.indexOf('id="admin-print-sticker-box"');
const stickerBoxHtml = osaHtml.substring(stickerBoxStartIndex, stickerBoxStartIndex + 1500);

assert(stickerBoxHtml.includes('SCAN ME'), 'Sticker must contain "SCAN ME"');
assert(stickerBoxHtml.includes('id="admin-sticker-qr-img"'), 'Sticker must contain dynamic QR image tag');
assert(stickerBoxHtml.includes('id="admin-sticker-token"'), 'Sticker must contain token element');
assert(stickerBoxHtml.includes('class="sticker-fallback"'), 'Sticker must contain fallback container');
assert(stickerBoxHtml.includes('ncstgadgetguard.onrender.com/#osa-surrender'), 'Sticker must contain direct OSA surrender anchor link');
assert(!stickerBoxHtml.includes('phone') && !stickerBoxHtml.includes('@'), 'Sticker must not expose phone or private emails');
assert(osaHtml.includes('href="/campus-poster.html"'), 'osa/index.html must include Campus Poster link in sidebar');
console.log('✅ PASS: public/osa/index.html sticker layout and sidebar verified');

// 5. Verify CSS Styles in public/css/style.css
const cssPath = path.join(rootDir, 'public', 'css', 'style.css');
const css = fs.readFileSync(cssPath, 'utf8');

assert(css.includes('.official-qr-sticker'), 'style.css must define .official-qr-sticker');
assert(css.includes('.sticker-scan-me'), 'style.css must define .sticker-scan-me');
assert(css.includes('.sticker-fallback'), 'style.css must define .sticker-fallback');
assert(css.includes('.sticker-fallback-link'), 'style.css must define .sticker-fallback-link');
assert(css.includes('body.printing-qr-sticker #admin-print-sticker-box'), 'style.css must define print rules for sticker box');
console.log('✅ PASS: public/css/style.css sticker styling and print rules verified');

// 6. Verify public/js/public.js smooth anchor offset
const publicJsPath = path.join(rootDir, 'public', 'js', 'public.js');
const publicJs = fs.readFileSync(publicJsPath, 'utf8');
assert(publicJs.includes('#osa-surrender'), 'public.js must handle #osa-surrender anchor scroll offset');
console.log('✅ PASS: public/js/public.js anchor offset logic verified');

console.log('--- ALL VERIFICATION CHECKS PASSED SUCCESSFULLY ---');
