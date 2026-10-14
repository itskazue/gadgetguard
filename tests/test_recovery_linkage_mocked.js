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
  update(key, id, patch) { Object.assign(this.findById(key, id), patch); },
  addAuditLog() {}
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
    '../seed': { seedDatabase() { throw Error('Seeding prohibited'); } }, jsonwebtoken: jwt });
  return (method, url, token = 'osa', params = {}) => {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, query: {}, params };
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
console.log(`${checks} focused checks passed; application imports mocked, no DB or server loaded.`);
