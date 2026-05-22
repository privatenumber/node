// Flags: --no-warnings

// Regression test for nodejs/node#51327.
//
// When an asynchronous loader's `load` hook returns `format: 'commonjs'`, the
// `require()` and `require.resolve()` calls inside the resulting CJS source
// must reach the resolve hook with CJS conditions (containing 'require',
// NOT 'import'). The original bug, confirmed by @aduh95 in
// https://github.com/nodejs/node/issues/51327#issuecomment-1873442078, was
// that the resolve hook received ESM conditions for those calls because the
// load context constructed on the main thread did not carry the requestType
// signal across the IPC to the loader worker.
//
// This test adapts aduh95's minimal repro.

import '../common/index.mjs';
import assert from 'node:assert';
import { execPath } from 'node:process';
import { spawnSyncAndAssert } from '../common/child_process.js';

// Loader registered as a data: URL so the test is fully self-contained.
const loaderSource = `
import assert from 'node:assert';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'node:target') {
    assert.ok(
      context.conditions.includes('require'),
      \`Conditions should include 'require' for require.resolve('node:target') inside async-hook-supplied CJS, got \${JSON.stringify(context.conditions)}\`,
    );
    assert.ok(
      !context.conditions.includes('import'),
      \`Conditions should not include 'import' for require.resolve('node:target') inside async-hook-supplied CJS, got \${JSON.stringify(context.conditions)}\`,
    );
    assert.strictEqual(
      context.requestType,
      'require',
      'requestType should be "require" for require.resolve in async-hook-supplied CJS',
    );
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'custom:cjs') {
    return {
      format: 'commonjs',
      source: 'console.log(require.resolve("node:target"))',
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
`;

const loaderDataURL = `data:text/javascript,${encodeURIComponent(loaderSource)}`;

const childSource = `
import { register } from 'node:module';
register(${JSON.stringify(loaderDataURL)});
await import('custom:cjs');
`;

spawnSyncAndAssert(
  execPath,
  [
    '--no-warnings',
    '--input-type=module',
    '--eval',
    childSource,
  ],
  {
    stderr: '',
    stdout(output) {
      // The synthetic CJS source contains console.log(require.resolve('node:target')),
      // which should print 'node:target' to stdout after the assertions pass.
      assert.match(output, /^node:target\s*$/m);
    },
  },
);
