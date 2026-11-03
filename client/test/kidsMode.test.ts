import { describe, it, expect, beforeEach } from 'vitest';

// Polyfill localStorage for node environment in test
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, String(v)),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
};

import { KidsPlayManager } from '../src/features/kidsMode';

describe('KidsPlayManager', () => {
  beforeEach(() => {
    storage.clear();
    const mgr = KidsPlayManager.getInstance();
    mgr.config = {
      enabled: false,
      timeLimitEnabled: true,
      timeLimitMinutes: 20,
      livesLimitEnabled: true,
      livesLimit: 5,
      pinHash: '',
    };
    mgr.resetSession();
  });

  it('initializes with default config and session', () => {
    const mgr = KidsPlayManager.getInstance();
    expect(mgr.config.enabled).toBe(false);
    expect(mgr.config.timeLimitMinutes).toBe(20);
    expect(mgr.state.timeRemainingSec).toBe(1200);
    expect(mgr.state.isLocked).toBe(false);
  });

  it('updates limits and hashes parent PIN', () => {
    const mgr = KidsPlayManager.getInstance();
    mgr.updateLimits(true, true, 15, true, 3, '1234');

    expect(mgr.config.enabled).toBe(true);
    expect(mgr.config.timeLimitMinutes).toBe(15);
    expect(mgr.state.timeRemainingSec).toBe(900);
    expect(mgr.config.livesLimit).toBe(3);
    expect(mgr.state.livesRemaining).toBe(3);
    expect(mgr.hasPin()).toBe(true);

    // Verify PIN
    expect(mgr.verifyPin('1234')).toBe(true);
    expect(mgr.verifyPin('9999')).toBe(false);
  });

  it('ticks down playtime and locks when time reaches 0', () => {
    const mgr = KidsPlayManager.getInstance();
    mgr.updateLimits(true, true, 1, false, 5); // 1 minute = 60s
    expect(mgr.state.timeRemainingSec).toBe(60);

    // Tick 30 seconds
    mgr.tick(30);
    expect(mgr.state.timeRemainingSec).toBe(30);
    expect(mgr.state.isLocked).toBe(false);

    // Tick another 35 seconds -> should lock
    mgr.tick(35);
    expect(mgr.state.timeRemainingSec).toBe(0);
    expect(mgr.state.isLocked).toBe(true);
    expect(mgr.state.lockReason).toBe('time');
  });

  it('consumes lives and locks when lives reach 0', () => {
    const mgr = KidsPlayManager.getInstance();
    mgr.updateLimits(true, false, 20, true, 2); // 2 lives
    expect(mgr.state.livesRemaining).toBe(2);

    // Lose life 1
    const locked1 = mgr.consumeLife();
    expect(locked1).toBe(false);
    expect(mgr.state.livesRemaining).toBe(1);
    expect(mgr.state.isLocked).toBe(false);

    // Lose life 2 -> locks
    const locked2 = mgr.consumeLife();
    expect(locked2).toBe(true);
    expect(mgr.state.livesRemaining).toBe(0);
    expect(mgr.state.isLocked).toBe(true);
    expect(mgr.state.lockReason).toBe('lives');
  });

  it('allows parent to extend time or lives with valid PIN', () => {
    const mgr = KidsPlayManager.getInstance();
    mgr.updateLimits(true, true, 10, true, 3, '4321');
    mgr.lock('time');
    expect(mgr.state.isLocked).toBe(true);

    // Wrong PIN fails
    const failRes = mgr.extendTime(15, '0000');
    expect(failRes).toBe(false);
    expect(mgr.state.isLocked).toBe(true);

    // Correct PIN unlocks and extends
    const okRes = mgr.extendTime(15, '4321');
    expect(okRes).toBe(true);
    expect(mgr.state.isLocked).toBe(false);
    expect(mgr.state.timeRemainingSec).toBe(10 * 60 + 15 * 60);

    // Extend lives
    mgr.extendLives(3, '4321');
    expect(mgr.state.livesRemaining).toBe(6);
  });

  it('automatically unlocks after 1 hour (3600s) if parent forgets to unlock', () => {
    const mgr = KidsPlayManager.getInstance();
    mgr.updateLimits(true, true, 10, true, 3, '4321');
    mgr.lock('time');
    expect(mgr.state.isLocked).toBe(true);
    expect(mgr.state.lockedAtTs).toBeDefined();

    // After 30 minutes (1800s) -> still locked
    mgr.state.lockedAtTs = Date.now() - 1800 * 1000;
    mgr.tick(1);
    expect(mgr.state.isLocked).toBe(true);
    expect(mgr.getAutoUnlockRemainingSec()).toBeLessThanOrEqual(1800);

    // After 60 minutes (3600s) -> automatically unlocked & new session initialized!
    mgr.state.lockedAtTs = Date.now() - 3601 * 1000;
    mgr.tick(1);
    expect(mgr.state.isLocked).toBe(false);
    expect(mgr.state.timeRemainingSec).toBe(10 * 60);
  });

  it('unlockAndReset resets full playtime and lives for a fresh session', () => {
    const mgr = KidsPlayManager.getInstance();
    mgr.updateLimits(true, true, 20, true, 5, '4321');
    mgr.lock('lives');
    expect(mgr.state.isLocked).toBe(true);

    mgr.unlockAndReset();
    expect(mgr.state.isLocked).toBe(false);
    expect(mgr.state.timeRemainingSec).toBe(20 * 60);
    expect(mgr.state.livesRemaining).toBe(5);
  });

  it('restores lives when extending time if lives were zero, and restores time when extending lives if time was zero', () => {
    const mgr = KidsPlayManager.getInstance();
    mgr.updateLimits(true, true, 20, true, 5);

    // Case 1: Locked on lives (0 lives remaining), parent extends 15 minutes
    mgr.state.livesRemaining = 0;
    mgr.lock('lives');
    mgr.extendTime(15);
    expect(mgr.state.isLocked).toBe(false);
    expect(mgr.state.livesRemaining).toBeGreaterThan(0);

    // Case 2: Locked on time (0 time remaining), parent extends 3 lives
    mgr.state.timeRemainingSec = 0;
    mgr.lock('time');
    mgr.extendLives(3);
    expect(mgr.state.isLocked).toBe(false);
    expect(mgr.state.timeRemainingSec).toBeGreaterThan(0);
  });
});
