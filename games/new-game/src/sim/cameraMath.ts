// Pure TS RTS & free-camera math (no three.js). Guarantees non-inverting pan/orbit controls.

import { CAMERA, WORLD } from '../config.ts';

export interface RtsCameraGoal {
  targetX: number;
  targetZ: number;
  distanceM: number;
  yawRad: number;
  pitchRad: number;
}

export interface FreeCameraPose {
  x: number;
  y: number;
  z: number;
  yawRad: number;
  pitchRad: number;
}

export interface CameraPose3D {
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function wrapAngleRad(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export function clampRtsGoal(goal: RtsCameraGoal, halfMapM: number = WORLD.halfSizeM): RtsCameraGoal {
  return {
    targetX: clamp(goal.targetX, -halfMapM, halfMapM),
    targetZ: clamp(goal.targetZ, -halfMapM, halfMapM),
    distanceM: clamp(goal.distanceM, CAMERA.minDistanceM, CAMERA.maxDistanceM),
    yawRad: wrapAngleRad(goal.yawRad),
    pitchRad: clamp(goal.pitchRad, CAMERA.minPitchRad, CAMERA.maxPitchRad),
  };
}

/**
 * Maps screen-aligned forward (+1 = top of screen) and right (+1 = right of screen) inputs
 * to world XZ deltas based on current camera yaw. Keys never invert at any yaw angle.
 */
export function groundPanDelta(yawRad: number, rightInput: number, forwardInput: number, distanceScaleM: number): { dx: number; dz: number } {
  // Camera looks from target + (sin(yaw), cos(yaw)) * horiz back toward target,
  // so forward on screen is (-sin(yaw), -cos(yaw)) and right on screen is (cos(yaw), -sin(yaw)).
  const fwdX = -Math.sin(yawRad);
  const fwdZ = -Math.cos(yawRad);
  const rightX = Math.cos(yawRad);
  const rightZ = -Math.sin(yawRad);
  return {
    dx: (rightX * rightInput + fwdX * forwardInput) * distanceScaleM,
    dz: (rightZ * rightInput + fwdZ * forwardInput) * distanceScaleM,
  };
}

/** Computes world eye and look-at coordinates for an RTS orbit camera above terrain height `groundY`. */
export function rtsCameraPose(state: RtsCameraGoal, groundY = 0): CameraPose3D {
  const horiz = Math.cos(state.pitchRad) * state.distanceM;
  const vert = Math.sin(state.pitchRad) * state.distanceM;
  return {
    eyeX: state.targetX + Math.sin(state.yawRad) * horiz,
    eyeY: groundY + vert,
    eyeZ: state.targetZ + Math.cos(state.yawRad) * horiz,
    lookX: state.targetX,
    lookY: groundY,
    lookZ: state.targetZ,
  };
}

/**
 * Computes look-at coordinates from an explicit eye position + yaw/pitch (used by
 * `window.__debug.place({x, y, z, yaw, pitch})` for fixed eye-height / 0.45 m shots).
 * Convention: yaw = 0 looks along -Z; pitch < 0 looks down, pitch > 0 looks up.
 */
export function freeCameraPose(pose: FreeCameraPose): CameraPose3D {
  const cp = Math.cos(pose.pitchRad);
  const dirX = -Math.sin(pose.yawRad) * cp;
  const dirY = Math.sin(pose.pitchRad);
  const dirZ = -Math.cos(pose.yawRad) * cp;
  return {
    eyeX: pose.x,
    eyeY: pose.y,
    eyeZ: pose.z,
    lookX: pose.x + dirX * 10,
    lookY: pose.y + dirY * 10,
    lookZ: pose.z + dirZ * 10,
  };
}

/** Exponentially approaches goal from current over dtS (shortest angular arc for yaw). */
export function smoothRtsState(current: RtsCameraGoal, goal: RtsCameraGoal, dtS: number, tauS = CAMERA.smoothTauS): RtsCameraGoal {
  const alpha = tauS <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dtS) / tauS);
  const yawDiff = wrapAngleRad(goal.yawRad - current.yawRad);
  return {
    targetX: current.targetX + (goal.targetX - current.targetX) * alpha,
    targetZ: current.targetZ + (goal.targetZ - current.targetZ) * alpha,
    distanceM: current.distanceM + (goal.distanceM - current.distanceM) * alpha,
    yawRad: wrapAngleRad(current.yawRad + yawDiff * alpha),
    pitchRad: current.pitchRad + (goal.pitchRad - current.pitchRad) * alpha,
  };
}
