import { describe, it, expect, beforeEach } from 'vitest';

// Polyfill localStorage for node environment in test
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, String(v)),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
};

import { CowboyWallet } from '../src/minigame/cowboy/cowboyWallet';

describe('CowboyWallet', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('grants 20 daily credits on first run and persists immediately', () => {
    const wallet = new CowboyWallet();
    expect(wallet.getCredits()).toBe(20);
    expect(wallet.getTotalScore()).toBe(0);
    expect(wallet.getTotalCatches()).toBe(0);

    // Verify localStorage has written the initial grant
    expect(storage.has('farm_brawl_cowboy_wallet_v1')).toBe(true);
  });

  it('does not re-grant daily credits on the same calendar day', () => {
    const wallet1 = new CowboyWallet();
    const grant1 = wallet1.checkDailyGrant();
    expect(grant1.granted).toBe(false); // already granted during construction
    expect(wallet1.getCredits()).toBe(20);

    // Create another wallet instance representing reload on same day
    const wallet2 = new CowboyWallet();
    expect(wallet2.getCredits()).toBe(20);
  });

  it('deducts bets correctly and enforces sufficient balance', () => {
    const wallet = new CowboyWallet();
    expect(wallet.deductBet(5)).toBe(true);
    expect(wallet.getCredits()).toBe(15);

    expect(wallet.deductBet(10)).toBe(true);
    expect(wallet.getCredits()).toBe(5);

    // Cannot bet 6 when only 5 credits remain
    expect(wallet.deductBet(6)).toBe(false);
    expect(wallet.getCredits()).toBe(5);

    // Rejects invalid bets (NaN, negative, zero)
    expect(wallet.deductBet(NaN)).toBe(false);
    expect(wallet.deductBet(-5)).toBe(false);
    expect(wallet.deductBet(0)).toBe(false);
    expect(wallet.getCredits()).toBe(5);

    // Can bet exact 5
    expect(wallet.deductBet(5)).toBe(true);
    expect(wallet.getCredits()).toBe(0);

    // Cannot bet when 0
    expect(wallet.deductBet(1)).toBe(false);
    expect(wallet.getCredits()).toBe(0);
  });

  it('refunds bet cleanly without corrupting stats', () => {
    const wallet = new CowboyWallet();
    wallet.deductBet(5);
    expect(wallet.getCredits()).toBe(15);

    wallet.refundBet(5);
    expect(wallet.getCredits()).toBe(20);
    expect(wallet.getTotalScore()).toBe(0); // Score remains unpolluted
  });

  it('adds winnings, updates score and catch count safely', () => {
    const wallet = new CowboyWallet();
    wallet.deductBet(3); // 20 - 3 = 17
    expect(wallet.getCredits()).toBe(17);

    wallet.addWinnings(25, 1);
    expect(wallet.getCredits()).toBe(42);
    expect(wallet.getTotalScore()).toBe(25);
    expect(wallet.getTotalCatches()).toBe(1);

    // Rejects invalid winnings
    wallet.addWinnings(NaN);
    wallet.addWinnings(-10);
    expect(wallet.getCredits()).toBe(42);

    wallet.addWinnings(50, 2);
    expect(wallet.getCredits()).toBe(92);
    expect(wallet.getTotalScore()).toBe(75);
    expect(wallet.getTotalCatches()).toBe(3);
  });

  it('provides non-mutating getReliefStatus query and enforces relief limits', () => {
    const wallet = new CowboyWallet();

    // Query status when player still has credits
    const status1 = wallet.getReliefStatus();
    expect(status1.canClaim).toBe(false);
    expect(status1.remainingToday).toBe(2);
    expect(wallet.getCredits()).toBe(20); // NOT mutated!

    // Drain balance to 0
    wallet.deductBet(20);
    expect(wallet.getCredits()).toBe(0);

    // Query status when player is at 0 credits
    const status2 = wallet.getReliefStatus();
    expect(status2.canClaim).toBe(true);
    expect(status2.remainingToday).toBe(2);
    expect(wallet.getCredits()).toBe(0); // Still 0!

    // 1st Relief Claim
    const relief1 = wallet.claimRelief();
    expect(relief1.success).toBe(true);
    expect(relief1.amount).toBe(5);
    expect(relief1.remainingToday).toBe(1);
    expect(wallet.getCredits()).toBe(5);

    // Drain again
    wallet.deductBet(5);
    expect(wallet.getCredits()).toBe(0);

    // 2nd Relief Claim
    const relief2 = wallet.claimRelief();
    expect(relief2.success).toBe(true);
    expect(relief2.amount).toBe(5);
    expect(relief2.remainingToday).toBe(0);
    expect(wallet.getCredits()).toBe(5);

    // Drain again
    wallet.deductBet(5);
    expect(wallet.getCredits()).toBe(0);

    // 3rd Relief Claim should fail (daily quota exhausted)
    const relief3 = wallet.claimRelief();
    expect(relief3.success).toBe(false);
    expect(relief3.remainingToday).toBe(0);
    expect(wallet.getCredits()).toBe(0);
  });

  it('persists data across instances using localStorage', () => {
    const wallet1 = new CowboyWallet();
    wallet1.deductBet(4);
    wallet1.addWinnings(12, 1);

    const wallet2 = new CowboyWallet();
    expect(wallet2.getCredits()).toBe(28); // 20 - 4 + 12
    expect(wallet2.getTotalScore()).toBe(12);
    expect(wallet2.getTotalCatches()).toBe(1);
  });
  it('accumulates 1 credit per minute when below 20 credits (online & offline)', () => {
    const t0 = Date.now();
    const wallet1 = new CowboyWallet();
    wallet1.deductBet(20, t0); // Drained to 0
    expect(wallet1.getCredits(t0)).toBe(0);

    // Fast-forward 30 seconds: not enough for 1 minute
    const acc1 = wallet1.updateAccumulatedCredits(t0 + 30000);
    expect(acc1.added).toBe(0);

    // Fast-forward to 1 minute: exactly +1 credit
    const acc2 = wallet1.updateAccumulatedCredits(t0 + 60000);
    expect(acc2.added).toBe(1);
    expect(wallet1.getCredits(t0 + 60000)).toBe(1);

    // Fast-forward offline time: 5 minutes later (offline jump to minute 6)
    const acc3 = wallet1.updateAccumulatedCredits(t0 + 360000);
    expect(acc3.added).toBe(5);
    expect(wallet1.getCredits(t0 + 360000)).toBe(6);

    // Fast-forward 2 hours offline: capped at 20 credits max
    const acc4 = wallet1.updateAccumulatedCredits(t0 + 7200000);
    expect(acc4.added).toBe(14); // 6 + 14 = 20 max
    expect(wallet1.getCredits(t0 + 7200000)).toBe(20);

    // Does not accumulate when already at 20 or higher
    const acc5 = wallet1.updateAccumulatedCredits(t0 + 8000000);
    expect(acc5.added).toBe(0);
    expect(wallet1.getCredits(t0 + 8000000)).toBe(20);
  });
});
import { CowboyKidsManager } from '../src/minigame/cowboy/cowboyKids';
import { CowboyInventoryManager, COWBOY_ITEMS_CATALOG } from '../src/minigame/cowboy/cowboyItems';

