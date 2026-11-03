import { describe, expect, it } from 'vitest';
import { daysLabel } from './plural';

describe('daysLabel', () => {
  it('uses Ukrainian plural forms', () => {
    expect(daysLabel(0)).toBe('0 днів');
    expect(daysLabel(1)).toBe('1 день');
    expect(daysLabel(3)).toBe('3 дні');
    expect(daysLabel(5)).toBe('5 днів');
    expect(daysLabel(11)).toBe('11 днів');
    expect(daysLabel(12)).toBe('12 днів');
    expect(daysLabel(21)).toBe('21 день');
    expect(daysLabel(22)).toBe('22 дні');
  });
});
