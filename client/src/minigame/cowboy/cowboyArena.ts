import * as THREE from 'three';
import { COWBOY_SPECIES_LIST, type ActiveCowboyAnimal, type LassoRope, type CowboyThemeId } from './cowboyTypes';
import { buildFullAnimal } from '../../render/animals';
import { cowboyAudio } from './cowboyAudio';
import { cowboyInventory } from './cowboyItems';
import { getCowboyTrackTexture, getCowboyMeadowTexture, getCowboyWoodTexture, getCowboyBarnTexture } from './cowboyTextures';


// Module-level target spreads (reused to prevent GC allocations)
const COWBOY_TARGET_SPREADS: readonly number[][] = [
  [0],
  [-2.6, 2.6],
  [-4.0, 0, 4.0],
  [-4.8, -1.6, 1.6, 4.8],
  [-5.4, -2.7, 0, 2.7, 5.4],
];

// Shared base geometries for tree decorations (reused across all trees)
let sharedAppleBodyGeo: THREE.SphereGeometry | null = null;
let sharedAppleStemGeo: THREE.CylinderGeometry | null = null;
let sharedAppleLeafGeo: THREE.ConeGeometry | null = null;
let sharedPetalGeo: THREE.SphereGeometry | null = null;
let sharedCenterGeo: THREE.SphereGeometry | null = null;
let sharedTuftGeo: THREE.ConeGeometry | null = null;

function getSharedTreeGeos(): {
  appleBody: THREE.SphereGeometry;
  appleStem: THREE.CylinderGeometry;
  appleLeaf: THREE.ConeGeometry;
  petal: THREE.SphereGeometry;
  center: THREE.SphereGeometry;
  tuft: THREE.ConeGeometry;
} {
  if (!sharedAppleBodyGeo) {
    sharedAppleBodyGeo = new THREE.SphereGeometry(0.13, 6, 5);
    sharedAppleStemGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.07, 4);
    sharedAppleLeafGeo = new THREE.ConeGeometry(0.035, 0.08, 4);
    sharedPetalGeo = new THREE.SphereGeometry(0.045, 5, 4);
    sharedCenterGeo = new THREE.SphereGeometry(0.035, 5, 4);
    sharedTuftGeo = new THREE.ConeGeometry(0.08, 0.35, 4);
  }
  return {
    appleBody: sharedAppleBodyGeo!,
    appleStem: sharedAppleStemGeo!,
    appleLeaf: sharedAppleLeafGeo!,
    petal: sharedPetalGeo!,
    center: sharedCenterGeo!,
    tuft: sharedTuftGeo!,
  };
}

export class CowboyArena {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  private animals: ActiveCowboyAnimal[] = [];
  private ropes: LassoRope[] = [];
  private nextAnimalId = 1;

  // Background and props
  private stageGroup = new THREE.Group();
  private decorGroup = new THREE.Group();
  private dirtMesh!: THREE.Mesh;
  private fenceGroup = new THREE.Group();
  private windowFrameGroup = new THREE.Group();
  private leftJamb: THREE.Mesh | null = null;
  private rightJamb: THREE.Mesh | null = null;
  private leftBrace: THREE.Mesh | null = null;
  private rightBrace: THREE.Mesh | null = null;
  private sillBeam: THREE.Mesh | null = null;
  private sillCap: THREE.Mesh | null = null;
  private windowMaterials: THREE.Material[] = [];
  private windmillBlades?: THREE.Group;
  private snowParticles?: THREE.Points;
  private clouds: THREE.Group[] = [];

  // Particle bursts & 3D Popups
  private particles: { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; maxLife: number }[] = [];
  private scoreSprites: { sprite: THREE.Sprite; vy: number; life: number; maxLife: number }[] = [];
  private trollSprites: { sprite: THREE.Sprite; animalId: number; life: number; maxLife: number }[] = [];

  // Scratch vectors for zero GC pressure during rope physics
  private scratchP0 = new THREE.Vector3();
  private scratchP1 = new THREE.Vector3();
  private scratchP2 = new THREE.Vector3();
  private scratchP3 = new THREE.Vector3();
  private scratchTip = new THREE.Vector3();
  private scratchKnotWorld = new THREE.Vector3();