describe('CowboyKidsManager', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('initializes with safe defaults and validates parental PIN', () => {
    const kids = new CowboyKidsManager();
    expect(kids.isEnabled()).toBe(false);
    expect(kids.verifyPin('1234')).toBe(true);
    expect(kids.verifyPin('9999')).toBe(false);
  });

  it('updates settings with valid PIN and rejects wrong PIN', () => {
    const kids = new CowboyKidsManager();
    const wrongRes = kids.updateSettings('0000', { enabled: true });
    expect(wrongRes.success).toBe(false);
    expect(kids.isEnabled()).toBe(false);

    const goodRes = kids.updateSettings('1234', {
      enabled: true,
      timeLimitMinutes: 15,
      maxDailyCredits: 15,
      parentPin: '4321',
    });
    expect(goodRes.success).toBe(true);
    expect(kids.isEnabled()).toBe(true);
    expect(kids.verifyPin('4321')).toBe(true);
  });

  it('caps maxDailyCredits at 20 (normal user ceiling)', () => {
    const kids = new CowboyKidsManager();
    kids.updateSettings('1234', { maxDailyCredits: 50 }); // attempt to exceed 20
    expect(kids.getConfig().maxDailyCredits).toBe(20);
  });

  it('enforces daily credit quota and session expiration', () => {
    const kids = new CowboyKidsManager();
    kids.updateSettings('1234', { enabled: true, timeLimitMinutes: 15, maxDailyCredits: 10 });
    kids.startSession();

    expect(kids.recordCreditUsed(5)).toBe(true);
    expect(kids.recordCreditUsed(5)).toBe(true);
    // 10 reached, next attempt rejected
    expect(kids.recordCreditUsed(1)).toBe(false);
  });
});

describe('CowboyInventoryManager', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('buys, equips, and consumes items properly', () => {
    const wallet = new CowboyWallet();
    const inv = new CowboyInventoryManager();

    expect(inv.getCount('speed_boots')).toBe(0);
    expect(inv.isEquipped('speed_boots')).toBe(false);

    // Buy speed boots (cost 6)
    const res = inv.buyItem('speed_boots', wallet);
    expect(res.success).toBe(true);
    expect(wallet.getCredits()).toBe(14); // 20 - 6
    expect(inv.getCount('speed_boots')).toBe(1);

    // Equip
    expect(inv.equipForRound('speed_boots')).toBe(true);
    expect(inv.isEquipped('speed_boots')).toBe(true);

    // Consume
    inv.consume('speed_boots');
    expect(inv.getCount('speed_boots')).toBe(0);
    expect(inv.isEquipped('speed_boots')).toBe(false);
  });
});
