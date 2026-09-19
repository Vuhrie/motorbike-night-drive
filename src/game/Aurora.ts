import * as THREE from 'three';
import { setSkyPosition } from './math';

export class Aurora {
  public readonly mesh: THREE.Mesh;
  public get object(): THREE.Object3D {
    return this.mesh;
  }

  private geom: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private animTime = 0;

  constructor() {
    const starts = [-26, -14, -2];
    const ends = [2, 16, 30];
    const radii = [7.9, 8.2, 7.6];

    const segmentsPerRibbon = 28;
    const vertsPerRibbon = (segmentsPerRibbon + 1) * 2;
    const trisPerRibbon = segmentsPerRibbon * 2;
    const indicesPerRibbon = trisPerRibbon * 3;

    const totalRibbons = starts.length;
    const totalVerts = totalRibbons * vertsPerRibbon;
    const totalIndices = totalRibbons * indicesPerRibbon;

    const positions = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const ribbonIds = new Float32Array(totalVerts);
    const indices = new Uint16Array(totalIndices);

    const posVec = { x: 0, y: 0, z: 0 };
    let vOffset = 0;
    let iOffset = 0;

    for (let ribbonIndex = 0; ribbonIndex < totalRibbons; ribbonIndex++) {
      const ribVStart = vOffset;
      const startDeg = starts[ribbonIndex]!;
      const endDeg = ends[ribbonIndex]!;
      const radius = radii[ribbonIndex]!;

      for (let s = 0; s <= segmentsPerRibbon; s++) {
        const u = s / segmentsPerRibbon;
        const azDeg = startDeg + (endDeg - startDeg) * u;
        const az = (azDeg * Math.PI) / 180;

        const wave = Math.sin(u * Math.PI * 2.0);
        const centerElevation = 22 + ribbonIndex * 2.5 + wave * 0.55;
        const lowerElevation = centerElevation - 7;
        const upperElevation = centerElevation + 8;
        const elBottom = (lowerElevation * Math.PI) / 180;
        const elTop = (upperElevation * Math.PI) / 180;

        // Bottom vertex (-Z spherical direction)
        setSkyPosition(posVec, az, elBottom, radius);
        const bIdx = (vOffset + s * 2) * 3;
        positions[bIdx + 0] = posVec.x;
        positions[bIdx + 1] = posVec.y;
        positions[bIdx + 2] = posVec.z;

        uvs[(vOffset + s * 2) * 2 + 0] = u;
        uvs[(vOffset + s * 2) * 2 + 1] = 0.0;
        ribbonIds[vOffset + s * 2] = ribbonIndex;

        // Top vertex (-Z spherical direction)
        setSkyPosition(posVec, az, elTop, radius);
        const tIdx = (vOffset + s * 2 + 1) * 3;
        positions[tIdx + 0] = posVec.x;
        positions[tIdx + 1] = posVec.y;
        positions[tIdx + 2] = posVec.z;

        uvs[(vOffset + s * 2 + 1) * 2 + 0] = u;
        uvs[(vOffset + s * 2 + 1) * 2 + 1] = 1.0;
        ribbonIds[vOffset + s * 2 + 1] = ribbonIndex;
      }

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

      vOffset += vertsPerRibbon;
      iOffset += indicesPerRibbon;
    }

    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geom.setAttribute('aRibbonId', new THREE.BufferAttribute(ribbonIds, 1));
    this.geom.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geom.setDrawRange(0, indices.length);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        opacity: { value: 0.38 },
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
          // Slow harmonic curtain undulation
          float undulation = sin(uv.x * 6.2 + aRibbonId * 1.7 + uTime * 0.35) * 0.16
                           + sin(uv.x * 12.5 - uTime * 0.22) * 0.08;
          pos += normalize(position) * undulation;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float opacity;
        varying vec2 vUv;
        varying float vRibbonId;

        void main() {
          vec3 teal = vec3(0.10, 0.62, 0.52);
          vec3 cyan = vec3(0.14, 0.55, 0.74);
          vec3 violet = vec3(0.36, 0.28, 0.58);

          vec3 col;
          if (vUv.y < 0.4) {
            float t = vUv.y / 0.4;
            col = mix(teal, cyan, t);
          } else {
            float t = (vUv.y - 0.4) / 0.6;
            col = mix(cyan, violet, t);
          }
          col *= 1.15;

          float vAlong = vUv.x;
          float vAcross = vUv.y;
          float verticalFade = smoothstep(0.0, 0.18, vAcross) * (1.0 - smoothstep(0.74, 1.0, vAcross));
          float endFade = smoothstep(0.0, 0.12, vAlong) * (1.0 - smoothstep(0.86, 1.0, vAlong));
          float fold = 0.72 + 0.28 * sin(vUv.x * 26.0 + vUv.y * 3.0 + uTime * 0.4 + vRibbonId * 1.8);

          float alpha = verticalFade * endFade * fold * opacity;

          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: true,
    });
    this.material.forceSinglePass = true;
    this.material.visible = true;

    this.mesh = new THREE.Mesh(this.geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.layers.set(0);
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
