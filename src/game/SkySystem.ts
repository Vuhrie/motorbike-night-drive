import * as THREE from 'three';
import { Aurora } from './Aurora';
import { CelestialLandmark } from './CelestialLandmark';
import { RendererProfile } from './config';
import { hash01 } from './rng';
import { ShootingStars } from './ShootingStars';
import { SkyDome } from './SkyDome';

const MAX_SKY_STARS = 1800;
const FIXED_STAR_RADIUS = 8.6;

export class SkySystem {
  public readonly scene: THREE.Scene;
  public get skyScene(): THREE.Scene {
    return this.scene;
  }
  public readonly camera: THREE.PerspectiveCamera;
  public get skyCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  private skyDome: SkyDome;
  private celestialLandmark: CelestialLandmark;
  private aurora: Aurora;
  private shootingStars: ShootingStars;

  private starsMesh: THREE.Points;
  private starsGeom: THREE.BufferGeometry;
  private starsMat: THREE.ShaderMaterial;
  private starTime = 0;

  private readonly gameplayWorldQuaternion = new THREE.Quaternion();
  private readonly initialGameplayQuaternion = new THREE.Quaternion();
  private readonly inverseInitialGameplayQuaternion = new THREE.Quaternion();
  private readonly relativeCameraQuaternion = new THREE.Quaternion();
  private initialOrientationCaptured = false;
  private readonly compositionRoot = new THREE.Group();

  constructor(seed: number, profile: RendererProfile) {
    this.scene = new THREE.Scene();
    this.scene.fog = null; // fog-free sky render pass

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 100);
    this.camera.position.set(0, 0, 0);
    this.camera.layers.set(0);

    // 1. Procedural SkyDome with gradient + diagonal Milky Way
    const dome = new SkyDome(profile);
    this.skyDome = dome;

    // 2. Visible stars at fixed radius 8.6, single custom soft-point draw call
    const starPositions = new Float32Array(MAX_SKY_STARS * 3);
    const starColors = new Float32Array(MAX_SKY_STARS * 3);
    const starSizes = new Float32Array(MAX_SKY_STARS);
    const starTwinkles = new Float32Array(MAX_SKY_STARS * 3); // freq, phase, amp

    for (let i = 0; i < MAX_SKY_STARS; i++) {
      const az = hash01(seed, i, 71) * Math.PI * 2;
      const el = 0.05 * Math.PI + hash01(seed, i, 72) * (0.43 * Math.PI); // upper hemisphere

      const cosEl = Math.cos(el);
      starPositions[i * 3 + 0] = Math.sin(az) * cosEl * FIXED_STAR_RADIUS;
      starPositions[i * 3 + 1] = Math.sin(el) * FIXED_STAR_RADIUS;
      starPositions[i * 3 + 2] = -Math.cos(az) * cosEl * FIXED_STAR_RADIUS;

      // Color variation: diamond white, cool blue-white, subtle warm gold
      const cType = hash01(seed, i, 73);
      let r = 0.95;
      let g = 0.97;
      let b = 1.0;

      if (cType < 0.28) {
        // Subtle warm golden star
        r = 1.0;
        g = 0.93;
        b = 0.84;
      } else if (cType < 0.6) {
        // Cool icy blue star
        r = 0.82;
        g = 0.91;
        b = 1.0;
      }

      const brightness = 0.55 + hash01(seed, i, 74) * 0.45;
      starColors[i * 3 + 0] = r * brightness;
      starColors[i * 3 + 1] = g * brightness;
      starColors[i * 3 + 2] = b * brightness;

      starSizes[i] = 2.2 + hash01(seed, i, 75) * 2.2;

      // Restrained twinkle: subtle amplitude (0.15 - 0.32) on selected stars (~35%)
      const isTwinkle = hash01(seed, i, 76) < 0.35;
      starTwinkles[i * 3 + 0] = 1.4 + hash01(seed, i, 77) * 2.6; // frequency
      starTwinkles[i * 3 + 1] = hash01(seed, i, 78) * Math.PI * 2; // phase
      starTwinkles[i * 3 + 2] = isTwinkle ? 0.16 + hash01(seed, i, 79) * 0.16 : 0.0; // amplitude
    }

    this.starsGeom = new THREE.BufferGeometry();
    this.starsGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.starsGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    this.starsGeom.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
    this.starsGeom.setAttribute('aTwinkle', new THREE.BufferAttribute(starTwinkles, 3));

