import {
  SAMPLE_SPACING,
  SECTION_MIN_LENGTH,
  SECTION_MAX_LENGTH,
  HEADING_DELTA_MAX,
  HEADING_GLOBAL_CLAMP,
  PathSample,
  RoadPose,
  RoadSection,
} from './config';
import { clamp, lerp, smootherstep } from './math';
import { createRNG } from './rng';

export class RoadPath {
  private rng: () => number;
  private samples: PathSample[] = [];
  private sections: RoadSection[] = [];
  private currentSectionIndex = 0;
  private maxGeneratedS = 0;

  // Reusable pose object to avoid allocations in hot loop
  private readonly cachedPose: RoadPose = {
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

  constructor(seed: number) {
    this.rng = createRNG(seed);
    this.initStarterRoute();
  }

  private initStarterRoute(): void {
    this.samples = [];
    this.sections = [];

    // Starter section: s = -150 to s = 80, heading = 0
    const startS = -150;
    const endS = 80;
    const starterSection: RoadSection = {
      startS,
      endS,
      startHeading: 0,
      targetHeading: 0,
      startX: 0,
      startZ: -startS, // so at s=0, z=0
    };
    this.sections.push(starterSection);

    for (let s = startS; s <= endS; s += SAMPLE_SPACING) {
      this.samples.push({
        s,
        x: 0,
        z: -s,
        heading: 0,
        tangentX: 0,
        tangentZ: -1,
        rightX: 1,
        rightZ: 0,
        curvature: 0,
      });
    }

    this.maxGeneratedS = endS;
  }

  private getHeadingAndCurvatureAt(s: number, section: RoadSection): { heading: number; curvature: number } {
    const len = section.endS - section.startS;
    if (len <= 0.0001) {
      return { heading: section.startHeading, curvature: 0 };
    }
    const u = clamp((s - section.startS) / len, 0, 1);
    const smoothT = smootherstep(0, 1, u);
    const heading = lerp(section.startHeading, section.targetHeading, smoothT);

    // Derivative of smootherstep: 30 * u^2 * (1 - u)^2
    const dSmoothDu = 30 * u * u * (1 - u) * (1 - u);
    const curvature = ((section.targetHeading - section.startHeading) / len) * dSmoothDu;

    return { heading, curvature };
  }

  public generateUntil(targetS: number): void {
    while (this.maxGeneratedS < targetS) {
      const prevSection = this.sections[this.sections.length - 1]!;
      const lastSample = this.samples[this.samples.length - 1]!;

      const sectionLen = SECTION_MIN_LENGTH + this.rng() * (SECTION_MAX_LENGTH - SECTION_MIN_LENGTH);
      const startS = prevSection.endS;
      const endS = startS + sectionLen;

      const deltaHeading = (this.rng() * 2 - 1) * HEADING_DELTA_MAX;
      const targetHeading = clamp(
        prevSection.targetHeading + deltaHeading,
        -HEADING_GLOBAL_CLAMP,
        HEADING_GLOBAL_CLAMP
      );

      const section: RoadSection = {
        startS,
        endS,
        startHeading: prevSection.targetHeading,
        targetHeading,
        startX: lastSample.x,
        startZ: lastSample.z,
      };
      this.sections.push(section);

      // Integrate samples every SAMPLE_SPACING (5m)
      let currS = lastSample.s;
      let currX = lastSample.x;
      let currZ = lastSample.z;

      while (currS + SAMPLE_SPACING <= endS) {
        const midS = currS + 0.5 * SAMPLE_SPACING;
        const nextS = currS + SAMPLE_SPACING;

        const { heading: midHeading } = this.getHeadingAndCurvatureAt(midS, section);
        const { heading: nextHeading, curvature: nextCurvature } = this.getHeadingAndCurvatureAt(nextS, section);

        // tangent = (sin(h), -cos(h))
        const midTanX = Math.sin(midHeading);
        const midTanZ = -Math.cos(midHeading);

        currX += midTanX * SAMPLE_SPACING;
        currZ += midTanZ * SAMPLE_SPACING;
        currS = nextS;

        const tanX = Math.sin(nextHeading);
        const tanZ = -Math.cos(nextHeading);
        const rightX = Math.cos(nextHeading);
        const rightZ = Math.sin(nextHeading);

        this.samples.push({
          s: currS,
          x: currX,
          z: currZ,
          heading: nextHeading,
          tangentX: tanX,
          tangentZ: tanZ,
          rightX,
          rightZ,
          curvature: nextCurvature,
        });
      }

      this.maxGeneratedS = currS;
    }
  }

  public pruneBefore(minS: number): void {
    if (this.samples.length === 0) return;

    let pruneIndex = 0;
    // Keep at least two samples behind minS for interpolation
    while (pruneIndex < this.samples.length - 4 && (this.samples[pruneIndex + 2]?.s ?? 0) < minS) {
      pruneIndex++;
    }

    if (pruneIndex > 0) {
      this.samples.splice(0, pruneIndex);
    }

    // Also prune completed sections that are far behind
    while (this.sections.length > 1 && (this.sections[0]?.endS ?? 0) < minS - 50) {
      this.sections.shift();
      if (this.currentSectionIndex > 0) {
        this.currentSectionIndex--;
      }
    }
  }

  public getPose(s: number, out?: RoadPose): RoadPose {
    const result = out ?? this.cachedPose;

    if (this.samples.length === 0) {
      result.s = s;
      result.x = 0;
      result.z = -s;
      result.heading = 0;
      result.tangentX = 0;
      result.tangentZ = -1;
      result.rightX = 1;
      result.rightZ = 0;
      result.curvature = 0;
      return result;
    }

    const firstSample = this.samples[0]!;
    const lastSample = this.samples[this.samples.length - 1]!;

    if (s <= firstSample.s) {
      result.s = s;
      const ds = s - firstSample.s;
      result.x = firstSample.x + firstSample.tangentX * ds;
      result.z = firstSample.z + firstSample.tangentZ * ds;
      result.heading = firstSample.heading;
      result.tangentX = firstSample.tangentX;
      result.tangentZ = firstSample.tangentZ;
      result.rightX = firstSample.rightX;
      result.rightZ = firstSample.rightZ;
      result.curvature = firstSample.curvature;
      return result;
    }

    if (s >= lastSample.s) {
      result.s = s;
      const ds = s - lastSample.s;
      result.x = lastSample.x + lastSample.tangentX * ds;
      result.z = lastSample.z + lastSample.tangentZ * ds;
      result.heading = lastSample.heading;
      result.tangentX = lastSample.tangentX;
      result.tangentZ = lastSample.tangentZ;
      result.rightX = lastSample.rightX;
      result.rightZ = lastSample.rightZ;
      result.curvature = lastSample.curvature;
      return result;
    }

    // Direct uniform index lookup O(1)
    const rawIdx = Math.floor((s - firstSample.s) / SAMPLE_SPACING);
    const idx = clamp(rawIdx, 0, this.samples.length - 2);
    const s0 = this.samples[idx]!;
    const s1 = this.samples[idx + 1]!;

    const sampleLen = s1.s - s0.s;
    const t = sampleLen > 0 ? (s - s0.s) / sampleLen : 0;

    result.s = s;
    result.x = lerp(s0.x, s1.x, t);
    result.z = lerp(s0.z, s1.z, t);
    result.heading = lerp(s0.heading, s1.heading, t);
    result.tangentX = Math.sin(result.heading);
    result.tangentZ = -Math.cos(result.heading);
    result.rightX = Math.cos(result.heading);
    result.rightZ = Math.sin(result.heading);
    result.curvature = lerp(s0.curvature, s1.curvature, t);

    return result;
  }

  public rebase(deltaX: number, deltaZ: number): void {
    for (let i = 0; i < this.samples.length; i++) {
      const samp = this.samples[i]!;
      samp.x -= deltaX;
      samp.z -= deltaZ;
    }
    for (let i = 0; i < this.sections.length; i++) {
      const sec = this.sections[i]!;
      sec.startX -= deltaX;
      sec.startZ -= deltaZ;
    }
  }

  public getSampleCount(): number {
    return this.samples.length;
  }

  public getFirstS(): number {
    return this.samples[0]?.s ?? 0;
  }

  public getLastS(): number {
    return this.samples[this.samples.length - 1]?.s ?? 0;
  }
}
