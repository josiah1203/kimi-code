#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

function fail(message) {
  throw new Error(message);
}

function verifyArtifact(artifactPath, checksumPath) {
  const artifact = resolve(artifactPath);
  const checksum = resolve(checksumPath);
  const [expectedDigest, expectedName] = readFileSync(checksum, 'utf8').trim().split(/\s+/u);
  if (!/^[a-f0-9]{64}$/u.test(expectedDigest ?? '')) fail(`invalid SHA-256 checksum in ${checksum}`);
  if (expectedName?.replace(/^\*/u, '') !== basename(artifact)) {
    fail(`checksum filename does not match artifact: ${expectedName ?? '<missing>'}`);
  }

  const actualDigest = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  if (actualDigest !== expectedDigest) fail(`checksum mismatch for ${artifact}: expected ${expectedDigest}, got ${actualDigest}`);

  // eslint-disable-next-line no-console
  console.log(`Artifact checksum verified: ${artifact}`);
}

const [artifactPath, checksumPath] = process.argv.slice(2);
if (artifactPath === undefined || checksumPath === undefined) {
  fail('usage: node verify-artifact.mjs <artifact.zip> <artifact.zip.sha256>');
}
verifyArtifact(artifactPath, checksumPath);

export { verifyArtifact };
