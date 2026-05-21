// Test that asynchronous module hooks registered via `module.register()`
// receive `context.requestType` (`'import'` or `'require'`) and a populated
// `context.conditions` array in both resolve and load hooks. Previously the
// async load hook received a context with no `conditions` and no signal of
// the request type, making composed loaders unable to distinguish `import`
// from `require` semantics.
//
// Refs: https://github.com/nodejs/node/issues/51327

import '../common/index.mjs';
import assert from 'node:assert';
import { execPath } from 'node:process';
import fixtures from '../common/fixtures.js';
import { spawnSyncAndAssert } from '../common/child_process.js';

const loaderURL = fixtures.fileURL('es-module-loaders/loader-request-type.mjs');
const esmURL = fixtures.fileURL('module-hooks/empty.mjs');

spawnSyncAndAssert(
  execPath,
  [
    '--no-warnings',
    '--input-type=module',
    '--eval',
    `import { register } from 'node:module';\n` +
    `register(${JSON.stringify(loaderURL.href)});\n` +
    `await import(${JSON.stringify(esmURL.href)});\n`,
  ],
  {
    stderr: '',
    stdout(output) {
      const records = output.split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

      function find(predicate, label) {
        const record = records.find(predicate);
        assert.ok(record, `expected to find a record for ${label}\nRecords:\n${output}`);
        return record;
      }

      // import() of an ESM file: requestType: 'import', conditions = ESM defaults.
      const esmImportLoad = find(
        (r) => r.kind === 'load' && r.url.endsWith('module-hooks/empty.mjs'),
        'load of empty.mjs via import()');
      assert.strictEqual(esmImportLoad.requestType, 'import');
      assert.strictEqual(esmImportLoad.hasImportCondition, true);
      assert.strictEqual(esmImportLoad.hasRequireCondition, false);

      const esmImportResolve = find(
        (r) => r.kind === 'resolve' && r.specifier.endsWith('module-hooks/empty.mjs'),
        'resolve of empty.mjs');
      assert.strictEqual(esmImportResolve.requestType, 'import');
      assert.strictEqual(esmImportResolve.hasImportCondition, true);
      assert.strictEqual(esmImportResolve.hasRequireCondition, false);
    },
  },
);
