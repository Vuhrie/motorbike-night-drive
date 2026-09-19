import * as THREE from 'three';
import {
  ASPHALT_Y,
  DESKTOP_PROFILE,
  ROAD_HALF_WIDTH,
  SHOULDER_WIDTH,
  RendererProfile,
  RoadPose,
} from './config';
import { RoadPath } from './RoadPath';

const POLE_HEIGHT = 5.4;
const BULB_HEIGHT = 5.45;
const LIGHT_HEIGHT = 3.8;
const LATERAL_OFFSET = ROAD_HALF_WIDTH + SHOULDER_WIDTH + 1.75;
const WARM_LIGHT_COLOR = 0xffc38a;

const DESKTOP_STATIONS = 12;
const MOBILE_STATIONS = 8;
const DESKTOP_SPACING = 68;
const MOBILE_SPACING = 84;
const DESKTOP_OFFSETS = [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
const MOBILE_OFFSETS = [-3, -2, -1, 0, 1, 2, 3, 4];
const DESKTOP_LIGHT_OFFSETS = [-1, 0, 1, 2];
const MOBILE_LIGHT_OFFSETS = [0, 1];

// Preallocated objects to avoid allocations in hot loop
const dummyMatrix = new THREE.Matrix4();
const dummyPosition = new THREE.Vector3();
const dummyQuaternion = new THREE.Quaternion();
const dummyScale = new THREE.Vector3(1, 1, 1);
const reusablePose: RoadPose = {
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

export class RoadLighting {
  public readonly group: THREE.Group;

  private poleMesh!: THREE.InstancedMesh;
  private bulbMesh!: THREE.InstancedMesh;
  private poleGeom: THREE.CylinderGeometry;
  private poleMat: THREE.MeshLambertMaterial;
  private bulbGeom: THREE.SphereGeometry;
  private bulbMat: THREE.MeshBasicMaterial;

  private lights: THREE.PointLight[] = [];

  private lastAnchorIndex = -9999999;
  private currentProfileId: 'desktop' | 'mobile' = 'desktop';

  constructor(profile: RendererProfile = DESKTOP_PROFILE) {
    this.group = new THREE.Group();
    this.group.layers.set(0);

    // 1. Pole: 6-sided dark cylinder, height 5.4m, translated by half height
    this.poleGeom = new THREE.CylinderGeometry(0.1, 0.14, POLE_HEIGHT, 6);
    this.poleGeom.translate(0, POLE_HEIGHT * 0.5, 0);
    this.poleMat = new THREE.MeshLambertMaterial({
      color: 0x242d3d,
      flatShading: true,
    });

    // 2. Bulb: emissive glowing sphere, centered at origin (no vertical translation)
    this.bulbGeom = new THREE.SphereGeometry(0.24, 8, 6);
    this.bulbMat = new THREE.MeshBasicMaterial({
      color: WARM_LIGHT_COLOR,
      toneMapped: false,
    });

    this.buildPool(profile);
  }

  public setProfile(profile: RendererProfile): void {
    if (profile.id !== this.currentProfileId) {
      this.buildPool(profile);
    }
  }

  private buildPool(profile: RendererProfile): void {
    if (this.poleMesh) {
      this.group.remove(this.poleMesh);
      this.poleMesh.dispose();
    }
    if (this.bulbMesh) {
      this.group.remove(this.bulbMesh);
      this.bulbMesh.dispose();
    }
    for (const light of this.lights) {
      this.group.remove(light);
      light.dispose();
    }
    this.lights = [];

    this.currentProfileId = profile.id;
    const isDesktop = profile.id === 'desktop';
    const maxLamps = isDesktop ? DESKTOP_STATIONS : MOBILE_STATIONS;
    const lightCount = profile.pointLightCount;
    const initialDistance = isDesktop ? 34 : 30;

    this.poleMesh = new THREE.InstancedMesh(this.poleGeom, this.poleMat, maxLamps);
    this.poleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.poleMesh.frustumCulled = false;
    this.poleMesh.castShadow = false;
    this.poleMesh.receiveShadow = false;
    this.poleMesh.layers.set(0);
    this.group.add(this.poleMesh);

    this.bulbMesh = new THREE.InstancedMesh(this.bulbGeom, this.bulbMat, maxLamps);
    this.bulbMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bulbMesh.frustumCulled = false;
    this.bulbMesh.castShadow = false;
    this.bulbMesh.receiveShadow = false;
    this.bulbMesh.layers.set(0);
    this.group.add(this.bulbMesh);

    for (let i = 0; i < lightCount; i++) {
      const light = new THREE.PointLight(WARM_LIGHT_COLOR, 0, initialDistance, 2);
      light.castShadow = false;
      light.layers.mask = this.group.layers.mask;
      this.lights.push(light);
      this.group.add(light);
    }

    this.lastAnchorIndex = -9999999;
  }

  public update(progress: number, roadPath: RoadPath, profile: RendererProfile): void {
    if (profile.id !== this.currentProfileId) {
      this.buildPool(profile);
    }

    const isDesktop = profile.id === 'desktop';
    const spacing = isDesktop ? DESKTOP_SPACING : MOBILE_SPACING;
    const offsets = isDesktop ? DESKTOP_OFFSETS : MOBILE_OFFSETS;
    const lightOffsets = isDesktop ? DESKTOP_LIGHT_OFFSETS : MOBILE_LIGHT_OFFSETS;
    const intensity = isDesktop ? 2800 : 2200;
    const distance = isDesktop ? 34 : 30;
    const decay = 2;

    const anchorIndex = Math.round(progress / spacing);

    if (anchorIndex === this.lastAnchorIndex) {
      return;
    }
    this.lastAnchorIndex = anchorIndex;

    // Reset root position so local station poses evaluate against the road path directly
    this.group.position.set(0, 0, 0);

    const count = offsets.length;
    for (let i = 0; i < count; i++) {
      const stationIndex = anchorIndex + offsets[i]!;
      const stationS = stationIndex * spacing;
      roadPath.getPose(stationS, reusablePose);

      // Alternate sides by absolute station index: even => right (+), odd => left (-)
      const side = Math.abs(stationIndex) % 2 === 0 ? 1 : -1;
      const lampX = reusablePose.x + reusablePose.rightX * (side * LATERAL_OFFSET);
      const lampZ = reusablePose.z + reusablePose.rightZ * (side * LATERAL_OFFSET);

      // Pole at (lampX, roadY, lampZ)
      dummyPosition.set(lampX, ASPHALT_Y, lampZ);
      dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);
      this.poleMesh.setMatrixAt(i, dummyMatrix);

      // Bulb at (lampX, roadY + 5.45, lampZ)
      dummyPosition.set(lampX, ASPHALT_Y + BULB_HEIGHT, lampZ);
      dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);
      this.bulbMesh.setMatrixAt(i, dummyMatrix);
    }

    this.poleMesh.count = count;
    this.bulbMesh.count = count;
    this.poleMesh.instanceMatrix.needsUpdate = true;
    this.bulbMesh.instanceMatrix.needsUpdate = true;

    // Assign PointLights to configured station offsets
    const lightCount = this.lights.length;
    for (let li = 0; li < lightCount; li++) {
      const light = this.lights[li]!;
      if (li < lightOffsets.length) {
        const stationIndex = anchorIndex + lightOffsets[li]!;
        const stationS = stationIndex * spacing;
        roadPath.getPose(stationS, reusablePose);

        const side = Math.abs(stationIndex) % 2 === 0 ? 1 : -1;
        const lampX = reusablePose.x + reusablePose.rightX * (side * LATERAL_OFFSET);
        const lampZ = reusablePose.z + reusablePose.rightZ * (side * LATERAL_OFFSET);

        // PointLight at (lampX, roadY + LIGHT_HEIGHT, lampZ)
        light.position.set(lampX, ASPHALT_Y + LIGHT_HEIGHT, lampZ);
        light.intensity = intensity;
        light.distance = distance;
        light.decay = decay;
        light.layers.mask = this.group.layers.mask;
      } else {
        light.intensity = 0;
      }
    }
  }

  public rebase(deltaX: number, deltaZ: number): void {
    // Root-based rebase: apply translation only to group.position, keep instance matrices and light positions untouched
    this.group.position.x -= deltaX;
    this.group.position.z -= deltaZ;
  }

  public dispose(): void {
    this.poleGeom.dispose();
    this.poleMat.dispose();
    this.bulbGeom.dispose();
    this.bulbMat.dispose();
    if (this.poleMesh) {
      this.poleMesh.dispose();
    }
    if (this.bulbMesh) {
      this.bulbMesh.dispose();
    }
    for (const light of this.lights) {
      light.dispose();
    }
    this.lights = [];
    this.group.clear();
  }
}
