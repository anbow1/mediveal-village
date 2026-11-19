import { describe, expect, it } from 'vitest';
import { CAMERA, WORLD } from '../src/config.ts';
import { clampRtsGoal, freeCameraPose, groundPanDelta, rtsCameraPose, smoothRtsState, wrapAngleRad } from '../src/sim/cameraMath.ts';

describe('cameraMath (non-inverting RTS controls & bounds)', () => {
  it('pans screen-forward along the camera view direction without inverting at any yaw', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 1.23]) {
      const pose = rtsCameraPose({ targetX: 0, targetZ: 0, distanceM: 40, yawRad: yaw, pitchRad: 0.7 }, 0);
      // Horizontal view vector from eye toward target
      const viewX = pose.lookX - pose.eyeX;
      const viewZ = pose.lookZ - pose.eyeZ;
      const viewLen = Math.hypot(viewX, viewZ);
      const fwd = groundPanDelta(yaw, 0, 1, 10);
      // Forward pan must align positively with camera look direction on XZ plane
      const dotFwd = (fwd.dx * viewX + fwd.dz * viewZ) / (10 * viewLen);
      expect(dotFwd).toBeCloseTo(1, 5);

      // Right pan must be orthogonal to forward and point to camera's screen right (view x up)
      const right = groundPanDelta(yaw, 1, 0, 10);
      expect(right.dx * fwd.dx + right.dz * fwd.dz).toBeCloseTo(0, 5);
      // Cross product in XZ (fwd x right) should have positive Y (right-handed: -fwdX*rightZ + fwdZ*rightX < 0 -> right = (-viewZ, viewX))
      const expectedRightX = -viewZ / viewLen;
      const expectedRightZ = viewX / viewLen;
      expect(right.dx / 10).toBeCloseTo(expectedRightX, 5);
      expect(right.dz / 10).toBeCloseTo(expectedRightZ, 5);
    }
  });

  it('clamps target inside map bounds and distance/pitch inside configured limits', () => {
    const clamped = clampRtsGoal({
      targetX: 999,
      targetZ: -999,
      distanceM: 2,
      yawRad: Math.PI * 3.5,
      pitchRad: 5,
    });
    expect(clamped.targetX).toBe(WORLD.halfSizeM);
    expect(clamped.targetZ).toBe(-WORLD.halfSizeM);
    expect(clamped.distanceM).toBe(CAMERA.minDistanceM);
    expect(clamped.pitchRad).toBe(CAMERA.maxPitchRad);
    expect(Math.abs(clamped.yawRad)).toBeLessThanOrEqual(Math.PI);
  });

  it('smooths yaw across the +/-pi seam along the shortest arc', () => {
    const cur = { targetX: 0, targetZ: 0, distanceM: 50, yawRad: Math.PI - 0.1, pitchRad: 0.8 };
    const goal = { targetX: 0, targetZ: 0, distanceM: 50, yawRad: -Math.PI + 0.1, pitchRad: 0.8 };
    const next = smoothRtsState(cur, goal, 0.04, 0.08);
    // Shortest arc crosses +pi / -pi (distance 0.2 rad), never swings back through 0
    expect(Math.abs(wrapAngleRad(next.yawRad - Math.PI))).toBeLessThan(0.11);
  });

  it('computes free camera look vector at yaw=0 looking down -Z', () => {
    const pose = freeCameraPose({ x: 1, y: 1.7, z: 5, yawRad: 0, pitchRad: 0 });
    expect(pose.eyeX).toBe(1);
    expect(pose.eyeY).toBe(1.7);
    expect(pose.eyeZ).toBe(5);
    expect(pose.lookZ).toBeLessThan(pose.eyeZ);
    expect(pose.lookY).toBeCloseTo(1.7, 6);
  });
});
