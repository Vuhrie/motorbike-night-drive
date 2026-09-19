import * as THREE from 'three';
import { RendererProfile } from './config';

/**
 * Stars module converted safely to a disposable no-op.
 * Visible stars are managed and rendered fog-free in SkySystem to avoid duplication.
 */
export class Stars {
  public readonly group: THREE.Group;

  constructor(_seed?: number) {
    this.group = new THREE.Group();
  }

  public setProfile(_profile: RendererProfile): void {
    // No-op: stars handled in SkySystem
  }

  public update(
    _cameraPos: THREE.Vector3,
    _elapsedTime: number,
    _profile: RendererProfile,
    _reducedMotion: boolean
  ): void {
    // No-op: stars updated in SkySystem
  }

  public dispose(): void {
    this.group.clear();
  }
}
