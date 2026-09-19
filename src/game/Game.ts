import * as THREE from 'three';
import { Bike } from './Bike';
import { CameraRig } from './CameraRig';
import {
  DESKTOP_PROFILE,
  FOG_FAR,
  FOG_NEAR,
  MAX_DELTA_TIME,
  MOBILE_PROFILE,
  PALETTE,
  REBASE_DISTANCE,
  RendererProfile,
  RideState,
  RoadPose,
} from './config';
import { Input } from './Input';
import { getCryptoSeed } from './rng';
import { RoadPath } from './RoadPath';
import { RoadRenderer } from './RoadRenderer';
import { RoadLighting } from './RoadLighting';
import { Scenery } from './Scenery';
import { SkySystem } from './SkySystem';

export class Game {
  private canvas: HTMLCanvasElement;
  private instructionsEl: HTMLElement | null;
  private speedValEl: HTMLElement | null;
  private statusValEl: HTMLElement | null;
  private autoDriveBtn: HTMLButtonElement | null;
  private autoDriveStateEl: HTMLElement | null;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraRig: CameraRig;

  private roadPath: RoadPath;
  private roadRenderer: RoadRenderer;
  private roadLighting: RoadLighting;
  private scenery: Scenery;
  private skySystem: SkySystem;
  private bike: Bike;
  private input: Input;

  private state: RideState;
  private currentPose: RoadPose = {
    s: 0,
    x: 0,
    z: 0,
    heading: 0,
    tangentX: 0,
    tangentZ: -1,
    rightX: 1,
    rightZ: 0,
    curvature: 0,
  };

  private currentProfile: RendererProfile;
  private reducedMotion = false;
  private lastTime = 0;
  private animationFrameId = 0;
  private lastRebaseDistance = 0;
  private prevModeBeforeHide: 'ready' | 'running' = 'ready';

  private lastHudSpeed = -999;
  private lastHudStatus = '';
  private onAutoDriveClick: () => void;

  private onResize: () => void;
  private onMotionChange: (e: MediaQueryListEvent) => void;
  private onVisibilityChange: () => void;
  private motionQuery: MediaQueryList;
  private readonly skyDrawingBufferSize = new THREE.Vector2();

  // Dev diagnostic log timer
  private lastDiagTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.instructionsEl = document.getElementById('game-instructions');
    this.speedValEl = document.getElementById('hud-speed-value');
    this.statusValEl = document.getElementById('hud-status-value');
    this.autoDriveBtn = document.getElementById('btn-autodrive') as HTMLButtonElement | null;
    this.autoDriveStateEl = document.getElementById('hud-autodrive-state');

    const seed = getCryptoSeed();
    this.currentProfile = this.detectProfile();
    this.reducedMotion = this.detectReducedMotion();

    // 1. WebGLRenderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(PALETTE.fog, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = false;

    // 2. Scene & Fog (scene.background is null to allow fog-free SkySystem pass behind)
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(PALETTE.fog, FOG_NEAR, FOG_FAR);

    // 3. Lighting (Hemisphere + Directional, no shadow casting)
    const hemiLight = new THREE.HemisphereLight(PALETTE.ambientLight, PALETTE.hemiGround, 1.15);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(PALETTE.directionalLight, 1.25);
    dirLight.castShadow = false;

    // 4. Initial Ride State with manual mode by default
    this.state = {
      mode: 'ready',
      driveMode: 'manual',
      throttleInput: 0,
      distanceAlongRoad: 0,
      speed: 0,
      targetSpeed: 0,
      lateralOffset: 0,
      lateralVelocity: 0,
      steerInput: 0,
      offRoadAmount: 0,
      elapsedTime: 0,
      startElapsedTime: 0,
    };

    // 5. Game Modules
    this.skySystem = new SkySystem(seed, this.currentProfile);
    const moonDir = this.skySystem.getMoonDirection();
    dirLight.position.set(moonDir.x * 100, moonDir.y * 100, moonDir.z * 100);
    this.scene.add(dirLight);

    this.roadPath = new RoadPath(seed);
    this.roadRenderer = new RoadRenderer();
    this.scene.add(this.roadRenderer.group);

    this.scenery = new Scenery(seed, DESKTOP_PROFILE);
    this.scene.add(this.scenery.group);

    this.roadLighting = new RoadLighting(this.currentProfile);
    this.scene.add(this.roadLighting.group);

    this.bike = new Bike();
    this.scene.add(this.bike.group);

    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    this.cameraRig = new CameraRig(aspect);

    this.input = new Input(this.canvas, () => {
      this.handleStartRequest();
    });

