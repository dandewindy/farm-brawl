import { describe, it, expect, beforeEach } from 'vitest';

// Polyfill localStorage for node environment in test
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, String(v)),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
};

import { COWBOY_ITEMS_CATALOG, CowboyInventoryManager } from '../src/minigame/cowboy/cowboyItems';
import { CowboyWallet } from '../src/minigame/cowboy/cowboyWallet';
import { isCowboyAdminName } from '../src/minigame/cowboy/cowboyTypes';

describe('CowboyShop & Items Inventory', () => {
  let wallet: CowboyWallet;
  let inv: CowboyInventoryManager;

  beforeEach(() => {
    storage.clear();
    wallet = new CowboyWallet(); // default 20 credits
    inv = new CowboyInventoryManager();
  });

  it('catalog contains 6 defined items with correct prices and metadata', () => {
    expect(COWBOY_ITEMS_CATALOG).toHaveLength(6);
    const kinds = COWBOY_ITEMS_CATALOG.map((i) => i.kind);
    expect(kinds).toContain('speed_boots');
    expect(kinds).toContain('lucky_shield');
    expect(kinds).toContain('rainbow_net');
    expect(kinds).toContain('strength_potion');
    expect(kinds).toContain('time_clock');
    expect(kinds).toContain('lucky_clover');

    for (const item of COWBOY_ITEMS_CATALOG) {
      expect(item.price).toBeGreaterThan(0);
      expect(item.nameVi.length).toBeGreaterThan(0);
      expect(item.effectLabel.length).toBeGreaterThan(0);
      expect(item.descVi.length).toBeGreaterThan(0);
      expect(item.maxPerRound).toBeGreaterThan(0);
    }
  });

  it('allows purchasing items when wallet has sufficient credits', () => {
    const boots = COWBOY_ITEMS_CATALOG.find((i) => i.kind === 'speed_boots')!;
    expect(inv.getCount('speed_boots')).toBe(0);

    const res = inv.buyItem('speed_boots', wallet);
    expect(res.success).toBe(true);
    expect(inv.getCount('speed_boots')).toBe(1);
    expect(wallet.getCredits()).toBe(20 - boots.price);
  });

  it('prevents purchasing items when wallet does not have enough credits', () => {
    wallet.deductBet(18); // leaves 2 credits
    expect(wallet.getCredits()).toBe(2);

    const res = inv.buyItem('speed_boots', wallet); // costs 6
    expect(res.success).toBe(false);
    expect(inv.getCount('speed_boots')).toBe(0);
    expect(wallet.getCredits()).toBe(2);
  });

  it('allows equipping and unequipping owned items', () => {
    inv.buyItem('lucky_shield', wallet);
    expect(inv.getCount('lucky_shield')).toBe(1);
    expect(inv.isEquipped('lucky_shield')).toBe(false);

    // Equip returns boolean
    const equipped = inv.equipForRound('lucky_shield');
    expect(equipped).toBe(true);
    expect(inv.isEquipped('lucky_shield')).toBe(true);

    // Unequip
    inv.unequipForRound('lucky_shield');
    expect(inv.isEquipped('lucky_shield')).toBe(false);
  });

  it('prevents equipping unowned items', () => {
    expect(inv.getCount('rainbow_net')).toBe(0);
    const equipped = inv.equipForRound('rainbow_net');
    expect(equipped).toBe(false);
    expect(inv.isEquipped('rainbow_net')).toBe(false);
  });

  describe('isCowboyAdminName', () => {
    it('recognizes Admin9112267 and Admin911226 regardless of case or whitespace', () => {
      expect(isCowboyAdminName('Admin9112267')).toBe(true);
      expect(isCowboyAdminName('admin9112267')).toBe(true);
      expect(isCowboyAdminName('  Admin9112267  ')).toBe(true);
      expect(isCowboyAdminName('Admin911226')).toBe(true);
      expect(isCowboyAdminName('admin911226')).toBe(true);
    });

    it('rejects non-admin player names', () => {
      expect(isCowboyAdminName('Player1')).toBe(false);
      expect(isCowboyAdminName('NongDanVuiVe')).toBe(false);
      expect(isCowboyAdminName('')).toBe(false);
    });

    it('falls back to localStorage fb_name when no name is passed', () => {
      storage.set('fb_name', 'Admin9112267');
      expect(isCowboyAdminName()).toBe(true);

      storage.set('fb_name', 'NormalFarmer');
      expect(isCowboyAdminName()).toBe(false);
    });
  });
});
