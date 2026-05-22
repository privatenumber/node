'use strict';

// Test that context.requestType survives a chain of module.registerHooks() hooks,
// even when an intermediate hook calls nextResolve / nextLoad without forwarding
// the context object explicitly. The chain runner in customization_hooks merges
// the live context object, so the requestType set by Node should still reach
// hooks earlier in the chain.

const common = require('../common');
const assert = require('node:assert');
const { registerHooks } = require('node:module');
const fixtures = require('../common/fixtures');

const upstreamResolveSeen = [];
const upstreamLoadSeen = [];

// "Upstream" hook (runs LAST in the chain when iterating top-down because
// registerHooks pushes hooks LIFO; the most recently registered runs first).
// We register this first so it ends up at the bottom of the chain.
const upstreamHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    upstreamResolveSeen.push({
      specifier,
      requestType: context.requestType,
      hasRequire: context.conditions.includes('require'),
      hasImport: context.conditions.includes('import'),
    });
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    upstreamLoadSeen.push({
      url,
      requestType: context.requestType,
      hasRequire: context.conditions.includes('require'),
      hasImport: context.conditions.includes('import'),
    });
    return nextLoad(url, context);
  },
});

// "Downstream" hook (runs FIRST). It deliberately omits the context argument
// when calling next(): it just passes the specifier/url. The chain runner
// should preserve the original context (including requestType) for the
// upstream hook to observe.
const downstreamHook = registerHooks({
  resolve(specifier, _context, nextResolve) {
    return nextResolve(specifier);
  },
  load(url, _context, nextLoad) {
    return nextLoad(url);
  },
});

require(fixtures.path('module-hooks', 'require-esm', 'inner.cjs'));

// The upstream load hook should observe requestType and CJS conditions even
// though the downstream hook called nextLoad(url) without forwarding context.
const cjsLoad = upstreamLoadSeen.find((r) =>
  r.url.endsWith('require-esm/inner.cjs'));
assert.ok(cjsLoad, 'upstream load hook should have seen inner.cjs');
assert.strictEqual(cjsLoad.requestType, 'require');
assert.strictEqual(cjsLoad.hasRequire, true);
assert.strictEqual(cjsLoad.hasImport, false);

// Same for the resolve chain.
const cjsResolve = upstreamResolveSeen.find((r) =>
  typeof r.specifier === 'string' && r.specifier.endsWith('inner.cjs'));
assert.ok(cjsResolve, 'upstream resolve hook should have seen inner.cjs');
assert.strictEqual(cjsResolve.requestType, 'require');
assert.strictEqual(cjsResolve.hasRequire, true);
assert.strictEqual(cjsResolve.hasImport, false);

(async () => {
  await import(fixtures.fileURL('module-hooks', 'empty.mjs').href);

  const importLoad = upstreamLoadSeen.find((r) =>
    r.url.endsWith('module-hooks/empty.mjs'));
  assert.ok(importLoad, 'upstream load hook should have seen empty.mjs');
  assert.strictEqual(importLoad.requestType, 'import');
  assert.strictEqual(importLoad.hasRequire, false);
  assert.strictEqual(importLoad.hasImport, true);

  downstreamHook.deregister();
  upstreamHook.deregister();
})().then(common.mustCall());
