import { describe, expect, it } from 'vitest';
import { hoursSummary, staffHoursText } from '../hoursSummary.js';

const week = (over = {}) => Array.from({ length: 7 }, (_, d) => ({ weekday: d, closed: false, opens: '08:00', closes: '18:00', ...(over[d] || {}) }));

describe('hoursSummary', () => {
  it('groups runs of equal days into a compact week', () => {
    const days = week({ 5: { opens: '09:00', closes: '14:00' }, 6: { closed: true, opens: null, closes: null } });
    expect(hoursSummary(days)).toBe('Mon-Fri 08:00-18:00, Sat 09:00-14:00, Sun closed');
  });
  it('a single uniform week reads Mon-Sun', () => {
    expect(hoursSummary(week())).toBe('Mon-Sun 08:00-18:00');
  });
  it('is empty when no hours are entered', () => {
    expect(hoursSummary([])).toBe('');
    expect(hoursSummary(undefined)).toBe('');
  });
});

describe('staffHoursText', () => {
  it('shows the structured hours', () => {
    expect(staffHoursText({ hours: week(), opening_hours: 'old' })).toBe('Mon-Sun 08:00-18:00');
  });
  it('says Hours not set when there are none', () => {
    expect(staffHoursText({ hours: [], opening_hours: '' })).toBe('Hours not set');
    expect(staffHoursText({})).toBe('Hours not set');
  });
  it('keeps old text, labelled, only when no structured hours', () => {
    expect(staffHoursText({ hours: [], opening_hours: 'Mon–Sat 8-6' })).toBe('Hours not set (old text: Mon–Sat 8-6)');
  });
});
