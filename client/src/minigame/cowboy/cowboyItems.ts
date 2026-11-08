import type { CowboyItemDef, CowboyItemKind } from './cowboyTypes';
import type { CowboyWallet } from './cowboyWallet';

export const COWBOY_ITEMS_CATALOG: CowboyItemDef[] = [
  {
    kind: 'speed_boots',
    nameVi: 'Giày Thần Tốc',
    icon: '🥾',
    price: 6,
    descVi: 'Tăng tốc độ phóng dây và kéo con thú về nhanh hơn +60%, giúp bạn chớp thời cơ trong chớp mắt.',
    effectLabel: 'Tốc độ +60%',
    maxPerRound: 3,
  },
  {
    kind: 'lucky_shield',
    nameVi: 'Khiên Bảo Vệ',
    icon: '🛡️',
    price: 8,
    descVi: 'Bảo vệ không bị trắng tay: Tự động uốn dây bắt dính 1 con thú gần nhất nếu quăng trượt.',
    effectLabel: 'Chống Hụt 1 Lần',
    maxPerRound: 2,
  },
  {
    kind: 'rainbow_net',
    nameVi: 'Lưới Cầu Vồng',
    icon: '🌈',
    price: 15,
    descVi: 'Vật phẩm tối thượng: Lần quăng tiếp theo bung một tấm lưới thần thoại khổng lồ quét sạch tất cả thú trong màn hình!',
    effectLabel: 'Quét Sạch Cả Màn Hình',
    maxPerRound: 1,
  },
  {
    kind: 'strength_potion',
    nameVi: 'Thuốc Tăng Lực XXX',
    icon: '🧪',
    price: 10,
    descVi: 'Truyền sức mạnh vô song: Khi thắt trúng con thú sẽ lập tức giật phăng về ngay, bỏ qua 2 giây giằng co.',
    effectLabel: 'Bỏ Qua 2s Giằng Co',
    maxPerRound: 3,
  },
  {
    kind: 'time_clock',
    nameVi: 'Đồng Hồ Gia Hạn',
    icon: '⏱️',
    price: 5,
    descVi: 'Cộng thêm +60 giây cho vòng chơi kế tiếp (thời gian chơi tăng từ 3 phút lên 4 phút).',
    effectLabel: 'Cộng +60 Giây',
    maxPerRound: 1,
  },
  {
    kind: 'lucky_clover',
    nameVi: 'Cỏ 4 Lá May Mắn',
    icon: '🍀',
    price: 7,
    descVi: 'Tăng +35% cơ hội xuất hiện Thú Lấp Lánh nhân đôi điểm (X2) và Thú Cầu Vồng thần thoại.',
    effectLabel: 'Tỉ Lệ Hiếm +35%',
    maxPerRound: 2,
  },
];

const INVENTORY_STORAGE_KEY = 'farm_brawl_cowboy_inventory_v1';

export class CowboyInventoryManager {
  private owned: Record<CowboyItemKind, number> = {
    speed_boots: 0,
    lucky_shield: 0,
    rainbow_net: 0,
    strength_potion: 0,
    time_clock: 0,
    lucky_clover: 0,
  };

  private activeRoundItems: Set<CowboyItemKind> = new Set();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(INVENTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const item of COWBOY_ITEMS_CATALOG) {
          if (typeof parsed[item.kind] === 'number' && Number.isFinite(parsed[item.kind])) {
            this.owned[item.kind] = Math.max(0, Math.floor(parsed[item.kind]));
          }
        }
      }
    } catch (_) {}
  }

  private save(): void {
    try {
      localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(this.owned));
    } catch (_) {}
  }

  public getCount(kind: CowboyItemKind): number {
    return this.owned[kind] || 0;
  }

  public buyItem(kind: CowboyItemKind, wallet: CowboyWallet): { success: boolean; msg: string } {
    const item = COWBOY_ITEMS_CATALOG.find((i) => i.kind === kind);
    if (!item) return { success: false, msg: 'Vật phẩm không tồn tại.' };

    if (wallet.getCredits() < item.price) {
      return { success: false, msg: `Không đủ Credit! Cần ${item.price} Credit để mua.` };
    }

    if (wallet.deductBet(item.price)) {
      this.owned[kind] = (this.owned[kind] || 0) + 1;
      this.save();
      return { success: true, msg: `Đã mua thành công ${item.nameVi} (-${item.price} Credit)!` };
    }

    return { success: false, msg: 'Giao dịch thất bại.' };
  }

  /** Trang bị vật phẩm cho vòng đấu tiếp theo */
  public equipForRound(kind: CowboyItemKind): boolean {
    if ((this.owned[kind] || 0) <= 0) return false;
    this.activeRoundItems.add(kind);
    return true;
  }

  /** Bỏ trang bị */
  public unequipForRound(kind: CowboyItemKind): void {
    this.activeRoundItems.delete(kind);
  }

  public isEquipped(kind: CowboyItemKind): boolean {
    return this.activeRoundItems.has(kind);
  }

  public getEquippedList(): CowboyItemKind[] {
    return Array.from(this.activeRoundItems);
  }

  /** Tiêu hao 1 lần sử dụng khi kích hoạt trong trận */
  public consume(kind: CowboyItemKind): boolean {
    if ((this.owned[kind] || 0) > 0) {
      this.owned[kind]--;
      if (this.owned[kind] === 0) {
        this.activeRoundItems.delete(kind);
      }
      this.save();
      return true;
    }
    this.activeRoundItems.delete(kind);
    return false;
  }

  /** Kết thúc vòng đấu: reset các hiệu ứng 1 vòng */
  public resetRound(): void {
    this.activeRoundItems.clear();
  }
}

export const cowboyInventory = new CowboyInventoryManager();
