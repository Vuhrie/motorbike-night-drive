import * as THREE from 'three';
import { CAMERA_FAR, CAMERA_NEAR, RoadPose } from './config';
import { damp } from './math';

export class CameraRig {
  public readonly camera: THREE.PerspectiveCamera;

  private currentPos = new THREE.Vector3(0, 3.2, 7.2);
  private currentTarget = new THREE.Vector3(0, 1.2, -8);
  private currentRoll = 0;
  private isLandscape = true;
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, CAMERA_NEAR, CAMERA_FAR);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentTarget);
  }

  public setViewport(width: number, height: number): void {
    this.isLandscape = width >= height;
    const fov = this.isLandscape ? 62 : 68;

    this.camera.aspect = width / Math.max(height, 1);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  public update(
    bikePos: THREE.Vector3,
    roadPose: RoadPose,
    bikeLean: number,
    dt: number,
    reducedMotion: boolean
  ): void {
    const behindDist = this.isLandscape ? 7.2 : 8.5;
    const camHeight = this.isLandscape ? 3.2 : 3.8;
    const lookAhead = 8.0;

    // Desired camera position: behind along tangent
    // tangent = (sin(h), -cos(h))
    const tanX = roadPose.tangentX;
    const tanZ = roadPose.tangentZ;

    const desiredX = bikePos.x - tanX * behindDist;
    const desiredY = bikePos.y + camHeight;
    const desiredZ = bikePos.z - tanZ * behindDist;

    const desiredTargetX = bikePos.x + tanX * lookAhead;
    const desiredTargetY = bikePos.y + 1.15;
    const desiredTargetZ = bikePos.z + tanZ * lookAhead;

    if (!this.initialized) {
      this.currentPos.set(desiredX, desiredY, desiredZ);
      this.currentTarget.set(desiredTargetX, desiredTargetY, desiredTargetZ);
      this.initialized = true;
    }

    // Frame-rate independent exponential interpolation
    // If reducedMotion, reduce lag significantly
    const posLambda = reducedMotion ? 18.0 : 6.5;
    const targetLambda = reducedMotion ? 20.0 : 8.0;

    this.currentPos.x = damp(this.currentPos.x, desiredX, posLambda, dt);
    this.currentPos.y = damp(this.currentPos.y, desiredY, posLambda, dt);
    this.currentPos.z = damp(this.currentPos.z, desiredZ, posLambda, dt);

    this.currentTarget.x = damp(this.currentTarget.x, desiredTargetX, targetLambda, dt);
    this.currentTarget.y = damp(this.currentTarget.y, desiredTargetY, targetLambda, dt);
    this.currentTarget.z = damp(this.currentTarget.z, desiredTargetZ, targetLambda, dt);

    // Camera roll: tiny roll in normal motion, zero in reducedMotion
    const targetRoll = reducedMotion ? 0.0 : bikeLean * 0.14;
    this.currentRoll = damp(this.currentRoll, targetRoll, 6.0, dt);

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentTarget);

    if (Math.abs(this.currentRoll) > 0.0001) {
      this.camera.rotateZ(-this.currentRoll);
    }
  }

  public rebase(deltaX: number, deltaZ: number): void {
    this.currentPos.x -= deltaX;
    this.currentPos.z -= deltaZ;
    this.currentTarget.x -= deltaX;
    this.currentTarget.z -= deltaZ;
    this.camera.position.copy(this.currentPos);
  }
}
