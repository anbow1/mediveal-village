// Desktop + Touch RTS camera controller with free-camera debug override for exact view placement.

import type { PerspectiveCamera } from 'three/webgpu';
import { CAMERA } from '../config.ts';
import {
  clamp,
  clampRtsGoal,
  type FreeCameraPose,
  freeCameraPose,
  groundPanDelta,
  type RtsCameraGoal,
  rtsCameraPose,
  smoothRtsState,
  wrapAngleRad,
} from '../sim/cameraMath.ts';
import type { InputBindings } from './bindings.ts';
import type { BenchSpotCamera } from './bench.ts';

/** The orbit eye never goes nearer the ground, or a roof under it, than this. */
const CAMERA_CLEARANCE_M = 2.5;

export interface DebugPlaceArgs {
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  pitch?: number;
  turn?: number;
  distance?: number;
}

interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

export class RtsCameraController {
  goal: RtsCameraGoal = {
    targetX: 0,
    targetZ: 0,
    distanceM: CAMERA.defaultDistanceM,
    yawRad: 0.45,
    pitchRad: CAMERA.defaultPitchRad,
  };
  current: RtsCameraGoal = { ...this.goal };
  /** When non-null, camera holds an explicit world eye pose (used by debug shots & eye-height spots). */
  private freePose: FreeCameraPose | null = null;

  private dragMode: 'none' | 'pan' | 'rotate' = 'none';
  private lastPointerX = 0;
  private lastPointerY = 0;
  private readonly touches = new Map<number, TouchPoint>();
  private prevPinchDist = 0;
  private prevPinchAngle = 0;
  private prevPinchMidX = 0;
  private prevPinchMidY = 0;

  /** When false, right-drag is reserved for tactical regiment facing/placement (FPS/marchland controls). */
  canRightDragRotate: () => boolean = () => true;
  /** When false, 1-finger touch drag is reserved for regiment pose facing rotation (2-finger zoom/rotate still works). */
  canSingleTouchPan: () => boolean = () => true;

  /**
   * Height of whatever stands at (x, z) that the orbit eye must clear (roof ridges, the keep), or -Infinity.
   * Set by the game; up close the eye rides over buildings instead of ending up inside a wall or roof.
   */
  obstacleTopAt: (x: number, z: number) => number = () => -Infinity;

