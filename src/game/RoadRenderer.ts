import * as THREE from 'three';
import {
  ASPHALT_Y,
  CENTER_DASH_LENGTH,
  CENTER_DASH_PERIOD,
  CENTER_DASH_WIDTH,
  CHUNK_LENGTH,
  EDGE_LINE_OFFSET,
  EDGE_LINE_WIDTH,
  MARKINGS_Y,
  OUTER_HALF_WIDTH,
  PALETTE,
  POOLED_CHUNK_COUNT,
  ROAD_HALF_WIDTH,
  SHOULDERS_Y,
  TERRAIN_HALF_WIDTH,
  TERRAIN_Y,
  RendererProfile,
  RoadPose,
} from './config';
import { RoadPath } from './RoadPath';

const SEGMENTS_PER_CHUNK = 12;
const SUB_STEP = CHUNK_LENGTH / SEGMENTS_PER_CHUNK; // 2.5m
const MAX_CENTER_DASHES_PER_CHUNK = 6;

// Reusable poses to prevent allocation in hot loop
const tempPoseA: RoadPose = {
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

const tempPoseB: RoadPose = {
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

export class RoadRenderer {
  public readonly group: THREE.Group;

  private asphaltMesh: THREE.Mesh;
  private shoulderMesh: THREE.Mesh;
  private terrainMesh: THREE.Mesh;
  private markingsMesh: THREE.Mesh;

  // Geometry attributes
  private asphaltPosAttr: THREE.BufferAttribute;
  private asphaltNormAttr: THREE.BufferAttribute;
  private shoulderPosAttr: THREE.BufferAttribute;
  private shoulderNormAttr: THREE.BufferAttribute;
  private terrainPosAttr: THREE.BufferAttribute;
  private terrainNormAttr: THREE.BufferAttribute;
  private markingsPosAttr: THREE.BufferAttribute;
  private markingsNormAttr: THREE.BufferAttribute;

  // Track assigned chunk key for each slot (slot index -> chunk key)
  private slotChunkKeys: number[] = new Array(POOLED_CHUNK_COUNT).fill(-999999);

  constructor() {
    this.group = new THREE.Group();

    // 1. Asphalt: 1 ribbon (width = -ROAD_HALF_WIDTH to +ROAD_HALF_WIDTH)
    const asphaltVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 2;
    const asphaltIndicesPerChunk = SEGMENTS_PER_CHUNK * 6;
    const totalAsphaltVerts = POOLED_CHUNK_COUNT * asphaltVertsPerChunk;
    const totalAsphaltIndices = POOLED_CHUNK_COUNT * asphaltIndicesPerChunk;

    const asphaltPos = new Float32Array(totalAsphaltVerts * 3);
    const asphaltNorm = new Float32Array(totalAsphaltVerts * 3);
    const asphaltIdx = new Uint16Array(totalAsphaltIndices);

    // Fill normal array with (0, 1, 0)
    for (let i = 0; i < totalAsphaltVerts; i++) {
      asphaltNorm[i * 3 + 1] = 1.0;
    }

    // Pre-wire index buffer for asphalt
    for (let slot = 0; slot < POOLED_CHUNK_COUNT; slot++) {
      const vOffset = slot * asphaltVertsPerChunk;
      const iOffset = slot * asphaltIndicesPerChunk;
      for (let s = 0; s < SEGMENTS_PER_CHUNK; s++) {
        const i0 = vOffset + s * 2;
        const i1 = i0 + 1;
        const i2 = vOffset + (s + 1) * 2;
        const i3 = i2 + 1;

        const outIdx = iOffset + s * 6;
        asphaltIdx[outIdx + 0] = i0;
        asphaltIdx[outIdx + 1] = i1;
        asphaltIdx[outIdx + 2] = i2;
        asphaltIdx[outIdx + 3] = i1;
        asphaltIdx[outIdx + 4] = i3;
        asphaltIdx[outIdx + 5] = i2;
      }
    }

    const asphaltGeom = new THREE.BufferGeometry();
    this.asphaltPosAttr = new THREE.BufferAttribute(asphaltPos, 3);
    this.asphaltNormAttr = new THREE.BufferAttribute(asphaltNorm, 3);
    asphaltGeom.setAttribute('position', this.asphaltPosAttr);
    asphaltGeom.setAttribute('normal', this.asphaltNormAttr);
    asphaltGeom.setIndex(new THREE.BufferAttribute(asphaltIdx, 1));

    const asphaltMat = new THREE.MeshLambertMaterial({
      color: PALETTE.asphalt,
    });
    this.asphaltMesh = new THREE.Mesh(asphaltGeom, asphaltMat);
    this.asphaltMesh.frustumCulled = false;
    this.group.add(this.asphaltMesh);

    // 2. Shoulders: 2 ribbons (left shoulder & right shoulder)
    // 4 vertices per cross-section
    const shoulderVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 4;
    const shoulderIndicesPerChunk = SEGMENTS_PER_CHUNK * 12; // 2 ribbons * 6 indices
    const totalShoulderVerts = POOLED_CHUNK_COUNT * shoulderVertsPerChunk;
    const totalShoulderIndices = POOLED_CHUNK_COUNT * shoulderIndicesPerChunk;

    const shoulderPos = new Float32Array(totalShoulderVerts * 3);
    const shoulderNorm = new Float32Array(totalShoulderVerts * 3);
    const shoulderIdx = new Uint16Array(totalShoulderIndices);

    for (let i = 0; i < totalShoulderVerts; i++) {
      shoulderNorm[i * 3 + 1] = 1.0;
    }

    for (let slot = 0; slot < POOLED_CHUNK_COUNT; slot++) {
      const vOffset = slot * shoulderVertsPerChunk;
      const iOffset = slot * shoulderIndicesPerChunk;
      for (let s = 0; s < SEGMENTS_PER_CHUNK; s++) {
        // Left ribbon
        const l0 = vOffset + s * 4;
        const l1 = l0 + 1;
        const l2 = vOffset + (s + 1) * 4;
        const l3 = l2 + 1;

        const outIdxL = iOffset + s * 12;
        shoulderIdx[outIdxL + 0] = l0;
        shoulderIdx[outIdxL + 1] = l1;
        shoulderIdx[outIdxL + 2] = l2;
        shoulderIdx[outIdxL + 3] = l1;
        shoulderIdx[outIdxL + 4] = l3;
        shoulderIdx[outIdxL + 5] = l2;

        // Right ribbon
        const r0 = l0 + 2;
        const r1 = l0 + 3;
        const r2 = l2 + 2;
        const r3 = l2 + 3;

        const outIdxR = outIdxL + 6;
        shoulderIdx[outIdxR + 0] = r0;
        shoulderIdx[outIdxR + 1] = r1;
        shoulderIdx[outIdxR + 2] = r2;
        shoulderIdx[outIdxR + 3] = r1;
        shoulderIdx[outIdxR + 4] = r3;
        shoulderIdx[outIdxR + 5] = r2;
      }
    }

    const shoulderGeom = new THREE.BufferGeometry();
    this.shoulderPosAttr = new THREE.BufferAttribute(shoulderPos, 3);
    this.shoulderNormAttr = new THREE.BufferAttribute(shoulderNorm, 3);
    shoulderGeom.setAttribute('position', this.shoulderPosAttr);
    shoulderGeom.setAttribute('normal', this.shoulderNormAttr);
    shoulderGeom.setIndex(new THREE.BufferAttribute(shoulderIdx, 1));

    const shoulderMat = new THREE.MeshLambertMaterial({
      color: PALETTE.shoulder,
    });
    this.shoulderMesh = new THREE.Mesh(shoulderGeom, shoulderMat);
    this.shoulderMesh.frustumCulled = false;
    this.group.add(this.shoulderMesh);

    // 3. Terrain: 2 ribbons (left & right terrain)
    const terrainVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 4;
    const terrainIndicesPerChunk = SEGMENTS_PER_CHUNK * 12;
    const totalTerrainVerts = POOLED_CHUNK_COUNT * terrainVertsPerChunk;
    const totalTerrainIndices = POOLED_CHUNK_COUNT * terrainIndicesPerChunk;

    const terrainPos = new Float32Array(totalTerrainVerts * 3);
    const terrainNorm = new Float32Array(totalTerrainVerts * 3);
    const terrainIdx = new Uint16Array(totalTerrainIndices);

    for (let i = 0; i < totalTerrainVerts; i++) {
      terrainNorm[i * 3 + 1] = 1.0;
    }

    for (let slot = 0; slot < POOLED_CHUNK_COUNT; slot++) {
      const vOffset = slot * terrainVertsPerChunk;
      const iOffset = slot * terrainIndicesPerChunk;
      for (let s = 0; s < SEGMENTS_PER_CHUNK; s++) {
        // Left ribbon
        const l0 = vOffset + s * 4;
        const l1 = l0 + 1;
        const l2 = vOffset + (s + 1) * 4;
        const l3 = l2 + 1;

        const outIdxL = iOffset + s * 12;
        terrainIdx[outIdxL + 0] = l0;
        terrainIdx[outIdxL + 1] = l1;
        terrainIdx[outIdxL + 2] = l2;
        terrainIdx[outIdxL + 3] = l1;
        terrainIdx[outIdxL + 4] = l3;
        terrainIdx[outIdxL + 5] = l2;

        // Right ribbon
        const r0 = l0 + 2;
        const r1 = l0 + 3;
        const r2 = l2 + 2;
        const r3 = l2 + 3;

        const outIdxR = outIdxL + 6;
        terrainIdx[outIdxR + 0] = r0;
        terrainIdx[outIdxR + 1] = r1;
        terrainIdx[outIdxR + 2] = r2;
        terrainIdx[outIdxR + 3] = r1;
        terrainIdx[outIdxR + 4] = r3;
        terrainIdx[outIdxR + 5] = r2;
      }
    }

    const terrainGeom = new THREE.BufferGeometry();
    this.terrainPosAttr = new THREE.BufferAttribute(terrainPos, 3);
    this.terrainNormAttr = new THREE.BufferAttribute(terrainNorm, 3);
    terrainGeom.setAttribute('position', this.terrainPosAttr);
    terrainGeom.setAttribute('normal', this.terrainNormAttr);
    terrainGeom.setIndex(new THREE.BufferAttribute(terrainIdx, 1));

    const terrainMat = new THREE.MeshLambertMaterial({
      color: PALETTE.terrain,
    });
    this.terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    this.terrainMesh.frustumCulled = false;
    this.group.add(this.terrainMesh);

    // 4. Markings: Edge lines (left & right) + Center dashes
    // Edge lines: 4 verts per cross section * 13 cross sections = 52 verts
    // Edge indices: 12 segments * 12 indices = 144 indices
    // Center dashes: up to 6 dashes * 4 verts = 24 verts
    // Center dash indices: 6 dashes * 6 indices = 36 indices
    const markingVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 4 + MAX_CENTER_DASHES_PER_CHUNK * 4;
    const markingIndicesPerChunk = SEGMENTS_PER_CHUNK * 12 + MAX_CENTER_DASHES_PER_CHUNK * 6;
    const totalMarkingVerts = POOLED_CHUNK_COUNT * markingVertsPerChunk;
    const totalMarkingIndices = POOLED_CHUNK_COUNT * markingIndicesPerChunk;

    const markingPos = new Float32Array(totalMarkingVerts * 3);
    const markingNorm = new Float32Array(totalMarkingVerts * 3);
    const markingIdx = new Uint16Array(totalMarkingIndices);

    for (let i = 0; i < totalMarkingVerts; i++) {
      markingNorm[i * 3 + 1] = 1.0;
    }

    for (let slot = 0; slot < POOLED_CHUNK_COUNT; slot++) {
      const vOffset = slot * markingVertsPerChunk;
      const iOffset = slot * markingIndicesPerChunk;

      // Edge lines pre-wire
      for (let s = 0; s < SEGMENTS_PER_CHUNK; s++) {
        // Left edge line
        const l0 = vOffset + s * 4;
        const l1 = l0 + 1;
        const l2 = vOffset + (s + 1) * 4;
        const l3 = l2 + 1;

        const outIdxL = iOffset + s * 12;
        markingIdx[outIdxL + 0] = l0;
        markingIdx[outIdxL + 1] = l1;
        markingIdx[outIdxL + 2] = l2;
        markingIdx[outIdxL + 3] = l1;
        markingIdx[outIdxL + 4] = l3;
        markingIdx[outIdxL + 5] = l2;

        // Right edge line
        const r0 = l0 + 2;
        const r1 = l0 + 3;
        const r2 = l2 + 2;
        const r3 = l2 + 3;

        const outIdxR = outIdxL + 6;
        markingIdx[outIdxR + 0] = r0;
        markingIdx[outIdxR + 1] = r1;
        markingIdx[outIdxR + 2] = r2;
        markingIdx[outIdxR + 3] = r1;
        markingIdx[outIdxR + 4] = r3;
        markingIdx[outIdxR + 5] = r2;
      }

      // Center dashes pre-wire
      const centerVBase = vOffset + (SEGMENTS_PER_CHUNK + 1) * 4;
      const centerIBase = iOffset + SEGMENTS_PER_CHUNK * 12;
      for (let d = 0; d < MAX_CENTER_DASHES_PER_CHUNK; d++) {
        const d0 = centerVBase + d * 4;
        const d1 = d0 + 1;
        const d2 = d0 + 2;
        const d3 = d0 + 3;

        const outIdxD = centerIBase + d * 6;
        markingIdx[outIdxD + 0] = d0;
        markingIdx[outIdxD + 1] = d1;
        markingIdx[outIdxD + 2] = d2;
        markingIdx[outIdxD + 3] = d1;
        markingIdx[outIdxD + 4] = d3;
        markingIdx[outIdxD + 5] = d2;
      }
    }

    const markingsGeom = new THREE.BufferGeometry();
    this.markingsPosAttr = new THREE.BufferAttribute(markingPos, 3);
    this.markingsNormAttr = new THREE.BufferAttribute(markingNorm, 3);
    markingsGeom.setAttribute('position', this.markingsPosAttr);
    markingsGeom.setAttribute('normal', this.markingsNormAttr);
    markingsGeom.setIndex(new THREE.BufferAttribute(markingIdx, 1));

    const markingsMat = new THREE.MeshBasicMaterial({
      color: PALETTE.marking,
    });
    this.markingsMesh = new THREE.Mesh(markingsGeom, markingsMat);
    this.markingsMesh.frustumCulled = false;
    this.group.add(this.markingsMesh);
  }

  public update(riderS: number, roadPath: RoadPath, profile: RendererProfile): void {
    const minS = riderS - profile.behindDistance;
    const maxS = riderS + profile.aheadDistance;

    const startChunkKey = Math.floor(minS / CHUNK_LENGTH);
    const endChunkKey = Math.ceil(maxS / CHUNK_LENGTH);

    let needsAsphaltUpdate = false;
    let needsShoulderUpdate = false;
    let needsTerrainUpdate = false;
    let needsMarkingUpdate = false;

    // Build set of required chunks
    for (let k = startChunkKey; k <= endChunkKey; k++) {
      const slot = ((k % POOLED_CHUNK_COUNT) + POOLED_CHUNK_COUNT) % POOLED_CHUNK_COUNT;
      if (this.slotChunkKeys[slot] !== k) {
        this.populateChunkSlot(slot, k, roadPath);
        this.slotChunkKeys[slot] = k;
        needsAsphaltUpdate = true;
        needsShoulderUpdate = true;
        needsTerrainUpdate = true;
        needsMarkingUpdate = true;
      }
    }

    // Degenerate inactive slots
    for (let slot = 0; slot < POOLED_CHUNK_COUNT; slot++) {
      const k = this.slotChunkKeys[slot]!;
      if (k !== -999999 && (k < startChunkKey || k > endChunkKey)) {
        this.clearChunkSlot(slot);
        this.slotChunkKeys[slot] = -999999;
        needsAsphaltUpdate = true;
        needsShoulderUpdate = true;
        needsTerrainUpdate = true;
        needsMarkingUpdate = true;
      }
    }

    if (needsAsphaltUpdate) this.asphaltPosAttr.needsUpdate = true;
    if (needsShoulderUpdate) this.shoulderPosAttr.needsUpdate = true;
    if (needsTerrainUpdate) this.terrainPosAttr.needsUpdate = true;
    if (needsMarkingUpdate) this.markingsPosAttr.needsUpdate = true;
  }

  private populateChunkSlot(slot: number, chunkKey: number, roadPath: RoadPath): void {
    const chunkStartS = chunkKey * CHUNK_LENGTH;
    const asphaltPos = this.asphaltPosAttr.array as Float32Array;
    const shoulderPos = this.shoulderPosAttr.array as Float32Array;
    const terrainPos = this.terrainPosAttr.array as Float32Array;
    const markingsPos = this.markingsPosAttr.array as Float32Array;

    const asphaltVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 2;
    const shoulderVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 4;
    const terrainVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 4;
    const markingVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 4 + MAX_CENTER_DASHES_PER_CHUNK * 4;

    const asphaltBaseV = slot * asphaltVertsPerChunk;
    const shoulderBaseV = slot * shoulderVertsPerChunk;
    const terrainBaseV = slot * terrainVertsPerChunk;
    const markingBaseV = slot * markingVertsPerChunk;

    const edgeHalfW = EDGE_LINE_WIDTH * 0.5;
    const leftEdgeCenter = -EDGE_LINE_OFFSET;
    const rightEdgeCenter = EDGE_LINE_OFFSET;

    // Cross section samples along chunk
    for (let sIdx = 0; sIdx <= SEGMENTS_PER_CHUNK; sIdx++) {
      const s = chunkStartS + sIdx * SUB_STEP;
      roadPath.getPose(s, tempPoseA);

      const px = tempPoseA.x;
      const pz = tempPoseA.z;
      const rx = tempPoseA.rightX;
      const rz = tempPoseA.rightZ;

      // 1. Asphalt
      const aVIdx = (asphaltBaseV + sIdx * 2) * 3;
      // Left (-ROAD_HALF_WIDTH)
      asphaltPos[aVIdx + 0] = px - rx * ROAD_HALF_WIDTH;
      asphaltPos[aVIdx + 1] = ASPHALT_Y;
      asphaltPos[aVIdx + 2] = pz - rz * ROAD_HALF_WIDTH;
      // Right (+ROAD_HALF_WIDTH)
      asphaltPos[aVIdx + 3] = px + rx * ROAD_HALF_WIDTH;
      asphaltPos[aVIdx + 4] = ASPHALT_Y;
      asphaltPos[aVIdx + 5] = pz + rz * ROAD_HALF_WIDTH;

      // 2. Shoulders: left [-OUTER_HALF_WIDTH, -ROAD_HALF_WIDTH], right [ROAD_HALF_WIDTH, OUTER_HALF_WIDTH]
      const sVIdx = (shoulderBaseV + sIdx * 4) * 3;
      // Left shoulder
      shoulderPos[sVIdx + 0] = px - rx * OUTER_HALF_WIDTH;
      shoulderPos[sVIdx + 1] = SHOULDERS_Y;
      shoulderPos[sVIdx + 2] = pz - rz * OUTER_HALF_WIDTH;

      shoulderPos[sVIdx + 3] = px - rx * ROAD_HALF_WIDTH;
      shoulderPos[sVIdx + 4] = SHOULDERS_Y;
      shoulderPos[sVIdx + 5] = pz - rz * ROAD_HALF_WIDTH;

      // Right shoulder
      shoulderPos[sVIdx + 6] = px + rx * ROAD_HALF_WIDTH;
      shoulderPos[sVIdx + 7] = SHOULDERS_Y;
      shoulderPos[sVIdx + 8] = pz + rz * ROAD_HALF_WIDTH;

      shoulderPos[sVIdx + 9] = px + rx * OUTER_HALF_WIDTH;
      shoulderPos[sVIdx + 10] = SHOULDERS_Y;
      shoulderPos[sVIdx + 11] = pz + rz * OUTER_HALF_WIDTH;

      // 3. Terrain: left [-TERRAIN_HALF_WIDTH, -OUTER_HALF_WIDTH], right [OUTER_HALF_WIDTH, TERRAIN_HALF_WIDTH]
      const tVIdx = (terrainBaseV + sIdx * 4) * 3;
      // Left terrain
      terrainPos[tVIdx + 0] = px - rx * TERRAIN_HALF_WIDTH;
      terrainPos[tVIdx + 1] = TERRAIN_Y;
      terrainPos[tVIdx + 2] = pz - rz * TERRAIN_HALF_WIDTH;

      terrainPos[tVIdx + 3] = px - rx * OUTER_HALF_WIDTH;
      terrainPos[tVIdx + 4] = TERRAIN_Y;
      terrainPos[tVIdx + 5] = pz - rz * OUTER_HALF_WIDTH;

      // Right terrain
      terrainPos[tVIdx + 6] = px + rx * OUTER_HALF_WIDTH;
      terrainPos[tVIdx + 7] = TERRAIN_Y;
      terrainPos[tVIdx + 8] = pz + rz * OUTER_HALF_WIDTH;

      terrainPos[tVIdx + 9] = px + rx * TERRAIN_HALF_WIDTH;
      terrainPos[tVIdx + 10] = TERRAIN_Y;
      terrainPos[tVIdx + 11] = pz + rz * TERRAIN_HALF_WIDTH;

      // 4. Edge markings
      const mVIdx = (markingBaseV + sIdx * 4) * 3;
      // Left edge line
      markingsPos[mVIdx + 0] = px + rx * (leftEdgeCenter - edgeHalfW);
      markingsPos[mVIdx + 1] = MARKINGS_Y;
      markingsPos[mVIdx + 2] = pz + rz * (leftEdgeCenter - edgeHalfW);

      markingsPos[mVIdx + 3] = px + rx * (leftEdgeCenter + edgeHalfW);
      markingsPos[mVIdx + 4] = MARKINGS_Y;
      markingsPos[mVIdx + 5] = pz + rz * (leftEdgeCenter + edgeHalfW);

      // Right edge line
      markingsPos[mVIdx + 6] = px + rx * (rightEdgeCenter - edgeHalfW);
      markingsPos[mVIdx + 7] = MARKINGS_Y;
      markingsPos[mVIdx + 8] = pz + rz * (rightEdgeCenter - edgeHalfW);

      markingsPos[mVIdx + 9] = px + rx * (rightEdgeCenter + edgeHalfW);
      markingsPos[mVIdx + 10] = MARKINGS_Y;
      markingsPos[mVIdx + 11] = pz + rz * (rightEdgeCenter + edgeHalfW);
    }

    // Center dashes
    const chunkEndS = chunkStartS + CHUNK_LENGTH;
    const centerHalfW = CENTER_DASH_WIDTH * 0.5;
    const centerVBase = markingBaseV + (SEGMENTS_PER_CHUNK + 1) * 4;

    const minCycle = Math.floor((chunkStartS - CENTER_DASH_LENGTH) / CENTER_DASH_PERIOD);
    const maxCycle = Math.floor(chunkEndS / CENTER_DASH_PERIOD);

    let dashCount = 0;
    for (let c = minCycle; c <= maxCycle; c++) {
      const dashS0 = Math.max(chunkStartS, c * CENTER_DASH_PERIOD);
      const dashS1 = Math.min(chunkEndS, c * CENTER_DASH_PERIOD + CENTER_DASH_LENGTH);

      if (dashS1 > dashS0 && dashCount < MAX_CENTER_DASHES_PER_CHUNK) {
        roadPath.getPose(dashS0, tempPoseA);
        roadPath.getPose(dashS1, tempPoseB);

        const dIdx = (centerVBase + dashCount * 4) * 3;

        // V0: start left
        markingsPos[dIdx + 0] = tempPoseA.x - tempPoseA.rightX * centerHalfW;
        markingsPos[dIdx + 1] = MARKINGS_Y;
        markingsPos[dIdx + 2] = tempPoseA.z - tempPoseA.rightZ * centerHalfW;

        // V1: start right
        markingsPos[dIdx + 3] = tempPoseA.x + tempPoseA.rightX * centerHalfW;
        markingsPos[dIdx + 4] = MARKINGS_Y;
        markingsPos[dIdx + 5] = tempPoseA.z + tempPoseA.rightZ * centerHalfW;

        // V2: end left
        markingsPos[dIdx + 6] = tempPoseB.x - tempPoseB.rightX * centerHalfW;
        markingsPos[dIdx + 7] = MARKINGS_Y;
        markingsPos[dIdx + 8] = tempPoseB.z - tempPoseB.rightZ * centerHalfW;

        // V3: end right
        markingsPos[dIdx + 9] = tempPoseB.x + tempPoseB.rightX * centerHalfW;
        markingsPos[dIdx + 10] = MARKINGS_Y;
        markingsPos[dIdx + 11] = tempPoseB.z + tempPoseB.rightZ * centerHalfW;

        dashCount++;
      }
    }

    // Fill unused dash slots with degenerate vertices
    for (let d = dashCount; d < MAX_CENTER_DASHES_PER_CHUNK; d++) {
      const dIdx = (centerVBase + d * 4) * 3;
      for (let i = 0; i < 12; i++) {
        markingsPos[dIdx + i] = 0;
      }
    }
  }

  private clearChunkSlot(slot: number): void {
    const asphaltPos = this.asphaltPosAttr.array as Float32Array;
    const shoulderPos = this.shoulderPosAttr.array as Float32Array;
    const terrainPos = this.terrainPosAttr.array as Float32Array;
    const markingsPos = this.markingsPosAttr.array as Float32Array;

    const asphaltVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 2;
    const shoulderVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 4;
    const terrainVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 4;
    const markingVertsPerChunk = (SEGMENTS_PER_CHUNK + 1) * 4 + MAX_CENTER_DASHES_PER_CHUNK * 4;

    asphaltPos.fill(0, slot * asphaltVertsPerChunk * 3, (slot + 1) * asphaltVertsPerChunk * 3);
    shoulderPos.fill(0, slot * shoulderVertsPerChunk * 3, (slot + 1) * shoulderVertsPerChunk * 3);
    terrainPos.fill(0, slot * terrainVertsPerChunk * 3, (slot + 1) * terrainVertsPerChunk * 3);
    markingsPos.fill(0, slot * markingVertsPerChunk * 3, (slot + 1) * markingVertsPerChunk * 3);
  }

  public invalidateAllSlots(): void {
    this.slotChunkKeys.fill(-999999);
  }
}
