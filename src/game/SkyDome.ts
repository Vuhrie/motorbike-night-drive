import * as THREE from 'three';
import { RendererProfile } from './config';

function clampByte(val: number): number {
  return Math.max(0, Math.min(255, Math.round(val)));
}

export class SkyDome {
  public readonly mesh: THREE.Mesh;
  public get object(): THREE.Object3D {
    return this.mesh;
  }

  public readonly material: THREE.ShaderMaterial & {
    uniforms: {
      uMilkyWay: { value: THREE.DataTexture };
      uResolution: { value: THREE.Vector2 };
      uTime: { value: number };
      [key: string]: THREE.IUniform;
    };
  };
  public get skyDomeMaterial() {
    return this.material;
  }

  public readonly uResolution: THREE.Vector2;

  private geometry: THREE.SphereGeometry;
  private texture: THREE.DataTexture;

  constructor(profile: RendererProfile) {
    const [width, height] = profile.skyDomeResolution;
    this.texture = this.generateSkyTexture(width, height);
    this.uResolution = new THREE.Vector2(1920, 1080);

    this.geometry = new THREE.SphereGeometry(9.5, 32, 24);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMilkyWay: { value: this.texture },
        uResolution: { value: this.uResolution },
        uTime: { value: 0.0 },
      },
      vertexShader: `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position =
      projectionMatrix *
      modelViewMatrix *
      vec4(position, 1.0);
  }
`,
      fragmentShader: `
  uniform sampler2D uMilkyWay;
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 screenUv = clamp(gl_FragCoord.xy / max(uResolution, vec2(1.0)), 0.0, 1.0);
    vec3 skyColor = mix(vec3(0.0060, 0.0120, 0.0300), vec3(0.0015, 0.0035, 0.0110), smoothstep(0.05, 0.95, screenUv.y));

    vec3 textureDetail = texture2D(uMilkyWay, screenUv).rgb;
    float existingGalaxyNoise = clamp(dot(textureDetail, vec3(0.25, 0.35, 0.40)) * 2.0, 0.0, 1.0);

    float centerY = 0.94 - 0.025 * screenUv.x;
    float d = abs(screenUv.y - centerY);
    float core = 1.0 - smoothstep(0.012, 0.030, d);
    float dust = 1.0 - smoothstep(0.030, 0.050, d);
    float along = smoothstep(0.06, 0.15, screenUv.x) * (1.0 - smoothstep(0.85, 0.95, screenUv.x));
    float structure = 0.78 + 0.22 * existingGalaxyNoise;
    skyColor += vec3(0.075, 0.085, 0.235) * core * along * structure;
    skyColor += vec3(0.024, 0.014, 0.062) * dust * along * structure;
    gl_FragColor = vec4(skyColor, 1.0);
    #include <colorspace_fragment>
  }
`,
      side: THREE.BackSide,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.material = material as typeof this.material;

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10000;
    this.mesh.layers.set(0);
  }

  public updateResolution(width: number, height: number): void {
    this.uResolution.set(width, height);
  }

  private generateSkyTexture(width: number, height: number): THREE.DataTexture {
    const data = new Uint8Array(width * height * 4);

    // Plane normal for diagonal Milky Way band
    const rawNx = 0.52;
    const rawNy = 0.68;
    const rawNz = -0.51;
    const nLen = Math.hypot(rawNx, rawNy, rawNz);
    const nx = rawNx / nLen;
    const ny = rawNy / nLen;
    const nz = rawNz / nLen;

    for (let y = 0; y < height; y++) {
      const v = y / (height - 1);
      const phi = (v - 0.5) * Math.PI;
      const cosPhi = Math.cos(phi);
      const py = Math.sin(phi);

      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const theta = u * Math.PI * 2;
        const px = cosPhi * Math.cos(theta);
        const pz = cosPhi * Math.sin(theta);

        const signedDist = px * nx + py * ny + pz * nz;
        const planeDist = Math.abs(signedDist);

        let wideBand = 0;
        let coreBand = 0;
        let cloud = 0;
        let pocket = 0;
        let dustLane = 0;

        if (planeDist < 0.38 && py > -0.05) {
          const elevFade = Math.min(1.0, Math.max(0.0, (py + 0.05) / 0.25));

          const n1 = Math.sin(px * 7.4 + py * 5.8 + pz * 8.1) * 0.5 + 0.5;
          const n2 = Math.sin(px * 15.2 - py * 13.7 + pz * 16.5) * 0.5 + 0.5;
          const n3 = Math.sin(px * 32.1 + py * 29.4 - pz * 31.2) * 0.5 + 0.5;
          cloud = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;

          wideBand = Math.max(0, 1.0 - planeDist / 0.38) * elevFade;
          coreBand = Math.max(0, 1.0 - planeDist / 0.14) * elevFade;

          pocket = Math.max(0, Math.sin(px * 12.0 + py * 16.0 - pz * 10.0)) * coreBand * (0.5 + 0.5 * n2);
          const laneDist = Math.abs(signedDist - 0.035);
          dustLane = Math.max(0, 1.0 - laneDist / 0.045) * (0.5 + 0.5 * n1) * coreBand;
        }

        const offset = (y * width + x) * 4;
        const intensity = Math.max(
          0,
          wideBand * (0.72 + cloud * 0.48) + coreBand * 0.58 + pocket * 0.28 - dustLane * 0.24,
        );
        const warm = pocket * coreBand * 0.24;
        data[offset] = clampByte(intensity * 98 + warm * 95);
        data[offset + 1] = clampByte(intensity * 122 + warm * 62);
        data[offset + 2] = clampByte(intensity * 178 + warm * 32);
        data[offset + 3] = 255;
      }
    }

    const texture = new THREE.DataTexture(
      data,
      width,
      height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    return texture;
  }

  private animTime = 0;

  public update(dt: number, reducedMotion: boolean): void {
    if (!reducedMotion) {
      this.animTime += dt;
    }
    const uTime = this.material.uniforms['uTime'];
    if (uTime) {
      uTime.value = this.animTime;
    }
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