    // Initial road generation ahead
    this.roadPath.generateUntil(this.currentProfile.aheadDistance + 100);
    this.roadPath.getPose(0, this.currentPose);
    this.roadRenderer.update(0, this.roadPath, this.currentProfile);
    this.roadLighting.update(0, this.roadPath, this.currentProfile);

    this.bike.updateOffRoad(this.state);
    this.bike.updateVisuals(this.state, this.currentPose, 0.016, this.reducedMotion);
    this.scenery.update(0, this.currentPose, this.roadPath, this.currentProfile, 0.016, this.reducedMotion);
    this.cameraRig.update(this.bike.group.position, this.currentPose, 0, 0.016, this.reducedMotion);

    // 6. HUD setup & listeners
    this.onAutoDriveClick = () => {
      this.toggleAutoDrive();
    };
    if (this.autoDriveBtn) {
      this.autoDriveBtn.addEventListener('click', this.onAutoDriveClick);
    }
    this.syncAutoDriveButton();
    this.updateHUD();

    // 7. Viewport & Listeners
    this.onResize = () => this.handleResize();
    this.onMotionChange = (e: MediaQueryListEvent) => {
      this.reducedMotion = e.matches;
    };
    this.onVisibilityChange = () => {
      this.handleVisibilityChange();
    };

