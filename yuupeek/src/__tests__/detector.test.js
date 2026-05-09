const { matchesStream, matchesBaron } = require('../detector');

test('detects YouTube in window titles', () => {
  expect(matchesStream(['YouTube - Google Chrome', 'Notepad'])).toBe(true);
});

test('returns false when no titles match', () => {
  expect(matchesStream(['Notepad', 'File Explorer'])).toBe(false);
});

test('detects LCK keyword', () => {
  expect(matchesStream(['LCK Spring 2026 - Twitch'])).toBe(true);
});

test('is case-insensitive', () => {
  expect(matchesStream(['twitch.tv - firefox'])).toBe(true);
});

test('baron event triggers on Baron keyword', () => {
  expect(matchesBaron(['LOL Esports - Baron Nashor spawned'])).toBe(true);
});

test('baron does not trigger on normal titles', () => {
  expect(matchesBaron(['YouTube', 'Twitch'])).toBe(false);
});