    this.starsMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        uTwinkleEnabled: { value: 1.0 },
      },
      vertexShader: `
        attribute vec3 color;
        attribute float aSize;
        attribute vec3 aTwinkle;
        uniform float uTime;
        uniform float uTwinkleEnabled;
        varying vec3 vColor;
        varying float vBrightness;

        void main() {
          vColor = color;
          float twinkle = 1.0;
          if (uTwinkleEnabled > 0.5) {
            twinkle += aTwinkle.z * sin(uTime * aTwinkle.x + aTwinkle.y);
          }
          vBrightness = twinkle;
          gl_PointSize = aSize * (0.85 + 0.15 * twinkle);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vBrightness;

        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float soft = smoothstep(0.5, 0.06, d);
          gl_FragColor = vec4(vColor * vBrightness, soft);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: true,
    });

    this.starsMesh = new THREE.Points(this.starsGeom, this.starsMat);
    this.starsMesh.frustumCulled = false;
    this.starsMesh.renderOrder = 5;
    this.starsMesh.layers.set(0);

    // 3. Aurora ribbons
    const aurora = new Aurora();
    this.aurora = aurora;

    // 4. Celestial Landmark: icy low-poly moon with subtle halo
    const celestial = new CelestialLandmark();
    this.celestialLandmark = celestial;

    // 5. Shooting Stars pool
    const shootingStars = new ShootingStars() as ShootingStars & { readonly object: THREE.Object3D };
    (shootingStars as any).object = shootingStars.group;
    this.shootingStars = shootingStars;

    this.compositionRoot.add(
      dome.object,
      this.starsMesh,
      aurora.object,
      celestial.object,
      shootingStars.object,
    );
    this.scene.add(this.compositionRoot);

    this.compositionRoot.position.set(0, 0, 0);
    this.compositionRoot.quaternion.identity();
    this.compositionRoot.scale.set(1, 1, 1);

    this.compositionRoot.visible = true;
    this.compositionRoot.layers.set(0);
    this.compositionRoot.traverse((object) => {
      object.visible = true;
      object.layers.set(0);
    });

    this.setProfile(profile);
  }

  public setProfile(profile: RendererProfile): void {
    const starCount = profile.skyStarCount;
    this.starsGeom.setDrawRange(0, starCount);
  }

  public getMoonDirection(): THREE.Vector3 {
    return this.celestialLandmark.getMoonDirection();
  }

  public update(dt: number, profile: RendererProfile, reducedMotion: boolean): void {
    // Clamp sky animation delta to 0.05
    const clampedDt = Math.min(dt, 0.05);

    if (!reducedMotion) {
      this.starTime += clampedDt;
    }

    const uTime = this.starsMat.uniforms['uTime'];
    if (uTime) {
      uTime.value = this.starTime;
    }

    const uTwinkleEnabled = this.starsMat.uniforms['uTwinkleEnabled'];
    if (uTwinkleEnabled) {
      uTwinkleEnabled.value = reducedMotion ? 0.0 : 1.0;
    }

    this.aurora.update(clampedDt, reducedMotion);
    this.shootingStars.update(clampedDt, profile, reducedMotion);
  }

  private syncProjection(gameplayCamera: THREE.PerspectiveCamera): void {
    this.camera.fov = gameplayCamera.fov;
    this.camera.aspect = gameplayCamera.aspect;
    this.camera.updateProjectionMatrix();
  }

  public render(renderer: THREE.WebGLRenderer, gameplayCamera: THREE.PerspectiveCamera): void {
    this.syncProjection(gameplayCamera);

    gameplayCamera.getWorldQuaternion(this.gameplayWorldQuaternion);

    if (!this.initialOrientationCaptured) {
      this.initialGameplayQuaternion.copy(this.gameplayWorldQuaternion);
      this.inverseInitialGameplayQuaternion
        .copy(this.initialGameplayQuaternion)
        .invert();
      this.initialOrientationCaptured = true;
    }

    this.relativeCameraQuaternion
      .multiplyQuaternions(
        this.inverseInitialGameplayQuaternion,
        this.gameplayWorldQuaternion,
      )
      .normalize();

    this.camera.quaternion.copy(this.relativeCameraQuaternion);
    this.camera.position.set(0, 0, 0);

    renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.skyDome.dispose();
    this.celestialLandmark.dispose();
    this.aurora.dispose();
    this.shootingStars.dispose();
    this.starsGeom.dispose();
    this.starsMat.dispose();
    this.compositionRoot.clear();
    this.scene.clear();
  }
}