    this.handleResize();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);

    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motionQuery.addEventListener('change', this.onMotionChange);

    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // Start RAF loop
    this.lastTime = performance.now();
    this.loop = this.loop.bind(this);
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  private detectProfile(): RendererProfile {
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    return isCoarse || minDim < 700 ? MOBILE_PROFILE : DESKTOP_PROFILE;
  }

  private detectReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    const newProfile = this.detectProfile();
    const profileChanged = newProfile.id !== this.currentProfile.id;
    this.currentProfile = newProfile;

    const dpr = Math.min(window.devicePixelRatio || 1, this.currentProfile.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.cameraRig.setViewport(width, height);

    const skyDrawingBufferSize = this.skyDrawingBufferSize;
    const skyDomeMaterial = this.skySystem.skyDome.skyDomeMaterial;
    this.renderer.getDrawingBufferSize(skyDrawingBufferSize);
    skyDomeMaterial.uniforms.uResolution.value.copy(skyDrawingBufferSize);

    if (profileChanged) {
      this.skySystem.setProfile(this.currentProfile);
      this.roadRenderer.invalidateAllSlots();
      this.roadLighting.setProfile(this.currentProfile);
      this.roadLighting.update(this.state.distanceAlongRoad, this.roadPath, this.currentProfile);
    }
  }

  private handleStartRequest(): void {
    if (this.state.mode === 'ready') {
      this.state.mode = 'running';
      this.state.startElapsedTime = this.state.elapsedTime;
      if (this.instructionsEl) {
        this.instructionsEl.classList.add('hidden');
      }
    }
  }

  private toggleAutoDrive(): void {
    if (this.state.driveMode === 'manual') {
      this.state.driveMode = 'autodrive';
      if (this.state.mode === 'ready') {
        this.handleStartRequest();
      }
    } else {
      this.state.driveMode = 'manual';
    }
    this.syncAutoDriveButton();
  }

  private syncAutoDriveButton(): void {
    if (!this.autoDriveBtn) return;
    const isAuto = this.state.driveMode === 'autodrive';
    this.autoDriveBtn.setAttribute('aria-pressed', isAuto ? 'true' : 'false');
    this.autoDriveBtn.classList.toggle('active', isAuto);
    if (this.autoDriveStateEl) {
      this.autoDriveStateEl.textContent = isAuto ? 'ON' : 'OFF';
    }
  }

  private updateHUD(): void {
    if (this.speedValEl) {
      const dispSpeed = Math.round(Math.abs(this.state.speed));
      if (dispSpeed !== this.lastHudSpeed) {
        this.speedValEl.textContent = dispSpeed.toString();
        this.lastHudSpeed = dispSpeed;
      }
    }

    if (this.statusValEl) {
      let status = 'READY';
      if (this.state.mode === 'paused') {
        status = 'PAUSED';
      } else if (this.state.mode === 'running') {
        if (this.state.driveMode === 'autodrive') {
          status = this.state.offRoadAmount > 0.4 ? 'AUTO [DIRT]' : 'AUTO-DRIVE';
        } else if (this.state.speed < -0.4) {
          status = this.state.offRoadAmount > 0.4 ? 'REV [DIRT]' : 'REVERSE';
        } else if (this.state.speed > 0.4) {
          status = this.state.offRoadAmount > 0.4 ? 'FWD [DIRT]' : 'FORWARD';
        } else {
          status = 'NEUTRAL';
        }
      }

      if (status !== this.lastHudStatus) {
        this.statusValEl.textContent = status;
        this.lastHudStatus = status;
      }
    }
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      if (this.state.mode !== 'paused') {
        this.prevModeBeforeHide = this.state.mode;
        this.state.mode = 'paused';
      }
      this.input.clear();
    } else {
      if (this.state.mode === 'paused') {
        this.state.mode = this.prevModeBeforeHide;
      }
      // Reset timestamp to avoid giant dt spike
      this.lastTime = performance.now();
    }
  }

  private loop(now: number): void {
    this.animationFrameId = requestAnimationFrame(this.loop);

    // 1. Clamp dt
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(rawDt, MAX_DELTA_TIME);

    if (this.state.mode !== 'paused') {
      this.state.elapsedTime += dt;

      // 2. Read input (steer & throttle)
      this.state.steerInput = this.input.getSteer();
      this.state.throttleInput = this.input.getThrottle();

      // 3. Lateral dynamics
      this.bike.updateLateralDynamics(this.state, dt);

      // 4. Off-road
      this.bike.updateOffRoad(this.state);

      // 5. Speed (manual throttle / autodrive)
      this.bike.updateSpeed(this.state, dt);

      // 6. Distance (bounded by reverse boundary)
      this.bike.updateDistance(this.state, dt);

      // 7. Generate/prune path
      this.roadPath.generateUntil(this.state.distanceAlongRoad + this.currentProfile.aheadDistance + 60);
      this.roadPath.pruneBefore(this.state.distanceAlongRoad - this.currentProfile.behindDistance - 90);

      // 8. Rebase
      if (this.state.distanceAlongRoad - this.lastRebaseDistance >= REBASE_DISTANCE) {
        this.performRebase();
      }

      // 9. Recycle road/scenery
      this.roadRenderer.update(this.state.distanceAlongRoad, this.roadPath, this.currentProfile);
      this.scenery.updateInstances(this.state.distanceAlongRoad, this.roadPath, this.currentProfile);
      this.roadLighting.update(this.state.distanceAlongRoad, this.roadPath, this.currentProfile);

      // 10. Pose
      this.roadPath.getPose(this.state.distanceAlongRoad, this.currentPose);

      // 11. Bike
      this.bike.updateVisuals(this.state, this.currentPose, dt, this.reducedMotion);

      // 12. Mountains
      this.scenery.updateMountains(this.currentPose, dt, this.reducedMotion);

      // 13. SkySystem updates (fog-free celestial dome, aurora, moon, shooting stars)
      this.skySystem.update(dt, this.currentProfile, this.reducedMotion);

      // 14. Camera
      this.cameraRig.update(
        this.bike.group.position,
        this.currentPose,
        this.bike.getLeanAngle(),
        dt,
        this.reducedMotion
      );

      // 15. Update HUD without per-frame allocations
      this.updateHUD();
    }

    // 16. Render: Fog-free SkySystem pass before gameplay scene
    this.renderer.clear();
    this.skySystem.render(this.renderer, this.cameraRig.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.cameraRig.camera);

    // Diagnostic console logging (every 4 seconds)
    if (this.state.elapsedTime - this.lastDiagTime > 4.0) {
      this.lastDiagTime = this.state.elapsedTime;
      if (import.meta.env.DEV) {
        console.debug(
          `[Night Ride Diag] calls=${this.renderer.info.render.calls} geoms=${this.renderer.info.memory.geometries} dist=${Math.round(this.state.distanceAlongRoad)}m speed=${this.state.speed.toFixed(1)}m/s mode=${this.state.driveMode} profile=${this.currentProfile.id}`
        );
      }
    }
  }

  private performRebase(): void {
    this.roadPath.getPose(this.state.distanceAlongRoad, this.currentPose);
    const deltaX = this.currentPose.x;
    const deltaZ = this.currentPose.z;

    this.roadPath.rebase(deltaX, deltaZ);
    this.roadRenderer.invalidateAllSlots();
    this.scenery.rebase(deltaX, deltaZ);
    this.roadLighting.rebase(deltaX, deltaZ);
    this.cameraRig.rebase(deltaX, deltaZ);

    this.lastRebaseDistance = this.state.distanceAlongRoad;
  }

  public pause(): void {
    if (this.state.mode !== 'paused') {
      this.prevModeBeforeHide = this.state.mode;
      this.state.mode = 'paused';
    }
  }

  public resume(): void {
    if (this.state.mode === 'paused') {
      this.state.mode = this.prevModeBeforeHide;
      this.lastTime = performance.now();
    }
  }

  public destroy(): void {
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.motionQuery.removeEventListener('change', this.onMotionChange);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    if (this.autoDriveBtn) {
      this.autoDriveBtn.removeEventListener('click', this.onAutoDriveClick);
    }

    this.input.dispose();
    this.roadLighting.dispose();
    this.skySystem.dispose();
    this.renderer.dispose();
  }
}
