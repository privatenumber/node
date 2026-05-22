// Flags: --experimental-import-meta-resolve

// Test that import.meta.resolve() invokes the resolve hook with
// context.requestType === 'import'. This goes through the same resolveSync
// path as require() in imported CJS but with import semantics.

import '../common/index.mjs';
import assert from 'node:assert';
import { registerHooks } from 'node:module';

const records = [];
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    records.push({
      specifier,
      requestType: context.requestType,
      hasRequire: context.conditions.includes('require'),
      hasImport: context.conditions.includes('import'),
    });
    return nextResolve(specifier, context);
  },
});

import.meta.resolve('../common/index.mjs');

const record = records.find((r) =>
  typeof r.specifier === 'string' && r.specifier.endsWith('common/index.mjs'));
assert.ok(record, 'expected to see common/index.mjs in resolve records');
// import.meta.resolve has import semantics; the hook should see requestType
// 'import' and ESM conditions even though it routes through resolveSync (the
// same function require() in imported CJS uses).
assert.strictEqual(record.requestType, 'import');
assert.strictEqual(record.hasImport, true);
assert.strictEqual(record.hasRequire, false);

hook.deregister();
