import type { AdminAction } from '@shared/protocol';
import type { Species } from '@shared/constants';
import type { Transport } from '../net/transport';

export class AdminPanel {
  private panelEl: HTMLElement | null = null;
  private isCollapsed = false;
  private isGod = false;
  private isRainbow = false;
  private speedMultiplier = 1;
  private keydownHandler?: (e: KeyboardEvent) => void;

  constructor(
    private readonly transportGetter: () => Transport | null,
    private readonly isTouchDevice: boolean
  ) {
    this.init();
  }

  private init(): void {
    // Only show on PC (non-touch and wide enough screen)
    if (this.isTouchDevice || window.innerWidth < 900) {
      return;
    }

    this.createUI();
    this.bindGlobalKeys();
  }

  private send(cmd: AdminAction): void {
    const transport = this.transportGetter();
    if (transport) {
      transport.send({ t: 'admin', cmd });
    }
  }

  private createUI(): void {
    if (document.getElementById('adminPanel')) return;

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'adminPanel';
    this.panelEl.className = 'admin-panel';
    this.panelEl.innerHTML = `
      <div class="ap-header" id="apHeader">
        <div class="ap-title">
          <span class="ap-icon">🛠️</span>
          <span>ADMIN SANDBOX</span>
          <span class="ap-badge">F2</span>
        </div>
        <button type="button" class="ap-btn-toggle" id="apToggleBtn" title="Thu gọn/Mở rộng (F2)">−</button>
      </div>

      <div class="ap-body" id="apBody">
        <!-- 1. Mass & Evolution -->
        <div class="ap-section">
          <div class="ap-sec-title">⚖️ CÂN NẶNG & TIẾN HÓA</div>
          <div class="ap-grid-4">
            <button type="button" class="ap-btn" data-mass="1000">1000kg</button>
            <button type="button" class="ap-btn" data-mass="2000">2000kg</button>
            <button type="button" class="ap-btn ap-btn-gold" data-mass="3000">3000⚡</button>
            <button type="button" class="ap-btn ap-btn-fire" data-mass="5000">5000🔥</button>
          </div>
          <div class="ap-row" style="margin-top: 4px;">
            <input type="number" id="apCustomMass" class="ap-input" placeholder="Nhập số kg..." min="50" max="50000" step="500" value="3500" />
            <button type="button" id="apApplyMass" class="ap-btn ap-btn-action">Đặt Kg</button>
          </div>
        </div>

        <!-- 2. 9 Species -->
        <div class="ap-section">
          <div class="ap-sec-title">🐾 CON VẬT (9 LOÀI GỐC / THẦN THÚ)</div>
          <div class="ap-grid-3">
            <button type="button" class="ap-btn" data-species="chicken" title="Gà / Phượng Hoàng (≥3000kg)">🐔 Gà</button>
            <button type="button" class="ap-btn" data-species="duck" title="Vịt / Thiên Nga (≥3000kg)">🦆 Vịt</button>
            <button type="button" class="ap-btn" data-species="sheep" title="Cừu / Ram (≥3000kg)">🐑 Cừu</button>
            <button type="button" class="ap-btn" data-species="pig" title="Heo / Boar Rừng (≥3000kg)">🐷 Heo</button>
            <button type="button" class="ap-btn" data-species="horse" title="Ngựa / Pegasus (≥3000kg)">🐴 Ngựa</button>
            <button type="button" class="ap-btn" data-species="cow" title="Bò / Bull (≥3000kg)">🐮 Bò</button>
            <button type="button" class="ap-btn" data-species="dog" title="Chó / Sói Wolf (≥3000kg)">🐕 Chó</button>
            <button type="button" class="ap-btn" data-species="elephant" title="Voi / Mammoth (≥3000kg)">🐘 Voi</button>
            <button type="button" class="ap-btn" data-species="monkey" title="Khỉ / Gorilla (≥3000kg)">🐒 Khỉ</button>
          </div>
          <div class="ap-hint">Đạt ≥3000kg lập tức tự biến hình thành Thần thú tiến hóa!</div>
        </div>

        <!-- 3. Spawn Items -->
        <div class="ap-section">
          <div class="ap-sec-title">🎁 THẢ ITEM / QUẢ LÊN SÂN</div>
          <div class="ap-row">
            <select id="apItemType" class="ap-select">
              <option value="rainbow_candy">🌈 Kẹo Cầu Vồng (Super)</option>
              <option value="apple">🍎 Quả Táo (+2.5kg)</option>
              <option value="carrot">🥕 Cà Rốt (+1.6kg)</option>
              <option value="corn">🌽 Bắp Ngô (+1kg)</option>
              <option value="pumpkin">🎃 Quả Bí Đỏ (+7kg)</option>
              <option value="watermelon">🍉 Quả Dưa Hấu (+11kg)</option>
              <option value="pitchfork">🍴 Chĩa Ba Sắt (Húc x2)</option>
              <option value="dynamite">🧨 Thuốc Nổ Đỏ (Nổ 25%)</option>
              <option value="speed">⚡ Giày Tăng Tốc</option>
              <option value="shield">🛡️ Khiên Bất Hoại</option>
              <option value="heart">❤️ Tim Hồi Sinh</option>
              <option value="banana">🍌 Chuối Trơn</option>
            </select>
            <input type="number" id="apItemCount" class="ap-input" style="width: 48px; text-align: center;" value="5" min="1" max="30" />
            <button type="button" id="apSpawnBtn" class="ap-btn ap-btn-action">Thả</button>
          </div>
        </div>

        <!-- 4. God Tools -->
        <div class="ap-section">
          <div class="ap-sec-title">⚡ QUYỀN NĂNG THỬ NGHIỆM</div>
          <div class="ap-grid-2">
            <button type="button" id="apGodBtn" class="ap-btn">🛡️ Bất tử: TẮT</button>
            <button type="button" id="apRainbowBtn" class="ap-btn">🌈 Siêu cấp: TẮT</button>
            <button type="button" id="apSpeedBtn" class="ap-btn">⚡ Tốc độ: x1</button>
            <button type="button" id="apTillBtn" class="ap-btn ap-btn-warn">🚜 Gọi máy cày</button>
            <button type="button" id="apAddBotsBtn" class="ap-btn">🤖 Thêm 5 Bot</button>
            <button type="button" id="apClearBotsBtn" class="ap-btn">🧹 Xóa Bot</button>
            <button type="button" id="apClearFoodBtn" class="ap-btn" style="grid-column: span 2;">🗑️ Dọn sạch Thức ăn & Item</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.panelEl);
    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.panelEl) return;

    // Prevent keydown / pointerdown from bubbling down to game canvas
    const stopBubble = (e: Event) => e.stopPropagation();
    this.panelEl.addEventListener('keydown', stopBubble);
    this.panelEl.addEventListener('keyup', stopBubble);
    this.panelEl.addEventListener('keypress', stopBubble);
    this.panelEl.addEventListener('pointerdown', stopBubble);
    this.panelEl.addEventListener('mousedown', stopBubble);
    this.panelEl.addEventListener('click', stopBubble);

    // Toggle collapse
    const header = this.panelEl.querySelector('#apHeader') as HTMLElement;
    const body = this.panelEl.querySelector('#apBody') as HTMLElement;
    const toggleBtn = this.panelEl.querySelector('#apToggleBtn') as HTMLButtonElement;

    const toggleCollapse = () => {
      this.isCollapsed = !this.isCollapsed;
      body.classList.toggle('is-collapsed', this.isCollapsed);
      toggleBtn.textContent = this.isCollapsed ? '+' : '−';
    };
    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName !== 'BUTTON') {
        toggleCollapse();
      }
    });
    toggleBtn.addEventListener('click', toggleCollapse);

    // 1. Quick Mass buttons
    this.panelEl.querySelectorAll('[data-mass]').forEach((el) => {
      el.addEventListener('click', () => {
        const mass = Number(el.getAttribute('data-mass'));
        this.send({ act: 'mass', val: mass });
      });
    });

    // Custom mass apply
    const applyMassBtn = this.panelEl.querySelector('#apApplyMass');
    const customMassInput = this.panelEl.querySelector('#apCustomMass') as HTMLInputElement;
    applyMassBtn?.addEventListener('click', () => {
      const val = Number(customMassInput?.value || 3500);
      this.send({ act: 'mass', val });
    });

    // 2. Species buttons
    this.panelEl.querySelectorAll('[data-species]').forEach((el) => {
      el.addEventListener('click', () => {
        const species = el.getAttribute('data-species') as Species;
        this.send({ act: 'species', val: species });
      });
    });

    // 3. Spawn item
    const spawnBtn = this.panelEl.querySelector('#apSpawnBtn');
    const itemSelect = this.panelEl.querySelector('#apItemType') as HTMLSelectElement;
    const countInput = this.panelEl.querySelector('#apItemCount') as HTMLInputElement;

    spawnBtn?.addEventListener('click', () => {
      const item = itemSelect?.value || 'rainbow_candy';
      const count = Number(countInput?.value || 5);
      this.send({ act: 'spawn', item, count });
    });

    // 4. God tools
    const godBtn = this.panelEl.querySelector('#apGodBtn') as HTMLButtonElement;
    godBtn?.addEventListener('click', () => {
      this.isGod = !this.isGod;
      godBtn.classList.toggle('ap-active', this.isGod);
      godBtn.textContent = `🛡️ Bất tử: ${this.isGod ? 'BẬT' : 'TẮT'}`;
      this.send({ act: 'god', val: this.isGod });
    });

    const rainbowBtn = this.panelEl.querySelector('#apRainbowBtn') as HTMLButtonElement;
    rainbowBtn?.addEventListener('click', () => {
      this.isRainbow = !this.isRainbow;
      rainbowBtn.classList.toggle('ap-active', this.isRainbow);
      rainbowBtn.textContent = `🌈 Siêu cấp: ${this.isRainbow ? 'BẬT' : 'TẮT'}`;
      this.send({ act: 'rainbow', val: this.isRainbow });
    });

    const speedBtn = this.panelEl.querySelector('#apSpeedBtn') as HTMLButtonElement;
    speedBtn?.addEventListener('click', () => {
      this.speedMultiplier = this.speedMultiplier === 1 ? 2 : this.speedMultiplier === 2 ? 3 : 1;
      speedBtn.classList.toggle('ap-active', this.speedMultiplier > 1);
      speedBtn.textContent = `⚡ Tốc độ: x${this.speedMultiplier}`;
      this.send({ act: 'speed', val: this.speedMultiplier });
    });

    const tillBtn = this.panelEl.querySelector('#apTillBtn') as HTMLButtonElement;
    tillBtn?.addEventListener('click', () => {
      this.send({ act: 'till' });
    });

    const addBotsBtn = this.panelEl.querySelector('#apAddBotsBtn') as HTMLButtonElement;
    addBotsBtn?.addEventListener('click', () => {
      this.send({ act: 'add_bots', count: 5 });
    });

    const clearBotsBtn = this.panelEl.querySelector('#apClearBotsBtn') as HTMLButtonElement;
    clearBotsBtn?.addEventListener('click', () => {
      this.send({ act: 'clear_bots' });
    });

    const clearFoodBtn = this.panelEl.querySelector('#apClearFoodBtn') as HTMLButtonElement;
    clearFoodBtn?.addEventListener('click', () => {
      this.send({ act: 'clear_food' });
    });
  }

  private bindGlobalKeys(): void {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'F2' || e.code === 'F2' || e.key === '`') {
        e.preventDefault();
        if (this.panelEl) {
          const isHidden = this.panelEl.style.display === 'none';
          this.panelEl.style.display = isHidden ? 'block' : 'none';
        }
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
  }

  public show(): void {
    if (this.panelEl) {
      this.panelEl.style.display = 'block';
    }
  }

  public hide(): void {
    if (this.panelEl) {
      this.panelEl.style.display = 'none';
    }
  }

  public destroy(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = undefined;
    }
    if (this.panelEl && this.panelEl.parentNode) {
      this.panelEl.parentNode.removeChild(this.panelEl);
      this.panelEl = null;
    }
  }
}
