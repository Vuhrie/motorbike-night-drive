import * as THREE from 'three';
import { setCameraLocalNdcPoint } from './math';

const MOON_NDC_X = 0.57;
const MOON_NDC_Y = 0.70;
const MOON_DEPTH = 8.05;
const MOON_RADIUS = 0.34;
const MOON_VISUAL_SCALE = 0.70;

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

  constructor(skyTanHalfFov = 0.6008, skyAspect = 1.0) {
    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.direction = new THREE.Vector3(0, 0, -1);

    // 1. Low-poly crystalline icy moon
    this.moonGeom = new THREE.IcosahedronGeometry(MOON_RADIUS, 1);
    this.moonMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vNormal = normalMatrix * normal;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vec3 normalDirection = normalize(vNormal);
    vec3 lightDirection = normalize(vec3(-0.35, 0.60, 0.70));
    float diffuse = max(dot(normalDirection, lightDirection), 0.0);
    float rim = pow(1.0 - max(dot(normalDirection, normalize(vViewDir)), 0.0), 2.2);

    vec3 shadowIce = vec3(0.22, 0.36, 0.58);
    vec3 litIce = vec3(0.88, 0.96, 1.25);
    vec3 rimIce = vec3(0.75, 0.95, 1.35);

    vec3 color = mix(shadowIce, litIce, 0.25 + diffuse * 0.75);
    color += rimIce * (rim * 0.45);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.moonMat.forceSinglePass = true;

    this.moonMesh = new THREE.Mesh(this.moonGeom, this.moonMat);
    this.moonMesh.scale.setScalar(MOON_VISUAL_SCALE);
    this.moonMesh.quaternion.identity();
    this.moonMesh.frustumCulled = false;
    this.moonMesh.renderOrder = 25;
    this.moonMesh.layers.set(0);
    this.group.add(this.moonMesh);

    // 2. Framed icy halo with soft corona
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
          float innerCorona = pow(max(0.0, 1.0 - radius), 1.8);
          float outerHalo = smoothstep(1.0, 0.0, radius);
          float alpha = (innerCorona * 0.45 + outerHalo * 0.22) * 0.65;
          vec3 color = vec3(0.40, 0.68, 1.05);
          gl_FragColor = vec4(color, alpha);
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
    this.haloMat.forceSinglePass = true;

    this.haloMesh = new THREE.Mesh(this.haloGeom, this.haloMat);
    this.haloMesh.scale.setScalar(
      MOON_RADIUS * MOON_VISUAL_SCALE * 4.8,
    );
    this.haloMesh.quaternion.identity();
    this.haloMesh.frustumCulled = false;
    this.haloMesh.renderOrder = 26;
    this.haloMesh.layers.set(0);
    this.group.add(this.haloMesh);

    this.updatePlacement(skyTanHalfFov, skyAspect);
  }

  public updatePlacement(skyTanHalfFov: number, skyAspect: number): void {
    setCameraLocalNdcPoint(
      this.moonMesh.position,
      MOON_NDC_X,
      MOON_NDC_Y,
      MOON_DEPTH,
      skyTanHalfFov,
      skyAspect
    );
    this.haloMesh.position.copy(this.moonMesh.position);
    this.haloMesh.quaternion.identity();
    this.direction.copy(this.moonMesh.position).normalize();
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
