import * as THREE from 'three';
import {
  CENTER_FORCE_THRESHOLD_1,
  CENTER_FORCE_THRESHOLD_2,
  FORWARD_SPEED,
  LATERAL_CLAMP,
  OFF_ROAD_FORWARD_SPEED,
  OFF_ROAD_REVERSE_SPEED,
  OFF_ROAD_START,
  PALETTE,
  REVERSE_LIMIT_DISTANCE,
  REVERSE_SPEED,
  RideState,
  RoadPose,
} from './config';
import { clamp, damp, lerp, smoothstep } from './math';

const MAX_LEAN_RAD = (10 * Math.PI) / 180; // +/- 10 degrees
const WHEEL_RADIUS = 0.32;

export class Bike {
  public readonly group: THREE.Group;
  public readonly leanPivot: THREE.Group;

  private rearWheelGroup: THREE.Group;
  private frontWheelGroup: THREE.Group;
  private handlebarGroup: THREE.Group;

  private wheelAngle = 0;
  private currentRoll = 0;

  constructor() {
    this.group = new THREE.Group();
    this.leanPivot = new THREE.Group();
    this.group.add(this.leanPivot);

    // Shared materials
    const bodyMat = new THREE.MeshLambertMaterial({
      color: PALETTE.bikeBody,
      flatShading: true,
    });
    const frameMat = new THREE.MeshLambertMaterial({
      color: PALETTE.bikeFrame,
      flatShading: true,
    });
    const seatMat = new THREE.MeshLambertMaterial({
      color: PALETTE.bikeSeat,
      flatShading: true,
    });
    const wheelMat = new THREE.MeshLambertMaterial({
      color: PALETTE.bikeWheel,
      flatShading: true,
    });
    const forkMat = new THREE.MeshLambertMaterial({
      color: PALETTE.bikeFork,
      flatShading: true,
    });
    const tailLightMat = new THREE.MeshBasicMaterial({
      color: PALETTE.bikeTailLight,
    });
    const headLightMat = new THREE.MeshBasicMaterial({
      color: 0x93c5fd,
    });
    const riderMat = new THREE.MeshLambertMaterial({
      color: PALETTE.riderJacket,
      flatShading: true,
    });
    const helmetMat = new THREE.MeshLambertMaterial({
      color: PALETTE.riderHelmet,
      flatShading: true,
    });
    const visorMat = new THREE.MeshBasicMaterial({
      color: PALETTE.riderVisor,
    });

    // 1. Frame & Engine chassis (merged into 1 mesh)
    const chassisGeom = new THREE.BoxGeometry(0.28, 0.35, 0.9);
    chassisGeom.translate(0, 0.45, 0.0);
    const engineGeom = new THREE.BoxGeometry(0.32, 0.28, 0.45);
    engineGeom.translate(0, 0.34, 0.05);
    const frameGeom = this.mergeGeometries([chassisGeom, engineGeom]);
    const frameMesh = new THREE.Mesh(frameGeom, frameMat);
    this.leanPivot.add(frameMesh);

    // 2. Fuel Tank, Fairing & Rear Cowl (merged into 1 bodywork mesh)
    const tankGeom = new THREE.BoxGeometry(0.34, 0.28, 0.55);
    tankGeom.rotateX(-0.15);
    tankGeom.translate(0, 0.68, -0.2);

    const fairingGeom = new THREE.ConeGeometry(0.24, 0.5, 4);
    fairingGeom.rotateX(Math.PI / 2 + 0.2);
    fairingGeom.translate(0, 0.72, -0.55);

    const cowlGeom = new THREE.BoxGeometry(0.24, 0.14, 0.35);
    cowlGeom.rotateX(0.18);
    cowlGeom.translate(0, 0.71, 0.6);

    const bodyGeom = this.mergeGeometries([tankGeom, fairingGeom, cowlGeom]);
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    this.leanPivot.add(bodyMesh);

    // Front Headlight facet
    const headLightGeom = new THREE.BoxGeometry(0.18, 0.12, 0.05);
    const headLight = new THREE.Mesh(headLightGeom, headLightMat);
    headLight.position.set(0, 0.72, -0.74);
    this.leanPivot.add(headLight);

    // 3. Seat & Tail
    const seatGeom = new THREE.BoxGeometry(0.26, 0.12, 0.55);
    const seat = new THREE.Mesh(seatGeom, seatMat);
    seat.position.set(0, 0.66, 0.32);
    seat.rotation.x = 0.08;
    this.leanPivot.add(seat);

    // Emissive Tail Light (No PointLight as specified)
    const tailLightGeom = new THREE.BoxGeometry(0.18, 0.08, 0.05);
    const tailLight = new THREE.Mesh(tailLightGeom, tailLightMat);
    tailLight.position.set(0, 0.71, 0.78);
    this.leanPivot.add(tailLight);

    // 4. Wheels
    const tireGeom = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.16, 12);
    tireGeom.rotateZ(Math.PI / 2);

