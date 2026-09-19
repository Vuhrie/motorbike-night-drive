import * as THREE from 'three';
import { RendererProfile } from './config';
import { setSkyPosition } from './math';

// Preallocated ribbon cross-sections and color definitions (zero per-frame allocations)
const FIRST_METEOR_DELAY = 0.20;
const FIRST_METEOR_DURATION = 4.5;
const FIRST_START_X = -0.50;
const FIRST_START_Y = 0.88;
const FIRST_END_X = 0.46;
const FIRST_END_Y = 0.82;
const FIRST_HALF_WIDTH_NDC = 0.014;
const FIRST_METEOR_SEGMENTS = 32;

const TRAIL_LENGTH = 0.38;

const SECTIONS_T = new Float32Array([0.0, 0.38, 0.82, 1.0]);
const HALF_WIDTHS = new Float32Array([0.040, 0.068, 0.102, 0.115]);
const BASE_COLOR_R = new Float32Array([0.30, 0.36, 0.72, 1.25]);
const BASE_COLOR_G = new Float32Array([0.12, 0.42, 1.15, 1.60]);
const BASE_COLOR_B = new Float32Array([0.80, 1.15, 1.55, 1.75]);

interface StarTrail {
  active: boolean;
  age: number;
  progress: number;
  duration: number;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  posAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  mesh: THREE.Mesh;
}

export class ShootingStars {
  public readonly group: THREE.Group;

  private firstMeteor: {
    spawned: boolean;
    active: boolean;
    delay: number;
    age: number;
    duration: number;
    mesh: THREE.Mesh;
    material: THREE.ShaderMaterial;
    geometry: THREE.BufferGeometry;
  };

  public get firstMeteorMesh(): THREE.Mesh {
    return this.firstMeteor.mesh;
  }

  private pool: StarTrail[];
  private accumulatedTimer = 0;
  private nextSpawnDelay = 3.6;
  private rngState = 7654321;

