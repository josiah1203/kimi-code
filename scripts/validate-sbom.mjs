#!/usr/bin/env node
/** Validate completeness and graph integrity of the generated CycloneDX SBOM. */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SBOM_PATH = join(ROOT, 'sbom.cdx.json');
const LICENSE_OVERRIDES_PATH = join(ROOT, 'config/dependency-license-overrides.json');

function validateLicenseRegistry(registry, today = new Date()) {
  const findings = [];
  if (registry.schema_version !== 1) findings.push('license override registry schema_version must be 1');
  if (typeof registry.owner !== 'string' || registry.owner.length === 0) findings.push('license override registry must have an owner');
  if (typeof registry.review_by !== 'string' || Number.isNaN(Date.parse(registry.review_by))) findings.push('license override registry must have a valid review_by date');
  else if (new Date(`${registry.review_by}T23:59:59Z`) < today) findings.push(`license override registry review expired on ${registry.review_by}`);
  for (const [index, override] of (registry.overrides ?? []).entries()) {
    const label = `license override ${String(index + 1)}`;
    for (const field of ['pattern', 'license', 'evidence', 'rationale']) {
      if (typeof override[field] !== 'string' || override[field].trim().length === 0) findings.push(`${label}: missing ${field}`);
    }
    if ((override.pattern?.match(/\*/g) ?? []).length > 1) findings.push(`${label}: pattern may contain at most one wildcard`);
  }
  return findings;
}

function validateSbom(bom) {
  const findings = [];
  if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.6') findings.push('SBOM must be CycloneDX 1.6');
  if (typeof bom.serialNumber !== 'string' || !bom.serialNumber.startsWith('urn:uuid:')) findings.push('serialNumber must be a deterministic UUID URN');
  if (bom.metadata?.timestamp !== undefined) findings.push('metadata.timestamp must be omitted for deterministic output');
  const refs = new Set();
  for (const component of bom.components ?? []) {
    const label = component['bom-ref'] ?? component.name ?? '(unknown)';
    if (typeof component['bom-ref'] !== 'string' || component['bom-ref'].length === 0) findings.push(`${label}: missing bom-ref`);
    else if (refs.has(component['bom-ref'])) findings.push(`${label}: duplicate bom-ref`);
    else refs.add(component['bom-ref']);
    if (typeof component.version !== 'string' || component.version.length === 0 || /^(workspace:|link:|\^|~)/.test(component.version)) findings.push(`${label}: unresolved version`);
    if (typeof component.purl !== 'string' || !component.purl.startsWith('pkg:npm/')) findings.push(`${label}: missing npm purl`);
    const licenses = component.licenses ?? [];
    if (licenses.length === 0 || licenses.some((entry) => entry.expression === 'UNKNOWN' || entry.license?.id === 'UNKNOWN')) findings.push(`${label}: unknown license`);
  }
  const relationshipRefs = new Set();
  for (const relationship of bom.dependencies ?? []) {
    relationshipRefs.add(relationship.ref);
    if (!refs.has(relationship.ref)) findings.push(`${relationship.ref}: relationship source is missing`);
    for (const dependency of relationship.dependsOn ?? []) {
      if (!refs.has(dependency)) findings.push(`${relationship.ref}: dependency target is missing: ${dependency}`);
    }
  }
  for (const ref of refs) if (!relationshipRefs.has(ref)) findings.push(`${ref}: dependency relationship is missing`);
  return findings;
}

function main() {
  const bom = JSON.parse(readFileSync(SBOM_PATH, 'utf8'));
  const registry = JSON.parse(readFileSync(LICENSE_OVERRIDES_PATH, 'utf8'));
  const findings = [...validateLicenseRegistry(registry), ...validateSbom(bom)];
  if (findings.length === 0) console.log(`CycloneDX SBOM validation passed for ${String(bom.components.length)} components.`);
  else {
    console.error(`CycloneDX SBOM validation found ${String(findings.length)} issue(s):`);
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { validateLicenseRegistry, validateSbom };
