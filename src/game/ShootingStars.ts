import * as THREE from 'three';
import { RendererProfile } from './config';

interface StarTrail {
  active: boolean;
  progress: number;
  duration: number;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  posAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
  line: THREE.Line;
}

export class ShootingStars {
  public readonly group: THREE.Group;

  private pool: StarTrail[];
  private accumulatedTimer = 0;
  private nextSpawnDelay = 5.0;
  private rngState = 1234567;

  constructor() {
    this.group = new THREE.Group();
    this.pool = [];

    // Fixed pool of 3 point-trail objects, pre-allocated
    for (let i = 0; i < 3; i++) {
      const positions = new Float32Array(6); // 2 points: tail (0), head (1)
      const colors = new Float32Array(6);

      const geometry = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(positions, 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', posAttr);

      const colAttr = new THREE.BufferAttribute(colors, 3);
      colAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('color', colAttr);

      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        fog: false,
      });

      const line = new THREE.Line(geometry, material);
      line.visible = false;
      line.frustumCulled = false;
      line.renderOrder = 25;
      line.layers.set(0);
      this.group.add(line);

      this.pool.push({
        active: false,
        progress: 0,
        duration: 0.6,
        startPos: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        posAttr,
        colAttr,
        geometry,
        material,
        line,
      });
    }
  }

  private nextRand(): number {
    // Fast pseudo-random LCG for deterministic no-allocation updates
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  public update(dt: number, profile: RendererProfile, reducedMotion: boolean): void {
    if (reducedMotion) {
      // Reduced motion: shooting stars disabled and hidden
      for (const star of this.pool) {
        if (star.active || star.line.visible) {
          star.active = false;
          star.line.visible = false;
        }
      }
      this.accumulatedTimer = 0;
      return;
    }

    const maxActive = profile.id === 'desktop' ? 2 : 1;

    // 1. Update active stars
    let activeCount = 0;
    for (const star of this.pool) {
      if (!star.active) continue;

      star.progress += dt / star.duration;

      if (star.progress >= 1.0) {
        star.active = false;
        star.line.visible = false;
        continue;
      }

      activeCount++;

      // Head leads, tail follows with lag
      const headP = Math.min(1.0, star.progress);
      const tailP = Math.max(0.0, star.progress - 0.22);

      const hx = star.startPos.x + (star.endPos.x - star.startPos.x) * headP;
      const hy = star.startPos.y + (star.endPos.y - star.startPos.y) * headP;
      const hz = star.startPos.z + (star.endPos.z - star.startPos.z) * headP;

      const tx = star.startPos.x + (star.endPos.x - star.startPos.x) * tailP;
      const ty = star.startPos.y + (star.endPos.y - star.startPos.y) * tailP;
      const tz = star.startPos.z + (star.endPos.z - star.startPos.z) * tailP;

      star.posAttr.setXYZ(0, tx, ty, tz);
      star.posAttr.setXYZ(1, hx, hy, hz);
      star.posAttr.needsUpdate = true;

      // Bell fade curve
      const fade = Math.sin(star.progress * Math.PI);
      star.colAttr.setXYZ(0, 0.35 * fade, 0.55 * fade, 0.95 * fade);
      star.colAttr.setXYZ(1, 1.0 * fade, 1.0 * fade, 1.0 * fade);
      star.colAttr.needsUpdate = true;

      star.line.visible = true;
    }

    // 2. Accumulate timer to trigger rare diagonal events
    this.accumulatedTimer += dt;
    if (this.accumulatedTimer >= this.nextSpawnDelay) {
      this.accumulatedTimer = 0;
      this.nextSpawnDelay = 4.5 + this.nextRand() * 6.5;

      if (activeCount < maxActive) {
        this.spawnOne();
      }
    }
  }

  private spawnOne(): void {
    let inactiveStar: StarTrail | null = null;
    for (const star of this.pool) {
      if (!star.active) {
        inactiveStar = star;
        break;
      }
    }
    if (!inactiveStar) return;

    // Pick random upper hemisphere start point
    const r = 8.4;
    const az = (this.nextRand() - 0.5) * (Math.PI * 1.6);
    const el = 0.35 + this.nextRand() * 0.45;

    const cosEl = Math.cos(el);
    const sx = Math.sin(az) * cosEl * r;
    const sy = Math.sin(el) * r;
    const sz = -Math.cos(az) * cosEl * r;
    inactiveStar.startPos.set(sx, sy, sz);

    // Diagonal streak trajectory
    const streakLength = 1.4 + this.nextRand() * 0.9;
    const diagonalSign = this.nextRand() < 0.5 ? -1 : 1;
    const dx = diagonalSign * streakLength * 0.7;
    const dy = -streakLength * 0.45;
    const dz = (this.nextRand() - 0.5) * streakLength * 0.5;

    inactiveStar.endPos.set(sx + dx, sy + dy, sz + dz);
    // Project endPos onto sphere
    inactiveStar.endPos.normalize().multiplyScalar(r);

    inactiveStar.progress = 0;
    inactiveStar.duration = 0.48 + this.nextRand() * 0.24;
    inactiveStar.active = true;

    // Initial degenerate placement before first step
    inactiveStar.posAttr.setXYZ(0, sx, sy, sz);
    inactiveStar.posAttr.setXYZ(1, sx, sy, sz);
    inactiveStar.posAttr.needsUpdate = true;
    inactiveStar.colAttr.setXYZ(0, 0, 0, 0);
    inactiveStar.colAttr.setXYZ(1, 0, 0, 0);
    inactiveStar.colAttr.needsUpdate = true;
    inactiveStar.line.visible = true;
  }

  public dispose(): void {
    for (const item of this.pool) {
      item.geometry.dispose();
      item.material.dispose();
    }
  }
}
