import * as THREE from 'three';

const AURORA_DEPTH = 8.15;
const AURORA_OPACITY = 0.24;

const NDC_RECTS: readonly [number, number, number, number][] = [
  [-0.78, -0.48, 0.47, 0.87],
  [-0.25, 0.03, 0.43, 0.83],
  [0.28, 0.57, 0.49, 0.89],
];

export class Aurora {
  public readonly mesh: THREE.Mesh;
  public get object(): THREE.Object3D {
    return this.mesh;
  }

  private geom!: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private animTime = 0;

  constructor(skyTanHalfFov = 0.6008, skyAspect = 1.0) {
    this.buildGeometry(skyTanHalfFov, skyAspect);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        uAlpha: { value: AURORA_OPACITY },
        uOpacity: { value: AURORA_OPACITY },
      },
      vertexShader: `
        attribute float aRibbonId;
        uniform float uTime;
        varying vec2 vUv;
        varying float vRibbonId;

        void main() {
          vUv = uv;
          vRibbonId = aRibbonId;

          vec3 pos = position;
          // Smooth harmonic curtain wave undulation
          float undulation = sin(uv.x * 5.8 + aRibbonId * 1.9 + uTime * 0.38) * 0.18
                           + sin(uv.x * 11.2 - uTime * 0.24) * 0.09;
          pos.z += undulation;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uAlpha;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vRibbonId;

        void main() {
          // Colors approximately 0x19dca0, 0x24bfe6, 0x8162dc
          vec3 greenTeal = vec3(0.098, 0.863, 0.627);   // ~0x19dca0
          vec3 cyanBlue = vec3(0.141, 0.749, 0.902);    // ~0x24bfe6
          vec3 blueViolet = vec3(0.506, 0.384, 0.863);  // ~0x8162dc

          vec3 col;
          if (vRibbonId < 0.5) {
            // Ribbon 0 (left): saturated green-teal
            col = mix(greenTeal, vec3(0.10, 0.90, 0.68), smoothstep(0.15, 0.85, vUv.y));
          } else if (vRibbonId < 1.5) {
            // Ribbon 1 (center): saturated cyan-blue
            col = mix(cyanBlue, vec3(0.18, 0.82, 0.96), smoothstep(0.15, 0.85, vUv.y));
          } else {
            // Ribbon 2 (right): saturated blue-violet
            col = mix(blueViolet, vec3(0.56, 0.44, 0.95), smoothstep(0.15, 0.85, vUv.y));
          }

          float vAlong = vUv.x;
          float vAcross = vUv.y;

          // Distinct vertical ray folds / drapery striations
          float fold1 = sin(vAlong * 30.0 + vAcross * 3.8 + uTime * 0.42 + vRibbonId * 1.9);
          float fold2 = sin(vAlong * 62.0 - uTime * 0.28);
          float drapery = 0.68 + 0.32 * (fold1 * 0.68 + fold2 * 0.32);
          float existingAuroraAlpha = drapery;

          float edgeX = smoothstep(0.00, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.00, vUv.x));
          float bottomFade = smoothstep(0.00, 0.10, vUv.y);
          float topFade = 1.0 - smoothstep(0.76, 1.00, vUv.y);
          float curtain = smoothstep(0.14, 0.55, existingAuroraAlpha);
          float alpha = curtain * edgeX * bottomFade * topFade * uOpacity;
          alpha = min(alpha, 0.24);

          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.material.forceSinglePass = true;
    this.material.visible = true;

    this.mesh = new THREE.Mesh(this.geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.layers.set(0);
  }

  public rebuildGeometry(skyTanHalfFov: number, skyAspect: number): void {
    this.buildGeometry(skyTanHalfFov, skyAspect);
  }

  private buildGeometry(skyTanHalfFov: number, skyAspect: number): void {
    const depth = AURORA_DEPTH;
    const yScale = depth * skyTanHalfFov;
    const xScale = yScale * skyAspect;

    const segmentsPerRibbon = 28;
    const vertsPerRibbon = (segmentsPerRibbon + 1) * 2;
    const trisPerRibbon = segmentsPerRibbon * 2;
    const indicesPerRibbon = trisPerRibbon * 3;

    const totalRibbons = NDC_RECTS.length;
    const totalVerts = totalRibbons * vertsPerRibbon;
    const totalIndices = totalRibbons * indicesPerRibbon;

    const existingPos = this.geom?.getAttribute('position') as THREE.BufferAttribute | undefined;
    const positions = existingPos ? (existingPos.array as Float32Array) : new Float32Array(totalVerts * 3);
    const uvs = existingPos ? (this.geom.getAttribute('uv').array as Float32Array) : new Float32Array(totalVerts * 2);
    const ribbonIds = existingPos ? (this.geom.getAttribute('aRibbonId').array as Float32Array) : new Float32Array(totalVerts);
    const indices = existingPos ? (this.geom.getIndex()!.array as Uint16Array) : new Uint16Array(totalIndices);

    let vOffset = 0;
    let iOffset = 0;

    for (let ribbonIndex = 0; ribbonIndex < totalRibbons; ribbonIndex++) {
      const ribVStart = vOffset;
      const [xMin, xMax, bottom, top] = NDC_RECTS[ribbonIndex]!;

      for (let s = 0; s <= segmentsPerRibbon; s++) {
        const u = s / segmentsPerRibbon;
        const ndcX = xMin + (xMax - xMin) * u;

        // Bottom vertex (v = 0.0)
        const bIdx = (vOffset + s * 2) * 3;
        positions[bIdx + 0] = ndcX * xScale;
        positions[bIdx + 1] = bottom * yScale;
        positions[bIdx + 2] = -depth;

        uvs[(vOffset + s * 2) * 2 + 0] = u;
        uvs[(vOffset + s * 2) * 2 + 1] = 0.0;
        ribbonIds[vOffset + s * 2] = ribbonIndex;

        // Top vertex (v = 1.0)
        const tIdx = (vOffset + s * 2 + 1) * 3;
        positions[tIdx + 0] = ndcX * xScale;
        positions[tIdx + 1] = top * yScale;
        positions[tIdx + 2] = -depth;

        uvs[(vOffset + s * 2 + 1) * 2 + 0] = u;
        uvs[(vOffset + s * 2 + 1) * 2 + 1] = 1.0;
        ribbonIds[vOffset + s * 2 + 1] = ribbonIndex;
      }

      if (!existingPos) {
        for (let s = 0; s < segmentsPerRibbon; s++) {
          const i0 = ribVStart + s * 2;
          const i1 = i0 + 1;
          const i2 = ribVStart + (s + 1) * 2;
          const i3 = i2 + 1;

          const outI = iOffset + s * 6;
          indices[outI + 0] = i0;
          indices[outI + 1] = i2;
          indices[outI + 2] = i1;
          indices[outI + 3] = i1;
          indices[outI + 4] = i2;
          indices[outI + 5] = i3;
        }
      }

      vOffset += vertsPerRibbon;
      iOffset += indicesPerRibbon;
    }

    if (!existingPos) {
      this.geom = new THREE.BufferGeometry();
      this.geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      this.geom.setAttribute('aRibbonId', new THREE.BufferAttribute(ribbonIds, 1));
      this.geom.setIndex(new THREE.BufferAttribute(indices, 1));
      this.geom.setDrawRange(0, indices.length);
    } else {
      existingPos.needsUpdate = true;
    }
  }

  public update(dt: number, reducedMotion: boolean): void {
    if (reducedMotion) {
      // Reduced motion: aurora remains static
      return;
    }
    this.animTime += dt;
    const uTime = this.material.uniforms['uTime'];
    if (uTime) {
      uTime.value = this.animTime;
    }
  }

  public dispose(): void {
    this.geom.dispose();
    this.material.dispose();
  }
}
