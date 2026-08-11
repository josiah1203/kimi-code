#!/usr/bin/env node
/** Enforce the reviewed dependency-license policy against the resolved SBOM. */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

function exceptionMatches(exception, component, expression) {
  const refMatches = exception.bom_ref === component['bom-ref']
    || (typeof exception.bom_ref_prefix === 'string' && component['bom-ref'].startsWith(exception.bom_ref_prefix));
  return refMatches && exception.license === expression;
}

function validateLicensePolicy(bom, policy, today = new Date()) {
  const findings = [];
  if (policy.schema_version !== 1) findings.push('license policy schema_version must be 1');
  if (typeof policy.owner !== 'string' || policy.owner.length === 0) findings.push('license policy must have an owner');
  if (typeof policy.review_by !== 'string' || Number.isNaN(Date.parse(policy.review_by))) findings.push('license policy must have a valid review_by date');
  else if (new Date(`${policy.review_by}T23:59:59Z`) < today) findings.push(`license policy review expired on ${policy.review_by}`);
  const allowed = new Set(policy.allowed_expressions ?? []);
  for (const component of bom.components ?? []) {
    for (const license of component.licenses ?? []) {
      const expression = license.expression;
      if (allowed.has(expression)) continue;
      const exception = (policy.reviewed_exceptions ?? []).find((item) => exceptionMatches(item, component, expression));
      if (exception === undefined) {
        findings.push(`${component['bom-ref']}: license is not allowed: ${String(expression)}`);
        continue;
      }
      for (const field of ['disposition', 'owner', 'review_by']) {
        if (typeof exception[field] !== 'string' || exception[field].length === 0) findings.push(`${component['bom-ref']}: license exception is missing ${field}`);
      }
      if (typeof exception.review_by === 'string' && new Date(`${exception.review_by}T23:59:59Z`) < today) findings.push(`${component['bom-ref']}: license exception expired on ${exception.review_by}`);
    }
  }
  return findings;
}

function main() {
  const bom = JSON.parse(readFileSync(join(ROOT, 'sbom.cdx.json'), 'utf8'));
  const policy = JSON.parse(readFileSync(join(ROOT, 'config/dependency-license-policy.json'), 'utf8'));
  const findings = validateLicensePolicy(bom, policy);
  if (findings.length > 0) {
    console.error(`Dependency license policy found ${String(findings.length)} issue(s):`);
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
  } else console.log(`Dependency license policy passed for ${String(bom.components.length)} components.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { validateLicensePolicy };
