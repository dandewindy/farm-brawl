import * as THREE from 'three';
import type { Species } from '@shared/constants';
import { buildFullAnimal } from './animals';

export class AnimalPreviewRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly turntable: THREE.Group;
  private currentAnimalGroup: THREE.Group | null = null;
  private animId: number | null = null;
  private isRunning = false;

  public currentSpecies: Species = 'pig';
  public currentSkin = 0;
  public currentTeam?: number;

  // Drag interaction to rotate
  private isDragging = false;
  private lastPointerX = 0;
  private rotSpeed = 0.01;
  private autoRotate = true;

  // Offscreen renderer for crisp 3D thumbnails
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenRenderer: THREE.WebGLRenderer | null = null;
  private offscreenScene: THREE.Scene | null = null;
  private offscreenCamera: THREE.PerspectiveCamera | null = null;
  private readonly thumbCache = new Map<string, string>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth || 280, canvas.clientHeight || 180, false);
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 280 / 180, 0.1, 30);
    this.camera.position.set(0, 2.1, 4.4);
    this.camera.lookAt(0, 0.95, 0);

    // Studio Lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x4a3b2a, 1.8);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfffaed, 2.2);
    keyLight.position.set(4, 7, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x90caf9, 1.0);
    fillLight.position.set(-4, 3, -2);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffd54f, 1.3);
    rimLight.position.set(0, 4, -4);
    this.scene.add(rimLight);

    // Turntable
    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);

    // Pedestal base
    const baseGeo = new THREE.CylinderGeometry(1.65, 1.75, 0.2, 36);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x3d2b1f,
      roughness: 0.65,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.1;
    this.turntable.add(base);

    // Pedestal top rim
    const rimGeo = new THREE.TorusGeometry(1.65, 0.04, 8, 36);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xe8b641,
      metalness: 0.8,
      roughness: 0.25,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.01;
    this.turntable.add(rim);

    this.initInteraction();
  }

  private initInteraction(): void {
    const onDown = (clientX: number) => {
      this.isDragging = true;
      this.lastPointerX = clientX;
      this.autoRotate = false;
    };

    const onMove = (clientX: number) => {
      if (!this.isDragging) return;
      const dx = clientX - this.lastPointerX;
      this.turntable.rotation.y += dx * 0.012;
      this.lastPointerX = clientX;
    };

    const onUp = () => {
      if (this.isDragging) {
        this.isDragging = false;
        // Resume slow auto rotate after 1.5 seconds of inactivity
        setTimeout(() => {
          if (!this.isDragging) this.autoRotate = true;
        }, 1500);
      }
    };

    this.canvas.addEventListener('pointerdown', (e) => onDown(e.clientX));
    window.addEventListener('pointermove', (e) => onMove(e.clientX));
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches[0]) onDown(e.touches[0].clientX);
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (e.touches[0]) onMove(e.touches[0].clientX);
    }, { passive: true });
    window.addEventListener('touchend', onUp);
  }

  public setAnimal(species: Species, skin: number, team?: number): void {
    this.currentSpecies = species;
    this.currentSkin = skin;
    this.currentTeam = team;

    if (this.currentAnimalGroup) {
      this.turntable.remove(this.currentAnimalGroup);
      this.currentAnimalGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material?.dispose();
        }
      });
      this.currentAnimalGroup = null;
    }

    const { root } = buildFullAnimal(species, skin, team);
    this.currentAnimalGroup = root;

    // Scale and frame nicely
    const scales: Record<Species, number> = {
      chicken: 1.15,
      sheep: 1.15,
      horse: 0.92,
      cow: 1.05,
      duck: 1.2,
      pig: 1.12,
    };
    const s = scales[species] || 1.1;
    root.scale.set(s, s, s);

    // Initial presentation angle
    this.turntable.add(root);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const loop = () => {
      if (!this.isRunning) return;
      if (this.autoRotate) {
        this.turntable.rotation.y += this.rotSpeed;
      }
      this.renderer.render(this.scene, this.camera);
      this.animId = requestAnimationFrame(loop);
    };

    this.animId = requestAnimationFrame(loop);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  public resize(): void {
    const w = this.canvas.clientWidth || 280;
    const h = this.canvas.clientHeight || 180;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /**
   * Generates a 96x96 transparent PNG dataURL showing the full-body 3D animal
   * from an isometric angle in its selected skin.
   */
  public getThumbnail(species: Species, skin: number): string {
    const key = `${species}_${skin}`;
    if (this.thumbCache.has(key)) {
      return this.thumbCache.get(key)!;
    }

    if (!this.offscreenRenderer) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = 96;
      this.offscreenCanvas.height = 96;

      this.offscreenRenderer = new THREE.WebGLRenderer({
        canvas: this.offscreenCanvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      });
      this.offscreenRenderer.setSize(96, 96, false);

      this.offscreenScene = new THREE.Scene();
      this.offscreenCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
      this.offscreenCamera.position.set(2.8, 2.2, 3.2);
      this.offscreenCamera.lookAt(0, 0.95, 0);

      // Bright studio lighting for thumbnail
      const hemi = new THREE.HemisphereLight(0xffffff, 0x4a3b2a, 2.0);
      this.offscreenScene.add(hemi);

      const dLight = new THREE.DirectionalLight(0xffffff, 2.4);
      dLight.position.set(4, 6, 4);
      this.offscreenScene.add(dLight);

      const fill = new THREE.DirectionalLight(0xffeedd, 1.2);
      fill.position.set(-3, 3, -2);
      this.offscreenScene.add(fill);
    }

    const { root } = buildFullAnimal(species, skin);
    const scales: Record<Species, number> = {
      chicken: 1.15,
      sheep: 1.15,
      horse: 0.92,
      cow: 1.05,
      duck: 1.2,
      pig: 1.12,
    };
    const s = scales[species] || 1.1;
    root.scale.set(s, s, s);

    // Face 3/4 front toward camera
    root.rotation.y = 0;

    this.offscreenScene!.add(root);
    this.offscreenRenderer!.render(this.offscreenScene!, this.offscreenCamera!);
    const url = this.offscreenCanvas!.toDataURL('image/png');
    this.offscreenScene!.remove(root);

    // Dispose temporary thumbnail geometries/materials
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material?.dispose();
      }
    });

    this.thumbCache.set(key, url);
    return url;
  }
}