  private readonly cleanupFns: (() => void)[] = [];

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly element: HTMLElement,
    private readonly bindings: InputBindings,
    private readonly groundHeightAt: (x: number, z: number) => number = () => 0,
  ) {
    this.attachEvents();
    this.syncCamera();
  }

  private attachEvents(): void {
    const el = this.element;
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
    };
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button === 1) {
        this.dragMode = 'pan';
        this.freePose = null;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        e.preventDefault();
      } else if (e.button === 2 && !e.ctrlKey && this.canRightDragRotate()) {
        this.dragMode = 'rotate';
        this.freePose = null;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        e.preventDefault();
      }
    };
    const onMouseMove = (e: MouseEvent): void => {
      if (this.dragMode === 'none') return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      if (this.dragMode === 'pan') {
        const scale = (this.goal.distanceM / Math.max(1, el.clientHeight)) * 1.15;
        const delta = groundPanDelta(this.goal.yawRad, -dx, dy, scale);
        this.goal = clampRtsGoal({
          ...this.goal,
          targetX: this.goal.targetX + delta.dx,
          targetZ: this.goal.targetZ + delta.dz,
        });
      } else if (this.dragMode === 'rotate') {
        this.goal = clampRtsGoal({
          ...this.goal,
          yawRad: this.goal.yawRad - dx * 0.006,
          pitchRad: this.goal.pitchRad + dy * 0.0045,
        });
      }
    };
    const onMouseUp = (): void => {
      this.dragMode = 'none';
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.freePose = null;
      const dir = Math.sign(e.deltaY);
      const factor = 1 + dir * CAMERA.wheelZoomFactor;
      this.goal = clampRtsGoal({ ...this.goal, distanceM: this.goal.distanceM * factor });
    };

    // Touch controls: 1-finger pan, 2-finger pinch zoom + twist rotate + drag pan.
    const onTouchStart = (e: TouchEvent): void => {
      e.preventDefault();
      this.freePose = null;
      for (const t of Array.from(e.changedTouches)) {
        this.touches.set(t.identifier, { id: t.identifier, x: t.clientX, y: t.clientY });
      }
      if (this.touches.size === 2) this.initPinch();
    };
    const onTouchMove = (e: TouchEvent): void => {
      e.preventDefault();
      const prevSingle = this.touches.size === 1 ? [...this.touches.values()][0] : undefined;
      for (const t of Array.from(e.changedTouches)) {
        this.touches.set(t.identifier, { id: t.identifier, x: t.clientX, y: t.clientY });
      }
      if (this.touches.size === 1 && prevSingle && this.canSingleTouchPan()) {
        const cur = this.touches.get(prevSingle.id);
        if (cur) {
          const dx = cur.x - prevSingle.x;
          const dy = cur.y - prevSingle.y;
          const scale = (this.goal.distanceM / Math.max(1, el.clientHeight)) * 1.25;
          const delta = groundPanDelta(this.goal.yawRad, -dx, dy, scale);
          this.goal = clampRtsGoal({
            ...this.goal,
            targetX: this.goal.targetX + delta.dx,
            targetZ: this.goal.targetZ + delta.dz,
          });
        }
      } else if (this.touches.size === 2) {
        const pair = [...this.touches.values()];
        const a = pair[0];
        const b = pair[1];
        if (a && b) {
          const dist = Math.hypot(b.x - a.x, b.y - a.y);
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          const midX = (a.x + b.x) * 0.5;
          const midY = (a.y + b.y) * 0.5;
          if (this.prevPinchDist > 10 && dist > 10) {
            const zoomRatio = this.prevPinchDist / dist;
            const dAngle = wrapAngleRad(angle - this.prevPinchAngle);
            const scale = (this.goal.distanceM / Math.max(1, el.clientHeight)) * 1.1;
            const delta = groundPanDelta(this.goal.yawRad, -(midX - this.prevPinchMidX), midY - this.prevPinchMidY, scale);
            this.goal = clampRtsGoal({
              ...this.goal,
              targetX: this.goal.targetX + delta.dx,
              targetZ: this.goal.targetZ + delta.dz,
              distanceM: this.goal.distanceM * zoomRatio,
              yawRad: this.goal.yawRad + dAngle,
            });
          }
          this.prevPinchDist = dist;
          this.prevPinchAngle = angle;
          this.prevPinchMidX = midX;
          this.prevPinchMidY = midY;
        }
      }
    };
    const onTouchEnd = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) this.touches.delete(t.identifier);
      if (this.touches.size === 2) this.initPinch();
      else this.prevPinchDist = 0;
    };

    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    this.cleanupFns.push(
      () => el.removeEventListener('contextmenu', onContextMenu),
      () => el.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => el.removeEventListener('wheel', onWheel),
      () => el.removeEventListener('touchstart', onTouchStart),
      () => el.removeEventListener('touchmove', onTouchMove),
      () => el.removeEventListener('touchend', onTouchEnd),
      () => el.removeEventListener('touchcancel', onTouchEnd),
    );
  }

  private initPinch(): void {
    const pair = [...this.touches.values()];
    const a = pair[0];
    const b = pair[1];
    if (!a || !b) return;
    this.prevPinchDist = Math.hypot(b.x - a.x, b.y - a.y);
    this.prevPinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
    this.prevPinchMidX = (a.x + b.x) * 0.5;
    this.prevPinchMidY = (a.y + b.y) * 0.5;
  }

  rotateBy(deltaYawRad: number): void {
    this.freePose = null;
    this.goal = clampRtsGoal({ ...this.goal, yawRad: this.goal.yawRad + deltaYawRad });
  }

  /** Smoothly pans RTS camera to focus on world (x, z) (used by minimap, alerts, bottlenecks, Home). */
  jumpTo(x: number, z: number, immediate = false): void {
    this.freePose = null;
    this.goal = clampRtsGoal({ ...this.goal, targetX: x, targetZ: z });
    if (immediate) {
      this.current = { ...this.goal };
      this.syncCamera();
    }
  }

  getBookmark(): RtsCameraGoal {
    return { ...this.goal };
  }

  applyBookmark(bm: RtsCameraGoal): void {
    this.freePose = null;
    this.goal = clampRtsGoal({ ...bm });
  }

  applySpotCamera(cam: BenchSpotCamera): void {
    if (cam.mode === 'rts') {
      this.freePose = null;
      this.goal = clampRtsGoal(cam.goal);
      this.current = { ...this.goal };
    } else {
      this.freePose = { ...cam.pose };
    }
    this.syncCamera();
  }

  /** Debug contract placement (`tools/measure/README.md`: place({x, y, z, yaw, pitch})). */
  place(v: DebugPlaceArgs): void {
    if (v.distance !== undefined || (v.y === undefined && (v.x !== undefined || v.z !== undefined))) {
      this.freePose = null;
      this.goal = clampRtsGoal({
        targetX: v.x ?? this.goal.targetX,
        targetZ: v.z ?? this.goal.targetZ,
        distanceM: v.distance ?? this.goal.distanceM,
        yawRad: (v.yaw ?? this.goal.yawRad) + (v.turn ?? 0),
        pitchRad: v.pitch !== undefined ? clamp(v.pitch, CAMERA.minPitchRad, CAMERA.maxPitchRad) : this.goal.pitchRad,
      });
      this.current = { ...this.goal };
    } else {
      const base: FreeCameraPose = this.freePose ?? {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
        yawRad: this.current.yawRad,
        pitchRad: -this.current.pitchRad,
      };
      this.freePose = {
        x: v.x ?? base.x,
        y: v.y ?? base.y,
        z: v.z ?? base.z,
        yawRad: wrapAngleRad((v.yaw ?? base.yawRad) + (v.turn ?? 0)),
        pitchRad: clamp(v.pitch ?? base.pitchRad, -1.52, 1.52),
      };
    }
    this.syncCamera();
  }

  update(dtS: number): void {
    const right = (this.bindings.isHeld('panRight') ? 1 : 0) - (this.bindings.isHeld('panLeft') ? 1 : 0);
    const forward = (this.bindings.isHeld('panUp') ? 1 : 0) - (this.bindings.isHeld('panDown') ? 1 : 0);
    const rot = (this.bindings.isHeld('rotateRight') ? 1 : 0) - (this.bindings.isHeld('rotateLeft') ? 1 : 0);
    if (right !== 0 || forward !== 0 || rot !== 0) {
      this.freePose = null;
      const distFactor = Math.max(0.25, this.goal.distanceM / 50);
      const speed = CAMERA.panSpeedAt50mMs * distFactor * dtS;
      const delta = groundPanDelta(this.goal.yawRad, right, forward, speed);
      this.goal = clampRtsGoal({
        ...this.goal,
        targetX: this.goal.targetX + delta.dx,
        targetZ: this.goal.targetZ + delta.dz,
        yawRad: this.goal.yawRad + rot * CAMERA.rotateSpeedRadS * dtS,
      });
    }
    if (!this.freePose) {
      this.current = smoothRtsState(this.current, this.goal, dtS);
    }
    this.syncCamera();
  }

  syncCamera(): void {
    const pose = this.freePose
      ? freeCameraPose(this.freePose)
      : rtsCameraPose(this.current, this.groundHeightAt(this.current.targetX, this.current.targetZ));
    let eyeY = pose.eyeY;
    if (!this.freePose) {
      // Up close and level the eye could dip into a slope or a house behind it: keep it above both.
      const midX = (pose.eyeX + pose.lookX) / 2;
      const midZ = (pose.eyeZ + pose.lookZ) / 2;
      const floor = Math.max(
        this.groundHeightAt(pose.eyeX, pose.eyeZ),
        this.groundHeightAt(midX, midZ),
        this.obstacleTopAt(pose.eyeX, pose.eyeZ),
      );
      eyeY = Math.max(eyeY, floor + CAMERA_CLEARANCE_M);
    }
    this.camera.position.set(pose.eyeX, eyeY, pose.eyeZ);
    this.camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
    this.camera.updateMatrixWorld();
  }

  dispose(): void {
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns.length = 0;
  }
}
