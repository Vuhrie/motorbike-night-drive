import * as THREE from 'three';
import { setSkyPosition } from './math';

const MOON_AZIMUTH = THREE.MathUtils.degToRad(28);
const MOON_ELEVATION = THREE.MathUtils.degToRad(27);
const MOON_DISTANCE = 5.2;
const MOON_RADIUS = 0.34;
const MOON_VISUAL_SCALE = 0.62;

export class CelestialLandmark {
  public readonly group: THREE.Group;
  public get object(): THREE.Object3D {
    return this.group;
  }
  public readonly direction: THREE.Vector3;

  private moonMesh: THREE.Mesh;
  private moonGeom: THREE.IcosahedronGeometry;
  private moonMat: THREE.ShaderMaterial;

  private haloMesh: THREE.Mesh;
  private haloGeom: THREE.PlaneGeometry;
  private haloMat: THREE.ShaderMaterial;

  constructor() {
    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);

    // Required moon position: azimuth +28 degrees, elevation +27 degrees, distance 5.2, radius 0.34
    const moonPos = new THREE.Vector3();
    setSkyPosition(moonPos, MOON_AZIMUTH, MOON_ELEVATION, MOON_DISTANCE);
    this.direction = moonPos.clone().normalize();

    // 1. Low-poly icy moon (no ring)
    this.moonGeom = new THREE.IcosahedronGeometry(MOON_RADIUS, 1);
    this.moonMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalMatrix * normal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
  varying vec3 vNormal;

  void main() {
    vec3 normalDirection = normalize(vNormal);
    vec3 lightDirection = normalize(vec3(-0.32, 0.58, 0.75));
    float diffuse = max(dot(normalDirection, lightDirection), 0.0);
    float lighting = 0.28 + diffuse * 0.72;

    vec3 shadowIce = vec3(0.20, 0.31, 0.50);
    vec3 litIce = vec3(0.78, 0.94, 1.20);
    vec3 color = mix(shadowIce, litIce, lighting);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: true,
    });

    const moon = new THREE.Mesh(this.moonGeom, this.moonMat);
    moon.scale.setScalar(MOON_VISUAL_SCALE);
    moon.position.copy(moonPos);
    moon.frustumCulled = false;
    moon.renderOrder = 30;
    moon.layers.set(0);
    this.moonMesh = moon;
    this.group.add(this.moonMesh);

    // 2. Subtle halo (billboard facing origin, no ring)
    this.haloGeom = new THREE.PlaneGeometry(1, 1);
    this.haloMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          float radius = length(vUv - vec2(0.5)) * 2.0;
          if (radius > 1.0) discard;
          float alpha = 1.0 - smoothstep(0.08, 1.0, radius);
          alpha = alpha * alpha * 0.12;
          vec3 color = vec3(0.34, 0.54, 0.88);
          gl_FragColor = vec4(color, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: true,
    });

    const halo = new THREE.Mesh(this.haloGeom, this.haloMat);
    halo.scale.setScalar(
      MOON_RADIUS * MOON_VISUAL_SCALE * 4.0,
    );
    halo.position.copy(moonPos);
    halo.lookAt(0, 0, 0);
    halo.frustumCulled = false;
    halo.renderOrder = 30;
    halo.layers.set(0);
    this.haloMesh = halo;
    this.group.add(this.haloMesh);
  }

  public getMoonDirection(): THREE.Vector3 {
    return this.direction.clone();
  }

  public dispose(): void {
    this.moonGeom.dispose();
    this.moonMat.dispose();
    this.haloGeom.dispose();
    this.haloMat.dispose();
  }
}
