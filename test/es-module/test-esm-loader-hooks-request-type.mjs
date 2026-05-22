// Test that asynchronous module hooks registered via `module.register()`
// receive `context.requestType` ('import' or 'require') and a populated
// `context.conditions` array in both resolve and load hooks. Previously the
// async load hook received a context with no `conditions` and no signal of
// the request type, which made composed loaders unable to distinguish
// `import` from `require` semantics.
//
// The require(esm) bridge invoked from an authentic CJS `require()` on the
// main thread is handled by the CJS loader and ESMLoader.importSyncForRequire,
// which compile the loaded source directly without re-entering the async load
// chain. That path is covered by test-esm-loader-hooks-conditions-bridge.mjs,
// which arranges for the bridge call to originate from an async-hook-supplied
// CJS source.
//
// Refs: https://github.com/nodejs/node/issues/51327

import '../common/index.mjs';
import assert from 'node:assert';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import fixtures from '../common/fixtures.js';
import { spawnSyncAndAssert } from '../common/child_process.js';

const loaderURL = fixtures.fileURL('es-module-loaders/loader-request-type.mjs');
const esmURL = fixtures.fileURL('module-hooks/empty.mjs');
// main.cjs requires esm.mjs (require(esm) bridge) which then statically
// imports inner.mjs. The kImportInRequiredESM case (import inside a require()'d
// ESM) routes through the cascaded loader and reaches the async hook.
const requireEsmMainPath = fileURLToPath(fixtures.fileURL('module-hooks/require-esm/main.cjs'));

const childSource =
  `import { register, createRequire } from 'node:module';\n` +
  `register(${JSON.stringify(loaderURL.href)});\n` +
  `const require = createRequire(import.meta.url);\n` +
  `require(${JSON.stringify(requireEsmMainPath)});\n` +
  `await import(${JSON.stringify(esmURL.href)});\n`;

spawnSyncAndAssert(
  execPath,
  [
    '--no-warnings',
    '--require-module',
    '--input-type=module',
    '--eval',
    childSource,
  ],
  {
    stderr: '',
    stdout(output) {
      const records = output.split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line));

      function find(predicate, label) {
        const record = records.find(predicate);
        assert.ok(record, `expected to find a record for ${label}\nRecords:\n${output}`);
        return record;
      }

      // 1. import() of an ESM file: requestType 'import', ESM conditions.
      const esmImportLoad = find(
        (r) => r.kind === 'load' && r.url.endsWith('module-hooks/empty.mjs'),
        'load of empty.mjs via import()');
      assert.strictEqual(esmImportLoad.requestType, 'import');
      assert.strictEqual(esmImportLoad.hasImportCondition, true);
      assert.strictEqual(esmImportLoad.hasRequireCondition, false);

      const esmImportResolve = find(
        (r) => r.kind === 'resolve' && r.specifier.endsWith('module-hooks/empty.mjs'),
        'resolve of empty.mjs via import()');
      assert.strictEqual(esmImportResolve.requestType, 'import');

      // 2. kImportInRequiredESM: inside a require()'d ESM (esm.mjs reached via
      //    require-bridge), the static `import { esmValue } from './inner.mjs'`
      //    routes through the cascaded loader and reaches the async hook. The
      //    requestType should be 'import' because it is still an import.
      const importInRequiredEsmLoad = find(
        (r) => r.kind === 'load' && r.url.endsWith('require-esm/inner.mjs'),
        'load of inner.mjs (import inside required ESM)');
      assert.strictEqual(importInRequiredEsmLoad.requestType, 'import');
      assert.strictEqual(importInRequiredEsmLoad.hasImportCondition, true);
      assert.strictEqual(importInRequiredEsmLoad.hasRequireCondition, false);

      // 3. Same for an import-of-CJS from within the required ESM: still 'import'.
      const importOfCjsFromRequiredEsm = find(
        (r) => r.kind === 'load' && r.url.endsWith('require-esm/cjs.cjs'),
        'load of cjs.cjs (import of CJS inside required ESM)');
      assert.strictEqual(importOfCjsFromRequiredEsm.requestType, 'import');
      assert.strictEqual(importOfCjsFromRequiredEsm.hasImportCondition, true);
    },
  },
);