  constructor(_tanHalfFov = 0.6008, _aspect = 1.0) {
    this.group = new THREE.Group();
    this.group.layers.set(0);
    this.pool = [];

    // 1. Slot 0: Deterministic first meteor with pooled fixed 32-segment ribbon in clip/NDC space
    {
      const totalVerts = (FIRST_METEOR_SEGMENTS + 1) * 2;
      const positions = new Float32Array(totalVerts * 3);
      const uvs = new Float32Array(totalVerts * 2);
      const indices = new Uint16Array(FIRST_METEOR_SEGMENTS * 6);

      const dx = FIRST_END_X - FIRST_START_X;
      const dy = FIRST_END_Y - FIRST_START_Y;
      const len = Math.hypot(dx, dy) || 1.0;
      const nx = -dy / len;
      const ny = dx / len;

      for (let s = 0; s <= FIRST_METEOR_SEGMENTS; s++) {
        const t = s / FIRST_METEOR_SEGMENTS;
        const px = FIRST_START_X + dx * t;
        const py = FIRST_START_Y + dy * t;

        const vLeft = s * 2;
        const vRight = vLeft + 1;

        positions[vLeft * 3 + 0] = px - nx * FIRST_HALF_WIDTH_NDC;
        positions[vLeft * 3 + 1] = py - ny * FIRST_HALF_WIDTH_NDC;
        positions[vLeft * 3 + 2] = 0.0;
        uvs[vLeft * 2 + 0] = t;
        uvs[vLeft * 2 + 1] = 0.0;

        positions[vRight * 3 + 0] = px + nx * FIRST_HALF_WIDTH_NDC;
        positions[vRight * 3 + 1] = py + ny * FIRST_HALF_WIDTH_NDC;
        positions[vRight * 3 + 2] = 0.0;
        uvs[vRight * 2 + 0] = t;
        uvs[vRight * 2 + 1] = 1.0;
      }

      for (let s = 0; s < FIRST_METEOR_SEGMENTS; s++) {
        const i0 = s * 2;
        const i1 = i0 + 1;
        const i2 = (s + 1) * 2;
        const i3 = i2 + 1;

        const outIdx = s * 6;
        indices[outIdx + 0] = i0;
        indices[outIdx + 1] = i1;
        indices[outIdx + 2] = i2;
        indices[outIdx + 3] = i1;
        indices[outIdx + 4] = i3;
        indices[outIdx + 5] = i2;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));

      const shaderMaterial = new THREE.ShaderMaterial({
        vertexShader: `
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;

          void main() {
            float along = vUv.x;
            float across = abs(vUv.y * 2.0 - 1.0);
            float crossFade = 1.0 - smoothstep(0.45, 1.0, across);
            float endFade = smoothstep(0.0, 0.06, along) * (1.0 - smoothstep(0.92, 1.0, along));
            vec3 color = mix(vec3(0.12, 0.62, 1.0), vec3(0.96, 0.99, 1.0), smoothstep(0.58, 0.96, along));
            float alpha = crossFade * endFade * 0.92;
            gl_FragColor = vec4(color, alpha);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      shaderMaterial.forceSinglePass = true;

      const mesh = new THREE.Mesh(geometry, shaderMaterial);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 10000;
      mesh.layers.set(0);

      this.firstMeteor = {
        spawned: false,
        active: false,
        delay: FIRST_METEOR_DELAY,
        age: 0,
        duration: FIRST_METEOR_DURATION,
        mesh,
        material: shaderMaterial,
        geometry,
      };
    }

    // 2. Pre-allocated pool of ribbon-trail meshes for subsequent random meteors
    for (let i = 0; i < 2; i++) {
      const positions = new Float32Array(8 * 3);
      const colors = new Float32Array(8 * 3);
      const uvs = new Float32Array(8 * 2);
      const indices = new Uint16Array(18);

      for (let s = 0; s < 3; s++) {
        const i0 = s * 2;
        const i1 = i0 + 1;
        const i2 = (s + 1) * 2;
        const i3 = i2 + 1;

        const outIdx = s * 6;
        indices[outIdx + 0] = i0;
        indices[outIdx + 1] = i1;
        indices[outIdx + 2] = i2;
        indices[outIdx + 3] = i1;
        indices[outIdx + 4] = i3;
        indices[outIdx + 5] = i2;
      }

      for (let s = 0; s < 4; s++) {
        const u = s / 3;
        uvs[s * 4 + 0] = u;
        uvs[s * 4 + 1] = 0;
        uvs[s * 4 + 2] = u;
        uvs[s * 4 + 3] = 1;
      }

      const geometry = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(positions, 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', posAttr);

      const colAttr = new THREE.BufferAttribute(colors, 3);
      colAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('color', colAttr);

      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));

      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      });
      material.forceSinglePass = true;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 40;
      mesh.layers.set(0);
      this.group.add(mesh);

      this.pool.push({
        active: false,
        age: 0,
        progress: 0,
        duration: 0.9,
        startPos: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        posAttr,
        colAttr,
        geometry,
        material,
        mesh,
      });
    }
  }

  private nextRand(): number {
    // Fast pseudo-random LCG for deterministic allocation-free updates
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  public update(dt: number, profile: RendererProfile, reducedMotion: boolean): void {
    if (reducedMotion) {
      // Reduced motion: shooting stars disabled and hidden before activation
      this.firstMeteor.active = false;
      this.firstMeteor.mesh.visible = false;
      this.firstMeteor.delay = FIRST_METEOR_DELAY;

      for (let i = 0; i < this.pool.length; i++) {
        const star = this.pool[i]!;
        if (star.active || star.mesh.visible) {
          star.active = false;
          star.mesh.visible = false;
        }
      }
      this.accumulatedTimer = 0;
      return;
    }

    // Handle first slot separately from the generic recycler
    const firstMeteor = this.firstMeteor;
    if (!firstMeteor.spawned) {
      firstMeteor.delay -= dt;
      if (firstMeteor.delay <= 0) {
        firstMeteor.spawned = true;
        firstMeteor.active = true;
        firstMeteor.age = 0;
        firstMeteor.mesh.visible = true;
      }
    } else if (firstMeteor.active) {
      firstMeteor.age += dt;
      firstMeteor.mesh.visible = true;
      if (firstMeteor.age >= FIRST_METEOR_DURATION) {
        firstMeteor.active = false;
        firstMeteor.mesh.visible = false;
      }
    }

    const maxActive = profile.id === 'desktop' ? 2 : 1;

    // 1. Update active stars in random pool
    let activeCount = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const star = this.pool[i]!;
      if (!star.active) continue;

      star.age += dt;
      star.progress = Math.min(star.age / star.duration, 1.0);

      if (star.progress >= 1.0) {
        star.active = false;
        star.mesh.visible = false;
        continue;
      }

      activeCount++;

      // Smooth continuous meteor streak across upper sky
      const trailLength = TRAIL_LENGTH;
      const headP = Math.min(1.0, star.progress * (1.0 + trailLength));
      const tailP = Math.max(0.0, star.progress * (1.0 + trailLength) - trailLength);

      // Streak start & end points
      const sx = star.startPos.x;
      const sy = star.startPos.y;
      const sz = star.startPos.z;

      const ex = star.endPos.x;
      const ey = star.endPos.y;
      const ez = star.endPos.z;

      const hx = sx + (ex - sx) * headP;
      const hy = sy + (ey - sy) * headP;
      const hz = sz + (ez - sz) * headP;

      const tx = sx + (ex - sx) * tailP;
      const ty = sy + (ey - sy) * tailP;
      const tz = sz + (ez - sz) * tailP;

      // Streak direction
      const dx = hx - tx;
      const dy = hy - ty;
      const dz = hz - tz;
      const dLen = Math.hypot(dx, dy, dz) || 0.001;
      const nx = dx / dLen;
      const ny = dy / dLen;
      const nz = dz / dLen;

      // View vector from head toward origin (0, 0, 0)
      const vLen = Math.hypot(hx, hy, hz) || 1;
      const vx = -hx / vLen;
      const vy = -hy / vLen;
      const vz = -hz / vLen;

      // Cross product (dir x view) to find ribbon billboard width vector
      const cx = ny * vz - nz * vy;
      const cy = nz * vx - nx * vz;
      const cz = nx * vy - ny * vx;
      const cLen = Math.hypot(cx, cy, cz) || 1;
      const ux = cx / cLen;
      const uy = cy / cLen;
      const uz = cz / cLen;

      // Long-lived alpha fade in 0.025 and fade out at 0.90
      const fadeIn = THREE.MathUtils.smoothstep(star.progress, 0.0, 0.025);
      const fadeOut = 1.0 - THREE.MathUtils.smoothstep(star.progress, 0.90, 1.0);
      const fade = fadeIn * fadeOut;

      const posArr = star.posAttr.array as Float32Array;
      const colArr = star.colAttr.array as Float32Array;

      // Compute 4 ribbon cross-sections without per-frame allocations
      for (let s = 0; s < 4; s++) {
        const st = SECTIONS_T[s]!;
        const px = tx + (hx - tx) * st;
        const py = ty + (hy - ty) * st;
        const pz = tz + (hz - tz) * st;
        const hw = HALF_WIDTHS[s]!;

        const vLeft = s * 2;
        const vRight = vLeft + 1;

        // Left vertex
        posArr[vLeft * 3 + 0] = px - ux * hw;
        posArr[vLeft * 3 + 1] = py - uy * hw;
        posArr[vLeft * 3 + 2] = pz - uz * hw;

        // Right vertex
        posArr[vRight * 3 + 0] = px + ux * hw;
        posArr[vRight * 3 + 1] = py + uy * hw;
        posArr[vRight * 3 + 2] = pz + uz * hw;

        const cr = BASE_COLOR_R[s]! * fade;
        const cg = BASE_COLOR_G[s]! * fade;
        const cb = BASE_COLOR_B[s]! * fade;

        colArr[vLeft * 3 + 0] = cr;
        colArr[vLeft * 3 + 1] = cg;
        colArr[vLeft * 3 + 2] = cb;

        colArr[vRight * 3 + 0] = cr;
        colArr[vRight * 3 + 1] = cg;
        colArr[vRight * 3 + 2] = cb;
      }

      star.posAttr.needsUpdate = true;
      star.colAttr.needsUpdate = true;
      star.mesh.visible = true;
    }

    // 2. Accumulate timer to trigger spawns
    this.accumulatedTimer += dt;
    if (this.accumulatedTimer >= this.nextSpawnDelay) {
      this.accumulatedTimer = 0;
      // Later deterministic spawn intervals: 2.8 - 5.2s
      this.nextSpawnDelay = 2.8 + this.nextRand() * 2.4;

      if (activeCount < maxActive) {
        this.spawnOne();
      }
    }
  }

  private spawnOne(): void {
    let inactiveStar: StarTrail | null = null;
    for (let i = 0; i < this.pool.length; i++) {
      const star = this.pool[i]!;
      if (!star.active) {
        inactiveStar = star;
        break;
      }
    }
    if (!inactiveStar) return;

    const r = 8.4;
    // Upper-sky spawn elevation: roughly 40–65 degrees, forward camera view azimuth centered
    const azDeg = (this.nextRand() - 0.5) * 22; // -11° to +11° centered in forward camera view
    const elDeg = 40 + this.nextRand() * 25; // 40° to 65° upper sky
    const az = (azDeg * Math.PI) / 180;
    const el = (elDeg * Math.PI) / 180;

    setSkyPosition(inactiveStar.startPos, az, el, r);

    // Trajectory streaks diagonally downward into upper forward sky (well above mountain horizon at 13°-15°)
    const diagonalSign = this.nextRand() < 0.5 ? -1 : 1;
    const endAzDeg = azDeg + diagonalSign * (14 + this.nextRand() * 12);
    const endElDeg = 17.5 + this.nextRand() * 4.0; // 17.5° to 21.5° (clearly upper forward sky)
    const endAz = (endAzDeg * Math.PI) / 180;
    const endEl = (endElDeg * Math.PI) / 180;

    setSkyPosition(inactiveStar.endPos, endAz, endEl, r);

    inactiveStar.age = 0;
    inactiveStar.progress = 0;
    // Duration roughly 0.95 - 1.20s
    inactiveStar.duration = 0.95 + this.nextRand() * 0.25;
    inactiveStar.active = true;

    // Zero initial arrays
    const posArr = inactiveStar.posAttr.array as Float32Array;
    const colArr = inactiveStar.colAttr.array as Float32Array;
    const sx = inactiveStar.startPos.x;
    const sy = inactiveStar.startPos.y;
    const sz = inactiveStar.startPos.z;
    for (let j = 0; j < 8; j++) {
      posArr[j * 3 + 0] = sx;
      posArr[j * 3 + 1] = sy;
      posArr[j * 3 + 2] = sz;
      colArr[j * 3 + 0] = 0;
      colArr[j * 3 + 1] = 0;
      colArr[j * 3 + 2] = 0;
    }
    inactiveStar.posAttr.needsUpdate = true;
    inactiveStar.colAttr.needsUpdate = true;
    inactiveStar.mesh.visible = true;
  }

  public updateMetrics(_tanHalfFov: number, _aspect: number): void {}

  public dispose(): void {
    if (this.firstMeteor.mesh.parent) {
      this.firstMeteor.mesh.removeFromParent();
    }
    this.firstMeteor.geometry.dispose();
    this.firstMeteor.material.dispose();
    for (let i = 0; i < this.pool.length; i++) {
      const item = this.pool[i]!;
      item.geometry.dispose();
      item.material.dispose();
    }
    this.pool = [];
    this.group.clear();
  }
}
