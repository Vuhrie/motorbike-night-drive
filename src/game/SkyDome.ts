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

  private geometry: THREE.SphereGeometry;
  private material: THREE.ShaderMaterial;
  private texture: THREE.DataTexture;

  constructor(profile: RendererProfile) {
    const [width, height] = profile.skyDomeResolution;
    this.texture = this.generateSkyTexture(width, height);

    this.geometry = new THREE.SphereGeometry(9.5, 32, 24);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMilkyWay: { value: this.texture },
      },
      vertexShader: `
  varying vec2 vUv;
  varying vec3 vDirection;

  void main() {
    vUv = uv;
    vDirection = normalize(position);

    gl_Position =
      projectionMatrix *
      modelViewMatrix *
      vec4(position, 1.0);
  }
`,
      fragmentShader: `
  uniform sampler2D uMilkyWay;

  varying vec2 vUv;
  varying vec3 vDirection;

  void main() {
    vec3 direction = normalize(vDirection);

    float horizonDistance = abs(direction.y);
    float horizonGlow = pow(max(0.0, 1.0 - horizonDistance), 1.65);

    vec3 zenith = vec3(0.018, 0.045, 0.085);
    vec3 horizon = vec3(0.095, 0.195, 0.335);

    vec3 color = mix(zenith, horizon, horizonGlow * 0.82);

    float bandCoordinate = (direction.y - 0.34 - direction.x * 0.44) * 0.915315;
    float bandDistance = abs(bandCoordinate);
    float milkyCore = 1.0 - smoothstep(0.050, 0.125, bandDistance);
    float milkyHaze = 1.0 - smoothstep(0.115, 0.260, bandDistance);
    float forwardMask = smoothstep(-0.30, 0.16, -direction.z);
    float milkyWayMask = (milkyHaze * 0.36 + milkyCore * 0.64) * forwardMask;

    vec3 textureDetail = texture2D(uMilkyWay, vUv).rgb;
    float milkyNoise = dot(textureDetail, vec3(0.25, 0.35, 0.40)) * 2.0;
    float milkyDetail = mix(0.65, 1.0, clamp(milkyNoise, 0.0, 1.0));
    float milkyWay = milkyWayMask * milkyDetail;

    vec3 galaxyColor = vec3(0.20, 0.255, 0.39) + vec3(0.105, 0.080, 0.155);

    float dustCoordinate = bandCoordinate - 0.020;
    float dustLane = exp(-(dustCoordinate * dustCoordinate) / 0.00060);
    galaxyColor *= 1.0 - dustLane * 0.22;

    color += galaxyColor * (milkyWay * 0.22);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`,
      side: THREE.BackSide,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.layers.set(0);
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

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
