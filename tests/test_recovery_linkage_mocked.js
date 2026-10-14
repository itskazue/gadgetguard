// No server, environment loading, database module, or network-capable dependency.
// Every application require is intercepted; unexpected imports fail closed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
const data = {
  users: [{ id: 'u1', role: 'student', name: 'One Student' },
    { id: 'u2', role: 'student', name: 'Two Student' },
    { id: 'osa', role: 'osa_admin', name: 'OSA' }],
  gadgets: [{ id: 'g1', userId: 'u1', status: 'MISSING' },
    { id: 'g2', userId: 'u2', status: 'MISSING' },
    { id: 'g3', userId: 'u1', status: 'REGISTERED' },
    { id: 'pending', status: 'PENDING_APPROVAL' }, { id: 'rejected', status: 'REJECTED' }],
  missing_reports: [{ id: 'old', gadgetId: 'g1', userId: 'u1', status: 'RESOLVED' },
    { id: 'new', gadgetId: 'g1', userId: 'u1', status: 'ACTIVE' },
    { id: 'other', gadgetId: 'g2', userId: 'u2', status: 'ACTIVE' }],
  found_reports: [], returns: [], claims: [], qr_scans: [], audit_logs: [], recovery_chats: []
};
const db = {
  get: key => data[key] || [],
  find(key, fn) { return this.get(key).filter(fn); },
  findOne(key, fn) { return this.get(key).find(fn); },
  findById(key, id) { return this.findOne(key, r => r.id === id); },
  update(key, id, patch) { return Object.assign(this.findById(key, id), patch); },
  insert(key, record) { data[key].push(record); return record; },
  addAuditLog(record) { data.audit_logs.push(record); },
  addNotification(record) { (data.notifications ||= []).push(record); }
};
const jwt = { verify(token) {
  if (!['u1', 'u2', 'osa'].includes(token)) throw Error('Invalid mock token');
  return data.users.find(u => u.id === token);
} };
function evaluate(file, imports) {
  const sandbox = { module: { exports: {} }, console, process: { env: {} }, require(name) {
    if (!Object.hasOwn(imports, name)) throw Error(`Blocked import: ${name}`);
    return imports[name];
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  return sandbox.module.exports;
}
const auth = evaluate('server/auth.js', { jsonwebtoken: jwt, bcryptjs: {}, './db': db });
function routes(file) {
  const handlers = {};
  const router = {};
  for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
    router[method] = (url, ...chain) => { handlers[`${method} ${url}`] = chain; };
  }
  evaluate(file, { express: { Router: () => router }, '../db': db, '../auth': auth,
    '../seed': { seedDatabase() { throw Error('Seeding prohibited'); } }, jsonwebtoken: jwt,
    crypto: require('node:crypto') });
  return (method, url, token = 'osa', params = {}, body = {}) => {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, query: {}, params, body };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    const chain = handlers[`${method} ${url}`];
    assert.ok(chain, `${method} ${url} exists`);
    let index = 0;
    const next = () => { const fn = chain[index++]; if (fn) fn(req, res, next); };
    next();
    return res;
  };
}
const missing = routes('server/routes/missingRoutes.js');
const osa = routes('server/routes/osaRoutes.js');
const claims = routes('server/routes/claimRoutes.js');
const active = () => missing('get', '/active').body.reports.find(r => r.id === 'new');
check('Prior returned cycle never hides new missing incident', () => {
  data.found_reports = [{ id: 'f-old', gadgetId: 'g1', missingReportId: 'old', status: 'RETURNED', returnId: 'r-old' }];
  assert.equal(active().hasActiveFoundReport, false);
});
for (const status of ['CANCELLED', 'INVALID', 'RETURNED', 'RESOLVED', 'UNKNOWN']) {
  check(`${status} reports do not hide incident`, () => {
    data.found_reports = [{ id: 'f', gadgetId: 'g1', missingReportId: 'new', status }];
    assert.equal(active().hasActiveFoundReport, false);
  });
}
check('Unlinked or different incident reports do not hide incident', () => {
  data.found_reports = [{ id: 'a', gadgetId: 'g1', status: 'REPORTED' },
    { id: 'b', gadgetId: 'g1', missingReportId: 'old', status: 'REPORTED' }];
  assert.equal(active().hasActiveFoundReport, false);
});
for (const status of ['REPORTED', 'PENDING_OSA_TURNOVER', 'IN_OSA_CUSTODY']) {
  check(`${status} exact incident link hides incident`, () => {
    data.found_reports.push({ id: status, gadgetId: 'g1', missingReportId: 'new', status });
    assert.equal(active().hasActiveFoundReport, true);
    assert.equal(missing('get', '/active').body.reports.length, 3, 'History retained');
    data.found_reports.pop();
  });
}
data.returns = [{ id: 'r-old', gadgetId: 'g1', userId: 'u1' },
  { id: 'r-new', gadgetId: 'g1', userId: 'u1', recoverySource: 'QR Finder Report' },
  { id: 'r-other', gadgetId: 'g2', userId: 'u2' }];
