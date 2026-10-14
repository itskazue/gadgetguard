// Offline regression checks; all app/database/location imports are intercepted.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const data = {
  users: [{ id: 'student', role: 'student', name: 'Test Student' }, { id: 'osa', role: 'osa_admin' }],
  gadgets: [{ id: 'g', userId: 'student', status: 'REGISTERED', brand: 'Test', model: 'Device', secureToken: 'test-qr' }],
  missing_reports: [{ id: 'history', gadgetId: 'g', status: 'RESOLVED', contactRewardOffer: 'Historical value' }],
  found_reports: [], claims: [], returns: [], qr_scans: [], recovery_chats: [], notifications: [], audit_logs: []
};
const db = {
  get: key => data[key] || [],
  find(key, fn) { return this.get(key).filter(fn); },
  findOne(key, fn) { return this.get(key).find(fn); },
  findById(key, id) { return this.findOne(key, r => r.id === id); },
  insert(key, record) { data[key].push(record); return record; },
  update(key, id, patch) { return Object.assign(this.findById(key, id), patch); },
  getSettings: () => ({ schoolName: 'Test campus' }),
  addAuditLog: record => data.audit_logs.push(record),
  addNotification: record => data.notifications.push(record)
};
function route(file, method, url) {
  const handlers = {};
  const router = {};
  for (const name of ['get', 'post', 'put', 'delete', 'patch']) {
    router[name] = (endpoint, ...chain) => { handlers[`${name} ${endpoint}`] = chain.at(-1); };
  }
  const imports = {
    express: { Router: () => router }, '../db': db,
    '../auth': { authMiddleware() {}, requireRole: () => () => {}, JWT_SECRET: 'mock-only' },
    jsonwebtoken: { verify: () => data.users[1] },
    '../services/locationService': { extractClientIp: () => '127.0.0.1',
      resolveScanLocation: async () => ({ formattedLocation: 'Mock location' }) }
  };
  vm.runInNewContext(read(file), { module: { exports: {} }, console, require(name) {
    assert.ok(Object.hasOwn(imports, name), 'Blocked import: ' + name);
    return imports[name];
  } });
  return async (body = {}, user = data.users[0], headers = {}, params = {}) => {
    const req = { body, user, headers, params, query: {}, ip: '127.0.0.1' };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handlers[`${method} ${url}`](req, res);
    return res;
  };
}
function functionText(file, name, next) {
  const source = read(file);
  const index = source.indexOf('function ' + name + '(');
  assert.ok(index >= 0);
  return source.slice(index, source.indexOf(next, index));
}
const controls = {
  'missing-form-gadget-select': { value: 'g' }, 'missing-form-location': { value: ' Library ' },
  'missing-form-datetime': { value: '2026-10-14T10:00' }, 'missing-form-details': { value: ' Notes ' },
  'confirm-missing-modal': { classList: { add() {} } },
  'osa-missing-gadget-id': { value: 'g' }, 'osa-missing-location': { value: 'Library' },
  'osa-missing-date': { value: '2026-10-14T10:00' }, 'osa-missing-details': { value: 'Notes' }
};
const document = { getElementById(id) {
  assert.ok(!/reward/i.test(id), 'Removed reward control must not be accessed');
  return controls[id] || null;
} };
(async () => {
  await check('No reward fields, labels or logic remain in active public/server source', () => {
    function inspect(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) inspect(file);
        else if (/\.(js|html)$/i.test(file)) {
          assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /contactRewardOffer|missing-form-reward|osa-missing-reward|token of appreciation|\breward\b/i, file);
        }
      }
    }
    inspect(path.join(root, 'public')); inspect(path.join(root, 'server'));
  });
  await check('Student missing form works without reward DOM and builds only incident fields', () => {
    const context = vm.createContext({ document, myGadgetsData: data.gadgets, pendingMissingReportData: null,
      SwalHelper: { warning() { throw Error('Unexpected warning'); } } });
    vm.runInContext(functionText('public/student/student.js', 'handleMissingFormSubmit', 'async function executeMissingSubmission'), context);
    vm.runInContext('handleMissingFormSubmit({preventDefault(){}})', context);
    assert.deepEqual(Object.keys(context.pendingMissingReportData).sort(), ['details','gadgetId','lastSeenDate','lastSeenLocation']);
    assert.equal(context.pendingMissingReportData.lastSeenLocation, 'Library');
  });
  await check('OSA missing submission sends no reward property and refreshes normally', async () => {
    let payload, refreshed = false;
    const context = vm.createContext({ document, api: { reportMissing: async body => { payload = body; return { success: true }; } },
      SwalHelper: { success: async () => {}, error() { throw Error('Unexpected error'); } }, closeModal() {},
      loadCurrentOsaScreenData: async () => { refreshed = true; } });
    vm.runInContext('async ' + functionText('public/osa/osa.js', 'handleOsaMarkMissingSubmit', 'async function openPrintStickerModal'), context);
    await vm.runInContext('handleOsaMarkMissingSubmit({preventDefault(){}})', context);
    assert.deepEqual(Object.keys(payload).sort(), ['details','gadgetId','lastSeenDate','lastSeenLocation']);
    assert.equal(refreshed, true);
  });
  const report = route('server/routes/missingRoutes.js', 'post', '/report');
  await check('Backend accepts incident without reward and ignores obsolete malformed reward input', async () => {
    const result = await report({ gadgetId: 'g', lastSeenLocation: 'Library', details: 'Notes', contactRewardOffer: { obsolete: true } });
    assert.equal(result.code, 201);
    assert.equal(result.body.report.status, 'ACTIVE');
    assert.equal(Object.hasOwn(result.body.report, 'contactRewardOffer'), false);
    assert.equal(data.gadgets[0].status, 'MISSING');
    assert.ok(data.audit_logs.length && data.notifications.length);
    const second = await report({ gadgetId: 'g', lastSeenLocation: 'Library' });
    assert.equal(second.code, 201);
    assert.equal(data.missing_reports[0].contactRewardOffer, 'Historical value');
  });
  await check('Required location and gadget ownership protection remain', async () => {
    assert.equal((await report({ gadgetId: 'g' })).code, 400);
    assert.equal((await report({ gadgetId: 'g', lastSeenLocation: 'Library' }, { id: 'other', role: 'student' })).code, 403);
  });
  await check('Public and OSA QR responses omit historical reward without changing saved values', async () => {
    const active = data.missing_reports.find(r => r.status === 'ACTIVE');
    active.contactRewardOffer = 'Old active reward';
    const scan = route('server/routes/scanRoutes.js', 'get', '/device/:token');
    for (const headers of [{}, { authorization: 'Bearer mock-osa' }]) {
      const result = await scan({}, null, headers, { token: 'test-qr' });
      assert.equal(result.code, 200);
      assert.equal(result.body.missingReport.id, active.id);
      assert.equal(Object.hasOwn(result.body.missingReport, 'contactRewardOffer'), false);
      assert.equal(active.contactRewardOffer, 'Old active reward');
    }
  });
  console.log(`${passed} focused reward-removal checks passed; no server or database loaded.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
