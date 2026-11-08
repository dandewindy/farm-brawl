import * as THREE from 'three';
import { t } from '../../i18n';
import { COWBOY_ITEMS_CATALOG, cowboyInventory } from './cowboyItems';
import { cowboyAudio } from './cowboyAudio';
import type { CowboyItemDef } from './cowboyTypes';
import type { CowboyWallet } from './cowboyWallet';
import {
  buildFarmerNPC,
  buildShopStall,
  buildShopItemModel,
  buildShopSack,
  disposeHierarchy,
  type FarmerNPC,
  type ShopItemModel,
  type ShopSack,
} from './cowboyShopModels';

export class CowboyShop {
  private rootEl: HTMLElement;
  private creditBalanceEl!: HTMLElement;
  private slotsContainer!: HTMLElement;
  private confirmModalEl!: HTMLElement;
  private speechBubbleEl!: HTMLElement;

  // Three.js 3D Shop Scene
  private canvas!: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private animFrameId: number | null = null;
  private isRendering = false;
  private lastTime = 0;

  // 3D Objects & Scene Environment
  private farmerNPC: FarmerNPC | null = null;
  private shopStall: THREE.Group | null = null;
  private itemModels: ShopItemModel[] = [];
  private shopSack: ShopSack | null = null;
  private floorMesh: THREE.Mesh | null = null;
  private backWallMesh: THREE.Mesh | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  private warmPointLight: THREE.PointLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;

  // Trạng thái hội thoại bác nông dân
  private isFarmerTalking = false;
  private talkingTimeout: any = null;

  // Trạng thái vật phẩm được chọn để mua
  private pendingBuyItem: CowboyItemDef | null = null;

  // Callbacks
  public onResumeGame?: () => void;
  public onExit?: () => void;
  public onCreditChanged?: () => void;

  constructor(private parent: HTMLElement, private wallet: CowboyWallet) {
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'cowboyShopRoot';
    this.rootEl.className = 'cowboy-shop-overlay cowboy-shop-fullscreen';
    this.rootEl.hidden = true;
    this.parent.appendChild(this.rootEl);

    this.render();
    this.initThreeScene();
    this.bindEvents();
  }