data.found_reports = [{ id: 'f-old', gadgetId: 'g1', returnId: 'r-old', status: 'RETURNED', finderName: 'Old Finder' },
  { id: 'f-new', gadgetId: 'g1', returnId: 'r-new', status: 'RETURNED', finderName: 'New Finder', finderContact: 'new-contact' }];
const returned = id => osa('get', '/returns').body.returns.find(r => r.id === id);
check('History uses exact return transaction, including contact and recorded source', () => {
  assert.equal(returned('r-old').foundReport.finderName, 'Old Finder');
  assert.equal(returned('r-old').recoverySource, 'Not recorded');
  assert.equal(returned('r-new').foundReport.finderContact, 'new-contact');
  assert.equal(returned('r-new').recoverySource, 'QR Finder Report');
});
check('Same gadget without transaction linkage is Not recorded', () => {
  data.returns.push({ id: 'unlinked', gadgetId: 'g1', userId: 'u1', type: 'OWNER_RECOVERED' });
  assert.equal(returned('unlinked').foundReport, null);
  assert.equal(returned('unlinked').recoverySource, 'Not recorded');
});
check('Multiple exact finder links remain ambiguous', () => {
  data.found_reports.push({ id: 'second', gadgetId: 'g1', returnId: 'r-new', status: 'RETURNED' });
  assert.equal(returned('r-new').foundReport, null);
  assert.equal(returned('r-new').recoverySource, 'Not recorded');
  data.found_reports.pop();
});
check('Invalid or cancelled linked finders never supply details', () => {
  for (const status of ['INVALID', 'CANCELLED']) {
    data.found_reports[1].status = status;
    assert.equal(returned('r-new').foundReport, null);
  }
  data.found_reports[1].status = 'RETURNED';
});
check('Student returns and claims are scoped; anonymous returns and student stats denied', () => {
  data.claims = [{ id: 'c1', gadgetId: 'g1', userId: 'u1' }, { id: 'c2', gadgetId: 'g2', userId: 'u2' }];
  assert.ok(osa('get', '/returns', 'u1').body.returns.every(r => r.userId === 'u1'));
  assert.equal(osa('get', '/returns', 'u2').body.returns.length, 1);
  assert.equal(claims('get', '/my', 'u1').body.claims.length, 1);
  assert.equal(osa('get', '/returns', null).code, 401);
  assert.equal(osa('get', '/stats', 'u1').code, 403);
});
check('Dashboard example remains Registered 3, Missing 2', () => {
  const result = osa('get', '/stats');
  assert.equal(result.code, 200);
  assert.equal(result.body.stats.registeredGadgets, 3);
  assert.equal(result.body.stats.missingGadgets, 2);
});
const uiText = fs.readFileSync(path.join(root, 'public/osa/osa.js'), 'utf8');
function uiFunction(name, next) {
  return uiText.slice(uiText.indexOf(`function ${name}(`), uiText.indexOf(next, uiText.indexOf(`function ${name}(`)));
}
const content = { innerHTML: '' };
const elements = { 'claim-details-content': content, 'claim-details-modal': { classList: { add() {} } } };
const ui = vm.createContext({ window: { _allClaimsData: [{ id: 'collision', status: 'PENDING', user: { name: 'Claim Person' } }],
  _historyList: [{ id: 'collision', user: { name: 'History Person' }, recoverySource: 'Not recorded' }] },
  document: { getElementById: id => elements[id] }, escapeHtml: s => String(s), formatDate: () => 'date' });
