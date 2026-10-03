import { describe, expect, it } from 'vitest';
import { buildRule, describeRule, parseRule, replaceRule, untilBefore } from '../shared/rrule.ts';
import { seal, unseal } from '../server/session.ts';

describe('rrule helpers', () => {
  it('parses and rebuilds weekly rules', () => {
    const r = parseRule(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2'])!;
    expect(r).toEqual({ freq: 'WEEKLY', interval: 2, byDay: [1, 3, 5], until: null, count: null });
    expect(buildRule(r)).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR');
    expect(describeRule(r)).toBe('Every 2 weeks on Mon, Wed, Fri');
  });

  it('keeps EXDATE lines when replacing the rule', () => {
    const rec = ['EXDATE;TZID=America/Los_Angeles:20261012T063000', 'RRULE:FREQ=DAILY;COUNT=5'];
    const out = replaceRule(rec, { freq: 'DAILY', interval: 1, byDay: [], until: '20261101T000000Z', count: null });
    expect(out).toEqual(['EXDATE;TZID=America/Los_Angeles:20261012T063000', 'RRULE:FREQ=DAILY;UNTIL=20261101T000000Z']);
  });

  it('cuts a series just before an occurrence', () => {
    expect(untilBefore('2026-10-19T13:30:00Z', false)).toBe('20261019T132959Z');
    expect(untilBefore('2026-10-19T06:30:00-07:00', false)).toBe('20261019T132959Z');
    expect(untilBefore('2026-11-01', true)).toBe('20261031');
  });

  it('ignores unsupported rules', () => {
    expect(parseRule(['RRULE:FREQ=HOURLY'])).toBeNull();
    expect(parseRule(undefined)).toBeNull();
  });
});

describe('session cookie', () => {
  const secret = 'a-very-long-test-secret-value';
  it('round-trips', () => {
    const token = seal({ refreshToken: 'rt', email: 'a@b.c' }, secret);
    expect(unseal<{ refreshToken: string }>(token, secret)?.refreshToken).toBe('rt');
    expect(token).not.toContain('rt');
  });
  it('rejects tampering and wrong secrets', () => {
    const token = seal({ refreshToken: 'rt' }, secret);
    const parts = token.split('.');
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('AA') ? 'BB' : 'AA');
    expect(unseal(parts.join('.'), secret)).toBeNull();
    expect(unseal(token, 'another-long-secret-value!!')).toBeNull();
    expect(unseal('garbage', secret)).toBeNull();
  });
  it('requires a strong secret', () => {
    expect(() => seal({}, 'short')).toThrow(/SESSION_SECRET/);
  });
});
