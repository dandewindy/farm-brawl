import { t } from '../../i18n';
import { COWBOY_ITEMS_CATALOG, cowboyInventory } from './cowboyItems';
import type { CowboyItemDef } from './cowboyTypes';
import type { CowboyWallet } from './cowboyWallet';

export class CowboyShop {
  private rootEl: HTMLElement;
  private creditBalanceEl!: HTMLElement;
  private cardsContainer!: HTMLElement;
  private modalEl!: HTMLElement;
  private selectedItem: CowboyItemDef | null = null;

  public onResumeGame?: () => void;
  public onCreditChanged?: () => void;

  constructor(private parent: HTMLElement, private wallet: CowboyWallet) {
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'cowboyShopRoot';
    this.rootEl.className = 'cowboy-shop-overlay';
    this.rootEl.hidden = true;
    this.parent.appendChild(this.rootEl);

    this.render();
    this.bindEvents();
  }

  private render(): void {
    this.rootEl.innerHTML = `
      <div class="cb-shop-backdrop"></div>
      <div class="cb-shop-content">
        <!-- Top Marquee Banner -->
        <div class="cb-shop-header">
          <div class="cb-shop-title-box">
            <span class="cb-shop-ico">🏪</span>
            <div class="cb-shop-titles">
              <h2 class="cb-shop-main-title" data-i18n="cb_shop_title">${t('cb_shop_title')}</h2>
              <span class="cb-shop-sub-title" data-i18n="cb_shop_sub">${t('cb_shop_sub')}</span>
            </div>
          </div>

          <div class="cb-shop-wallet-box">
            <span class="c-lbl" data-i18n="cb_credits_lbl">${t('cb_credits_lbl')}</span>
            <span class="c-val" id="cbShopCreditVal">${this.wallet.getCredits()}</span>
            <span class="c-unit">CREDIT 🪙</span>
          </div>
        </div>

        <!-- Merchant Booth Display -->
        <div class="cb-merchant-stage">
          <div class="cb-booth-roof">
            <div class="roof-scallop"></div>
          </div>
          <div class="cb-merchant-counter">
            <div class="cb-clerk-avatar">
              <span class="avatar-emoji">🤠</span>
              <span class="clerk-name">Lão Thợ Mỏ Kim Cương</span>
            </div>
            <div class="cb-merchant-sign">✨ VẬT PHẨM TRỢ THỦ ĐẮC LỰC ✨</div>
          </div>
        </div>

        <!-- 6 Item Cards Grid -->
        <div class="cb-shop-cards-scroll">
          <div class="cb-shop-cards-grid" id="cbShopCardsGrid"></div>
        </div>

        <!-- Bottom Action Bar -->
        <div class="cb-shop-bottom-bar">
          <button type="button" id="cbShopResumeBtn" class="cb-shop-btn-resume">
            <span class="btn-icon">🎯</span>
            <span class="btn-txt" data-i18n="cb_resume_game">${t('cb_resume_game')}</span>
            <small data-i18n="cb_resume_sub">${t('cb_resume_sub')}</small>
          </button>
        </div>

        <!-- Item Detail & Purchase Modal -->
        <div id="cbShopDetailModal" class="cb-shop-modal-wrap" hidden>
          <div class="cb-shop-modal-card">
            <button type="button" id="cbModalCloseBtn" class="cb-modal-close-btn">✕</button>
            <div class="cb-modal-icon-glow" id="cbModalIcon">🥾</div>
            <h3 class="cb-modal-title" id="cbModalTitle">Tên Vật Phẩm</h3>
            <div class="cb-modal-badge" id="cbModalBadge">Hiệu ứng</div>
            <p class="cb-modal-desc" id="cbModalDesc">Mô tả chi tiết tác dụng của vật phẩm.</p>
            <div class="cb-modal-price-row">
              <span class="lbl" data-i18n="cb_price_label">${t('cb_price_label')}</span>
              <span class="price-val" id="cbModalPrice">10 Credit</span>
            </div>
            <div id="cbModalNotice" class="cb-modal-notice" hidden></div>
            <div class="cb-modal-actions">
              <button type="button" id="cbModalBuyBtn" class="cb-btn-buy">🪙 <span data-i18n="cb_buy_now">${t('cb_buy_now')}</span></button>
              <button type="button" id="cbModalEquipBtn" class="cb-btn-equip">🎒 <span data-i18n="cb_equip">${t('cb_equip')}</span></button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.creditBalanceEl = this.rootEl.querySelector('#cbShopCreditVal')!;
    this.cardsContainer = this.rootEl.querySelector('#cbShopCardsGrid')!;
    this.modalEl = this.rootEl.querySelector('#cbShopDetailModal')!;

    this.renderItemCards();
  }

  private renderItemCards(): void {
    this.cardsContainer.innerHTML = '';
    for (const item of COWBOY_ITEMS_CATALOG) {
      const ownedCount = cowboyInventory.getCount(item.kind);
      const isEquipped = cowboyInventory.isEquipped(item.kind);

      const card = document.createElement('div');
      card.className = `cb-item-card ${isEquipped ? 'equipped' : ''}`;
      card.innerHTML = `
        <div class="card-roof-ornament"></div>
        <div class="card-icon-halo">
          <span class="halo-rays"></span>
          <span class="item-emoji">${item.icon}</span>
        </div>
        <div class="card-info">
          <h4 class="item-name">${item.nameVi}</h4>
          <span class="item-stat">${item.effectLabel}</span>
          <div class="item-owned-badge">${t('cb_owned_label')} <b>${ownedCount}</b></div>
        </div>
        <div class="card-action-box">
          <button type="button" class="cb-card-btn-view" data-kind="${item.kind}">
            <span class="c-price">${item.price} 🪙</span>
            <span class="c-action">${isEquipped ? t('cb_equipped') : (ownedCount > 0 ? t('cb_equip') : t('cb_view_buy'))}</span>
          </button>
        </div>
      `;

      card.querySelector('.cb-card-btn-view')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openDetailModal(item);
      });
      card.addEventListener('click', () => {
        this.openDetailModal(item);
      });

      this.cardsContainer.appendChild(card);
    }
  }

  private openDetailModal(item: CowboyItemDef): void {
    this.selectedItem = item;
    const noticeEl = this.modalEl.querySelector('#cbModalNotice') as HTMLElement;
    if (noticeEl) {
      noticeEl.hidden = true;
      noticeEl.textContent = '';
      noticeEl.className = 'cb-modal-notice';
    }
    const ownedCount = cowboyInventory.getCount(item.kind);
    const isEquipped = cowboyInventory.isEquipped(item.kind);

    this.modalEl.querySelector('#cbModalIcon')!.textContent = item.icon;
    this.modalEl.querySelector('#cbModalTitle')!.textContent = item.nameVi;
    this.modalEl.querySelector('#cbModalBadge')!.textContent = item.effectLabel;
    this.modalEl.querySelector('#cbModalDesc')!.textContent = item.descVi;
    this.modalEl.querySelector('#cbModalPrice')!.textContent = `${item.price} Credit (${t('cb_owned_label')} ${ownedCount})`;

    const equipBtn = this.modalEl.querySelector('#cbModalEquipBtn') as HTMLButtonElement;
    if (ownedCount <= 0) {
      equipBtn.disabled = true;
      equipBtn.textContent = `🎒 ${t('cb_backpack_empty')}`;
      equipBtn.style.opacity = '0.5';
    } else if (isEquipped) {
      equipBtn.disabled = false;
      equipBtn.textContent = `✅ ${t('cb_equipped')}`;
      equipBtn.style.opacity = '1';
    } else {
      equipBtn.disabled = false;
      equipBtn.textContent = `🎒 ${t('cb_equip')}`;
      equipBtn.style.opacity = '1';
    }

    this.modalEl.hidden = false;
  }

  private bindEvents(): void {
    // Nút đóng modal
    this.modalEl.querySelector('#cbModalCloseBtn')?.addEventListener('click', () => {
      this.modalEl.hidden = true;
    });

    // Nút Mua vật phẩm
    this.modalEl.querySelector('#cbModalBuyBtn')?.addEventListener('click', () => {
      if (!this.selectedItem) return;
      const res = cowboyInventory.buyItem(this.selectedItem.kind, this.wallet);
      const noticeEl = this.modalEl.querySelector('#cbModalNotice') as HTMLElement;
      if (noticeEl) {
        noticeEl.className = `cb-modal-notice ${res.success ? 'success' : 'error'}`;
        noticeEl.innerHTML = `<span class="ico">${res.success ? '✅' : '⚠️'}</span> <span>${res.msg}</span>`;
        noticeEl.hidden = false;
      }
      if (res.success) {
        this.creditBalanceEl.textContent = String(this.wallet.getCredits());
        this.onCreditChanged?.();
        this.renderItemCards();
        const ownedCount = cowboyInventory.getCount(this.selectedItem.kind);
        this.modalEl.querySelector('#cbModalPrice')!.textContent = `${this.selectedItem.price} Credit (${t('cb_owned_label')} ${ownedCount})`;
        const equipBtn = this.modalEl.querySelector('#cbModalEquipBtn') as HTMLButtonElement;
        equipBtn.disabled = false;
        equipBtn.style.opacity = '1';
        if (cowboyInventory.isEquipped(this.selectedItem.kind)) {
          equipBtn.textContent = `✅ ${t('cb_equipped')}`;
        } else {
          equipBtn.textContent = `🎒 ${t('cb_equip')}`;
        }
      }
    });

    // Nút Trang bị
    this.modalEl.querySelector('#cbModalEquipBtn')?.addEventListener('click', () => {
      if (!this.selectedItem) return;
      if (cowboyInventory.isEquipped(this.selectedItem.kind)) {
        cowboyInventory.unequipForRound(this.selectedItem.kind);
      } else {
        cowboyInventory.equipForRound(this.selectedItem.kind);
      }
      this.renderItemCards();
      this.openDetailModal(this.selectedItem);
    });

    // Nút Quay trở lại Game
    this.rootEl.querySelector('#cbShopResumeBtn')?.addEventListener('click', () => {
      this.close();
      this.onResumeGame?.();
    });
  }

  public open(): void {
    this.rootEl.hidden = false;
    this.creditBalanceEl.textContent = String(this.wallet.getCredits());
    this.renderItemCards();
  }

  public close(): void {
    this.rootEl.hidden = true;
    this.modalEl.hidden = true;
  }
}
