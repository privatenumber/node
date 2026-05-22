// Flags: --require-module
'use strict';

// Test that synchronous module hooks (module.registerHooks) receive
// context.requestType ('import' or 'require') in resolve and load hooks,
// and that context.conditions is the correct set for the request type
// (CJS conditions when requestType is 'require', ESM defaults otherwise).
//
// Covers the request-type matrix produced by the require-esm fixture, which
// interleaves require() and import in both directions:
//   - main.cjs                 : required at top-level                      -> 'require'
//   - main.cjs requires esm.mjs: require(esm) bridge                        -> 'require'
//   - esm.mjs imports inner.mjs: import inside require()'d ESM
//                                (kImportInRequiredESM)                     -> 'import'
//   - esm.mjs imports cjs.cjs  : import inside require()'d ESM of a CJS     -> 'import'
//   - cjs.cjs requires inner.cjs: require() inside CJS reached via import   -> 'require'
//
// Refs: https://github.com/nodejs/node/issues/51327

const common = require('../common');
const assert = require('node:assert');
const { registerHooks } = require('node:module');
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
      format: context.format,
      requestType: context.requestType,
      conditions: context.conditions,
    });
    return nextLoad(url, context);
  },
});

function findLoadRecord(suffix) {
  return records.find((r) => r.kind === 'load' && r.url.endsWith(suffix));
}

function assertRequireContext(record, label) {
  assert.ok(record, `expected a record for ${label}`);
  assert.strictEqual(record.requestType, 'require',
                     `${label}: requestType`);
  assert.ok(Array.isArray(record.conditions),
            `${label}: conditions should be an array`);
  assert.ok(record.conditions.includes('require'),
            `${label}: conditions should include 'require', got ${JSON.stringify(record.conditions)}`);
  assert.ok(!record.conditions.includes('import'),
            `${label}: conditions should not include 'import', got ${JSON.stringify(record.conditions)}`);
}

function assertImportContext(record, label) {
  assert.ok(record, `expected a record for ${label}`);
  assert.strictEqual(record.requestType, 'import',
                     `${label}: requestType`);
  assert.ok(Array.isArray(record.conditions),
            `${label}: conditions should be an array`);
  assert.ok(record.conditions.includes('import'),
            `${label}: conditions should include 'import', got ${JSON.stringify(record.conditions)}`);
  assert.ok(!record.conditions.includes('require'),
            `${label}: conditions should not include 'require', got ${JSON.stringify(record.conditions)}`);
}

// Trigger the full interleaving in one require chain.
require(fixtures.path('module-hooks', 'require-esm', 'main.cjs'));

// 1. main.cjs is required at top level -> 'require'.
assertRequireContext(findLoadRecord('require-esm/main.cjs'),
                     'require(main.cjs) load');

// 2. main.cjs does require('./esm.mjs') -> 'require' (require(esm) bridge).
assertRequireContext(findLoadRecord('require-esm/esm.mjs'),
                     'require(esm.mjs) load (bridge)');

// 3. esm.mjs does `import { esmValue } from './inner.mjs'` -> 'import'.
//    This is the kImportInRequiredESM case: an import statement inside an ESM
//    module that was reached via require(). Semantically still an import.
assertImportContext(findLoadRecord('require-esm/inner.mjs'),
                    'import-in-required-esm of inner.mjs load');

// 4. esm.mjs does `import { cjsValue } from './cjs.cjs'` -> 'import'.
//    Still an import statement, even though the target happens to be CJS.
assertImportContext(findLoadRecord('require-esm/cjs.cjs'),
                    'import-in-required-esm of cjs.cjs load');

// 5. cjs.cjs does require('./inner.cjs') -> 'require'.
//    Even though cjs.cjs was reached via an import statement, its internal
//    require() call still has require() semantics.
assertRequireContext(findLoadRecord('require-esm/inner.cjs'),
                     'require(inner.cjs) inside cjs.cjs load');

// Sanity check the resolve hook also saw the same requestType for each load.
function findResolveRecord(suffix) {
  return records.find((r) =>
    r.kind === 'resolve' &&
    typeof r.specifier === 'string' &&
    r.specifier.endsWith(suffix));
}

assertRequireContext(findResolveRecord('esm.mjs'), 'resolve esm.mjs');
assertImportContext(findResolveRecord('inner.mjs'), 'resolve inner.mjs');
assertImportContext(findResolveRecord('cjs.cjs'), 'resolve cjs.cjs');
assertRequireContext(findResolveRecord('inner.cjs'), 'resolve inner.cjs');

hook.deregister();

// Also test dynamic import() in an async block. Use a separate fixture path
// to avoid the module cache from the require chain above.
(async () => {
  const records2 = [];
  const dynHook = registerHooks({
    resolve(specifier, context, nextResolve) {
      records2.push({
        kind: 'resolve',
        specifier,
        requestType: context.requestType,
        conditions: context.conditions,
      });
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      records2.push({
        kind: 'load',
        url,
        requestType: context.requestType,
        conditions: context.conditions,
      });
      return nextLoad(url, context);
    },
  });

  await import(fixtures.fileURL('module-hooks', 'empty.mjs').href);

  const importLoad = records2.find((r) =>
    r.kind === 'load' && r.url.endsWith('module-hooks/empty.mjs'));
  assertImportContext(importLoad, 'dynamic import(empty.mjs) load');

  const importResolve = records2.find((r) =>
    r.kind === 'resolve' && typeof r.specifier === 'string' &&
    r.specifier.endsWith('module-hooks/empty.mjs'));
  assertImportContext(importResolve, 'dynamic import(empty.mjs) resolve');

  dynHook.deregister();
})().then(common.mustCall());
