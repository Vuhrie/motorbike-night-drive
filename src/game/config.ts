export type GameMode = 'ready' | 'running' | 'paused';

export interface RideState {
  mode: GameMode;
  distanceAlongRoad: number;
  speed: number;
  targetSpeed: number;
  lateralOffset: number;
  lateralVelocity: number;
  steerInput: number;
  offRoadAmount: number;
  elapsedTime: number;
  startElapsedTime: number;
}

export interface PathSample {
  s: number;
  x: number;
  z: number;
  heading: number;
  tangentX: number;
  tangentZ: number;
  rightX: number;
  rightZ: number;
  curvature: number;
}

export interface RoadSection {
  startS: number;
  endS: number;
  startHeading: number;
  targetHeading: number;
  startX: number;
  startZ: number;
}

export interface RoadPose {
  s: number;
  x: number;
  z: number;
  heading: number;
  tangentX: number;
  tangentZ: number;
  rightX: number;
  rightZ: number;
  curvature: number;
}

export interface RendererProfile {
  id: 'desktop' | 'mobile';
  behindDistance: number;
  aheadDistance: number;
  maxDpr: number;
  starCount: number;
  treeCount: number;
  rockCount: number;
  reflectorCount: number;
  reflectorSpacing: number;
  maxDrawCalls: number;
  skyStarCount: number;
  maxShootingStars: number;
  skyDomeResolution: [number, number];
  pointLightCount: number;
}

export const SAMPLE_SPACING = 5;
export const SECTION_MIN_LENGTH = 110;
export const SECTION_MAX_LENGTH = 240;
export const HEADING_DELTA_MAX = (18 * Math.PI) / 180;
export const HEADING_GLOBAL_CLAMP = (24 * Math.PI) / 180;

export const ROAD_WIDTH = 8.4;
export const ROAD_HALF_WIDTH = 4.2;
export const SHOULDER_WIDTH = 1.25;
export const OUTER_HALF_WIDTH = 5.45;
export const TERRAIN_HALF_WIDTH = 42;

export const CHUNK_LENGTH = 30;
export const POOLED_CHUNK_COUNT = 28;

export const REBASE_DISTANCE = 20000;

export const LATERAL_CLAMP = 7.25;
export const OFF_ROAD_START = 3.75;
export const CENTER_FORCE_THRESHOLD_1 = 4.2;
export const CENTER_FORCE_THRESHOLD_2 = 6.0;

export const CRUISE_SPEED = 22;
export const OFF_ROAD_TARGET_SPEED = 12;
export const STARTUP_EASE_DURATION = 1.75;

export const ASPHALT_Y = 0;
export const MARKINGS_Y = 0.015;
export const SHOULDERS_Y = -0.015;
export const TERRAIN_Y = -0.05;

export const EDGE_LINE_OFFSET = 4.0;
export const EDGE_LINE_WIDTH = 0.16;
export const CENTER_DASH_LENGTH = 3.0;
export const CENTER_DASH_PERIOD = 8.0;
export const CENTER_DASH_WIDTH = 0.18;

export const DESKTOP_PROFILE: RendererProfile = {
  id: 'desktop',
  behindDistance: 100,
  aheadDistance: 600,
  maxDpr: 1.75,
  starCount: 800,
  treeCount: 180,
  rockCount: 50,
  reflectorCount: 80,
  reflectorSpacing: 18,
  maxDrawCalls: 50,
  skyStarCount: 1800,
  maxShootingStars: 2,
  skyDomeResolution: [1024, 512],
  pointLightCount: 4,
};

export const MOBILE_PROFILE: RendererProfile = {
  id: 'mobile',
  behindDistance: 100,
  aheadDistance: 420,
  maxDpr: 1.35,
  starCount: 450,
  treeCount: 90,
  rockCount: 25,
  reflectorCount: 55,
  reflectorSpacing: 20,
  maxDrawCalls: 35,
  skyStarCount: 900,
  maxShootingStars: 1,
  skyDomeResolution: [512, 256],
  pointLightCount: 2,
};

export const FOG_NEAR = 120;
export const FOG_FAR = 760;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 900;
export const MAX_DELTA_TIME = 0.05;

export const PALETTE = {
  background: 0x101a2b,
  fog: 0x101a2b,
  ambientLight: 0x86a6d8,
  hemiGround: 0x172131,
  directionalLight: 0xbfd6ff,
  asphalt: 0x222b3d,
  shoulder: 0x182130,
  terrain: 0x121a27,
  marking: 0xf1f5f9,
  mountainNear: 0x1b273d,
  mountainMid: 0x152033,
  mountainFar: 0x111b2d,
  treeTrunk: 0x253042,
  treeFoliage: 0x1a383b,
  treeFoliageAlt: 0x204246,
  rock: 0x273448,
  rockAlt: 0x314056,
  reflectorPost: 0x475569,
  reflectorAmber: 0xf59e0b,
  reflectorWhite: 0xf8fafc,
  bikeBody: 0x0284c7,
  bikeFrame: 0x2a3649,
  bikeEngine: 0x3d4b61,
  bikeWheel: 0x151e2e,
  bikeFork: 0x78889e,
  bikeSeat: 0x151e2e,
  bikeTailLight: 0xff1e56,
  riderJacket: 0x263347,
  riderHelmet: 0x38bdf8,
  riderVisor: 0x090f1a,
};