vm.runInContext(uiFunction('openClaimDetailsModal', 'async function handleApproveClaim'), ui);
check('History modal remains accessible with Claims loaded and colliding ID', () => {
  vm.runInContext("openClaimDetailsModal('collision', 'history')", ui);
  assert.match(content.innerHTML, /History Person/);
  assert.match(content.innerHTML, /HANDOVER COMPLETE/);
  assert.match(content.innerHTML, /Linked Finder Report:<\/span> Not recorded/);
  assert.doesNotMatch(content.innerHTML, /Process Return|Proceed to Handover|Claim Person/);
});
check('Claims modal retains Claims record and pending behavior', () => {
  vm.runInContext("openClaimDetailsModal('collision')", ui);
  assert.match(content.innerHTML, /Claim Person/);
  assert.doesNotMatch(content.innerHTML, /History Person|HANDOVER COMPLETE/);
});
check('History button explicitly selects history source', () => {
  assert.ok(uiText.includes("openClaimDetailsModal('${c.id}', 'history')"));
});
check('Active missing UI hides linked incident, ALL keeps history', () => {
  let rendered;
  elements['missing-status-filter'] = { value: 'ACTIVE' };
  ui.missingReportsCache = [{ id: 'new', status: 'ACTIVE', gadget: { status: 'MISSING' }, hasActiveFoundReport: false },
    { id: 'found', status: 'ACTIVE', gadget: { status: 'MISSING' }, hasActiveFoundReport: true },
    { id: 'old', status: 'RESOLVED' }];
  ui.sortGadgetsList = rows => rows;
  ui.renderMissingTable = rows => { rendered = rows; };
  vm.runInContext(uiFunction('filterMissingTable', 'function clearMissingFilter'), ui);
  vm.runInContext('filterMissingTable()', ui);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].id, 'new');
  elements['missing-status-filter'].value = 'ALL';
  vm.runInContext('filterMissingTable()', ui);
  assert.equal(rendered.length, 3);
});
check('Owner recovery keeps existing behavior without creating return', () => {
  data.found_reports = [{ id: 'owner-found', gadgetId: 'g1', status: 'REPORTED' }];
  const count = data.returns.length;
  assert.equal(missing('post', '/:id/cancel', 'u2', { id: 'new' }).code, 403);
  assert.equal(missing('post', '/:id/cancel', 'u1', { id: 'new' }).code, 200);
  assert.equal(data.returns.length, count);
  assert.equal(db.findById('gadgets', 'g1').status, 'REGISTERED');
  assert.equal(data.found_reports[0].status, 'RESOLVED');
});
// Exercise official return writes against mock data, rather than fabricated history alone.
const proof = '/mock-handover-proof.jpg';
const receiptTime = '2026-10-14T10:00:00.000Z';
function returnFixture() {
  data.gadgets = [{ id: 'g1', userId: 'u1', status: 'FOUND_IN_CUSTODY', receivedAtOsaDate: receiptTime }];
  data.missing_reports = [
    { id: 'old', gadgetId: 'g1', userId: 'u1', status: 'RESOLVED', returnId: 'previous-return' },
    { id: 'current', gadgetId: 'g1', userId: 'u1', status: 'IN_OSA_CUSTODY', custodyReceivedAt: receiptTime }
  ];
  data.found_reports = [
    { id: 'cancelled', gadgetId: 'g1', missingReportId: 'old', status: 'CANCELLED', finderName: 'Cancelled finder' },
    { id: 'invalid', gadgetId: 'g1', missingReportId: 'old', status: 'INVALID' },
    { id: 'previous', gadgetId: 'g1', missingReportId: 'old', status: 'RETURNED', returnId: 'previous-return', finderName: 'Previous finder' },
    { id: 'current-finder', gadgetId: 'g1', missingReportId: 'current', status: 'IN_OSA_CUSTODY', finderName: 'Current finder', finderContact: 'current-contact' },
    { id: 'other-finder', gadgetId: 'g1', missingReportId: 'current', status: 'REPORTED' }
  ];
  data.returns = [{ id: 'previous-return', gadgetId: 'g1', userId: 'u1' }];
  data.claims = [{ id: 'verified', gadgetId: 'g1', userId: 'u1', status: 'APPROVED', verificationIdNumber: 'verified-id', claimProofDetails: 'Existing proof' }];
  data.audit_logs = [];
  data.notifications = [];
  data.recovery_chats = [];
}
function officialReturn(overrides = {}) {
  return osa('post', '/return', 'osa', {}, {
    gadgetId: 'g1', claimId: 'verified', receivedByPersonName: 'One Student',
    receivedByPersonId: 'verified-id', handoverPhotoUrl: proof, ...overrides
  });
}
check('Official return resolves custody incident and preserves historical reports, proof, claim and audit', () => {
  returnFixture();
  const history = JSON.stringify(data.found_reports.slice(0, 3));
  const oldMissing = JSON.stringify(data.missing_reports[0]);
  const result = officialReturn();
  assert.equal(result.code, 200);
  const returnId = result.body.returnRecord.id;
  assert.equal(data.missing_reports[1].status, 'RESOLVED');
  assert.equal(data.missing_reports[1].returnId, returnId);
  assert.equal(data.missing_reports[1].handoverPhotoUrl, proof);
  assert.equal(data.found_reports[3].status, 'RETURNED');
  assert.equal(data.found_reports[3].returnId, returnId);
  assert.equal(JSON.stringify(data.found_reports.slice(0, 3)), history);
  assert.equal(JSON.stringify(data.missing_reports[0]), oldMissing);
  assert.equal(data.found_reports[4].status, 'REPORTED');
  assert.equal(data.found_reports[4].returnId, undefined);
  assert.equal(data.claims[0].status, 'RETURNED');
  assert.equal(data.claims[0].verificationIdNumber, 'verified-id');
  assert.equal(data.claims[0].claimProofDetails, 'Existing proof');
  assert.equal(data.audit_logs[0].action, 'RETURN_GADGET');
  assert.equal(data.notifications.length, 1);
  assert.equal(returned(returnId).foundReport.finderContact, 'current-contact');
  assert.equal(returned('previous-return').foundReport.finderName, 'Previous finder');
});
check('Repeated recovery cycles retain earlier return and finder linkage', () => {
  const firstReturn = data.found_reports[3].returnId;
  const firstFinder = JSON.stringify(data.found_reports[3]);
  data.gadgets[0].status = 'FOUND_IN_CUSTODY';
  data.missing_reports.push({ id: 'next-cycle', gadgetId: 'g1', userId: 'u1', status: 'IN_OSA_CUSTODY' });
  data.found_reports.push({ id: 'next-finder', gadgetId: 'g1', missingReportId: 'next-cycle', status: 'IN_OSA_CUSTODY', finderName: 'Next finder' });
  data.claims.push({ id: 'next-claim', gadgetId: 'g1', userId: 'u1', status: 'APPROVED' });
  const result = officialReturn({ claimId: 'next-claim' });
  assert.equal(result.code, 200);
  assert.equal(data.missing_reports[2].status, 'RESOLVED');
  assert.equal(JSON.stringify(data.found_reports[3]), firstFinder);
  assert.equal(returned(firstReturn).foundReport.finderName, 'Current finder');
  assert.equal(returned(result.body.returnRecord.id).foundReport.finderName, 'Next finder');
});
check('Multiple custody finders reject before any mutation', () => {
  returnFixture();
  data.found_reports.push({ id: 'ambiguous', gadgetId: 'g1', missingReportId: 'current', status: 'IN_OSA_CUSTODY' });
  const before = JSON.stringify(data);
  assert.equal(officialReturn().code, 409);
  assert.equal(JSON.stringify(data), before);
});
check('Multiple exact receipt incidents without explicit finder link reject before any mutation', () => {
  returnFixture();
  delete data.found_reports[3].missingReportId;
  data.found_reports[3].receivedAtOsaDate = receiptTime;
  data.missing_reports.push({ id: 'ambiguous-missing', gadgetId: 'g1', status: 'IN_OSA_CUSTODY', custodyReceivedAt: receiptTime });
  const before = JSON.stringify(data);
  assert.equal(officialReturn().code, 409);
  assert.equal(JSON.stringify(data), before);
});
check('Unlinked legacy custody without exact receipt evidence rejects safely', () => {
  returnFixture();
  delete data.found_reports[3].missingReportId;
  const before = JSON.stringify(data);
  assert.equal(officialReturn().code, 409);
  assert.equal(JSON.stringify(data), before);
});
check('Direct surrender uses exact recorded custody receipt to resolve incident', () => {
  returnFixture();
  delete data.found_reports[3].missingReportId;
  data.found_reports[3].receivedAtOsaDate = receiptTime;
  assert.equal(officialReturn().code, 200);
  assert.equal(data.missing_reports[1].status, 'RESOLVED');
});
check('Direct surrender without a missing incident still returns with exact receipt evidence', () => {
  returnFixture();
  data.missing_reports = [];
  delete data.found_reports[3].missingReportId;
  data.found_reports[3].receivedAtOsaDate = receiptTime;
  assert.equal(officialReturn().code, 200);
  assert.equal(data.missing_reports.length, 0);
});
check('Wrong cycle, cancelled, invalid and completed custody candidates reject without writes', () => {
  for (const patch of [{ missingReportId: 'old' }, { status: 'CANCELLED' },
    { status: 'INVALID' }, { status: 'RETURNED' }, { returnId: 'previous-return' }]) {
    returnFixture();
    Object.assign(data.found_reports[3], patch);
    const before = JSON.stringify(data);
    assert.equal(officialReturn().code, 409);
    assert.equal(JSON.stringify(data), before);
  }
});
check('Proof remains mandatory and duplicate return remains rejected', () => {
  returnFixture();
  const before = JSON.stringify(data);
  assert.equal(officialReturn({ handoverPhotoUrl: '' }).code, 400);
  assert.equal(JSON.stringify(data), before);
  assert.equal(officialReturn().code, 200);
  const after = JSON.stringify(data);
  assert.equal(officialReturn().code, 400);
  assert.equal(JSON.stringify(data), after);
});
check('Verified iPhone configuration uses exact incident link despite five custody incidents', () => {
  returnFixture();
  const gadgetId = 'gdt_mv7iy1er4ut';
  const linkedId = 'msr_mv7ynavb4i0';
  data.gadgets[0].id = gadgetId;
  data.gadgets[0].brand = 'Apple';
  data.gadgets[0].model = 'iPhone 14 Pro Max';
  // Only supplied IDs/statuses are live facts; historical IDs below are synthetic.
  data.missing_reports = [
    ...[1, 2, 3].map(n => ({ id: `stale-incident-${n}`, gadgetId, status: 'IN_OSA_CUSTODY' })),
    { id: linkedId, gadgetId, status: 'IN_OSA_CUSTODY' },
    { id: 'msr_mv7yn90n1fm', gadgetId, status: 'IN_OSA_CUSTODY' }
  ];
  data.found_reports = [
    { id: 'historical-cancelled', gadgetId, status: 'CANCELLED', missingReportId: 'stale-incident-1' },
    ...[1, 2, 3].map(n => ({ id: `historical-finder-${n}`, gadgetId, status: 'RETURNED',
      missingReportId: `stale-incident-${n}`, returnId: `historical-return-${n}` })),
    { id: 'fnd_mv7yp4jh5c2548', gadgetId, status: 'IN_OSA_CUSTODY', missingReportId: linkedId }
  ];
  data.returns = [1, 2, 3].map(n => ({ id: `historical-return-${n}`, gadgetId, userId: 'u1' }));
  data.claims[0].gadgetId = gadgetId;
  const previousReturns = JSON.stringify(data.returns);
  const historicalFinders = JSON.stringify(data.found_reports.slice(0, 4));
  const untouchedMissing = JSON.stringify(data.missing_reports.filter(m => m.id !== linkedId));
  const result = officialReturn({ gadgetId });
  assert.equal(result.code, 200);
  const returnId = result.body.returnRecord.id;
  assert.equal(data.returns.length, 4);
  assert.equal(JSON.stringify(data.returns.slice(0, 3)), previousReturns);
  assert.equal(JSON.stringify(data.found_reports.slice(0, 4)), historicalFinders);
  assert.equal(JSON.stringify(data.missing_reports.filter(m => m.id !== linkedId)), untouchedMissing);
  assert.equal(db.findById('missing_reports', linkedId).status, 'RESOLVED');
  assert.equal(db.findById('missing_reports', linkedId).returnId, returnId);
  assert.equal(data.found_reports[4].returnId, returnId);
  assert.equal(data.claims[0].returnId, returnId);
  assert.equal(returned(returnId).foundReport.id, 'fnd_mv7yp4jh5c2548');
  assert.equal(returned('historical-return-1').foundReport.id, 'historical-finder-1');
});
const finder = routes('server/routes/finderRoutes.js');
check('Public finder creation records server-selected QR source through custody and return', () => {
  returnFixture();
  data.found_reports = [];
  data.gadgets[0].status = 'MISSING';
  data.missing_reports[1].status = 'ACTIVE';
  const created = finder('post', '/report', null, {}, { gadgetId: 'g1', foundLocation: 'Library',
    turnInMethod: 'SUBMITTED_TO_OSA', recoverySource: 'Owner Recovered' });
  assert.equal(created.code, 200);
  const report = data.found_reports[0];
  assert.equal(report.recoverySource, 'QR Finder Report');
  assert.equal(finder('post', '/:id/receive', 'osa', { id: report.id }).code, 200);
  assert.equal(report.recoverySource, 'QR Finder Report', 'Custody does not overwrite QR origin');
  const result = officialReturn();
  assert.equal(result.code, 200);
  assert.equal(result.body.returnRecord.recoverySource, 'QR Finder Report');
  assert.equal(returned(result.body.returnRecord.id).recoverySource, 'QR Finder Report');
});
check('Direct OSA intake records server-selected direct source and persists it on return', () => {
  returnFixture();
  data.found_reports = [];
  data.gadgets[0].status = 'MISSING';
  data.missing_reports[1].status = 'ACTIVE';
  const received = finder('post', '/:id/receive', 'osa', { id: 'g1' }, { recoverySource: 'QR Finder Report' });
  assert.equal(received.code, 200);
  assert.equal(data.found_reports[0].recoverySource, 'Direct OSA Surrender');
  const result = officialReturn();
  assert.equal(result.code, 200);
  assert.equal(result.body.returnRecord.recoverySource, 'Direct OSA Surrender');
  assert.equal(returned(result.body.returnRecord.id).recoverySource, 'Direct OSA Surrender');
});
check('Invalid finder submission creates no report or source', () => {
  returnFixture();
  const before = JSON.stringify(data);
  assert.equal(finder('post', '/report', null, {}, { gadgetId: 'g1', foundLocation: '' }).code, 400);
  assert.equal(JSON.stringify(data), before);
});
function historicalSourceFixture() {
  returnFixture();
  data.found_reports = [{ id: 'historical-exact', gadgetId: 'g1', missingReportId: 'old',
    returnId: 'previous-return', status: 'RETURNED' }];
}
check('Historical QR decision derives source through exact return link without database writes', () => {
  for (const decision of ['KEPT_SAFE', 'WILL_SURRENDER_TO_OSA']) {
    historicalSourceFixture();
    data.found_reports[0].finderDecision = decision;
    data.returns[0].recoverySource = 'Not recorded';
    const before = JSON.stringify(data);
    assert.equal(returned('previous-return').recoverySource, 'QR Finder Report');
    assert.equal(JSON.stringify(data), before);
  }
});
check('Exactly linked recovery chat verifies historical QR source even when closed', () => {
  historicalSourceFixture();
  data.recovery_chats = [{ id: 'chat', gadgetId: 'g1', foundReportId: 'historical-exact',
    missingReportId: 'old', status: 'CLOSED' }];
  assert.equal(returned('previous-return').recoverySource, 'QR Finder Report');
});
check('Chat for wrong report, gadget or incident cannot establish source', () => {
  for (const patch of [{ foundReportId: 'different' }, { gadgetId: 'g2' }, { missingReportId: 'different' }]) {
    historicalSourceFixture();
    data.recovery_chats = [{ id: 'chat', gadgetId: 'g1', foundReportId: 'historical-exact',
      missingReportId: 'old', ...patch }];
    assert.equal(returned('previous-return').recoverySource, 'Not recorded');
  }
});
check('Explicit historical direct provenance is accepted, names and turnover alone are not', () => {
  historicalSourceFixture();
  data.found_reports[0].recoverySource = 'Direct OSA Surrender';
  assert.equal(returned('previous-return').recoverySource, 'Direct OSA Surrender');
  delete data.found_reports[0].recoverySource;
  data.found_reports[0].finderName = 'Face-to-Face Walk-in (Surrendered at OSA)';
  data.found_reports[0].turnInMethod = 'SUBMITTED_TO_OSA';
  assert.equal(returned('previous-return').recoverySource, 'Not recorded');
  data.found_reports[0].finderName = 'Regular finder name';
  assert.equal(returned('previous-return').recoverySource, 'Not recorded');
});
check('Multiple exact finder links cannot establish historical source', () => {
  historicalSourceFixture();
  data.found_reports[0].finderDecision = 'WILL_SURRENDER_TO_OSA';
  data.found_reports.push({ ...data.found_reports[0], id: 'other-exact' });
  assert.equal(returned('previous-return').recoverySource, 'Not recorded');
});
check('Unsupported owner and conflicting sources remain Not recorded', () => {
  for (const source of ['Owner Recovered', 'UNVERIFIED_SOURCE']) {
    historicalSourceFixture();
    data.returns[0].recoverySource = source;
    data.found_reports[0].finderDecision = 'WILL_SURRENDER_TO_OSA';
    assert.equal(returned('previous-return').recoverySource, 'Not recorded');
  }
  historicalSourceFixture();
  data.found_reports[0].recoverySource = 'Direct OSA Surrender';
  data.found_reports[0].finderDecision = 'WILL_SURRENDER_TO_OSA';
  assert.equal(returned('previous-return').recoverySource, 'Not recorded');
});
check('Future return persists verified legacy QR provenance and rejects unsupported source labels', () => {
  returnFixture();
  data.found_reports[3].finderDecision = 'WILL_SURRENDER_TO_OSA';
  assert.equal(officialReturn().body.returnRecord.recoverySource, 'QR Finder Report');
  returnFixture();
  data.found_reports[3].recoverySource = 'Owner Recovered';
  assert.equal(officialReturn().body.returnRecord.recoverySource, 'Not recorded');
});
check('History table and View Details display the same derived API source', () => {
  historicalSourceFixture();
  data.found_reports[0].finderDecision = 'KEPT_SAFE';
  const record = returned('previous-return');
  ui.window._historyList = [record];
  elements['returned-history-table'] = { innerHTML: '' };
  vm.runInContext(uiFunction('renderReturnedHistoryTable', 'function viewLargePhoto'), ui);
  vm.runInContext('renderReturnedHistoryTable(window._historyList)', ui);
  vm.runInContext("openClaimDetailsModal('previous-return', 'history')", ui);
  assert.match(elements['returned-history-table'].innerHTML, /QR Finder Report/);
  assert.match(content.innerHTML, /Recovery Source:<\/span> <strong>QR Finder Report/);
});
function asusFixture() {
  returnFixture();
  const gadgetId = 'gdt_mv7lbtb5pb6';
  const timestamp = '2026-10-14T12:18:02.812Z';
  for (const collection of ['missing_reports', 'found_reports', 'claims', 'returns']) {
    for (const record of data[collection]) record.gadgetId = gadgetId;
  }
  Object.assign(data.gadgets[0], { id: gadgetId, receivedAtOsaDate: timestamp });
  Object.assign(data.missing_reports[0], { status: 'IN_OSA_CUSTODY', custodyReceivedAt: '2026-10-13T10:00:00.000Z' });
  delete data.missing_reports[0].returnId;
  Object.assign(data.missing_reports[1], { id: 'msr_mv7wt0a2kim', custodyReceivedAt: timestamp });
  data.missing_reports.push({ id: 'synthetic-older-asus-incident', gadgetId,
    status: 'IN_OSA_CUSTODY', custodyReceivedAt: '2026-10-12T10:00:00.000Z' });
  Object.assign(data.found_reports[3], { id: 'fnd_mv82sjssrvw', missingReportId: null, receivedAtOsaDate: timestamp });
  return gadgetId;
}
check('Verified Asus direct intake resolves only unique exact receipt incident despite stale custody history', () => {
  const gadgetId = asusFixture();
  const historicalMissing = JSON.stringify(data.missing_reports.filter(m => m.id !== 'msr_mv7wt0a2kim'));
  const historicalFinders = JSON.stringify(data.found_reports.filter(f => f.id !== 'fnd_mv82sjssrvw'));
  const previousReturns = JSON.stringify(data.returns);
  const result = officialReturn({ gadgetId });
  assert.equal(result.code, 200);
  const returnId = result.body.returnRecord.id;
  assert.equal(db.findById('missing_reports', 'msr_mv7wt0a2kim').status, 'RESOLVED');
  assert.equal(db.findById('missing_reports', 'msr_mv7wt0a2kim').returnId, returnId);
  assert.equal(db.findById('found_reports', 'fnd_mv82sjssrvw').returnId, returnId);
  assert.equal(JSON.stringify(data.missing_reports.filter(m => m.id !== 'msr_mv7wt0a2kim')), historicalMissing);
  assert.equal(JSON.stringify(data.found_reports.filter(f => f.id !== 'fnd_mv82sjssrvw')), historicalFinders);
  assert.equal(JSON.stringify(data.returns.slice(0, 1)), previousReturns);
  assert.equal(returned(returnId).foundReport.id, 'fnd_mv82sjssrvw');
});
check('Asus duplicate exact incident timestamps reject without choosing first or latest', () => {
  const gadgetId = asusFixture();
  data.missing_reports[2].custodyReceivedAt = data.missing_reports[1].custodyReceivedAt;
  const before = JSON.stringify(data);
  assert.equal(officialReturn({ gadgetId }).code, 409);
  assert.equal(JSON.stringify(data), before);
});
check('Asus missing or mismatched exact incident receipt evidence rejects without writes', () => {
  for (const timestamp of [undefined, '2026-10-14T12:18:02.813Z']) {
    const gadgetId = asusFixture();
    data.missing_reports[1].custodyReceivedAt = timestamp;
    const before = JSON.stringify(data);
    assert.equal(officialReturn({ gadgetId }).code, 409);
    assert.equal(JSON.stringify(data), before);
  }
});
check('Asus finder/gadget receipt mismatch still rejects before writes', () => {
  const gadgetId = asusFixture();
  data.gadgets[0].receivedAtOsaDate = '2026-10-14T12:18:02.813Z';
  const before = JSON.stringify(data);
  assert.equal(officialReturn({ gadgetId }).code, 409);
  assert.equal(JSON.stringify(data), before);
});
console.log(`${checks} focused checks passed; application imports mocked, no DB or server loaded.`);
