import assert from 'node:assert/strict';
import { it } from 'node:test';
import { scanText } from './check-secrets.mjs';

it('detects credential-shaped values without exposing them in the finding', () => {
  const value = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');

  assert.deepEqual(scanText(`API_KEY=${value}`, 'fixture.env'), ['fixture.env:1: possible OpenAI API key']);
});

it('does not flag documented placeholder credentials', () => {
  assert.deepEqual(scanText('API_KEY=YOUR_API_KEY', 'example.env'), []);
});
