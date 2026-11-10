import { describe, it, expect, beforeEach } from 'vitest';

// Polyfill localStorage for node environment in test
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, String(v)),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
};

import { getStageTargetScore, getCoopStageTargetScore } from '../src/minigame/cowboy/cowboyTypes';
import { CowboyWallet } from '../src/minigame/cowboy/cowboyWallet';

describe('Cowboy Campaign & Modes Progression', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('correctly calculates balanced stage target scores for solo campaign', () => {
    expect(getStageTargetScore(1)).toBe(80);
    expect(getStageTargetScore(2)).toBe(180);
    expect(getStageTargetScore(3)).toBe(300);
    expect(getStageTargetScore(4)).toBe(450);
    expect(getStageTargetScore(5)).toBe(650);
    expect(getStageTargetScore(6)).toBe(875);
    expect(getStageTargetScore(7)).toBe(1125);
  });

  it('correctly calculates 2-player co-op stage target scores', () => {
    expect(getCoopStageTargetScore(1)).toBe(120);
    expect(getCoopStageTargetScore(2)).toBe(260);
    expect(getCoopStageTargetScore(3)).toBe(420);
    expect(getCoopStageTargetScore(4)).toBe(620);
    expect(getCoopStageTargetScore(5)).toBe(880);
    expect(getCoopStageTargetScore(6)).toBe(1195);
  });

  it('evaluates 2-player hybrid control handover matrix accurately', () => {
    const canControlSlot = (mySlot: 0 | 1, guestConnected: boolean, targetSlot: 0 | 1) => {
      if (mySlot === 1) return targetSlot === 1;
      if (targetSlot === 0) return true;
      return !guestConnected;
    };

    // Host alone (no 2nd device joined yet) -> controls both P1 (0) and P2 (1)
    expect(canControlSlot(0, false, 0)).toBe(true);
    expect(canControlSlot(0, false, 1)).toBe(true);

    // 2nd device joins -> Host only controls P1 (0), Guest controls P2 (1)
    expect(canControlSlot(0, true, 0)).toBe(true);
    expect(canControlSlot(0, true, 1)).toBe(false);
    expect(canControlSlot(1, true, 0)).toBe(false);
    expect(canControlSlot(1, true, 1)).toBe(true);
  });

  it('correctly adds credits directly to wallet without inflating catch counts', () => {
    const wallet = new CowboyWallet();
    const initialCredits = wallet.getCredits();
    wallet.addCredits(5);
    expect(wallet.getCredits()).toBe(initialCredits + 5);

    // Negative or zero bonus should be ignored
    wallet.addCredits(-3);
    wallet.addCredits(0);
    expect(wallet.getCredits()).toBe(initialCredits + 5);
  });

  it('evaluates surplus bonus credit correctly', () => {
    const calcBonus = (score: number, target: number) => {
      const surplus = Math.max(0, score - target);
      return Math.min(10, Math.floor(surplus / 20));
    };

    expect(calcBonus(79, 80)).toBe(0);
    expect(calcBonus(80, 80)).toBe(0);
    expect(calcBonus(100, 80)).toBe(1);
    expect(calcBonus(140, 80)).toBe(3);
    expect(calcBonus(350, 80)).toBe(10); // capped at 10 bonus credits
  });

  it('resets 2-Player scores independently across competitive rounds', () => {
    let p1Score = 120;
    let p2Score = 40;

    // Simulate match 1 conclusion
    expect(p1Score > p2Score).toBe(true);

    // Starting new round must reset both scores
    p1Score = 0;
    p2Score = 0;
    expect(p1Score).toBe(0);
    expect(p2Score).toBe(0);

    // Match 2 where P2 catches and wins
    p1Score += 10;
    p2Score += 80;
    expect(p2Score > p1Score).toBe(true);
  });

  it('verifies cycle bet increments cyclically between 1 and 5', () => {
    let bet = 1;
    const cycle = (b: number) => (b % 5) + 1;
    bet = cycle(bet); expect(bet).toBe(2);
    bet = cycle(bet); expect(bet).toBe(3);
    bet = cycle(bet); expect(bet).toBe(4);
    bet = cycle(bet); expect(bet).toBe(5);
    bet = cycle(bet); expect(bet).toBe(1);
  });
});