  // Coin particle assets (shared to prevent GPU leak)
  private coinGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.04, 12);
  private coinMatGold = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    metalness: 0.9,
    roughness: 0.2,
    emissive: 0xffa000,
    emissiveIntensity: 0.4,
  });
  private coinMatRainbow = new THREE.MeshStandardMaterial({
    color: 0xffea00,
    metalness: 0.9,
    roughness: 0.2,
    emissive: 0xff007f,
    emissiveIntensity: 0.4,
  });

  private spawnTimer = 0;

  // Cơ chế nhấn giữ gồng canh cự ly xa gần
  private isAimCharging = false;
  private aimChargeStartTime = 0;
  private currentAimZ = 1.0;
  private selectedRopeCount = 1;
  private isNetSweeping = false;
  private currentTheme: CowboyThemeId = 'farm';

  // Rainbow Net visual mesh
  private netMesh?: THREE.Mesh;
  private netSweepTimeout: any = null;

  // Callbacks
  public onCatch?: (animal: ActiveCowboyAnimal, playerIndex?: number) => void;
  public onMiss?: (animal: ActiveCowboyAnimal, playerIndex?: number) => void;
  public onVolleyFinish?: (playerIndex?: number) => void;

  private isTwoPlayerMode = false;
  private selectedRopeCountP2 = 1;

  private isRunning = false;
  private animFrameId = 0;
  private lastTime = 0;

  constructor(private container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Bright cheerful farm sky
    this.scene.fog = new THREE.Fog(0x87ceeb, 28, 90);

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 80);
    this.camera.position.set(0, 3.4, 8.2);
    this.camera.lookAt(0, 1.2, -0.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    this.initLighting();
    this.initStage();
    this.initRopes();
    this.setTheme('farm');

    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => {
    if (!this.container) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    // Cập nhật vị trí 2 cột cửa sổ tự động neo sát mép ngoài màn hình
    const aspect = this.camera.aspect || 1.77;
    const halfWidthAtZ = 2.1 * Math.tan(THREE.MathUtils.degToRad(26)) * aspect;
    if (this.leftJamb) this.leftJamb.position.set(-halfWidthAtZ - 0.04, 0.40, -2.1);
    if (this.rightJamb) this.rightJamb.position.set(halfWidthAtZ + 0.04, 0.40, -2.1);
    if (this.leftBrace) this.leftBrace.position.set(-halfWidthAtZ + 0.12, -0.68, -2.1);
    if (this.rightBrace) this.rightBrace.position.set(halfWidthAtZ - 0.12, -0.68, -2.1);
  };

  private initLighting(): void {
    // Rich natural hemisphere illumination: sky-blue dome above, warm loam earth below
    const hemi = new THREE.HemisphereLight(0xbde0fe, 0x5c3d22, 0.70);
    this.scene.add(hemi);

    const amb = new THREE.AmbientLight(0xffecd2, 0.45);
    this.scene.add(amb);

    const sun = new THREE.DirectionalLight(0xfff6e5, 1.45);
    sun.position.set(7, 13, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 35;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0xffab40, 0.55);
    rim.position.set(-8, 6, -8);
    this.scene.add(rim);
  }

  private initStage(): void {
    this.scene.add(this.stageGroup);
    this.stageGroup.add(this.decorGroup);

    // Ground plane with procedural track texture
    const groundGeo = new THREE.PlaneGeometry(64, 42, 8, 8);
    groundGeo.rotateX(-Math.PI / 2);
    const trackTex = getCowboyTrackTexture('farm');
    const groundMat = new THREE.MeshStandardMaterial({
      map: trackTex,
      roughness: 0.88,
      metalness: 0.05,
    });
    this.dirtMesh = new THREE.Mesh(groundGeo, groundMat);
    this.dirtMesh.receiveShadow = true;
    this.stageGroup.add(this.dirtMesh);

    // Track lane markings (subtle trodden dirt tracks)
    const laneMat = new THREE.MeshBasicMaterial({ color: 0x5a3d24, transparent: true, opacity: 0.28 });
    for (let z = -2.5; z <= 2.5; z += 1.8) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(54, 0.10), laneMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.02, z);
      this.stageGroup.add(line);
    }

    this.buildFence();
    this.buildBarnWindowFrame();
  }

  
  /**
   * Tạo khung cửa sổ gỗ chuồng trại 3D ở cận cảnh (Cockpit / Window view)
   * Mô phỏng người chơi đứng ở một ô cửa sổ gỗ nông trại quăng dây ra bãi quây
   */
  private buildBarnWindowFrame(): void {
    // Gắn vào camera để luôn neo cố định tại cạnh dưới và 2 bên màn hình ở góc nhìn thứ nhất
    this.scene.add(this.camera);
    this.windowFrameGroup.name = 'barnWindowFrame';
    this.camera.add(this.windowFrameGroup);

    const woodTex = getCowboyWoodTexture();
    const woodMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0x4a2e1b,
      roughness: 0.85,
      metalness: 0.08,
    });

    const woodCapMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0x664126,
      roughness: 0.78,
      metalness: 0.12,
    });

    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x212121,
      roughness: 0.45,
      metalness: 0.85,
    });

    this.windowMaterials.push(woodMat, woodCapMat, ironMat);

    // 1. BẬU CỬA SỔ GỖ CHÍNH (MAIN WOODEN SILL BEAM TẠI ĐÁY MÀN HÌNH) - NỚI RỘNG & HẠ THẤP ĐỂ TỐI ĐA KHÔNG GIAN
    this.sillBeam = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.28, 0.75), woodMat);
    this.sillBeam.position.set(0, -1.06, -2.1);
    this.sillBeam.castShadow = true;
    this.sillBeam.receiveShadow = true;
    this.windowFrameGroup.add(this.sillBeam);

    // Gờ nẹp trên của bậu cửa (Sill Cap) mỏng và áp sát mép dưới
    this.sillCap = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.05, 0.80), woodCapMat);
    this.sillCap.position.set(0, -0.91, -2.1);
    this.windowFrameGroup.add(this.sillCap);

    // Gờ nẹp gỗ phụ phía dưới bậu cửa tạo chiều sâu 3D
    const sillSub = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.12, 0.65), woodMat);
    sillSub.position.set(0, -1.24, -2.1);
    this.windowFrameGroup.add(sillSub);

    // 2. CÁC BẢN LỀ / NẸP SẮT RÈN & ĐINH TÁN ĐẦU TRÒN CỐ ĐỊNH BẬU CỬA
    for (const x of [-2.6, -1.3, 0, 1.3, 2.6]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.30, 0.78), ironMat);
      strap.position.set(x, -1.06, -2.1);
      this.windowFrameGroup.add(strap);

      for (const y of [-0.96, -1.16]) {
        const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 6), ironMat);
        rivet.position.set(x, y, -1.71);
        this.windowFrameGroup.add(rivet);
      }
    }

    // 3. HAI CỘT KHUNG CỬA SỔ GỖ 2 BÊN MÉP (LEFT & RIGHT JAMBS) - TỰ ĐỘNG NEO SÁT MÉP MÀN HÌNH
    const aspect = this.camera.aspect || 1.77;
    const halfWidthAtZ = 2.1 * Math.tan(THREE.MathUtils.degToRad(26)) * aspect;

    this.leftJamb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.8, 0.55), woodMat);
    this.leftJamb.position.set(-halfWidthAtZ - 0.04, 0.40, -2.1);
    this.windowFrameGroup.add(this.leftJamb);

    this.rightJamb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.8, 0.55), woodMat);
    this.rightJamb.position.set(halfWidthAtZ + 0.04, 0.40, -2.1);
    this.windowFrameGroup.add(this.rightJamb);

    // Ke góc gỗ nhỏ gọn nép sát mép ngoài không che chắn tầm nhìn
    this.leftBrace = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.38, 0.18), woodMat);
    this.leftBrace.position.set(-halfWidthAtZ + 0.12, -0.68, -2.1);
    this.leftBrace.rotation.z = -0.78;
    this.windowFrameGroup.add(this.leftBrace);

    this.rightBrace = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.38, 0.18), woodMat);
    this.rightBrace.position.set(halfWidthAtZ - 0.12, -0.68, -2.1);
    this.rightBrace.rotation.z = 0.78;
    this.windowFrameGroup.add(this.rightBrace);
  }

  private buildFence(): void {
    const woodTex = getCowboyWoodTexture();
    const postMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0xc89666,
      roughness: 0.85,
    });
    const railMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0xb58354,
      roughness: 0.82,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x37474f,
      metalness: 0.8,
      roughness: 0.3,
    });

    const fenceZ = -3.8;
    const postGeo = new THREE.CylinderGeometry(0.14, 0.17, 2.2, 8);
    const capGeo = new THREE.ConeGeometry(0.20, 0.22, 6);
    const baseGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.25, 8);
    const boltGeo = new THREE.SphereGeometry(0.035, 6, 6);

    for (let x = -24; x <= 24; x += 3.2) {
      // Main post
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, 1.1, fenceZ);
      post.castShadow = true;
      post.receiveShadow = true;
      this.fenceGroup.add(post);

      // Chamfered post cap
      const cap = new THREE.Mesh(capGeo, postMat);
      cap.position.set(x, 2.30, fenceZ);
      this.fenceGroup.add(cap);

      // Post base footing
      const base = new THREE.Mesh(baseGeo, postMat);
      base.position.set(x, 0.12, fenceZ);
      this.fenceGroup.add(base);

      // Iron bolts at rail junctions
      const boltTop = new THREE.Mesh(boltGeo, metalMat);
      boltTop.position.set(x, 1.65, fenceZ + 0.14);
      this.fenceGroup.add(boltTop);

      const boltBot = new THREE.Mesh(boltGeo, metalMat);
      boltBot.position.set(x, 0.95, fenceZ + 0.14);
      this.fenceGroup.add(boltBot);
    }

    const railGeo = new THREE.BoxGeometry(50, 0.13, 0.14);
    const railTop = new THREE.Mesh(railGeo, railMat);
    railTop.position.set(0, 1.65, fenceZ);
    railTop.castShadow = true;
    this.fenceGroup.add(railTop);

    const railBot = new THREE.Mesh(railGeo, railMat);
    railBot.position.set(0, 0.95, fenceZ);
    railBot.castShadow = true;
    this.fenceGroup.add(railBot);

    this.stageGroup.add(this.fenceGroup);
  }

  /** Chuyển đổi 3 Theme bản đồ tương ứng game chính (Nông trại, Sa mạc, Băng tuyết) */
  public getTheme(): CowboyThemeId {
    return this.currentTheme;
  }

  private clearDecorGroup(): void {
    while (this.decorGroup.children.length > 0) {
      const obj = this.decorGroup.children[0];
      this.decorGroup.remove(obj);
      this.disposeHierarchy(obj);
    }
    this.clouds = [];
    this.windmillBlades = undefined;
    this.snowParticles = undefined;
  }

  private disposeHierarchy(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      }
    });
  }

  public setTheme(theme: CowboyThemeId): void {
    this.currentTheme = theme;

    // Dọn dẹp decor cũ & giải phóng GPU resources an toàn
    this.clearDecorGroup();

    // Cập nhật procedural ground texture
    const trackTex = getCowboyTrackTexture(theme);
    const dirtMat = this.dirtMesh.material as THREE.MeshStandardMaterial;
    dirtMat.map = trackTex;
    dirtMat.needsUpdate = true;

    // Dãy đồi chân trời 3D xoá bỏ khoảng trống phẳng sau rào
    const hills = this.buildHorizonHills(theme);
    this.decorGroup.add(hills);

    if (theme === 'farm') {
      // 1. Theme Nông Trại: Bầu trời xanh tươi sáng, mây trắng bồng bềnh, đồng cỏ hoa cúc & barn đỏ
      this.scene.background = new THREE.Color(0x87ceeb);
      this.scene.fog = new THREE.Fog(0x87ceeb, 32, 95);

      // Đồng cỏ hoa cúc trải rộng nằm hoàn toàn phía sau hàng rào (fence z = -3.8)
      // Không bao giờ lấn đè lên mặt đất đường đua (track z in [-21, +21])
      const meadowTex = getCowboyMeadowTexture();
      const meadow = new THREE.Mesh(
        new THREE.PlaneGeometry(140, 56),
        new THREE.MeshStandardMaterial({
          map: meadowTex,
          roughness: 0.88,
          metalness: 0.02,
        })
      );
      meadow.rotation.x = -Math.PI / 2;
      meadow.position.set(0, -0.01, -32.0);
      meadow.receiveShadow = true;
      this.decorGroup.add(meadow);

      // Đám mây trắng bồng bềnh
      this.clouds = [];
      const cloudPositions = [
        [-28, 14, -24], [-14, 16.5, -26], [2, 15, -23], [18, 17, -25], [32, 14.5, -24]
      ];
      for (const [cx, cy, cz] of cloudPositions) {
        const cloud = this.buildCloud();
        cloud.position.set(cx, cy, cz);
        this.clouds.push(cloud);
        this.decorGroup.add(cloud);
      }

      // Cối xay gió gỗ tinh xảo quay 4 cánh
      const windmill = this.buildWindmill();
      this.decorGroup.add(windmill);

      // Chuồng nông trại đỏ cổ điển & Tháp ủ ngũ cốc (Barn & Silo)
      const barnAndSilo = this.buildBarnAndSilo();
      this.decorGroup.add(barnAndSilo);

      // Cuộn rơm (Hay bales) với texture vàng óng
      const hayMat = new THREE.MeshStandardMaterial({ color: 0xdeb841, roughness: 0.92 });
      const hayPositions = [[-11, 0.65, -4.6], [-6.5, 0.65, -4.9], [7.5, 0.65, -4.7], [13.5, 0.65, -4.5]];
      for (const [hx, hy, hz] of hayPositions) {
        const hay = new THREE.Mesh(new THREE.CylinderGeometry(0.70, 0.70, 1.4, 12), hayMat);
        hay.rotation.z = Math.PI / 2;
        hay.position.set(hx, hy, hz);
        hay.castShadow = true;
        this.decorGroup.add(hay);
      }

      // Cây táo trĩu quả đa tầng foliage xếp dọc theo bờ rào xa
      const treePos = [
        [-24, 0, -7.2], [-16, 0, -8.0], [-9, 0, -7.2], [-3, 0, -7.6],
        [4, 0, -7.2], [10, 0, -7.8], [17, 0, -7.2], [24, 0, -7.6]
      ];
      for (let idx = 0; idx < treePos.length; idx++) {
        const [tx, ty, tz] = treePos[idx];
        const tree = this.buildFarmTree(idx);
        tree.position.set(tx, ty, tz);
        this.decorGroup.add(tree);
      }
    } else if (theme === 'prairie') {
      // 2. Theme Sa Mạc Đất Đỏ: Xương rồng Saguaro hoa tím, vách hẻm núi Red Canyon
      this.scene.background = new THREE.Color(0xffd59e);
      this.scene.fog = new THREE.Fog(0xffd59e, 30, 90);

      // Cây xương rồng Saguaro hoa nở rộ
      const cactusPos = [
        [-20, 0, -5.5], [-13, 0, -6.0], [-4, 0, -5.5],
        [5, 0, -6.0], [14, 0, -5.5], [22, 0, -6.0]
      ];
      for (let idx = 0; idx < cactusPos.length; idx++) {
        const [cx, cy, cz] = cactusPos[idx];
        const cactus = this.buildCactus(idx);
        cactus.position.set(cx, cy, cz);
        this.decorGroup.add(cactus);
      }

      // Tảng đá sa mạc hẻm núi (Red canyon rocks)
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d4427, roughness: 0.95 });
      const rockPos = [[-15, 0.9, -5.0], [-7, 0.7, -4.7], [9, 1.0, -4.8], [18, 1.2, -5.0]];
      for (const [rx, ry, rz] of rockPos) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), rockMat);
        rock.scale.set(1.5, 0.85, 1.3);
        rock.position.set(rx, ry, rz);
        rock.castShadow = true;
        this.decorGroup.add(rock);
      }
    } else if (theme === 'ice') {
      // 3. Theme Băng Tuyết: Cây thông phủ tuyết đa tầng, thạch băng phát sáng, bão tuyết
      this.scene.background = new THREE.Color(0x98c5e9);
      this.scene.fog = new THREE.Fog(0x98c5e9, 28, 90);

      // Cây thông tuyết đa tầng
      const pinePos = [
        [-21, 0, -6.5], [-14, 0, -7.0], [-5, 0, -6.2],
        [4, 0, -6.8], [13, 0, -7.0], [21, 0, -6.5]
      ];
      for (let idx = 0; idx < pinePos.length; idx++) {
        const [px, py, pz] = pinePos[idx];
        const pine = this.buildSnowPine(idx);
        pine.position.set(px, py, pz);
        this.decorGroup.add(pine);
      }

      // Cột thạch băng phát sáng lấp lánh (Glowing cyan ice crystals)
      const crystalMat = new THREE.MeshStandardMaterial({
        color: 0x00e5ff,
        emissive: 0x0097a7,
        emissiveIntensity: 0.55,
        roughness: 0.18,
        transparent: true,
        opacity: 0.88,
      });
      const crystalPos = [[-16, 1.3, -4.8], [-8, 1.0, -4.5], [8, 1.5, -4.6], [17, 1.1, -4.8]];
      for (const [cx, cy, cz] of crystalPos) {
        const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 6), crystalMat);
        crystal.position.set(cx, cy, cz);
        crystal.rotation.z = (Math.random() - 0.5) * 0.3;
        crystal.castShadow = true;
        this.decorGroup.add(crystal);
      }

      // Tuyết rơi nhẹ (Snow particle system)
      const snowGeo = new THREE.BufferGeometry();
      const snowCount = 200;
      const snowPos = new Float32Array(snowCount * 3);
      for (let s = 0; s < snowCount; s++) {
        snowPos[s * 3 + 0] = (Math.random() - 0.5) * 45;
        snowPos[s * 3 + 1] = Math.random() * 14;
        snowPos[s * 3 + 2] = (Math.random() - 0.5) * 20;
      }
      snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
      const snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.75 });
      this.snowParticles = new THREE.Points(snowGeo, snowMat);
      this.decorGroup.add(this.snowParticles);
    }
  }

  private buildHorizonHills(theme: CowboyThemeId): THREE.Group {
    const grp = new THREE.Group();

    if (theme === 'farm') {
      // Gentle rolling emerald & olive countryside hills
      const hillMatFar = new THREE.MeshStandardMaterial({ color: 0x558b2f, roughness: 0.92, flatShading: true });
      const hillMatMid = new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.90, flatShading: true });

      // Far ridge (Z = -44 to -50)
      const farConfigs = [
        { x: -45, z: -46, rx: 32, ry: 9, rz: 16 },
        { x: -15, z: -48, rx: 36, ry: 11, rz: 18 },
        { x: 18, z: -47, rx: 34, ry: 10, rz: 17 },
        { x: 48, z: -45, rx: 30, ry: 8.5, rz: 15 },
      ];
      for (const c of farConfigs) {
        const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), hillMatFar);
        hill.scale.set(c.rx, c.ry, c.rz);
        hill.position.set(c.x, -1.0, c.z);
        grp.add(hill);
      }

      // Mid ridge (Z = -32 to -36)
      const midConfigs = [
        { x: -32, z: -34, rx: 24, ry: 7, rz: 14 },
        { x: -2, z: -35, rx: 26, ry: 8, rz: 15 },
        { x: 28, z: -33, rx: 25, ry: 7.5, rz: 14 },
      ];
      for (const c of midConfigs) {
        const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), hillMatMid);
        hill.scale.set(c.rx, c.ry, c.rz);
        hill.position.set(c.x, -1.2, c.z);
        grp.add(hill);
      }
    } else if (theme === 'prairie') {
      // Towering canyon mesas and flat-topped buttes
      const mesaMat1 = new THREE.MeshStandardMaterial({ color: 0x9c4121, roughness: 0.95, flatShading: true });
      const mesaMat2 = new THREE.MeshStandardMaterial({ color: 0xb8522e, roughness: 0.92, flatShading: true });

      const mesaConfigs = [
        { x: -38, z: -38, rTop: 12, rBot: 16, h: 14, mat: mesaMat1 },
        { x: -8, z: -42, rTop: 16, rBot: 22, h: 18, mat: mesaMat2 },
        { x: 25, z: -39, rTop: 14, rBot: 18, h: 15, mat: mesaMat1 },
        { x: 50, z: -37, rTop: 10, rBot: 14, h: 12, mat: mesaMat2 },
      ];
      for (const m of mesaConfigs) {
        const mesa = new THREE.Mesh(new THREE.CylinderGeometry(m.rTop, m.rBot, m.h, 7), m.mat);
        mesa.position.set(m.x, m.h * 0.5 - 2, m.z);
        grp.add(mesa);
      }
    } else if (theme === 'ice') {
      // Alpine snowy mountain ridge
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.9, flatShading: true });
      const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, flatShading: true });

      const peakConfigs = [
        { x: -35, z: -42, r: 16, h: 22 },
        { x: -12, z: -46, r: 20, h: 28 },
        { x: 15, z: -44, r: 18, h: 25 },
        { x: 42, z: -40, r: 15, h: 20 },
      ];
      for (const p of peakConfigs) {
        const base = new THREE.Mesh(new THREE.ConeGeometry(p.r, p.h, 6), rockMat);
        base.position.set(p.x, p.h * 0.5 - 2, p.z);
        grp.add(base);

        const cap = new THREE.Mesh(new THREE.ConeGeometry(p.r * 0.45, p.h * 0.45, 6), snowMat);
        cap.position.set(p.x, p.h * 0.78 - 2, p.z);
        grp.add(cap);
      }
    }

    return grp;
  }

  private buildBarnAndSilo(): THREE.Group {
    const grp = new THREE.Group();
    grp.position.set(13.5, 0, -21);

    const barnTex = getCowboyBarnTexture();
    const barnWallMat = new THREE.MeshStandardMaterial({
      map: barnTex,
      roughness: 0.85,
    });
    const whiteTrimMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.75,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x424242,
      roughness: 0.70,
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x3e2723,
      roughness: 0.85,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0xb0bec5,
      metalness: 0.75,
      roughness: 0.35,
    });

    // 1. Main Barn Structure
    const barnW = 7.0;
    const barnH = 4.2;
    const barnD = 5.2;

    const body = new THREE.Mesh(new THREE.BoxGeometry(barnW, barnH, barnD), barnWallMat);
    body.position.y = barnH * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    grp.add(body);

    // Gambrel / Pitched Roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(barnW * 0.68, 2.6, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, barnH + 1.2, 0);
    roof.scale.set(1.0, 1.0, barnD / (barnW * 0.68 * Math.SQRT2));
    roof.castShadow = true;
    grp.add(roof);

    // White Roof Fascia Trim
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(barnW + 0.3, 0.16, barnD + 0.3), whiteTrimMat);
    fascia.position.set(0, barnH + 0.05, 0);
    grp.add(fascia);

    // Corner Trim Posts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner = new THREE.Mesh(new THREE.BoxGeometry(0.22, barnH, 0.22), whiteTrimMat);
        corner.position.set(sx * (barnW * 0.5), barnH * 0.5, sz * (barnD * 0.5));
        grp.add(corner);
      }
    }

    // Barn Doors with White X-crossbucks
    const doorW = 2.4;
    const doorH = 2.8;
    const doorMesh = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), doorMat);
    doorMesh.position.set(0, doorH * 0.5, barnD * 0.5 + 0.02);
    grp.add(doorMesh);

    // Door Frame
    const dFrameTop = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.2, 0.14, 0.08), whiteTrimMat);
    dFrameTop.position.set(0, doorH + 0.07, barnD * 0.5 + 0.03);
    grp.add(dFrameTop);

    // Upper Hay Loft Window & Hoist Beam
    const loftWin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.1), whiteTrimMat);
    loftWin.position.set(0, barnH + 0.8, barnD * 0.5 + 0.02);
    grp.add(loftWin);

    const hoistBeam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.4), whiteTrimMat);
    hoistBeam.position.set(0, barnH + 1.6, barnD * 0.5 + 0.6);
    grp.add(hoistBeam);

    // 2. Grain Silo (to the right of the barn)
    const siloR = 1.4;
    const siloH = 7.5;
    const siloX = 5.2;

    const siloBody = new THREE.Mesh(new THREE.CylinderGeometry(siloR, siloR, siloH, 16), metalMat);
    siloBody.position.set(siloX, siloH * 0.5, 0);
    siloBody.castShadow = true;
    siloBody.receiveShadow = true;
    grp.add(siloBody);

    // Silo Tension Bands
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.6 });
    for (let h = 1.4; h < siloH; h += 1.4) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(siloR + 0.02, 0.03, 6, 16), bandMat);
      band.rotation.x = Math.PI / 2;
      band.position.set(siloX, h, 0);
      grp.add(band);
    }

    // Silo Silver Dome Cap
    const siloDome = new THREE.Mesh(new THREE.SphereGeometry(siloR, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metalMat);
    siloDome.position.set(siloX, siloH, 0);
    grp.add(siloDome);

    return grp;
  }

  private buildWindmill(): THREE.Group {
    const wmGroup = new THREE.Group();
    wmGroup.position.set(-18, 0, -7.5);

    const woodTex = getCowboyWoodTexture();
    const woodMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0x8d6e63,
      roughness: 0.85,
    });
    const redHousingMat = new THREE.MeshStandardMaterial({
      color: 0x9e2a2b,
      roughness: 0.75,
    });
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xf5f5f5,
      roughness: 0.70,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x37474f,
      metalness: 0.8,
      roughness: 0.3,
    });

    // 4 Tapered Trellis Legs with Cross Bracing
    const towerH = 7.2;
    const legGeo = new THREE.CylinderGeometry(0.08, 0.12, towerH, 6);
    const legSpreadBot = 1.6;
    const legSpreadTop = 0.55;

    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2 + Math.PI / 4;
      const xBot = Math.cos(ang) * legSpreadBot;
      const zBot = Math.sin(ang) * legSpreadBot;
      const xTop = Math.cos(ang) * legSpreadTop;
      const zTop = Math.sin(ang) * legSpreadTop;

      const leg = new THREE.Mesh(legGeo, woodMat);
      leg.position.set((xBot + xTop) * 0.5, towerH * 0.5, (zBot + zTop) * 0.5);
      leg.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(xTop - xBot, towerH, zTop - zBot).normalize()
      );
      leg.castShadow = true;
      wmGroup.add(leg);
    }

    // Horizontal Ring Braces
    for (const h of [2.0, 4.0, 5.8]) {
      const ratio = h / towerH;
      const spread = (1 - ratio) * legSpreadBot + ratio * legSpreadTop;
      const brace = new THREE.Mesh(new THREE.BoxGeometry(spread * 2, 0.10, spread * 2), woodMat);
      brace.position.y = h;
      wmGroup.add(brace);
    }

    // Top Platform & Nacelle Gear Housing
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 8), woodMat);
    platform.position.y = towerH;
    wmGroup.add(platform);

    const nacelle = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 1.4), redHousingMat);
    nacelle.position.set(0, towerH + 0.55, 0);
    nacelle.castShadow = true;
    wmGroup.add(nacelle);

    // Directional Wind-Vane Tail Rudder
    const tailBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8), metalMat);
    tailBoom.rotation.x = Math.PI / 2;
    tailBoom.position.set(0, towerH + 0.6, -1.4);
    wmGroup.add(tailBoom);

    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 1.1), redHousingMat);
    tailFin.position.set(0, towerH + 0.6, -2.2);
    wmGroup.add(tailFin);

    // 4-Blade Rotating Fan
    const blades = new THREE.Group();
    blades.position.set(0, towerH + 0.6, 0.85);

    // Center hub
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 12), metalMat);
    hub.rotation.x = Math.PI / 2;
    blades.add(hub);

    for (let b = 0; b < 4; b++) {
      const blGrp = new THREE.Group();
      blGrp.rotation.z = (b * Math.PI) / 2;

      // Spar
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.4, 0.06), woodMat);
      spar.position.y = 1.7;
      blGrp.add(spar);

      // Aerodynamic blade slat
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.6, 0.03), bladeMat);
      slat.position.set(0.18, 1.8, 0);
      slat.rotation.y = 0.15; // pitch
      slat.castShadow = true;
      blGrp.add(slat);

      blades.add(blGrp);
    }

    wmGroup.add(blades);
    this.windmillBlades = blades;

    return wmGroup;
  }

  private buildCloud(): THREE.Group {
    const grp = new THREE.Group();
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.90 });
    const p1 = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8), cloudMat);
    const p2 = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 8), cloudMat);
    p2.position.set(-1.4, -0.2, 0);
    const p3 = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 8), cloudMat);
    p3.position.set(1.4, -0.1, 0);
    const p4 = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 8), cloudMat);
    p4.position.set(0.6, 0.8, 0.2);
    grp.add(p1, p2, p3, p4);
    grp.scale.set(1.5, 0.75, 1.0);
    return grp;
  }

  private buildFarmTree(variant = 0): THREE.Group {
    const grp = new THREE.Group();
    const woodTex = getCowboyWoodTexture();
    const geos = getSharedTreeGeos();

    // 1. Organic Tapered Trunk with Bark Texture & Natural Tilt
    const trunkMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0x6d4427,
      roughness: 0.9,
    });
    const trunkH = 2.7;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.44, trunkH, 8), trunkMat);
    trunk.position.y = trunkH * 0.5;
    trunk.rotation.z = (variant % 2 === 0 ? 0.04 : -0.05);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    grp.add(trunk);

    // 4 Buttress Root Flares Anchoring to Ground
    const rootGeo = new THREE.BoxGeometry(0.22, 0.40, 0.65);
    for (let r = 0; r < 4; r++) {
      const ang = (r * Math.PI) / 2 + 0.3;
      const root = new THREE.Mesh(rootGeo, trunkMat);
      root.position.set(Math.cos(ang) * 0.35, 0.18, Math.sin(ang) * 0.35);
      root.rotation.y = -ang;
      root.rotation.x = 0.35;
      root.castShadow = true;
      grp.add(root);
    }

    // 2 Branch Limbs extending into foliage
    const bGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.4, 6);
    const branchL = new THREE.Mesh(bGeo, trunkMat);
    branchL.position.set(-0.35, trunkH * 0.75, 0);
    branchL.rotation.z = 0.60;
    grp.add(branchL);

    const branchR = new THREE.Mesh(bGeo, trunkMat);
    branchR.position.set(0.35, trunkH * 0.85, 0.1);
    branchR.rotation.z = -0.55;
    grp.add(branchR);

    // 2. Sculpted Multi-Tiered Foliage Canopy (5 Overlapping Organic Puffs)
    const folMat1 = new THREE.MeshStandardMaterial({ color: 0x1e5622, roughness: 0.85, flatShading: true });
    const folMat2 = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.80, flatShading: true });
    const folMat3 = new THREE.MeshStandardMaterial({ color: 0x43a047, roughness: 0.75, flatShading: true });
    const folMatTop = new THREE.MeshStandardMaterial({ color: 0x66bb6a, roughness: 0.75, flatShading: true });

    const puffConfigs = [
      { geo: new THREE.DodecahedronGeometry(1.25, 1), pos: [-0.65, 2.9, -0.2], mat: folMat2, scale: [1.1, 0.9, 1.1] },
      { geo: new THREE.DodecahedronGeometry(1.35, 1), pos: [0.75, 3.1, 0.25], mat: folMat3, scale: [1.05, 0.95, 1.05] },
      { geo: new THREE.DodecahedronGeometry(1.60, 1), pos: [0.0, 3.5, 0.0], mat: folMat2, scale: [1.15, 0.9, 1.15] },
      { geo: new THREE.DodecahedronGeometry(1.20, 1), pos: [-0.15, 4.4, 0.1], mat: folMatTop, scale: [1.0, 0.95, 1.0] },
      { geo: new THREE.DodecahedronGeometry(1.10, 1), pos: [0.35, 3.3, -0.75], mat: folMat1, scale: [1.0, 0.85, 1.0] },
    ];

    for (const p of puffConfigs) {
      const puff = new THREE.Mesh(p.geo, p.mat);
      puff.position.set(p.pos[0], p.pos[1], p.pos[2]);
      puff.scale.set(p.scale[0], p.scale[1], p.scale[2]);
      puff.castShadow = true;
      puff.receiveShadow = true;
      grp.add(puff);
    }

    // 3. Crisp 3D Apples placed strictly on the EXPOSED OUTER SURFACE of the canopy
    const appleBodyMat = new THREE.MeshStandardMaterial({
      color: 0xd32f2f,
      roughness: 0.35,
      emissive: 0x330000,
    });
    const appleStemMat = new THREE.MeshBasicMaterial({ color: 0x3e2723 });
    const appleLeafMat = new THREE.MeshBasicMaterial({ color: 0x4caf50 });

    const applePositions = [
      [-1.55, 2.9, 0.2],   // far left puff surface
      [-0.75, 2.7, 1.25],  // left front surface
      [-0.15, 3.8, 1.55],  // center front surface
      [0.85, 3.0, 1.35],   // right front surface
      [1.70, 3.1, 0.1],    // far right puff surface
      [-0.15, 5.25, 0.1],  // top crown peak
      [0.45, 4.5, 0.95],   // upper right front
      [-0.65, 4.4, 0.90],  // upper left front
    ];

    for (const [ax, ay, az] of applePositions) {
      const appleGrp = new THREE.Group();
      appleGrp.position.set(ax, ay, az);

      const body = new THREE.Mesh(geos.appleBody, appleBodyMat);
      body.castShadow = true;
      appleGrp.add(body);

      const stem = new THREE.Mesh(geos.appleStem, appleStemMat);
      stem.position.y = 0.12;
      stem.rotation.z = 0.25;
      appleGrp.add(stem);

      const leaf = new THREE.Mesh(geos.appleLeaf, appleLeafMat);
      leaf.position.set(0.04, 0.12, 0);
      leaf.rotation.z = -1.2;
      appleGrp.add(leaf);

      grp.add(appleGrp);
    }

    // 4. White & Gold Floral Blossoms on outer foliage
    const blossomPetalMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const blossomCenterMat = new THREE.MeshBasicMaterial({ color: 0xffca28 });

    const blossomPositions = [
      [-0.45, 3.6, 1.45],
      [0.55, 3.8, 1.40],
      [-1.15, 3.4, 0.85],
      [1.25, 3.4, 0.80],
    ];
    for (const [bx, by, bz] of blossomPositions) {
      const bGrp = new THREE.Group();
      bGrp.position.set(bx, by, bz);

      const center = new THREE.Mesh(geos.center, blossomCenterMat);
      bGrp.add(center);

      for (let p = 0; p < 5; p++) {
        const pang = (p * Math.PI * 2) / 5;
        const petal = new THREE.Mesh(geos.petal, blossomPetalMat);
        petal.position.set(Math.cos(pang) * 0.065, Math.sin(pang) * 0.065, 0);
        bGrp.add(petal);
      }
      grp.add(bGrp);
    }

    // 5. Base Undergrowth: Grass Tufts & River Stones
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0x43a047, roughness: 0.8 });
    for (let t = 0; t < 5; t++) {
      const tang = (t * Math.PI * 2) / 5 + 0.2;
      const tuft = new THREE.Mesh(geos.tuft, tuftMat);
      tuft.position.set(Math.cos(tang) * 0.55, 0.16, Math.sin(tang) * 0.55);
      tuft.rotation.z = (Math.random() - 0.5) * 0.4;
      grp.add(tuft);
    }

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.9 });
    const rock1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 0), rockMat);
    rock1.position.set(0.48, 0.12, 0.35);
    rock1.scale.set(1.4, 0.8, 1.1);
    grp.add(rock1);

    const rock2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14, 0), rockMat);
    rock2.position.set(-0.45, 0.09, -0.32);
    rock2.scale.set(1.2, 0.7, 1.3);
    grp.add(rock2);

    const s = 0.95 + (variant % 3) * 0.1;
    grp.scale.set(s, s, s);
    grp.rotation.y = (variant * 1.3);

    return grp;
  }
  private buildCactus(variant = 0): THREE.Group {
    const grp = new THREE.Group();
    const cactusMat = new THREE.MeshStandardMaterial({
      color: 0x2e7d32,
      roughness: 0.85,
      flatShading: true,
    });
    const flowerMat = new THREE.MeshStandardMaterial({
      color: 0xe91e63,
      emissive: 0x880e4f,
      emissiveIntensity: 0.4,
      roughness: 0.4,
    });
    const stamenMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b });

    // Main 10-sided Fluted Trunk
    const stemH = 4.0;
    const stemR = 0.34;
    const mainStem = new THREE.Mesh(new THREE.CylinderGeometry(stemR, stemR * 1.05, stemH, 10), cactusMat);
    mainStem.position.y = stemH * 0.5;
    mainStem.castShadow = true;
    mainStem.receiveShadow = true;
    grp.add(mainStem);

    // Crown Dome Cap
    const cap = new THREE.Mesh(new THREE.SphereGeometry(stemR, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), cactusMat);
    cap.position.y = stemH;
    grp.add(cap);

    // Left Arm (Horizontal stub + Vertical Column)
    const armR = 0.20;
    const leftArmStub = new THREE.Mesh(new THREE.BoxGeometry(0.70, armR * 2, armR * 2), cactusMat);
    leftArmStub.position.set(-0.48, 2.0, 0);
    leftArmStub.castShadow = true;
    grp.add(leftArmStub);

    const leftArmH = 1.4;
    const leftArmCol = new THREE.Mesh(new THREE.CylinderGeometry(armR, armR, leftArmH, 8), cactusMat);
    leftArmCol.position.set(-0.75, 2.0 + leftArmH * 0.5, 0);
    leftArmCol.castShadow = true;
    grp.add(leftArmCol);

    const leftArmCap = new THREE.Mesh(new THREE.SphereGeometry(armR, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), cactusMat);
    leftArmCap.position.set(-0.75, 2.0 + leftArmH, 0);
    grp.add(leftArmCap);

    // Right Arm (Higher, organic asymmetry)
    const rightArmStub = new THREE.Mesh(new THREE.BoxGeometry(0.70, armR * 2, armR * 2), cactusMat);
    rightArmStub.position.set(0.48, 2.6, 0);
    rightArmStub.castShadow = true;
    grp.add(rightArmStub);

    const rightArmH = 1.6;
    const rightArmCol = new THREE.Mesh(new THREE.CylinderGeometry(armR, armR, rightArmH, 8), cactusMat);
    rightArmCol.position.set(0.75, 2.6 + rightArmH * 0.5, 0);
    rightArmCol.castShadow = true;
    grp.add(rightArmCol);

    const rightArmCap = new THREE.Mesh(new THREE.SphereGeometry(armR, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), cactusMat);
    rightArmCap.position.set(0.75, 2.6 + rightArmH, 0);
    grp.add(rightArmCap);

    // Magenta Desert Flowers on Crown and Arm Tips
    const flowerSpots = [
      [0, stemH + stemR, 0],
      [-0.75, 2.0 + leftArmH + armR, 0],
      [0.75, 2.6 + rightArmH + armR, 0],
    ];
    for (const [fx, fy, fz] of flowerSpots) {
      const fGrp = new THREE.Group();
      fGrp.position.set(fx, fy, fz);

      const fPetals = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.20, 6), flowerMat);
      fPetals.position.y = 0.08;
      fGrp.add(fPetals);

      const stamen = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), stamenMat);
      stamen.position.y = 0.16;
      fGrp.add(stamen);

      grp.add(fGrp);
    }

    // Base Desert Rocks & Prickly Pear Cluster
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d4427, roughness: 0.95 });
    const bRock1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 0), rockMat);
    bRock1.position.set(0.55, 0.2, 0.2);
    bRock1.scale.set(1.3, 0.7, 1.1);
    grp.add(bRock1);

    const bRock2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25, 0), rockMat);
    bRock2.position.set(-0.5, 0.15, -0.2);
    bRock2.scale.set(1.1, 0.8, 1.4);
    grp.add(bRock2);

    const padMat = new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.8 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 8), padMat);
    pad.position.set(-0.45, 0.22, 0.35);
    pad.rotation.x = 0.4;
    grp.add(pad);

    const s = 0.92 + (variant % 3) * 0.1;
    grp.scale.set(s, s, s);
    grp.rotation.y = variant * 0.8;

    return grp;
  }

  private buildSnowPine(variant = 0): THREE.Group {
    const grp = new THREE.Group();

    // Frosted Pine Bark Trunk
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9 });
    const trunkH = 2.4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.36, trunkH, 8), trunkMat);
    trunk.position.y = trunkH * 0.5;
    trunk.castShadow = true;
    grp.add(trunk);

    // 4 Cascading Alpine Fir Tiers in Deep Emerald Green
    const pineMat = new THREE.MeshStandardMaterial({
      color: 0x1b4332,
      roughness: 0.85,
      flatShading: true,
    });
    const snowCapMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.35,
      flatShading: true,
    });

    const tierConfigs = [
      { r: 2.1, h: 1.6, y: 1.8, capR: 1.5, capH: 0.7, capY: 2.4 },
      { r: 1.7, h: 1.5, y: 2.7, capR: 1.2, capH: 0.65, capY: 3.3 },
      { r: 1.3, h: 1.4, y: 3.6, capR: 0.9, capH: 0.6, capY: 4.15 },
      { r: 0.85, h: 1.3, y: 4.4, capR: 0.55, capH: 0.55, capY: 4.85 },
    ];

    for (const t of tierConfigs) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(t.r, t.h, 8), pineMat);
      cone.position.y = t.y;
      cone.castShadow = true;
      cone.receiveShadow = true;
      grp.add(cone);

      const cap = new THREE.Mesh(new THREE.ConeGeometry(t.capR, t.capH, 8), snowCapMat);
      cap.position.y = t.capY;
      cap.castShadow = true;
      grp.add(cap);
    }

    // Snowy Base Mounds
    const snowMoundMat = new THREE.MeshStandardMaterial({ color: 0xf0f7fa, roughness: 0.5 });
    const mound1 = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), snowMoundMat);
    mound1.scale.set(1.5, 0.8, 1.4);
    mound1.position.set(0.4, 0, 0.3);
    grp.add(mound1);

    const mound2 = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), snowMoundMat);
    mound2.scale.set(1.3, 0.7, 1.2);
    mound2.position.set(-0.35, 0, -0.25);
    grp.add(mound2);

    const s = 0.95 + (variant % 3) * 0.1;
    grp.scale.set(s, s, s);
    grp.rotation.y = variant * 0.7;

    return grp;
  }

  private initRopes(): void {
    const ropeMat = new THREE.MeshBasicMaterial({
      color: 0xd4a359,
      side: THREE.DoubleSide,
    });

    const loopMat = new THREE.MeshStandardMaterial({
      color: 0xf4a460,
      roughness: 0.75,
      metalness: 0.2,
    });

    for (let i = 0; i < 10; i++) {
      const pIdx = i < 5 ? 0 : 1;
      const ribbonGeo = new THREE.BufferGeometry();
      const pos = new Float32Array(17 * 2 * 3);
      const uvs = new Float32Array(17 * 2 * 2);
      const indices: number[] = [];

      for (let s = 0; s < 16; s++) {
        const v0 = s * 2;
        const v1 = v0 + 1;
        const v2 = v0 + 2;
        const v3 = v0 + 3;
        indices.push(v0, v1, v2, v2, v1, v3);
      }

      ribbonGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      ribbonGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      ribbonGeo.setIndex(indices);

      const ribbonMesh = new THREE.Mesh(ribbonGeo, ropeMat);
      ribbonMesh.visible = false;
      ribbonMesh.frustumCulled = false;
      this.scene.add(ribbonMesh);

      const loopGroup = new THREE.Group();
      loopGroup.frustumCulled = false;

      // Vòng thòng lọng (hình elip/oval nằm ngang dẹt theo chiều cao từ góc nhìn người chơi)
      const loopTorus = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.046, 12, 48), loopMat);
      loopTorus.rotation.x = Math.PI / 2; // Nằm ngang trên mặt phẳng X-Z cục bộ
      loopTorus.scale.set(1.25, 0.76, 1.0); // Dẹt theo chiều dọc, mở rộng bề ngang
      loopGroup.add(loopTorus);

      // Cục nút thắt (honda knot) nằm trực tiếp trên vành sợi dây thòng lọng
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 10), loopMat);
      knot.position.set(1.25 * 0.95, 0, 0);
      loopGroup.add(knot);

      loopGroup.visible = false;
      this.scene.add(loopGroup);

      this.ropes.push({
        id: i,
        lane: i % 5,
        playerIndex: pIdx,
        state: 'idle',
        progress: 0,
        startX: pIdx === 0 ? 0 : 2.8,
        startY: 0.5,
        startZ: 5.5,
        targetX: 0,
        targetY: 1.2,
        targetZ: 0,
        caughtAnimalId: null,
        ribbonMesh,
        loopMesh: loopGroup,
        lineGeo: ribbonGeo,
        knotMesh: knot,
      });
    }
    this.syncReadyRopes();
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.animate(this.lastTime);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }
  }

  public getActiveAnimals(): ActiveCowboyAnimal[] {
    return this.animals;
  }

  public setTwoPlayerMode(enabled: boolean): void {
    this.isTwoPlayerMode = enabled;
    this.syncReadyRopes();
  }

  public canLaunch(playerIndex = 0): boolean {
    if (this.isNetSweeping) return false;
    const slice = playerIndex === 0 ? this.ropes.slice(0, 5) : this.ropes.slice(5, 10);
    return !slice.some((r) => r.state === 'flying' || r.state === 'tug' || r.state === 'pulling' || r.state === 'miss');
  }

  public setSelectedRopesCount(count: number, playerIndex = 0): void {
    if (playerIndex === 0) {
      this.selectedRopeCount = Math.max(1, Math.min(5, count));
    } else {
      this.selectedRopeCountP2 = Math.max(1, Math.min(5, count));
    }
    if (this.canLaunch(playerIndex)) {
      this.syncReadyRopes(playerIndex as (0 | 1));
    }
  }

  public syncReadyRopes(targetPlayerIndex?: 0 | 1): void {
    const countP1 = this.selectedRopeCount;
    const countP2 = this.selectedRopeCountP2;
    const originP1X = this.isTwoPlayerMode ? -2.8 : 0;
    const originP2X = 2.8;

    // P1 Ropes (0..4)
    if (targetPlayerIndex === undefined || targetPlayerIndex === 0) {
      for (let i = 0; i < 5; i++) {
        const rope = this.ropes[i];
        rope.startX = originP1X + (i - (countP1 - 1) / 2) * 0.32;
        if (i < countP1) {
          rope.state = 'ready';
          rope.progress = 0;
          rope.caughtAnimalId = null;
          rope.ribbonMesh.visible = true;
          rope.loopMesh.visible = true;
        } else {
          rope.state = 'idle';
          rope.progress = 0;
          rope.caughtAnimalId = null;
          rope.ribbonMesh.visible = false;
          rope.loopMesh.visible = false;
        }
      }
    }

    // P2 Ropes (5..9)
    if (targetPlayerIndex === undefined || targetPlayerIndex === 1) {
      for (let i = 5; i < 10; i++) {
        const rope = this.ropes[i];
        const p2Idx = i - 5;
        rope.startX = originP2X + (p2Idx - (countP2 - 1) / 2) * 0.32;
        if (this.isTwoPlayerMode && p2Idx < countP2) {
          rope.state = 'ready';
          rope.progress = 0;
          rope.caughtAnimalId = null;
          rope.ribbonMesh.visible = true;
          rope.loopMesh.visible = true;
        } else {
          rope.state = 'idle';
          rope.progress = 0;
          rope.caughtAnimalId = null;
          rope.ribbonMesh.visible = false;
          rope.loopMesh.visible = false;
        }
      }
    }
  }

  /** Bắt đầu gồng dây canh cự ly xa gần khi nhấn giữ nút Quăng dây / phím Space */
  public startAimCharge(): void {
    if (!this.canLaunch()) return;
    this.isAimCharging = true;
    this.aimChargeStartTime = performance.now();
    this.currentAimZ = 1.0;
  }

  /** Dừng trạng thái gồng dây */
  public stopAimCharge(): void {
    this.isAimCharging = false;
  }

  /** Lấy cự ly Z đang được canh hiện tại */
  public getCurrentAimZ(): number {
    return this.currentAimZ;
  }

  /** Phóng thòng lọng tới cự ly Z đã canh sẵn khi thả nút */
  public launchVolleyWithAim(ropeCount: number, targetZ: number, playerIndex = 0): boolean {
    if (!this.canLaunch(playerIndex)) return false;
    if (playerIndex === 0) this.isAimCharging = false;

    cowboyAudio.playLassoThrow();

    if (playerIndex === 0) {
      const hasRainbowNet = cowboyInventory.isEquipped('rainbow_net');
      if (hasRainbowNet) {
        cowboyInventory.consume('rainbow_net');
        this.triggerRainbowNetSweep();
        return true;
      }
    }

    const count = Math.max(1, Math.min(5, ropeCount));
    if (playerIndex === 0) this.selectedRopeCount = count;
    else this.selectedRopeCountP2 = count;

    const targets = COWBOY_TARGET_SPREADS[count - 1];
    const clampedZ = Math.max(-2.5, Math.min(2.2, targetZ));

    const offsetStart = playerIndex === 0 ? 0 : 5;
    const baseOriginX = playerIndex === 0 ? (this.isTwoPlayerMode ? -2.8 : 0) : 2.8;
    const centerTargetX = playerIndex === 0 ? (this.isTwoPlayerMode ? -1.8 : 0) : 1.8;

    for (let i = 0; i < count; i++) {
      const rope = this.ropes[offsetStart + i];
      rope.state = 'flying';
      rope.progress = 0;
      rope.caughtAnimalId = null;

      rope.startX = baseOriginX + (i - (count - 1) / 2) * 0.42;
      rope.startY = 0.38;
      rope.startZ = 5.2;

      rope.targetX = centerTargetX + targets[i] * (this.isTwoPlayerMode ? 0.7 : 1.0);
      rope.targetY = 1.1;
      rope.targetZ = clampedZ;

      rope.ribbonMesh.visible = true;
      rope.loopMesh.visible = true;
      rope.loopMesh.scale.setScalar(1);
    }

    for (let i = count; i < 5; i++) {
      const rope = this.ropes[offsetStart + i];
      rope.state = 'idle';
      rope.ribbonMesh.visible = false;
      rope.loopMesh.visible = false;
    }

    return true;
  }

  /** Phóng thòng lọng (hoặc bung Lưới Cầu Vồng nếu đã trang bị) */
  public launchVolley(ropeCount: number, playerIndex = 0): boolean {
    return this.launchVolleyWithAim(ropeCount, -2.8, playerIndex);
  }

  /** Bung Lưới Cầu Vồng quét sạch mọi con thú trên màn hình */
  private triggerRainbowNetSweep(): void {
    if (this.isNetSweeping) return;
    this.isNetSweeping = true;
    cowboyAudio.playVoice('cowboy_jackpot');

    if (this.netSweepTimeout) {
      clearTimeout(this.netSweepTimeout);
      this.netSweepTimeout = null;
    }
    if (this.netMesh) {
      this.scene.remove(this.netMesh);
      this.netMesh.geometry.dispose();
      (this.netMesh.material as THREE.Material).dispose();
      this.netMesh = undefined;
    }

    // Tạo hiệu ứng lưới 7 màu khổng lồ
    const netGeo = new THREE.PlaneGeometry(36, 12, 12, 12);
    netGeo.rotateX(-Math.PI / 2);
    const netMat = new THREE.MeshBasicMaterial({
      color: 0xffea00,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
    });
    this.netMesh = new THREE.Mesh(netGeo, netMat);
    this.netMesh.position.set(0, 1.2, -0.5);
    this.scene.add(this.netMesh);

    // Bắt dính toàn bộ các con thú đang chạy và lưu ID để retire
    const caughtIds: number[] = [];
    for (const a of this.animals) {
      if (a.state === 'running') {
        a.state = 'caught';
        caughtIds.push(a.id);
        this.spawnCoinBurst(a.x, 1.2, a.z, true);
        this.spawn3DScorePopup(a.x, 1.5, a.z, a.score, true);
        this.onCatch?.(a);
      }
    }

    this.netSweepTimeout = setTimeout(() => {
      this.netSweepTimeout = null;
      this.isNetSweeping = false;
      if (this.netMesh) {
        this.scene.remove(this.netMesh);
        this.netMesh.geometry.dispose();
        (this.netMesh.material as THREE.Material).dispose();
        this.netMesh = undefined;
      }
      for (const id of caughtIds) {
        this.retireAnimal(id);
      }
      this.syncReadyRopes();
      this.onVolleyFinish?.(0);
    }, 1200);
  }

  private spawnAnimal(): void {
    if (this.animals.length >= 8) return;

    const totalWeight = COWBOY_SPECIES_LIST.reduce((acc, c) => acc + c.spawnWeight, 0);
    let r = Math.random() * totalWeight;
    let chosen = COWBOY_SPECIES_LIST[0];
    for (const c of COWBOY_SPECIES_LIST) {
      if (r <= c.spawnWeight) {
        chosen = c;
        break;
      }
      r -= c.spawnWeight;
    }

    // Cỏ 4 Lá tăng +35% cơ hội thú cầu vồng & lấp lánh
    const hasClover = cowboyInventory.isEquipped('lucky_clover');
    // Thú cầu vồng hiếm hơn hẳn, tiền x3
    const rainbowChance = hasClover ? 0.035 : 0.015;
    const isRainbow = Math.random() < rainbowChance;

    const sparkleChance = hasClover ? 0.28 : 0.15;
    const isSparkleX2 = !isRainbow && Math.random() < sparkleChance;

    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const lane = Math.floor(Math.random() * 3);
    const zCoords = [1.0, -0.6, -2.4];
    const laneZ = zCoords[lane];

    const startX = dir === 1 ? -19 : 19;
    const speed = chosen.speed * (0.85 + Math.random() * 0.3);

    const animalMesh = buildFullAnimal(chosen.species, isRainbow ? 2 : Math.floor(Math.random() * 3));
    animalMesh.flowerHat.visible = false;
    animalMesh.witchHat.visible = false;
    animalMesh.cartGroup.visible = false;

    const sc = chosen.scale;
    animalMesh.root.scale.set(sc * (dir === 1 ? 1 : -1), sc, sc);
    animalMesh.root.position.set(startX, 0, laneZ);
    this.scene.add(animalMesh.root);

    let sparkleGroup: THREE.Group | undefined;
    if (isSparkleX2) {
      sparkleGroup = new THREE.Group();
      const starGeo = new THREE.OctahedronGeometry(0.18, 0);
      const starMat = new THREE.MeshBasicMaterial({ color: 0xffea00 });
      for (let s = 0; s < 5; s++) {
        const star = new THREE.Mesh(starGeo, starMat);
        const ang = (s / 5) * Math.PI * 2;
        star.position.set(Math.cos(ang) * 0.95, 1.25 + Math.sin(s * 1.5) * 0.25, Math.sin(ang) * 0.95);
        sparkleGroup.add(star);
      }
      animalMesh.root.add(sparkleGroup);
    }

    const rainbowMats: THREE.MeshStandardMaterial[] = [];
    if (isRainbow) {
      animalMesh.body.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && !(child.userData && child.userData.eye)) {
          const orig = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (orig) {
            const cloned = orig.clone();
            (child as THREE.Mesh).material = cloned;
            rainbowMats.push(cloned);
          }
        }
      });
    }

    let score = chosen.score;
    if (isRainbow) {
      score = chosen.score * 3; // Tiền tăng gấp 3 cho Thú Cầu Vồng
    } else if (isSparkleX2) {
      score = chosen.score * 2;
    }

    this.animals.push({
      id: this.nextAnimalId++,
      species: chosen.species,
      config: chosen,
      root: animalMesh.root,
      legs: animalMesh.legs,
      x: startX,
      y: 0,
      z: laneZ,
      vx: dir * speed,
      dir,
      lane,
      state: 'running',
      isRainbow,
      isSparkleX2,
      score,
      catchRate: chosen.catchRate,
      tugTimer: 0,
      runCycle: Math.random() * 10,
      sparkleGroup,
      rainbowMats,
    });
  }

  private updateReadyRopeGeometry(rope: LassoRope, time: number): void {
    if (!rope.ribbonMesh.visible) return;

    const count = this.selectedRopeCount;
    const i = rope.id;

    const startX = (i - (count - 1) / 2) * 0.38;
    const startY = 0.62;
    const startZ = 4.8;

    // Vị trí các vòng thòng lọng chờ sẵn, thu gọn vừa vặn bên trong khung hình (hiển thị trọn vẹn cả 5 dây)
    // Căn chỉnh 5 vòng thòng lọng hoàn toàn nằm gọn trong khung nhìn màn hình (kể cả iPad 4:3 và màn hình hẹp)
    const readyTargets: [number, number, number][][] = [
      [[0, 1.65, 2.7]],
      [[-1.25, 1.62, 2.7], [1.25, 1.62, 2.7]],
      [[-1.90, 1.58, 2.65], [0, 1.68, 2.7], [1.90, 1.58, 2.65]],
      [[-2.20, 1.54, 2.6], [-0.75, 1.64, 2.65], [0.75, 1.64, 2.65], [2.20, 1.54, 2.6]],
      [[-2.30, 1.50, 2.55], [-1.15, 1.60, 2.6], [0, 1.70, 2.7], [1.15, 1.60, 2.6], [2.30, 1.50, 2.55]],
    ];

    const targets = readyTargets[count - 1] || readyTargets[0];
    const target = targets[i] || [0, 1.62, 2.7];

    const targetX = target[0];
    let targetY = target[1];
    let targetZ = target[2];

    // Khi đang nhấn giữ gồng nút Quăng dây:
    // Đưa dây ra xa hoặc về gần liên tục (Z oscillation) và đưa lên xuống (Y bobbing) để canh cự ly
    if (this.isAimCharging) {
      const elapsed = (performance.now() - this.aimChargeStartTime) * 0.001;
      // Chu kỳ dao động mượt mà 0..1 từ gần (2.2) đến xa (-2.5)
      const reachCycle = 0.5 - 0.5 * Math.cos(elapsed * 4.0);
      const aimZ = 2.2 + (-2.5 - 2.2) * reachCycle;
      this.currentAimZ = aimZ;
      const bobY = Math.sin(elapsed * 6.5) * 0.35;
      targetY = 1.62 + bobY;
      targetZ = aimZ;
    }

    // Toàn bộ sợi dây thòng lọng dao động nhẹ nhàng, tự nhiên trong không gian 3D
    const oscY = Math.sin(time * 3.2 + i * 0.9) * 0.055;
    const oscX = Math.cos(time * 2.4 + i * 0.7) * 0.035;
    const oscZ = Math.sin(time * 2.8 + i * 0.8) * 0.025;
    rope.loopMesh.position.set(targetX + oscX, targetY + oscY, targetZ + oscZ);

    const oscPitch = Math.sin(time * 2.5 + i) * 0.045;
    const oscRoll = Math.cos(time * 2.1 + i) * 0.04;
    rope.loopMesh.rotation.set(0.68 + oscPitch, 0, oscRoll);
    rope.loopMesh.scale.set(1.0, 1.0, 1.0);

    // Nút thắt (honda) xoay tròn liên tục quanh vành elip của thòng lọng
    const spinAngle = time * 10.5 + i * 1.6;
    const localKnotX = 1.25 * 0.95 * Math.cos(spinAngle);
    const localKnotZ = 0.76 * 0.95 * Math.sin(spinAngle);

    if (rope.knotMesh) {
      rope.knotMesh.position.set(localKnotX, 0, localKnotZ);
      rope.knotMesh.getWorldPosition(this.scratchKnotWorld);
    } else {
      this.scratchKnotWorld.copy(rope.loopMesh.position);
    }

    // Phần dây kéo nối trực tiếp vào nút thắt trên vành dây thay vì nối vào tâm
    const endX = this.scratchKnotWorld.x;
    const endY = this.scratchKnotWorld.y;
    const endZ = this.scratchKnotWorld.z;

    const posAttr = rope.lineGeo.getAttribute('position') as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const width = 0.038;

    for (let s = 0; s <= 16; s++) {
      const t = s / 16;
      const it = 1 - t;

      // Biên độ dao động suy giảm về 0 ở cả 2 đầu t=0 (tay) và t=1 (nút thắt)
      // Đảm bảo đuôi dây luôn tracking dính chặt 100% vào vòng dây không bị tách rời
      const env = Math.sin(t * Math.PI);
      const sag = env * -0.12;
      const waveX = Math.sin(time * 4.8 + t * 4.0 + i) * 0.032 * env;
      const waveY = Math.cos(time * 3.8 + t * 3.5 + i) * 0.025 * env;

      const curX = it * startX + t * endX + waveX;
      const curY = it * startY + t * endY + sag + waveY;
      const curZ = it * startZ + t * endZ;

      const idx = s * 6;
      posArr[idx + 0] = curX - width;
      posArr[idx + 1] = curY;
      posArr[idx + 2] = curZ;

      posArr[idx + 3] = curX + width;
      posArr[idx + 4] = curY;
      posArr[idx + 5] = curZ;
    }

    posAttr.needsUpdate = true;
  }

  private updateRopes(dt: number, time: number): void {
    const p1WasActive = this.ropes.slice(0, 5).some((r) => r.state === 'flying' || r.state === 'tug' || r.state === 'pulling' || r.state === 'miss');
    const p2WasActive = this.isTwoPlayerMode && this.ropes.slice(5, 10).some((r) => r.state === 'flying' || r.state === 'tug' || r.state === 'pulling' || r.state === 'miss');
    const hasSpeedBoots = cowboyInventory.isEquipped('speed_boots');
    const speedMult = hasSpeedBoots ? 1.6 : 1.0;

    for (const rope of this.ropes) {
      if (rope.state === 'idle') continue;
      if (rope.state === 'ready') {
        this.updateReadyRopeGeometry(rope, time);
        continue;
      }

      if (rope.state === 'flying') {
        rope.progress += dt * 3.2 * speedMult;

        if (rope.progress >= 0.45 && rope.caughtAnimalId === null) {
          this.checkRopeCollision(rope);
        }

        if (rope.progress >= 1.0) {
          rope.progress = 1.0;
          if (rope.caughtAnimalId !== null) {
            rope.state = 'tug';
          } else {
            rope.state = 'miss';
          }
        }
      } else if (rope.state === 'tug') {
        // Animation 2 giây đang dùng sức kéo giằng co con vật (nếu có Thuốc Tăng Lực thì kéo luôn)
        const animal = this.animals.find((a) => a.id === rope.caughtAnimalId);
        if (animal) {
          const hasStrength = cowboyInventory.isEquipped('strength_potion');
          if (hasStrength) {
            animal.tugTimer = 2.0; // Bỏ qua 2s giằng co
          } else {
            animal.tugTimer += dt;
            // Hiệu ứng con thú giãy giụa chới với
            animal.root.position.x = animal.x + (Math.sin(time * 32) * 0.12);
            animal.root.rotation.z = Math.sin(time * 28) * 0.18;
          }

          if (animal.tugTimer >= 2.0) {
            // Xét tỷ lệ bắt dính (hoặc Khiên bảo vệ cứu khỏi bị hụt)
            let success = Math.random() < animal.catchRate;
            if (!success && cowboyInventory.isEquipped('lucky_shield')) {
              success = true;
              cowboyInventory.consume('lucky_shield');
            }

            if (success) {
              rope.state = 'pulling';
              animal.state = 'caught';
              cowboyAudio.playAnimalCry(animal.species);
              cowboyAudio.playReward();
            } else {
              rope.state = 'miss';
              animal.state = 'escaped';
              animal.vx *= 2.2; // Phóng nhanh tẩu thoát
              cowboyAudio.playLassoSnap();
              this.spawnTrollEmoji(animal);
              this.onMiss?.(animal);
            }
          }
        } else {
          rope.state = 'miss';
        }
      } else if (rope.state === 'pulling') {
        // Kéo dần về phía màn hình người chơi
        rope.progress -= dt * 2.2 * speedMult;
        const animal = this.animals.find((a) => a.id === rope.caughtAnimalId);
        if (animal) {
          const pullRate = dt * (hasSpeedBoots ? 6.2 : 3.8);
          animal.x += (rope.startX - animal.x) * pullRate;
          animal.z += (rope.startZ - animal.z) * pullRate;
          animal.root.position.set(animal.x, 0, animal.z);

          // Chân chới với
          for (let li = 0; li < animal.legs.length; li++) {
            animal.legs[li].rotation.x = Math.sin(time * 30 + li) * 0.7;
          }
        }

        if (rope.progress <= 0.05) {
          if (animal) {
            this.spawnCoinBurst(animal.x, 1.2, animal.z, animal.isRainbow);
            this.spawn3DScorePopup(animal.x, 1.6, animal.z, animal.score, animal.isRainbow || animal.isSparkleX2);
            this.onCatch?.(animal, rope.playerIndex ?? 0);
          }
          this.retireAnimal(rope.caughtAnimalId!);
          rope.state = 'idle';
          rope.ribbonMesh.visible = false;
          rope.loopMesh.visible = false;
        }
      } else if (rope.state === 'miss') {
        rope.progress -= dt * 2.8;
        if (rope.progress <= 0.05) {
          rope.state = 'idle';
          rope.ribbonMesh.visible = false;
          rope.loopMesh.visible = false;
        }
      }

      this.updateRopeGeometry(rope, time);
    }

    const p1StillActive = this.ropes.slice(0, 5).some((r) => r.state === 'flying' || r.state === 'tug' || r.state === 'pulling' || r.state === 'miss');
    const p2StillActive = this.isTwoPlayerMode && this.ropes.slice(5, 10).some((r) => r.state === 'flying' || r.state === 'tug' || r.state === 'pulling' || r.state === 'miss');

    if (p1WasActive && !p1StillActive) {
      this.syncReadyRopes(0);
      this.onVolleyFinish?.(0);
    }
    if (p2WasActive && !p2StillActive) {
      this.syncReadyRopes(1);
      this.onVolleyFinish?.(1);
    }
  }

  private checkRopeCollision(rope: LassoRope): void {
    const tipX = rope.startX + (rope.targetX - rope.startX) * rope.progress;
    const tipZ = rope.startZ + (rope.targetZ - rope.startZ) * rope.progress;

    for (const a of this.animals) {
      if (a.state !== 'running') continue;

      const dist = Math.hypot(a.x - tipX, a.z - tipZ);
      const catchDist = Math.max(1.85, a.config.scale * 1.85);

      if (dist <= catchDist) {
        rope.caughtAnimalId = a.id;
        a.state = 'tug';
        a.tugTimer = 0;
        cowboyAudio.playLassoTug();
        break;
      }
    }
  }

  private updateRopeGeometry(rope: LassoRope, time: number): void {
    if (!rope.ribbonMesh.visible) return;

    this.scratchP0.set(rope.startX, rope.startY, rope.startZ);

    // 1. Tính toán vị trí tâm vòng thòng lọng theo quỹ đạo bay hoặc con thú bị bắt
    let loopCenterX = rope.startX + (rope.targetX - rope.startX) * rope.progress;
    let loopCenterY = rope.startY + (rope.targetY - rope.startY) * rope.progress + Math.sin(rope.progress * Math.PI) * 1.5;
    let loopCenterZ = rope.startZ + (rope.targetZ - rope.startZ) * rope.progress;

    if (rope.caughtAnimalId !== null) {
      const a = this.animals.find((an) => an.id === rope.caughtAnimalId);
      if (a) {
        loopCenterX = a.x;
        loopCenterY = 1.05 * a.config.scale;
        loopCenterZ = a.z;
      }
    }

    rope.loopMesh.position.set(loopCenterX, loopCenterY, loopCenterZ);

    // 2. Cập nhật góc xoay và vị trí nút thắt (knot / honda) trên vành thòng lọng
    if (rope.state === 'flying') {
      rope.loopMesh.rotation.set(0.62, 0, Math.sin(time * 6.0) * 0.08);
      const spinAngle = time * 16.0 + rope.id * 1.5;
      if (rope.knotMesh) {
        rope.knotMesh.position.set(
          1.25 * 0.95 * Math.cos(spinAngle),
          0,
          0.76 * 0.95 * Math.sin(spinAngle)
        );
        rope.knotMesh.getWorldPosition(this.scratchKnotWorld);
      } else {
        this.scratchKnotWorld.set(loopCenterX, loopCenterY, loopCenterZ);
      }
    } else if (rope.state === 'tug' || rope.state === 'pulling') {
      rope.loopMesh.rotation.set(0.25, 0, 0);
      if (rope.knotMesh) {
        rope.knotMesh.position.set(0, 0, -0.76 * 0.95);
        rope.knotMesh.getWorldPosition(this.scratchKnotWorld);
      } else {
        this.scratchKnotWorld.set(loopCenterX, loopCenterY, loopCenterZ);
      }
    } else {
      rope.loopMesh.rotation.set(0.35, 0, 0);
      if (rope.knotMesh) {
        rope.knotMesh.getWorldPosition(this.scratchKnotWorld);
      } else {
        this.scratchKnotWorld.set(loopCenterX, loopCenterY, loopCenterZ);
      }
    }

    // Điểm mút P3 của sợi dây kéo luôn nối trực tiếp vào NÚT THẮT (knot) trên vành thay vì nối vào tâm
    this.scratchP3.copy(this.scratchKnotWorld);

    const tensionVibe = rope.state === 'tug' ? Math.sin(time * 45) * 0.12 : 0;

    this.scratchP1.set(
      rope.startX * 0.7 + this.scratchP3.x * 0.3,
      Math.max(this.scratchP0.y, this.scratchP3.y) + 2.0 * Math.sin(rope.progress * Math.PI) + tensionVibe,
      rope.startZ * 0.7 + this.scratchP3.z * 0.3,
    );
    this.scratchP2.set(
      rope.startX * 0.3 + this.scratchP3.x * 0.7,
      Math.max(this.scratchP0.y, this.scratchP3.y) + 1.4 * Math.sin(rope.progress * Math.PI) - tensionVibe,
      rope.startZ * 0.3 + this.scratchP3.z * 0.7,
    );

    const posAttr = rope.lineGeo.getAttribute('position') as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const width = 0.045;

    // Đánh giá toàn bộ đường cong từ tay (P0) tới nút thắt hiện tại (P3)
    // t=1 luôn chạm chính xác 100% vào knotMesh ở mọi frame và mọi tiến trình bay
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const it = 1 - t;

      const curX = it * it * it * this.scratchP0.x + 3 * it * it * t * this.scratchP1.x + 3 * it * t * t * this.scratchP2.x + t * t * t * this.scratchP3.x;
      const curY = it * it * it * this.scratchP0.y + 3 * it * it * t * this.scratchP1.y + 3 * it * t * t * this.scratchP2.y + t * t * t * this.scratchP3.y;
      const curZ = it * it * it * this.scratchP0.z + 3 * it * it * t * this.scratchP1.z + 3 * it * t * t * this.scratchP2.z + t * t * t * this.scratchP3.z;

      const idx = i * 6;
      posArr[idx + 0] = curX - width;
      posArr[idx + 1] = curY;
      posArr[idx + 2] = curZ;

      posArr[idx + 3] = curX + width;
      posArr[idx + 4] = curY;
      posArr[idx + 5] = curZ;

      if (i === 16) {
        this.scratchTip.set(curX, curY, curZ);
      }
    }

    posAttr.needsUpdate = true;
  }

  /** Hiệu ứng mặt cười trêu đùa khi hụt (Troll face / Smirk emoji) */
  private spawnTrollEmoji(animal: ActiveCowboyAnimal): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const trollEmojis = ['😜', '😏', '🐮💨', '🤪'];
    const emoji = trollEmojis[Math.floor(Math.random() * trollEmojis.length)];

    ctx.font = '72px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.4, 1.4, 1.4);
    sprite.position.set(animal.x, 1.8 * animal.config.scale, animal.z);
    this.scene.add(sprite);

    this.trollSprites.push({
      sprite,
      animalId: animal.id,
      life: 0,
      maxLife: 1.6,
    });
  }

  /** Hiệu ứng tăng điểm 3D bay lên rực rỡ khi kéo trúng con thú */
  private spawn3DScorePopup(x: number, y: number, z: number, score: number, isBonus = false): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.font = 'bold 54px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Viền phát sáng 3D
    ctx.strokeStyle = isBonus ? '#ff1744' : '#1b120c';
    ctx.lineWidth = 10;
    ctx.strokeText(`+${score} ĐIỂM`, 128, 64);

    ctx.fillStyle = isBonus ? '#ffea00' : '#ffd700';
    ctx.fillText(`+${score} ĐIỂM`, 128, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.4, 1.2, 1);
    sprite.position.set(x, y + 0.6, z);
    this.scene.add(sprite);

    this.scoreSprites.push({
      sprite,
      vy: 2.2,
      life: 0,
      maxLife: 1.4,
    });
  }

  private updateAnimals(dt: number): void {
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      a.runCycle += dt;

      if (a.state === 'running' || a.state === 'escaped') {
        a.x += a.vx * dt;
        a.root.position.set(a.x, a.y, a.z);

        const freq = 12 * Math.abs(a.vx / a.config.speed);
        for (let li = 0; li < a.legs.length; li++) {
          const phase = (li % 2 === 0 ? 1 : -1) * (li < 2 ? 1 : -1);
          a.legs[li].rotation.x = Math.sin(a.runCycle * freq + phase) * 0.45;
        }

        if (a.sparkleGroup) {
          a.sparkleGroup.rotation.y += dt * 3.5;
        }

        // Hiệu ứng màu cầu vồng 7 sắc luân chuyển rực rỡ như game chính
        if (a.isRainbow && a.rainbowMats) {
          a.rainbowMats.forEach((mat, idx) => {
            const h = (a.runCycle * 0.8 + idx * 0.12) % 1;
            mat.color.setHSL(h, 1.0, 0.52);
            mat.emissive.setHSL(h, 1.0, 0.22);
          });
        }

        if (a.x < -24 || a.x > 24) {
          this.retireAnimal(a.id);
        }
      }
    }
  }

  private spawnCoinBurst(x: number, y: number, z: number, rainbow = false): void {
    const mat = rainbow ? this.coinMatRainbow : this.coinMatGold;
    const count = rainbow ? 22 : 12;

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.coinGeo, mat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);

      const ang = Math.random() * Math.PI * 2;
      const spd = 2.5 + Math.random() * 4.5;

      this.particles.push({
        mesh,
        vx: Math.cos(ang) * spd,
        vy: 3.5 + Math.random() * 4.5,
        vz: Math.sin(ang) * spd,
        life: 0,
        maxLife: 0.85 + Math.random() * 0.4,
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }

      p.vy -= 9.8 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;

      p.mesh.rotation.x += dt * 8;
      p.mesh.rotation.y += dt * 6;

      const scale = 1 - p.life / p.maxLife;
      p.mesh.scale.setScalar(Math.max(0.01, scale));
    }

    // Cập nhật 3D Score Popups
    for (let i = this.scoreSprites.length - 1; i >= 0; i--) {
      const s = this.scoreSprites[i];
      s.life += dt;
      if (s.life >= s.maxLife) {
        this.scene.remove(s.sprite);
        if (s.sprite.material.map) s.sprite.material.map.dispose();
        s.sprite.material.dispose();
        this.scoreSprites.splice(i, 1);
        continue;
      }
      s.sprite.position.y += s.vy * dt;
      s.vy *= 0.94;
      const progress = s.life / s.maxLife;
      s.sprite.material.opacity = 1 - progress;
      const sc = 1.0 + Math.sin(progress * Math.PI) * 0.4;
      s.sprite.scale.set(2.4 * sc, 1.2 * sc, 1.0);
    }

    // Cập nhật Troll Sprites
    for (let i = this.trollSprites.length - 1; i >= 0; i--) {
      const ts = this.trollSprites[i];
      ts.life += dt;
      if (ts.life >= ts.maxLife) {
        this.scene.remove(ts.sprite);
        if (ts.sprite.material.map) ts.sprite.material.map.dispose();
        ts.sprite.material.dispose();
        this.trollSprites.splice(i, 1);
        continue;
      }
      const an = this.animals.find((a) => a.id === ts.animalId);
      if (an) {
        ts.sprite.position.x = an.x;
        ts.sprite.position.y = 1.8 * an.config.scale + (ts.life / ts.maxLife) * 0.5;
        ts.sprite.position.z = an.z;
      }
    }

    // Cập nhật tuyết rơi nhẹ
    if (this.snowParticles) {
      const posAttr = this.snowParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const posArr = posAttr.array as Float32Array;
      for (let s = 0; s < posArr.length / 3; s++) {
        posArr[s * 3 + 1] -= dt * 2.0;
        if (posArr[s * 3 + 1] < 0) {
          posArr[s * 3 + 1] = 14;
        }
      }
      posAttr.needsUpdate = true;
    }

    // Cập nhật cánh cối xay gió
    if (this.windmillBlades) {
      this.windmillBlades.rotation.z += dt * 0.8;
    }
  }

  private retireAnimal(id: number): void {
    const idx = this.animals.findIndex((a) => a.id === id);
    if (idx !== -1) {
      const a = this.animals[idx];
      if (a.sparkleGroup) {
        a.root.remove(a.sparkleGroup);
      }
      if (a.rainbowMats) {
        for (const m of a.rainbowMats) {
          m.dispose();
        }
      }
      this.scene.remove(a.root);
      this.animals.splice(idx, 1);
    }
  }

  private animate = (now: number): void => {
    if (!this.isRunning) return;
    this.animFrameId = requestAnimationFrame(this.animate);

    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    this.spawnTimer += dt;
    if (this.spawnTimer >= 0.70) {
      this.spawnTimer = 0;
      if (Math.random() < 0.75) {
        this.spawnAnimal();
      }
    }

    // Đám mây trôi bềnh bồng
    for (const c of this.clouds) {
      c.position.x += dt * 0.45;
      if (c.position.x > 38) c.position.x = -38;
    }

    this.updateAnimals(dt);
    this.updateRopes(dt, now * 0.001);
    this.updateParticles(dt);

    this.renderer.render(this.scene, this.camera);
  };

  public destroy(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);

    for (const p of this.particles) {
      this.scene.remove(p.mesh);
    }
    this.particles = [];

    if (this.netSweepTimeout) {
      clearTimeout(this.netSweepTimeout);
      this.netSweepTimeout = null;
    }
    if (this.netMesh) {
      this.scene.remove(this.netMesh);
      this.netMesh.geometry.dispose();
      (this.netMesh.material as THREE.Material).dispose();
      this.netMesh = undefined;
    }

    for (const s of this.scoreSprites) {
      if (s.sprite.material.map) s.sprite.material.map.dispose();
      s.sprite.material.dispose();
      this.scene.remove(s.sprite);
    }
    this.scoreSprites = [];

    for (const t of this.trollSprites) {
      if (t.sprite.material.map) t.sprite.material.map.dispose();
      t.sprite.material.dispose();
      this.scene.remove(t.sprite);
    }
    this.trollSprites = [];

    this.coinGeo.dispose();
    this.coinMatGold.dispose();
    this.coinMatRainbow.dispose();

    for (const a of this.animals) {
      this.scene.remove(a.root);
    }
    this.animals = [];

    for (const r of this.ropes) {
      this.scene.remove(r.ribbonMesh);
      this.scene.remove(r.loopMesh);
      r.lineGeo.dispose();
    }
    this.ropes = [];

    this.windowFrameGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
    });
    this.windowFrameGroup.clear();
    for (const mat of this.windowMaterials) {
      mat.dispose();
    }
    this.windowMaterials = [];
    this.camera.remove(this.windowFrameGroup);

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
