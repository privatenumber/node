// Async loader fixture for tests verifying that `context.requestType` and
// `context.conditions` are set correctly in resolve and load hooks.
//
// Each call appends a JSON line to stdout describing the hook kind, the
// specifier or url, requestType, and the relevant subset of conditions.

import { writeSync } from 'node:fs';

function logHook(record) {
  writeSync(1, JSON.stringify(record) + '\n');
}

export async function resolve(specifier, context, nextResolve) {
  logHook({
    kind: 'resolve',
    specifier,
    requestType: context.requestType,
    hasRequireCondition: Array.isArray(context.conditions) && context.conditions.includes('require'),
    hasImportCondition: Array.isArray(context.conditions) && context.conditions.includes('import'),
  });
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  logHook({
    kind: 'load',
    url,
    requestType: context.requestType,
    format: context.format,
    hasRequireCondition: Array.isArray(context.conditions) && context.conditions.includes('require'),
    hasImportCondition: Array.isArray(context.conditions) && context.conditions.includes('import'),
  });
  return nextLoad(url, context);
}
