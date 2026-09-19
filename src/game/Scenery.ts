import * as THREE from 'three';
import {
  PALETTE,
  RendererProfile,
  RoadPose,
} from './config';
import { hash01 } from './rng';
import { RoadPath } from './RoadPath';
import { damp } from './math';

const dummyMatrix = new THREE.Matrix4();
const dummyPosition = new THREE.Vector3();
const dummyQuaternion = new THREE.Quaternion();
const dummyScale = new THREE.Vector3();
const tempPose = {
  s: 0,
  x: 0,
  z: 0,
  heading: 0,
  tangentX: 0,
  tangentZ: -1,
  rightX: 1,
  rightZ: 0,
  curvature: 0,
} as RoadPose;

export class Scenery {
  public readonly group: THREE.Group;

  private treeMesh: THREE.InstancedMesh;
  private rockMesh: THREE.InstancedMesh;
  private reflectorMesh: THREE.InstancedMesh;

  private mountainGroup: THREE.Group;
  private mountainNear: THREE.Mesh;
  private mountainMid: THREE.Mesh;
  private mountainFar: THREE.Mesh;

  private mountainPos = new THREE.Vector3(0, 0, 0);
  private mountainInitialized = false;

  private seed: number;

  constructor(seed: number, maxProfile: RendererProfile) {
    this.seed = seed;
    this.group = new THREE.Group();

    // 1. Low-poly Tree geometry (merged trunk + foliage with vertex colors)
    const trunkGeom = new THREE.CylinderGeometry(0.18, 0.28, 1.8, 5);
    trunkGeom.translate(0, 0.9, 0);
    this.setGeometryColor(trunkGeom, PALETTE.treeTrunk);

    const foliage1 = new THREE.ConeGeometry(1.6, 2.4, 5);
    foliage1.translate(0, 2.2, 0);
    this.setGeometryColor(foliage1, PALETTE.treeFoliage);

    const foliage2 = new THREE.ConeGeometry(1.2, 2.0, 5);
    foliage2.translate(0, 3.4, 0);
    this.setGeometryColor(foliage2, PALETTE.treeFoliageAlt);

    const foliage3 = new THREE.ConeGeometry(0.8, 1.6, 5);
    foliage3.translate(0, 4.4, 0);
    this.setGeometryColor(foliage3, PALETTE.treeFoliage);

    // Merge into single geometry
    const treeGeom = this.mergeGeometries([trunkGeom, foliage1, foliage2, foliage3]);

    const treeMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });
    this.treeMesh = new THREE.InstancedMesh(treeGeom, treeMat, maxProfile.treeCount);
    this.treeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.treeMesh.frustumCulled = false;
    this.group.add(this.treeMesh);

    // 2. Low-poly Rock geometry
    const rockGeom = new THREE.DodecahedronGeometry(1.3, 0);
    const rockMat = new THREE.MeshLambertMaterial({
      color: PALETTE.rock,
      flatShading: true,
    });
    this.rockMesh = new THREE.InstancedMesh(rockGeom, rockMat, maxProfile.rockCount);
    this.rockMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rockMesh.frustumCulled = false;
    this.group.add(this.rockMesh);

    // 3. Reflector Post geometry (slender post with top reflector)
    const stemGeom = new THREE.BoxGeometry(0.08, 0.72, 0.08);
    stemGeom.translate(0, 0.36, 0);
    this.setGeometryColor(stemGeom, PALETTE.reflectorPost);

    const capGeom = new THREE.BoxGeometry(0.1, 0.16, 0.1);
    capGeom.translate(0, 0.8, 0);
    this.setGeometryColor(capGeom, PALETTE.reflectorAmber);

    const postGeom = this.mergeGeometries([stemGeom, capGeom]);
    const reflectorMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
    });
    this.reflectorMesh = new THREE.InstancedMesh(postGeom, reflectorMat, maxProfile.reflectorCount);
    this.reflectorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.reflectorMesh.frustumCulled = false;
    this.group.add(this.reflectorMesh);

    // 4. Mountain bands
    this.mountainGroup = new THREE.Group();
    this.mountainNear = this.createMountainRing(320, 75, 48, PALETTE.mountainNear, 101);
    this.mountainMid = this.createMountainRing(460, 110, 40, PALETTE.mountainMid, 202);
    this.mountainFar = this.createMountainRing(620, 155, 36, PALETTE.mountainFar, 303);

    this.mountainGroup.add(this.mountainFar);
    this.mountainGroup.add(this.mountainMid);
    this.mountainGroup.add(this.mountainNear);
    this.group.add(this.mountainGroup);
  }

  private setGeometryColor(geom: THREE.BufferGeometry, hexColor: number): void {
    const count = geom.getAttribute('position')!.count;
    const colArr = new Float32Array(count * 3);
    const color = new THREE.Color(hexColor);
    for (let i = 0; i < count; i++) {
      colArr[i * 3 + 0] = color.r;
      colArr[i * 3 + 1] = color.g;
      colArr[i * 3 + 2] = color.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  }

  private mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
    let totalVerts = 0;
    let totalIndices = 0;
    let hasColor = false;

    for (const g of geometries) {
      const pos = g.getAttribute('position');
      if (pos) totalVerts += pos.count;
      if (g.index) totalIndices += g.index.count;
      if (g.getAttribute('color')) hasColor = true;
    }

    const mergedPos = new Float32Array(totalVerts * 3);
    const mergedNorm = new Float32Array(totalVerts * 3);
    const mergedCol = hasColor ? new Float32Array(totalVerts * 3) : null;
    const mergedIdx = new Uint16Array(totalIndices);

    let vOffset = 0;
    let iOffset = 0;

    for (const g of geometries) {
      const pos = g.getAttribute('position')!;
      const norm = g.getAttribute('normal');
      const col = g.getAttribute('color');
      const idx = g.index;

      const pArr = pos.array;
      for (let i = 0; i < pos.count * 3; i++) {
        mergedPos[vOffset * 3 + i] = pArr[i] ?? 0;
      }

      if (norm) {
        const nArr = norm.array;
        for (let i = 0; i < norm.count * 3; i++) {
          mergedNorm[vOffset * 3 + i] = nArr[i] ?? 0;
        }
      }

      if (mergedCol) {
        if (col) {
          const cArr = col.array;
          for (let i = 0; i < col.count * 3; i++) {
            mergedCol[vOffset * 3 + i] = cArr[i] ?? 1;
          }
        } else {
          for (let i = 0; i < pos.count * 3; i++) {
            mergedCol[vOffset * 3 + i] = 1;
          }
        }
      }

      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          mergedIdx[iOffset + i] = (idx.getX(i) ?? 0) + vOffset;
        }
        iOffset += idx.count;
      }

      vOffset += pos.count;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(mergedNorm, 3));
    if (mergedCol) {
      merged.setAttribute('color', new THREE.BufferAttribute(mergedCol, 3));
    }
    merged.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
    return merged;
  }

  private createMountainRing(
    radius: number,
    baseHeight: number,
    segments: number,
    color: number,
    salt: number
  ): THREE.Mesh {
    const geom = new THREE.BufferGeometry();
    const vertCount = (segments + 1) * 2;
    const pos = new Float32Array(vertCount * 3);
    const idx = new Uint16Array(segments * 6);

    const angleStep = (Math.PI * 2) / segments;

    for (let i = 0; i <= segments; i++) {
      const ang = i * angleStep;
      const hNoise = hash01(this.seed, i % segments, salt);
      const h = baseHeight * (0.6 + 0.8 * hNoise);

      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);

      // Base vertex (y = -10)
      const v0 = i * 2;
      pos[v0 * 3 + 0] = cosA * radius;
      pos[v0 * 3 + 1] = -15;
      pos[v0 * 3 + 2] = sinA * radius;

      // Peak vertex
      const v1 = v0 + 1;
      pos[v1 * 3 + 0] = cosA * (radius * 0.96);
      pos[v1 * 3 + 1] = h;
      pos[v1 * 3 + 2] = sinA * (radius * 0.96);

      if (i < segments) {
        const i0 = v0;
        const i1 = v1;
        const i2 = v0 + 2;
        const i3 = v0 + 3;

        const outIdx = i * 6;
        idx[outIdx + 0] = i0;
        idx[outIdx + 1] = i2;
        idx[outIdx + 2] = i1;
        idx[outIdx + 3] = i1;
        idx[outIdx + 4] = i2;
        idx[outIdx + 5] = i3;
      }
    }

    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  public updateInstances(
    riderS: number,
    roadPath: RoadPath,
    profile: RendererProfile
  ): void {
    const minS = riderS - profile.behindDistance;
    const maxS = riderS + profile.aheadDistance;
    const span = maxS - minS;

    // 1. Update Trees
    const treeSpacing = span / profile.treeCount;
    const treeStartCell = Math.floor(minS / treeSpacing);
    let activeTrees = 0;

    for (let i = 0; i < profile.treeCount; i++) {
      const cell = treeStartCell + i;
      const h0 = hash01(this.seed, cell, 11);
      const h1 = hash01(this.seed, cell, 12);
      const h2 = hash01(this.seed, cell, 13);
      const h3 = hash01(this.seed, cell, 14);

      const s = cell * treeSpacing + (h0 - 0.5) * (treeSpacing * 0.85);

      if (s >= minS && s <= maxS) {
        roadPath.getPose(s, tempPose);
        const side = h1 < 0.5 ? -1 : 1;
        const dist = 8 + h2 * (36 - 8);
        const scale = 0.75 + h3 * 0.7;

        dummyPosition.set(
          tempPose.x + tempPose.rightX * (side * dist),
          -0.05,
          tempPose.z + tempPose.rightZ * (side * dist)
        );
        dummyQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h0 * Math.PI * 2);
        dummyScale.set(scale, scale, scale);
        dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);

        this.treeMesh.setMatrixAt(activeTrees, dummyMatrix);
        activeTrees++;
      }
    }
    this.treeMesh.count = activeTrees;
    this.treeMesh.instanceMatrix.needsUpdate = true;

    // 2. Update Rocks
    const rockSpacing = span / profile.rockCount;
    const rockStartCell = Math.floor(minS / rockSpacing);
    let activeRocks = 0;

    for (let i = 0; i < profile.rockCount; i++) {
      const cell = rockStartCell + i;
      const h0 = hash01(this.seed, cell, 21);
      const h1 = hash01(this.seed, cell, 22);
      const h2 = hash01(this.seed, cell, 23);
      const h3 = hash01(this.seed, cell, 24);

      const s = cell * rockSpacing + (h0 - 0.5) * (rockSpacing * 0.85);

      if (s >= minS && s <= maxS) {
        roadPath.getPose(s, tempPose);
        const side = h1 < 0.5 ? -1 : 1;
        const dist = 7 + h2 * (24 - 7);
        const scale = 0.65 + h3 * 1.0;

        dummyPosition.set(
          tempPose.x + tempPose.rightX * (side * dist),
          scale * 0.35 - 0.05,
          tempPose.z + tempPose.rightZ * (side * dist)
        );
        dummyQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h0 * Math.PI * 2);
        dummyScale.set(scale, scale * (0.6 + h2 * 0.6), scale);
        dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);

        this.rockMesh.setMatrixAt(activeRocks, dummyMatrix);
        activeRocks++;
      }
    }
    this.rockMesh.count = activeRocks;
    this.rockMesh.instanceMatrix.needsUpdate = true;

    // 3. Update Reflectors (placed along roadside at +/-5.7m every reflectorSpacing)
    const refSpacing = profile.reflectorSpacing;
    const startRefCell = Math.floor(minS / refSpacing);
    let activeRefs = 0;

    for (let i = 0; i < profile.reflectorCount && activeRefs < profile.reflectorCount; i++) {
      const cell = startRefCell + i;
      const s = cell * refSpacing;

      if (s >= minS && s <= maxS) {
        roadPath.getPose(s, tempPose);
        const postYaw = -tempPose.heading;

        // Left reflector (-5.7m)
        if (activeRefs < profile.reflectorCount) {
          dummyPosition.set(
            tempPose.x - tempPose.rightX * 5.7,
            0.0,
            tempPose.z - tempPose.rightZ * 5.7
          );
          dummyQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, postYaw);
          dummyScale.set(1, 1, 1);
          dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);

          this.reflectorMesh.setMatrixAt(activeRefs, dummyMatrix);
          activeRefs++;
        }

        // Right reflector (+5.7m)
        if (activeRefs < profile.reflectorCount) {
          dummyPosition.set(
            tempPose.x + tempPose.rightX * 5.7,
            0.0,
            tempPose.z + tempPose.rightZ * 5.7
          );
          dummyQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, postYaw);
          dummyScale.set(1, 1, 1);
          dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);

          this.reflectorMesh.setMatrixAt(activeRefs, dummyMatrix);
          activeRefs++;
        }
      }
    }
    this.reflectorMesh.count = activeRefs;
    this.reflectorMesh.instanceMatrix.needsUpdate = true;
  }

  public updateMountains(riderPose: RoadPose, dt: number, reducedMotion: boolean): void {
    if (!this.mountainInitialized) {
      this.mountainPos.set(riderPose.x, 0, riderPose.z);
      this.mountainInitialized = true;
    }

    // Subtle parallax lag: mountains smoothly follow rider with gentle damping
    // In reduced motion, lag is minimized
    const lambda = reducedMotion ? 30.0 : 2.2;
    this.mountainPos.x = damp(this.mountainPos.x, riderPose.x, lambda, dt);
    this.mountainPos.z = damp(this.mountainPos.z, riderPose.z, lambda, dt);
    this.mountainGroup.position.set(this.mountainPos.x, 0, this.mountainPos.z);
  }

  public update(
    riderS: number,
    riderPose: RoadPose,
    roadPath: RoadPath,
    profile: RendererProfile,
    dt: number,
    reducedMotion: boolean
  ): void {
    this.updateInstances(riderS, roadPath, profile);
    this.updateMountains(riderPose, dt, reducedMotion);
  }

  public rebase(deltaX: number, deltaZ: number): void {
    this.mountainPos.x -= deltaX;
    this.mountainPos.z -= deltaZ;
    this.mountainGroup.position.copy(this.mountainPos);
  }
}
