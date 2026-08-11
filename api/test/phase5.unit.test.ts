import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messageId, parseBoolean } from '../src/mailer';
import { schedulerEnabled } from '../src/scheduler';

test('Message-ID is stable for an event and recipient pair', () => {
  const first = messageId('booking-created:42', 'coach@example.test');
  const second = messageId('booking-created:42', 'coach@example.test');
  const different = messageId('booking-created:43', 'coach@example.test');

  assert.equal(first, second);
  assert.notEqual(first, different);
  assert.match(first, /^<atrium-[a-f0-9]{64}@atrium\.local>$/);
});

test('boolean environment switches reject ambiguous values', () => {
  assert.equal(parseBoolean('true', false), true);
  assert.equal(parseBoolean('false', true), false);
  assert.equal(parseBoolean(undefined, true), true);
  assert.throws(() => parseBoolean('0', true));
  assert.equal(schedulerEnabled('false'), false);
  assert.equal(schedulerEnabled('true'), true);
  assert.throws(() => schedulerEnabled('no'));
});
