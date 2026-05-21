// Flags: --require-module
'use strict';

// Test that synchronous module hooks (module.registerHooks) receive
// context.requestType ('import' or 'require') in both resolve and load hooks,
// and that context.conditions is the correct set for the request type
// (CJS conditions for require, ESM conditions for import).
//
// Refs: https://github.com/nodejs/node/issues/51327

const common = require('../common');
const assert = require('node:assert');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const fixtures = require('../common/fixtures');

const records = [];

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    records.push({
      kind: 'resolve',
      specifier,
      requestType: context.requestType,
      conditions: context.conditions,
    });
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    records.push({
      kind: 'load',
      url,
      requestType: context.requestType,
      conditions: context.conditions,
      format: context.format,
    });
    return nextLoad(url, context);
  },
});

function findRecord(predicate) {
  return records.find(predicate);
}

function assertRequireContext(record, label) {
  assert.strictEqual(record.requestType, 'require');
  assert.ok(Array.isArray(record.conditions),
            `${label}: conditions should be an array`);
  assert.ok(record.conditions.includes('require'),
            `${label}: conditions should include 'require', got ${JSON.stringify(record.conditions)}`);
  assert.ok(!record.conditions.includes('import'),
            `${label}: conditions should not include 'import', got ${JSON.stringify(record.conditions)}`);
}

function assertImportContext(record, label) {
  assert.strictEqual(record.requestType, 'import');
  assert.ok(Array.isArray(record.conditions),
            `${label}: conditions should be an array`);
  assert.ok(record.conditions.includes('import'),
            `${label}: conditions should include 'import', got ${JSON.stringify(record.conditions)}`);
  assert.ok(!record.conditions.includes('require'),
            `${label}: conditions should not include 'require', got ${JSON.stringify(record.conditions)}`);
}

// 1. require() of a CJS file -> requestType: 'require'.
require(fixtures.path('module-hooks', 'require-esm', 'inner.cjs'));

const cjsRequireLoad = findRecord((r) =>
  r.kind === 'load' && r.url.endsWith('require-esm/inner.cjs'));
assert.ok(cjsRequireLoad, 'expected load record for inner.cjs');
assertRequireContext(cjsRequireLoad, 'require(inner.cjs) load');

const cjsRequireResolve = findRecord((r) =>
  r.kind === 'resolve' && typeof r.specifier === 'string' && r.specifier.endsWith('inner.cjs'));
assert.ok(cjsRequireResolve, 'expected resolve record for inner.cjs');
assertRequireContext(cjsRequireResolve, 'require(inner.cjs) resolve');

// 2. require(esm) bridge of an ESM file -> requestType: 'require'.
//    This is the require() in CJS of an ESM module. The hook sees the ESM file
//    being loaded but the requestType reflects that the load is for a require().
require(fixtures.path('module-hooks', 'require-esm', 'inner.mjs'));

const esmRequireLoad = findRecord((r) =>
  r.kind === 'load' && r.url.endsWith('require-esm/inner.mjs'));
assert.ok(esmRequireLoad, 'expected load record for require(inner.mjs)');
assertRequireContext(esmRequireLoad, 'require(inner.mjs) load (bridge)');

// 3. import() of an ESM file -> requestType: 'import'.
//    Use a fixture path that hasn't been required yet so we avoid the load cache.
(async () => {
  await import(pathToFileURL(fixtures.path('module-hooks', 'empty.mjs')).href);

  const esmImportLoad = findRecord((r) =>
    r.kind === 'load' && r.url.endsWith('module-hooks/empty.mjs'));
  assert.ok(esmImportLoad, 'expected load record for import(empty.mjs)');
  assertImportContext(esmImportLoad, 'import(empty.mjs) load');

  const esmImportResolve = findRecord((r) =>
    r.kind === 'resolve' && typeof r.specifier === 'string' && r.specifier.endsWith('module-hooks/empty.mjs'));
  assert.ok(esmImportResolve, 'expected resolve record for import(empty.mjs)');
  assertImportContext(esmImportResolve, 'import(empty.mjs) resolve');

  hook.deregister();
})().then(common.mustCall());