  private render(): void {
    this.rootEl.innerHTML = `
      <!-- 3D Canvas Background Viewport -->
      <div class="cb-shop-3d-viewport" id="cbShop3DViewport">
        <canvas id="cbShopCanvas" class="cb-shop-canvas"></canvas>
      </div>

      <!-- 2D HUD UI Layer on top of 3D Scene -->
      <div class="cb-shop-ui-layer">
        <!-- Top Title & Wallet Bar -->
        <div class="cb-shop-header-bar">
          <div class="cb-shop-brand">
            <span class="cb-brand-ico">🏪</span>
            <div class="cb-brand-text">
              <h1 class="cb-brand-title" data-i18n="cb_shop_brand_title">${t('cb_shop_brand_title')}</h1>
              <span class="cb-brand-subtitle" data-i18n="cb_shop_brand_sub">${t('cb_shop_brand_sub')}</span>
            </div>
          </div>

          <div class="cb-shop-wallet-badge">
            <span class="w-ico">🪙</span>
            <div class="w-info">
              <span class="w-lbl" data-i18n="cb_shop_credits_lbl">${t('cb_shop_credits_lbl')}</span>
              <span class="w-val" id="cbShopCreditVal">${this.wallet.getCredits()}</span>
            </div>
          </div>
        </div>

        <!-- Speech Bubble of Farmer NPC on Left -->
        <div class="cb-farmer-speech-bubble" id="cbFarmerSpeech">
          <div class="speech-avatar">👨‍🌾</div>
          <div class="speech-content">
            <b class="speech-name" data-i18n="cb_shop_farmer_name">${t('cb_shop_farmer_name')}</b>
            <p class="speech-msg" id="cbFarmerSpeechText">"${t('cb_shop_farmer_speech')}"</p>
          </div>
        </div>

        <!-- 6 Interactive Item Shelf Slots in Center -->
        <div class="cb-shop-shelves-ui">
          <div class="cb-shop-slots-grid" id="cbShopSlotsGrid"></div>
        </div>

        <!-- Floating Tooltip on Item Hover -->
        <div class="cb-item-tooltip" id="cbItemTooltip" hidden>
          <div class="tip-header">
            <span class="tip-icon" id="tipIcon">🥾</span>
            <div class="tip-title-box">
              <h4 class="tip-name" id="tipName">Giày Thần Tốc</h4>
              <span class="tip-badge" id="tipBadge">+60% Tốc độ quăng</span>
            </div>
          </div>
          <p class="tip-desc" id="tipDesc">Mô tả tác dụng của vật phẩm.</p>
          <div class="tip-footer">
            <span class="tip-owned" id="tipOwned">Đang sở hữu: 0</span>
            <span class="tip-price" id="tipPrice">10 Credit 🪙</span>
          </div>
        </div>

        <!-- Bottom Action Bar (Qua màn mới & Thoát) -->
        <div class="cb-shop-bottom-bar">
          <button type="button" id="cbShopExitBtn" class="cb-btn-shop-exit" title="Thoát trò chơi về sảnh chính">
            <span class="btn-ico">🚪</span>
            <span class="btn-txt" data-i18n="cb_exit">${t('cb_exit')}</span>
          </button>

          <button type="button" id="cbShopNextRoundBtn" class="cb-btn-shop-next" title="Tiếp tục sang màn mới">
            <span class="btn-ico">🎯</span>
            <div class="btn-body">
              <span class="btn-txt" data-i18n="cb_shop_next_round">${t('cb_shop_next_round')}</span>
              <small class="btn-sub" data-i18n="cb_shop_next_sub">${t('cb_shop_next_sub')}</small>
            </div>
          </button>
        </div>

        <!-- Simplified Confirm Purchase Modal -->
        <div id="cbShopConfirmModal" class="cb-shop-confirm-modal-wrap" hidden>
          <div class="cb-shop-confirm-card">
            <div class="cf-icon" id="cfIcon">🥾</div>
            <h3 class="cf-title" id="cfTitle">${t('cb_shop_confirm_title')}</h3>
            <p class="cf-desc" id="cfDesc"></p>
            <div class="cf-price-badge" id="cfPriceBadge">🪙 10 Credit</div>
            <div class="cf-actions">
              <button type="button" id="cfCancelBtn" class="cf-btn-cancel" data-i18n="cb_cancel">${t('cb_cancel')}</button>
              <button type="button" id="cfConfirmBtn" class="cf-btn-buy">🪙 <span data-i18n="cb_buy_now">${t('cb_buy_now')}</span></button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.canvas = this.rootEl.querySelector('#cbShopCanvas')!;
    this.creditBalanceEl = this.rootEl.querySelector('#cbShopCreditVal')!;
    this.slotsContainer = this.rootEl.querySelector('#cbShopSlotsGrid')!;
    this.confirmModalEl = this.rootEl.querySelector('#cbShopConfirmModal')!;
    this.speechBubbleEl = this.rootEl.querySelector('#cbFarmerSpeech')!;
  }

  private initThreeScene(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a170e);
    this.scene.fog = new THREE.FogExp2(0x2a170e, 0.035);

    this.camera = new THREE.PerspectiveCamera(46, w / h, 0.5, 60);
    this.camera.position.set(0, 2.05, 6.8);
    this.camera.lookAt(0, 1.65, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Ánh sáng ấm áp phong cách cửa hàng gỗ
    this.ambientLight = new THREE.AmbientLight(0xfff3e0, 1.2);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffe082, 1.8);
    this.sunLight.position.set(4, 7, 5);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0x90caf9, 0.6);
    this.fillLight.position.set(-5, 4, 3);
    this.scene.add(this.fillLight);

    this.warmPointLight = new THREE.PointLight(0xffb300, 1.4, 8);
    this.warmPointLight.position.set(0.65, 2.8, 1.2);
    this.scene.add(this.warmPointLight);

    // Sàn gỗ ấm
    const floorGeo = new THREE.PlaneGeometry(24, 16);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.85 });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.y = 0;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);

    // Tường gỗ phía sau
    const backWallGeo = new THREE.PlaneGeometry(24, 10);
    const backWallMat = new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.9 });
    this.backWallMesh = new THREE.Mesh(backWallGeo, backWallMat);
    this.backWallMesh.position.set(0, 4.5, -2.5);
    this.scene.add(this.backWallMesh);

    // 1. Tạo Bác Nông Dân bên trái
    this.farmerNPC = buildFarmerNPC();
    this.scene.add(this.farmerNPC.group);

    // 2. Tạo Quầy hàng gỗ chính giữa
    this.shopStall = buildShopStall();
    this.scene.add(this.shopStall);

    // 3. Tạo 6 Model 3D Vật Phẩm trưng bày trên 2 tầng kệ
    this.itemModels = [];
    COWBOY_ITEMS_CATALOG.forEach((item, idx) => {
      const model = buildShopItemModel(item.kind, idx);
      this.scene.add(model.group);
      this.itemModels.push(model);
    });

    // 4. Tạo Túi hàng / Thùng bảo bối bên góc phải (gắn trực tiếp flyingItem vào scene)
    this.shopSack = buildShopSack(this.scene);
    this.scene.add(this.shopSack.group);

    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => {
    if (!this.rootEl || this.rootEl.hidden) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;
    this.camera.aspect = aspect;

    // Responsive 3D camera framing based on aspect ratio
    if (aspect < 1.0) {
      // Mobile Portrait: widen FOV & camera distance so farmer + stall fit in view
      this.camera.fov = 64;
      this.camera.position.set(-0.4, 2.2, 9.2);
      this.camera.lookAt(-0.2, 1.6, 0);
    } else if (aspect < 1.5) {
      // Tablet / 4:3
      this.camera.fov = 52;
      this.camera.position.set(0, 2.1, 7.6);
      this.camera.lookAt(0, 1.65, 0);
    } else {
      // Standard 16:9 widescreen
      this.camera.fov = 46;
      this.camera.position.set(0, 2.05, 6.8);
      this.camera.lookAt(0, 1.65, 0);
    }

    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private renderSlotsUI(): void {
    this.slotsContainer.innerHTML = '';
    const tooltip = this.rootEl.querySelector('#cbItemTooltip') as HTMLElement;

    COWBOY_ITEMS_CATALOG.forEach((item, idx) => {
      const owned = cowboyInventory.getCount(item.kind);
      const isEquipped = cowboyInventory.isEquipped(item.kind);

      const slot = document.createElement('div');
      slot.className = `cb-shelf-slot slot-${idx} ${isEquipped ? 'is-equipped' : ''}`;
      slot.innerHTML = `
        <div class="slot-badge-top">${item.nameVi}</div>
        <div class="slot-stat-pill">${item.effectLabel}</div>
        <div class="slot-owned-count">${t('cb_owned_label')} <b>${owned}</b></div>
        <div class="slot-actions">
          ${
            isEquipped
              ? `<button type="button" class="btn-slot-equip equipped">✅ ${t('cb_equipped')}</button>`
              : owned > 0
              ? `<button type="button" class="btn-slot-equip">🎒 ${t('cb_equip')}</button>`
              : ''
          }
          <button type="button" class="btn-slot-buy" data-kind="${item.kind}">
            <span class="b-price">${item.price} 🪙</span>
            <span class="b-txt">${t('cb_buy_now')}</span>
          </button>
        </div>
      `;

      // Hover hiển thị tooltip thông tin chi tiết
      slot.addEventListener('mouseenter', () => {
        if (!tooltip) return;
        const iconEl = tooltip.querySelector('#tipIcon')!;
        const nameEl = tooltip.querySelector('#tipName')!;
        const badgeEl = tooltip.querySelector('#tipBadge')!;
        const descEl = tooltip.querySelector('#tipDesc')!;
        const ownedEl = tooltip.querySelector('#tipOwned')!;
        const priceEl = tooltip.querySelector('#tipPrice')!;

        iconEl.textContent = item.icon;
        nameEl.textContent = item.nameVi;
        badgeEl.textContent = item.effectLabel;
        descEl.textContent = item.descVi;
        ownedEl.textContent = `${t('cb_owned_label')} ${cowboyInventory.getCount(item.kind)}`;
        priceEl.textContent = `${item.price} Credit 🪙`;

        const rect = slot.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top - 12}px`;
        tooltip.hidden = false;
      });

      slot.addEventListener('mouseleave', () => {
        if (tooltip) tooltip.hidden = true;
      });

      // Bấm nút Mua -> Mở modal confirm đơn giản
      slot.querySelector('.btn-slot-buy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openConfirmModal(item);
      });

      // Bấm nút Trang bị / Tháo trang bị
      slot.querySelector('.btn-slot-equip')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cowboyInventory.isEquipped(item.kind)) {
          cowboyInventory.unequipForRound(item.kind);
        } else {
          cowboyInventory.equipForRound(item.kind);
        }
        this.renderSlotsUI();
      });

      this.slotsContainer.appendChild(slot);
    });
  }

  private openConfirmModal(item: CowboyItemDef): void {
    this.pendingBuyItem = item;
    const cfIcon = this.confirmModalEl.querySelector('#cfIcon')!;
    const cfTitle = this.confirmModalEl.querySelector('#cfTitle')!;
    const cfDesc = this.confirmModalEl.querySelector('#cfDesc')!;
    const cfPrice = this.confirmModalEl.querySelector('#cfPriceBadge')!;

    cfIcon.textContent = item.icon;
    cfTitle.textContent = `${t('cb_shop_confirm_title')} - ${item.nameVi}`;
    cfDesc.textContent = t('cb_shop_confirm_prompt')
      .replace('{item}', item.nameVi)
      .replace('{effect}', item.effectLabel)
      .replace('{price}', String(item.price));
    cfPrice.textContent = `🪙 ${item.price} Credit (${t('cb_shop_credits_lbl')} ${this.wallet.getCredits()})`;

    this.confirmModalEl.hidden = false;
  }

  private bindEvents(): void {
    // Hủy modal confirm
    this.confirmModalEl.querySelector('#cfCancelBtn')?.addEventListener('click', () => {
      this.confirmModalEl.hidden = true;
      this.pendingBuyItem = null;
    });

    // Xác nhận mua
    this.confirmModalEl.querySelector('#cfConfirmBtn')?.addEventListener('click', () => {
      if (!this.pendingBuyItem) return;
      const item = this.pendingBuyItem;
      const res = cowboyInventory.buyItem(item.kind, this.wallet);

      this.confirmModalEl.hidden = true;
      this.pendingBuyItem = null;

      if (res.success) {
        this.creditBalanceEl.textContent = String(this.wallet.getCredits());
        this.onCreditChanged?.();

        // Kích hoạt animation 3D: Túi hàng lắc lắc & Vật phẩm nhảy vào túi!
        const itemIdx = COWBOY_ITEMS_CATALOG.findIndex((it) => it.kind === item.kind);
        if (itemIdx >= 0 && this.itemModels[itemIdx] && this.shopSack) {
          this.shopSack.triggerPurchaseHop(this.itemModels[itemIdx].pedestalPos);
        }

        // SFX ting ting mua hàng thành công
        cowboyAudio.playReward();

        this.renderSlotsUI();
        const msg = t('cb_shop_thank_you').replace('{item}', item.nameVi);
        this.showFarmerSpeech(msg);
      } else {
        alert(res.msg);
      }
    });

    // Nút "Qua màn mới" -> bắt đầu round mới
    this.rootEl.querySelector('#cbShopNextRoundBtn')?.addEventListener('click', () => {
      this.close();
      this.onResumeGame?.();
    });

    // Nút "Thoát" -> trở về lobby
    this.rootEl.querySelector('#cbShopExitBtn')?.addEventListener('click', () => {
      this.close();
      this.onExit?.();
    });
  }

  private showFarmerSpeech(text: string, duration = 4000): void {
    const textEl = this.speechBubbleEl.querySelector('#cbFarmerSpeechText') as HTMLElement;
    if (textEl) {
      textEl.textContent = `"${text}"`;
    }
    this.speechBubbleEl.classList.add('pop-in');
    this.isFarmerTalking = true;

    if (this.talkingTimeout) clearTimeout(this.talkingTimeout);
    this.talkingTimeout = setTimeout(() => {
      this.isFarmerTalking = false;
    }, duration);
  }

  private loop = (now: number): void => {
    if (!this.isRendering) return;
    this.animFrameId = requestAnimationFrame(this.loop);

    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    const time = now / 1000;

    // Cập nhật hoạt ảnh Bác Nông Dân
    if (this.farmerNPC) {
      this.farmerNPC.update(dt, time, this.isFarmerTalking);
    }

    // Cập nhật hoạt ảnh 6 vật phẩm xoay vòng và lấp lánh
    for (const itemModel of this.itemModels) {
      itemModel.update(dt, time);
    }

    // Cập nhật hoạt ảnh Túi hàng lắc lắc & nhảy
    if (this.shopSack) {
      this.shopSack.update(dt, time);
    }

    this.renderer.render(this.scene, this.camera);
  };

  public open(): void {
    this.rootEl.hidden = false;
    this.creditBalanceEl.textContent = String(this.wallet.getCredits());
    this.renderSlotsUI();
    this.onResize();

    // Bắt đầu vòng lặp render 3D
    if (!this.isRendering) {
      this.isRendering = true;
      this.lastTime = performance.now();
      this.animFrameId = requestAnimationFrame(this.loop);
    }

    // Phát giọng nói chào mừng Nữ miền Nam "Chào mừng đến với cửa hàng nông trại!"
    cowboyAudio.playVoice('cowboy_shop_welcome');
    this.showFarmerSpeech(t('cb_shop_farmer_speech'), 4200);
  }

  public close(): void {
    this.rootEl.hidden = true;
    this.confirmModalEl.hidden = true;
    this.isRendering = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.talkingTimeout) {
      clearTimeout(this.talkingTimeout);
      this.talkingTimeout = null;
    }
  }

  public destroy(): void {
    this.close();
    window.removeEventListener('resize', this.onResize);

    // Giải phóng tài nguyên môi trường sàn và tường
    if (this.floorMesh) {
      this.floorMesh.geometry.dispose();
      (this.floorMesh.material as THREE.Material).dispose();
      this.floorMesh = null;
    }
    if (this.backWallMesh) {
      this.backWallMesh.geometry.dispose();
      (this.backWallMesh.material as THREE.Material).dispose();
      this.backWallMesh = null;
    }
    if (this.sunLight) {
      this.sunLight.shadow?.dispose();
      this.sunLight = null;
    }

    if (this.farmerNPC) {
      this.farmerNPC.dispose();
      this.farmerNPC = null;
    }
    if (this.shopStall) {
      disposeHierarchy(this.shopStall);
      this.shopStall = null;
    }
    for (const itemModel of this.itemModels) {
      itemModel.dispose();
    }
    this.itemModels = [];
    if (this.shopSack) {
      this.shopSack.dispose();
      this.shopSack = null;
    }

    disposeHierarchy(this.scene);
    this.renderer.dispose();
    if (this.rootEl.parentElement) {
      this.rootEl.parentElement.removeChild(this.rootEl);
    }
  }
}
