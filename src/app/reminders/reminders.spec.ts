import { describe, expect, it } from 'vitest';
import { QUESTS } from '../game/quests';
import { normalizeApiUrl } from './app-config.service';
import { defaultSettings, reminderText } from './reminders.service';

describe('normalizeApiUrl', () => {
  it('accepts https and strips trailing slashes', () => {
    expect(normalizeApiUrl(' https://push.example.com/ ')).toBe('https://push.example.com');
    expect(normalizeApiUrl('https://example.com/life/api//')).toBe('https://example.com/life/api');
  });

  it('allows plain http only for local development', () => {
    expect(normalizeApiUrl('http://localhost:5000')).toBe('http://localhost:5000');
    expect(normalizeApiUrl('http://127.0.0.1:5198')).toBe('http://127.0.0.1:5198');
    expect(normalizeApiUrl('http://push.example.com')).toBeNull();
  });

  it('treats empty input as "use config.json" and rejects garbage', () => {
    expect(normalizeApiUrl('   ')).toBe('');
    expect(normalizeApiUrl('not a url')).toBeNull();
  });
});

describe('reminders', () => {
  it('has a default time for every quest', () => {
    const settings = defaultSettings();
    expect(settings.map((s) => s.questId)).toEqual(QUESTS.map((q) => q.id));
    expect(settings.every((s) => /^\d{2}:\d{2}$/.test(s.time) && s.enabled)).toBe(true);
  });

  it('builds the notification text from the quest', () => {
    const text = reminderText(QUESTS[0]);
    expect(text.title).toBe('Квест «Ранок»');
    expect(text.body).toContain('Почистити зуби');
    expect(text.body.length).toBeLessThanOrEqual(200);
    expect(QUESTS.every((q) => reminderText(q).title.length <= 80)).toBe(true);
  });
});
