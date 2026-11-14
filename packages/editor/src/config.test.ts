import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HUB_URL, MIN_POLL_SECONDS, normalizeHubUrl, pollSeconds, webUrlFor } from './config';

test('the hub address is an origin, https away from this machine, and never carries credentials', () => {
  assert.equal(normalizeHubUrl(''), DEFAULT_HUB_URL);
  assert.equal(normalizeHubUrl('https://blue.patchkin.io/'), 'https://blue.patchkin.io');
  assert.throws(() => normalizeHubUrl('https://blue.patchkin.io/some/path'), /without a path/, 'the hub is an origin, not a page');
  assert.equal(normalizeHubUrl('http://localhost:4000'), 'http://localhost:4000');
  assert.equal(normalizeHubUrl('http://127.0.0.1:4000'), 'http://127.0.0.1:4000');
  assert.throws(() => normalizeHubUrl('http://patchkin.example'), /https/);
  assert.throws(() => normalizeHubUrl('ftp://patchkin.example'), /https/);
  assert.throws(() => normalizeHubUrl('https://user:secret@patchkin.example'), /username or password/);
  assert.throws(() => normalizeHubUrl('not a url'), /hub address/);
});

test('polling is never faster than the minimum', () => {
  assert.equal(pollSeconds(undefined), MIN_POLL_SECONDS);
  assert.equal(pollSeconds(5), MIN_POLL_SECONDS);
  assert.equal(pollSeconds('60'), 60);
  assert.equal(pollSeconds(99999), 3600);
});

test('Open in Patchkin lands on the Products screen', () => {
  assert.equal(webUrlFor('https://blue.patchkin.io'), 'https://blue.patchkin.io/?tab=projects');
});