    this.rearWheelGroup = new THREE.Group();
    this.rearWheelGroup.position.set(0, WHEEL_RADIUS, 0.62);
    const rearTire = new THREE.Mesh(tireGeom, wheelMat);
    this.rearWheelGroup.add(rearTire);
    this.leanPivot.add(this.rearWheelGroup);

    this.frontWheelGroup = new THREE.Group();
    this.frontWheelGroup.position.set(0, WHEEL_RADIUS, -0.65);
    const frontTire = new THREE.Mesh(tireGeom, wheelMat);
    this.frontWheelGroup.add(frontTire);
    this.leanPivot.add(this.frontWheelGroup);

    // Front fork (left & right merged)
    const forkLGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.65, 5);
    forkLGeom.rotateX(0.28);
    forkLGeom.translate(-0.1, 0.55, -0.58);

    const forkRGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.65, 5);
    forkRGeom.rotateX(0.28);
    forkRGeom.translate(0.1, 0.55, -0.58);

    const forksGeom = this.mergeGeometries([forkLGeom, forkRGeom]);
    const forks = new THREE.Mesh(forksGeom, forkMat);
    this.leanPivot.add(forks);

    // 5. Handlebar & Mirrors (in handlebarGroup for steering turn)
    this.handlebarGroup = new THREE.Group();
    this.handlebarGroup.position.set(0, 0.88, -0.46);

    const barGeom = new THREE.BoxGeometry(0.62, 0.04, 0.04);
    const bar = new THREE.Mesh(barGeom, forkMat);
    this.handlebarGroup.add(bar);

    // Left & Right Mirrors (merged)
    const mirrorLGeom = new THREE.BoxGeometry(0.08, 0.05, 0.02);
    mirrorLGeom.translate(-0.32, 0.08, 0.02);
    const mirrorRGeom = new THREE.BoxGeometry(0.08, 0.05, 0.02);
    mirrorRGeom.translate(0.32, 0.08, 0.02);
    const mirrorsGeom = this.mergeGeometries([mirrorLGeom, mirrorRGeom]);
    const mirrors = new THREE.Mesh(mirrorsGeom, bodyMat);
    this.handlebarGroup.add(mirrors);

    this.leanPivot.add(this.handlebarGroup);

    // 6. Rider
    // Rider Torso
    const torsoGeom = new THREE.BoxGeometry(0.36, 0.45, 0.28);
    const torso = new THREE.Mesh(torsoGeom, riderMat);
    torso.position.set(0, 1.02, 0.12);
    torso.rotation.x = -0.32; // leaned forward
    this.leanPivot.add(torso);

    // Rider Head / Helmet
    const headGeom = new THREE.SphereGeometry(0.16, 7, 6);
    const head = new THREE.Mesh(headGeom, helmetMat);
    head.position.set(0, 1.34, -0.05);
    this.leanPivot.add(head);

    // Helmet Visor
    const visorGeom = new THREE.BoxGeometry(0.2, 0.07, 0.08);
    const visor = new THREE.Mesh(visorGeom, visorMat);
    visor.position.set(0, 1.34, -0.16);
    this.leanPivot.add(visor);
  }

  private mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
    let totalVerts = 0;
    let totalIndices = 0;

    for (const g of geometries) {
      const pos = g.getAttribute('position');
      if (pos) totalVerts += pos.count;
      if (g.index) totalIndices += g.index.count;
    }

    const mergedPos = new Float32Array(totalVerts * 3);
    const mergedNorm = new Float32Array(totalVerts * 3);
    const mergedIdx = new Uint16Array(totalIndices);

    let vOffset = 0;
    let iOffset = 0;

    for (const g of geometries) {
      const pos = g.getAttribute('position')!;
      const norm = g.getAttribute('normal');
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
    merged.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
    return merged;
  }

  public updateLateralDynamics(state: RideState, dt: number): void {
    if (state.mode === 'running') {
      const maxLatVel = lerp(3.2, 2.5, state.offRoadAmount);
      const desiredLatVel = state.steerInput * maxLatVel;

      // Damp lateral velocity around 6.5
      state.lateralVelocity = damp(state.lateralVelocity, desiredLatVel, 6.5, dt);

      // Centering forces when off asphalt
      const absOffset = Math.abs(state.lateralOffset);
      if (absOffset > CENTER_FORCE_THRESHOLD_1) {
        const sign = state.lateralOffset > 0 ? -1 : 1;
        // Mild restoring force beyond 4.2m
        let centerForce = sign * 2.8 * (absOffset - CENTER_FORCE_THRESHOLD_1);
        // Stronger force beyond 6.0m
        if (absOffset > CENTER_FORCE_THRESHOLD_2) {
          centerForce += sign * 6.5 * (absOffset - CENTER_FORCE_THRESHOLD_2);
        }
        state.lateralVelocity += centerForce * dt;
      }

      state.lateralOffset += state.lateralVelocity * dt;

      // Hard clamp at +/- 7.25m and zero outward velocity at the clamp
      if (state.lateralOffset > LATERAL_CLAMP) {
        state.lateralOffset = LATERAL_CLAMP;
        if (state.lateralVelocity > 0) state.lateralVelocity = 0;
      } else if (state.lateralOffset < -LATERAL_CLAMP) {
        state.lateralOffset = -LATERAL_CLAMP;
        if (state.lateralVelocity < 0) state.lateralVelocity = 0;
      }
    } else {
      state.lateralVelocity = 0;
    }
  }

  public updateOffRoad(state: RideState): void {
    const absOffset = Math.abs(state.lateralOffset);
    state.offRoadAmount = smoothstep(OFF_ROAD_START, 6.0, absOffset);
  }

  public updateSpeed(state: RideState, dt: number): void {
    if (state.mode === 'ready') {
      state.speed = 0;
      state.targetSpeed = 0;
      return;
    }

    if (state.mode === 'running') {
      const forwardTarget = lerp(FORWARD_SPEED, OFF_ROAD_FORWARD_SPEED, state.offRoadAmount);
      const reverseTarget = lerp(REVERSE_SPEED, OFF_ROAD_REVERSE_SPEED, state.offRoadAmount);

      if (state.driveMode === 'autodrive') {
        state.targetSpeed = forwardTarget;
      } else {
        if (state.throttleInput === 1) {
          state.targetSpeed = forwardTarget;
        } else if (state.throttleInput === -1) {
          state.targetSpeed = reverseTarget;
        } else {
          state.targetSpeed = 0;
        }
      }

      // Damping speed toward target around coefficient 8
      state.speed = damp(state.speed, state.targetSpeed, 8.0, dt);
    }
  }

  public updateDistance(state: RideState, dt: number): void {
    state.distanceAlongRoad += state.speed * dt;
    if (state.distanceAlongRoad <= REVERSE_LIMIT_DISTANCE) {
      state.distanceAlongRoad = REVERSE_LIMIT_DISTANCE;
      if (state.speed < 0) {
        state.speed = 0;
      }
      if (state.targetSpeed < 0) {
        state.targetSpeed = 0;
      }
    }
  }

  public updateVisuals(
    state: RideState,
    roadPose: RoadPose,
    dt: number,
    reducedMotion: boolean
  ): void {
    // Damped visual roll combines road curvature lean and steering lean, clamped to +/-10 degrees
    const steerLean = state.steerInput * 0.12;
    const curvatureLean = clamp(roadPose.curvature * 4.5, -0.12, 0.12);
    const targetRoll = clamp(steerLean + curvatureLean, -MAX_LEAN_RAD, MAX_LEAN_RAD);
    this.currentRoll = damp(this.currentRoll, targetRoll, 7.5, dt);

    // Update wheel spinning
    this.wheelAngle -= (state.speed * dt) / WHEEL_RADIUS;
    this.rearWheelGroup.rotation.x = this.wheelAngle;
    this.frontWheelGroup.rotation.x = this.wheelAngle;

    // Handlebar slight turn
    this.handlebarGroup.rotation.y = -state.steerInput * 0.08;

    // Update bike placement in 3D scene
    const wx = roadPose.x + roadPose.rightX * state.lateralOffset;
    let wy = 0;
    const wz = roadPose.z + roadPose.rightZ * state.lateralOffset;

    // Idle bob or subtle off-road micro-vibration if not reduced motion
    if (!reducedMotion) {
      if (state.mode === 'ready') {
        wy += Math.sin(state.elapsedTime * 2.5) * 0.015;
      } else if (state.offRoadAmount > 0.1) {
        wy += Math.sin(state.elapsedTime * 35) * (0.012 * state.offRoadAmount);
      }
    }

    this.group.position.set(wx, wy, wz);
    // Bike yaw is -heading
    this.group.rotation.set(0, -roadPose.heading, 0);

    // Leaning around local Z
    this.leanPivot.rotation.set(0, 0, -this.currentRoll);
  }

  public getLeanAngle(): number {
    return this.currentRoll;
  }
}
