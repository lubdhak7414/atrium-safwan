import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLocalDays, localDayWindow, parseLocalSessionWindow } from '../src/time';

test('local session input resolves in the centre timezone', () => {
  const result = parseLocalSessionWindow({
    localDate: '2030-02-01',
    localStartTime: '10:00',
    localEndTime: '11:00',
    sessionType: 'standard'
  }, new Date('2029-01-01T00:00:00Z'));

  assert.deepEqual(result, {
    startsAt: '2030-02-01T15:00:00.000Z',
    endsAt: '2030-02-01T16:00:00.000Z'
  });
});

test('local session input rejects DST gaps and ambiguous times', () => {
  const gap = parseLocalSessionWindow({
    localDate: '2026-03-08',
    localStartTime: '02:00',
    localEndTime: '03:00',
    sessionType: 'standard'
  }, new Date('2025-01-01T00:00:00Z'));
  const ambiguous = parseLocalSessionWindow({
    localDate: '2026-11-01',
    localStartTime: '01:00',
    localEndTime: '02:00',
    sessionType: 'standard'
  }, new Date('2025-01-01T00:00:00Z'));

  assert.equal(typeof gap, 'string');
  assert.equal(typeof ambiguous, 'string');
});

test('local session input enforces the centre calendar and opening hours', () => {
  const sunday = parseLocalSessionWindow({
    localDate: '2030-02-03',
    localStartTime: '10:00',
    localEndTime: '11:00',
    sessionType: 'standard'
  }, new Date('2029-01-01T00:00:00Z'));
  const outsideHours = parseLocalSessionWindow({
    localDate: '2030-02-04',
    localStartTime: '06:00',
    localEndTime: '07:00',
    sessionType: 'standard'
  }, new Date('2029-01-01T00:00:00Z'));

  assert.equal(typeof sunday, 'string');
  assert.equal(typeof outsideHours, 'string');
});

test('the 48-hour boundary is inclusive at exactly 48 hours', () => {
  const exact = parseLocalSessionWindow({
    localDate: '2030-02-01',
    localStartTime: '10:00',
    localEndTime: '11:00',
    sessionType: 'standard'
  }, new Date('2030-01-30T15:00:00.000Z'));
  const late = parseLocalSessionWindow({
    localDate: '2030-02-01',
    localStartTime: '10:00',
    localEndTime: '11:00',
    sessionType: 'standard'
  }, new Date('2030-01-30T15:00:01.000Z'));

  assert.equal(typeof exact, 'object');
  assert.equal(typeof late, 'string');
});

test('local calendar arithmetic preserves DST day lengths', () => {
  const autumn = localDayWindow('2026-11-01');
  const spring = localDayWindow('2026-03-08');

  assert.equal(autumn.hours, 25);
  assert.equal(spring.hours, 23);
  assert.equal(addLocalDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addLocalDays('2026-03-08', 1), '2026-03-09');
});
