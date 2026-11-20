// Stage 6 RTS World Input Controller (Desktop Mouse + Touch, BRIEF.md F23 & docs/GAMEPLAY.md §1):
// - Analytical raymarch terrain picking (zero Three.js mesh raycast cost, < 0.05 ms!)
// - Left-click & left-drag marquee selection box + double-click same-type select
// - Right-click context orders (march / run on double-click / attack enemy / siege / garrison watchtower)
// - Shift order queuing + Ctrl+right-drag live formation line & width (4..12) facing left of drag!
// - Free building placement ghost (green/red + rejection tooltip), R rotate, Road/Wall/Gate placement!
// - Control groups (Ctrl+1..9 / 1..9 + double-tap center) and Camera bookmarks (Ctrl+F5..F8 / F5..F8)!

import { Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three/webgpu';
import { BUILDING_DEFS, UNIT_DEFS, WORLD, type BuildingTypeId } from '../config.ts';
import type { FormationGhostPreview, PlacementGhostPreview } from '../render/combatFx.ts';
import { countAliveSoldiers } from '../sim/combat.ts';
import type { SimEngine } from '../sim/engine.ts';
import type { PlacementRejectionReason, RegimentEntity, SimCommand } from '../sim/types.ts';
import type { RtsCameraGoal } from '../sim/cameraMath.ts';
import type { RtsCameraController } from './rtsCamera.ts';

export type PlacementTool =
  | null
  | { readonly kind: 'building'; readonly buildingType: BuildingTypeId }
  | { readonly kind: 'road' }
  | { readonly kind: 'wall' }
  | { readonly kind: 'gate' };

export interface RtsInputCallbacks {
  readonly getSim: () => SimEngine;
  readonly isPlaying: () => boolean;
  readonly onExecute: (cmd: SimCommand) => boolean;
  readonly onPlayUiSound: (kind: 'uiClick' | 'uiError' | 'horn') => void;
  readonly onSelectionChanged: () => void;
  readonly onPlacementHover: (reason: PlacementRejectionReason | null, screenX: number, screenY: number) => void;
}

export class RtsInputController {
  readonly selectedRegimentIds = new Set<number>();
  selectedBuildingId: number | null = null;
  placementTool: PlacementTool = null;
  placementYawRad = 0;

  readonly controlGroups = new Map<number, number[]>();
  readonly cameraBookmarks = new Map<number, RtsCameraGoal>();

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly rayPt = new Vector3();

  private readonly marqueeEl: HTMLDivElement;
  private leftDown = false;
  private leftStartX = 0;
  private leftStartY = 0;
  private lastLeftClickMs = 0;
  private lastLeftClickRegId = -1;

  private rightDown = false;
  private rightStartX = 0;
  private rightStartY = 0;
  private rightStartWorld: { x: number; z: number } | null = null;
  private rightFormationDrag = false;
  private lastRightClickMs = 0;

  private lineDragStart: { x: number; z: number } | null = null;
  private hoverWorld: { x: number; z: number } | null = null;
  private lastHoverReason: PlacementRejectionReason | null = null;

  private lastGroupTapKey = -1;
  private lastGroupTapMs = 0;

  private formationGhost: FormationGhostPreview | null = null;
  private placementGhost: PlacementGhostPreview | null = null;

  private touchLongPressTimer: number | null = null;
  private touchStartX = 0;
  private touchStartY = 0;

  private readonly cleanupFns: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: PerspectiveCamera,
    private readonly camCtrl: RtsCameraController,
    private readonly cb: RtsInputCallbacks,
  ) {
    this.marqueeEl = document.createElement('div');
    this.marqueeEl.className = 'rts-marquee hidden';
    canvas.parentElement?.appendChild(this.marqueeEl);
    this.attachEvents();
  }

  getFormationGhost(): FormationGhostPreview | null {
    return this.formationGhost;
  }

  getPlacementGhost(): PlacementGhostPreview | null {
    return this.placementGhost;
  }

  setPlacementTool(tool: PlacementTool): void {
    this.placementTool = tool;
    this.lineDragStart = null;
    this.placementGhost = null;
    if (!tool) {
      this.cb.onPlacementHover(null, 0, 0);
    }
    this.cb.onSelectionChanged();
  }

  rotatePlacement(stepRad = Math.PI * 0.25): void {
    this.placementYawRad = (this.placementYawRad + stepRad) % (Math.PI * 2);
    if (this.placementGhost) {
      this.placementGhost = { ...this.placementGhost, yawRad: this.placementYawRad };
    }
  }

  selectRegiments(ids: readonly number[], additive = false): void {
    if (!additive) {
      this.selectedRegimentIds.clear();
      this.selectedBuildingId = null;
    }
    for (const id of ids) this.selectedRegimentIds.add(id);
    this.cb.onSelectionChanged();
  }

  selectBuilding(buildingId: number | null): void {
    this.selectedRegimentIds.clear();
    this.selectedBuildingId = buildingId;
    this.cb.onSelectionChanged();
  }

  selectAllPlayerArmy(): void {
    const sim = this.cb.getSim();
    this.selectedRegimentIds.clear();
    this.selectedBuildingId = null;
    for (const r of sim.state.regiments) {
      if (r.side === 0 && countAliveSoldiers(r) > 0) {
        this.selectedRegimentIds.add(r.id);
      }
    }
    this.cb.onSelectionChanged();
  }

  handleGroupKey(groupNum: number, ctrlHeld: boolean): void {
    const sim = this.cb.getSim();
    if (ctrlHeld) {
      if (this.selectedRegimentIds.size > 0) {
        this.controlGroups.set(groupNum, [...this.selectedRegimentIds]);
        this.cb.onPlayUiSound('uiClick');
        this.cb.onSelectionChanged();
      }
      return;
    }
    const ids = (this.controlGroups.get(groupNum) ?? []).filter((id) =>
      sim.state.regiments.some((r) => r.id === id && r.side === 0 && countAliveSoldiers(r) > 0),
    );
    if (ids.length === 0) return;
    this.selectRegiments(ids, false);

    const now = performance.now();
    if (this.lastGroupTapKey === groupNum && now - this.lastGroupTapMs < 400) {
      // Double-tap group key centers camera on group!
      let sx = 0;
      let sz = 0;
      let cnt = 0;
      for (const id of ids) {
        const r = sim.state.regiments.find((x) => x.id === id);
        if (r) {
          sx += r.x;
          sz += r.z;
          cnt++;
        }
      }
      if (cnt > 0) this.camCtrl.jumpTo(sx / cnt, sz / cnt);
    }
    this.lastGroupTapKey = groupNum;
    this.lastGroupTapMs = now;
  }

  handleBookmarkKey(slot: number, ctrlHeld: boolean): void {
    if (ctrlHeld) {
      this.cameraBookmarks.set(slot, this.camCtrl.getBookmark());
      this.cb.onPlayUiSound('uiClick');
    } else {
      const bm = this.cameraBookmarks.get(slot);
      if (bm) this.camCtrl.applyBookmark(bm);
    }
  }

  /** Prunes dead regiment IDs and destroyed building selection cleanly every frame. */
  pruneDeadSelections(): void {
    const sim = this.cb.getSim();
    let changed = false;
    for (const id of [...this.selectedRegimentIds]) {
      const r = sim.state.regiments.find((x) => x.id === id);
      if (!r || countAliveSoldiers(r) === 0) {
        this.selectedRegimentIds.delete(id);
        changed = true;
      }
    }
    if (this.selectedBuildingId !== null) {
      const b = sim.state.buildings.find((x) => x.id === this.selectedBuildingId && x.hp > 0);
      if (!b) {
        this.selectedBuildingId = null;
        changed = true;
      }
    }
    if (changed) this.cb.onSelectionChanged();
  }

  /** Fast analytic terrain raymarch picking screen (clientX, clientY) -> world (x, z). */
  screenToGround(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    if (direction.y >= -0.01) return null;

    const terrain = this.cb.getSim().terrain;
    let prevT = 0;
    const maxT = 650;
    const stepT = 6.0;
    for (let t = stepT; t <= maxT; t += stepT) {
      const x = origin.x + direction.x * t;
      const y = origin.y + direction.y * t;
      const z = origin.z + direction.z * t;
      if (y <= terrain.heightAt(x, z)) {
        // Binary refine intersection to < 0.05 m precision!
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 7; k++) {
          const mid = (lo + hi) * 0.5;
          const mx = origin.x + direction.x * mid;
          const my = origin.y + direction.y * mid;
          const mz = origin.z + direction.z * mid;
          if (my <= terrain.heightAt(mx, mz)) hi = mid;
          else lo = mid;
        }
        const fx = origin.x + direction.x * hi;
        const fz = origin.z + direction.z * hi;
        if (Math.abs(fx) > WORLD.halfSizeM || Math.abs(fz) > WORLD.halfSizeM) return null;
        return { x: fx, z: fz };
      }
      prevT = t;
    }
    return null;
  }

  private worldToScreen(wx: number, wy: number, wz: number): { x: number; y: number; visible: boolean } {
    const rect = this.canvas.getBoundingClientRect();
    this.rayPt.set(wx, wy, wz).project(this.camera);
    return {
      x: rect.left + (this.rayPt.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-this.rayPt.y * 0.5 + 0.5) * rect.height,
      visible: this.rayPt.z >= -1 && this.rayPt.z <= 1,
    };
  }

  private pickNearestRegiment(wx: number, wz: number, sideFilter?: 0 | 1, radiusM = 7.5): RegimentEntity | null {
    const sim = this.cb.getSim();
    let best: RegimentEntity | null = null;
    let bestD = radiusM;
    for (const r of sim.state.regiments) {
      if (sideFilter !== undefined && r.side !== sideFilter) continue;
      if (r.garrisonedInBuildingId !== null || countAliveSoldiers(r) === 0) continue;
      const d = Math.hypot(r.x - wx, r.z - wz);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  private pickNearestBuilding(wx: number, wz: number, sideFilter?: 0 | 1): number | null {
    const sim = this.cb.getSim();
    let bestId: number | null = null;
    let bestD = Infinity;
    for (const b of sim.state.buildings) {
      if (b.hp <= 0) continue;
      if (sideFilter !== undefined && b.side !== sideFilter) continue;
      const rad = BUILDING_DEFS[b.type].radiusM + 2.5;
      const d = Math.hypot(b.x - wx, b.z - wz);
      if (d <= rad && d < bestD) {
        bestD = d;
        bestId = b.id;
      }
    }
    return bestId;
  }

  /** Issues a right-click context order at world `(wx, wz)` (also callable from Minimap right-click!). */
  issueContextOrderAt(wx: number, wz: number, queue: boolean, forceRun = false): void {
    if (this.selectedRegimentIds.size === 0) return;
    const sim = this.cb.getSim();
    const ids = [...this.selectedRegimentIds];

    // 1. Enemy regiment under cursor -> attack / cavalry charge!
    const enemyReg = this.pickNearestRegiment(wx, wz, 1, 8.5);
    if (enemyReg) {
      for (const id of ids) {
        const reg = sim.state.regiments.find((r) => r.id === id);
        if (!reg) continue;
        const kind = UNIT_DEFS[reg.unitType].unitClass === 'cavalry' ? 'charge' : 'attack';
        this.cb.onExecute({
          type: 'issueOrder',
          side: 0,
          regimentIds: [id],
          order: { kind, x: enemyReg.x, z: enemyReg.z, targetRegimentId: enemyReg.id },
          queue,
        });
      }
      this.cb.onPlayUiSound('horn');
      return;
    }

    // 2. Enemy building or wall under cursor -> siege attack!
    const enemyBldId = this.pickNearestBuilding(wx, wz, 1);
    if (enemyBldId !== null) {
      const b = sim.state.buildings.find((x) => x.id === enemyBldId)!;
      this.cb.onExecute({
        type: 'issueOrder',
        side: 0,
        regimentIds: ids,
        order: { kind: 'attack', x: b.x, z: b.z, targetBuildingId: b.id },
        queue,
      });
      this.cb.onPlayUiSound('horn');
      return;
    }

    const enemyWall =
      sim.state.walls.find((w) => w.side === 1 && !w.destroyed && Math.hypot(w.x - wx, w.z - wz) < 5) ??
      sim.state.gates.find((g) => g.side === 1 && !g.destroyed && Math.hypot(g.x - wx, g.z - wz) < 5);
    if (enemyWall) {
      this.cb.onExecute({
        type: 'issueOrder',
        side: 0,
        regimentIds: ids,
        order: { kind: 'attack', x: enemyWall.x, z: enemyWall.z, targetWallId: enemyWall.id },
        queue,
      });
      this.cb.onPlayUiSound('horn');
      return;
    }

    // 3. Own Watchtower under cursor -> garrison archers/crossbowmen!
    const ownBldId = this.pickNearestBuilding(wx, wz, 0);
    if (ownBldId !== null) {
      const ob = sim.state.buildings.find((x) => x.id === ownBldId);
      if (ob && ob.type === 'watchtower' && ob.buildProgress >= 1) {
        const rangedIds = ids.filter((id) => {
          const r = sim.state.regiments.find((x) => x.id === id);
          return r && (r.unitType === 'archers' || r.unitType === 'crossbowmen');
        });
        if (rangedIds.length > 0) {
          this.cb.onExecute({
            type: 'issueOrder',
            side: 0,
            regimentIds: rangedIds,
            order: { kind: 'garrison', x: ob.x, z: ob.z, targetBuildingId: ob.id },
            queue,
          });
          this.cb.onPlayUiSound('uiClick');
          return;
        }
      }
    }

    // 4. Open ground -> fan out multi-regiment line march (or run on double right-click!)
    const kind = forceRun ? 'run' : 'march';
    if (ids.length === 1) {
      const reg = sim.state.regiments.find((r) => r.id === ids[0]);
      const facing = reg ? Math.atan2(wx - reg.x, wz - reg.z) : 0;
      this.cb.onExecute({
        type: 'issueOrder',
        side: 0,
        regimentIds: ids,
        order: { kind, x: wx, z: wz, facingYawRad: facing },
        queue,
      });
    } else {
      let cx = 0;
      let cz = 0;
      let cnt = 0;
      for (const id of ids) {
        const r = sim.state.regiments.find((x) => x.id === id);
        if (r) {
          cx += r.x;
          cz += r.z;
          cnt++;
        }
      }
      const facing = cnt > 0 ? Math.atan2(wx - cx / cnt, wz - cz / cnt) : 0;
      const rx = Math.cos(facing);
      const rz = -Math.sin(facing);
      const spacing = 12;
      for (let i = 0; i < ids.length; i++) {
        const off = (i - (ids.length - 1) * 0.5) * spacing;
        this.cb.onExecute({
          type: 'issueOrder',
          side: 0,
          regimentIds: [ids[i]!],
          order: { kind, x: wx + rx * off, z: wz + rz * off, facingYawRad: facing },
          queue,
        });
      }
    }
    this.cb.onPlayUiSound('uiClick');
  }

  private updatePlacementPreview(clientX: number, clientY: number): void {
    if (!this.placementTool) {
      this.placementGhost = null;
      return;
    }
    const pt = this.screenToGround(clientX, clientY);
    this.hoverWorld = pt;
    if (!pt) {
      this.placementGhost = null;
      this.cb.onPlacementHover(null, clientX, clientY);
      return;
    }

    const sim = this.cb.getSim();
    if (this.placementTool.kind === 'building') {
      const reason = sim.validatePlacement(0, this.placementTool.buildingType, pt.x, pt.z, this.placementYawRad, true);
      this.lastHoverReason = reason;
      this.placementGhost = {
        active: true,
        mode: 'building',
        buildingType: this.placementTool.buildingType,
        x: pt.x,
        z: pt.z,
        yawRad: this.placementYawRad,
        valid: reason === 'ok',
      };
      this.cb.onPlacementHover(reason, clientX, clientY);
    } else if (this.placementTool.kind === 'gate') {
      const valid =
        sim.terrain.waterDepthAt(pt.x, pt.z) <= 0.1 &&
        !sim.terrain.isImpassable(pt.x, pt.z) &&
        sim.state.sides[0].stock.timber >= 20 &&
        sim.state.sides[0].stock.stone >= 12;
      const reason: PlacementRejectionReason = valid ? 'ok' : sim.terrain.waterDepthAt(pt.x, pt.z) > 0.1 ? 'water' : 'insufficientResources';
      this.lastHoverReason = reason;
      this.placementGhost = {
        active: true,
        mode: 'gate',
        x: pt.x,
        z: pt.z,
        yawRad: this.placementYawRad,
        valid,
      };
      this.cb.onPlacementHover(reason, clientX, clientY);
    } else {
      // Road or Wall drag preview
      const start = this.lineDragStart ?? pt;
      const valid = sim.terrain.waterDepthAt(pt.x, pt.z) <= 0.1 && !sim.terrain.isImpassable(pt.x, pt.z);
      this.placementGhost = {
        active: true,
        mode: this.placementTool.kind,
        x: start.x,
        z: start.z,
        x1: pt.x,
        z1: pt.z,
        yawRad: 0,
        valid,
      };
      this.cb.onPlacementHover(valid ? 'ok' : 'blocked', clientX, clientY);
    }
  }

  private attachEvents(): void {
    const el = this.canvas;

    const onMouseDown = (e: MouseEvent): void => {
      if (!this.cb.isPlaying()) return;
      if (e.button === 0) {
        const pt = this.screenToGround(e.clientX, e.clientY);
        if (this.placementTool) {
          if (pt) {
            if (this.placementTool.kind === 'building') {
              const ok = this.cb.onExecute({
                type: 'placeBuilding',
                side: 0,
                buildingType: this.placementTool.buildingType,
                x: pt.x,
                z: pt.z,
                yawRad: this.placementYawRad,
              });
              this.cb.onPlayUiSound(ok ? 'uiClick' : 'uiError');
              if (ok && !e.shiftKey) this.setPlacementTool(null);
            } else if (this.placementTool.kind === 'gate') {
              const ok = this.cb.onExecute({
                type: 'placeGate',
                side: 0,
                x: pt.x,
                z: pt.z,
                yawRad: this.placementYawRad,
              });
              this.cb.onPlayUiSound(ok ? 'uiClick' : 'uiError');
              if (ok && !e.shiftKey) this.setPlacementTool(null);
            } else {
              // Road / Wall drag start
              this.lineDragStart = pt;
            }
          }
          return;
        }

        // Start marquee / click selection
        this.leftDown = true;
        this.leftStartX = e.clientX;
        this.leftStartY = e.clientY;
      } else if (e.button === 2) {
        if (this.placementTool) {
          this.setPlacementTool(null);
          this.cb.onPlayUiSound('uiClick');
          return;
        }
        this.rightDown = true;
        this.rightStartX = e.clientX;
        this.rightStartY = e.clientY;
        this.rightStartWorld = this.screenToGround(e.clientX, e.clientY);
        this.rightFormationDrag = e.ctrlKey && this.selectedRegimentIds.size > 0 && this.rightStartWorld !== null;
      }
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (!this.cb.isPlaying()) return;
      if (this.placementTool) {
        this.updatePlacementPreview(e.clientX, e.clientY);
        return;
      }

      if (this.leftDown) {
        const dx = e.clientX - this.leftStartX;
        const dy = e.clientY - this.leftStartY;
        if (Math.hypot(dx, dy) > 6) {
          this.marqueeEl.classList.remove('hidden');
          const x = Math.min(this.leftStartX, e.clientX);
          const y = Math.min(this.leftStartY, e.clientY);
          this.marqueeEl.style.left = `${x}px`;
          this.marqueeEl.style.top = `${y}px`;
          this.marqueeEl.style.width = `${Math.abs(dx)}px`;
          this.marqueeEl.style.height = `${Math.abs(dy)}px`;
        }
      }

      if (this.rightDown && this.rightFormationDrag && this.rightStartWorld) {
        const cur = this.screenToGround(e.clientX, e.clientY);
        if (cur) {
          const dx = cur.x - this.rightStartWorld.x;
          const dz = cur.z - this.rightStartWorld.z;
          const len = Math.hypot(dx, dz);
          const cx = (this.rightStartWorld.x + cur.x) * 0.5;
          const cz = (this.rightStartWorld.z + cur.z) * 0.5;
          // Facing perpendicular-left of drag vector (docs/GAMEPLAY.md §1)!
          const yawRad = len > 1.0 ? Math.atan2(-dz, dx) : 0;
          const width = Math.max(4, Math.min(12, Math.round(len / 1.65)));
          const sim = this.cb.getSim();
          const firstReg = sim.state.regiments.find((r) => this.selectedRegimentIds.has(r.id));
          this.formationGhost = {
            active: true,
            x: cx,
            z: cz,
            yawRad,
            width,
            count: firstReg ? countAliveSoldiers(firstReg) : 12,
            unitClass: firstReg ? UNIT_DEFS[firstReg.unitType].unitClass : 'infantry',
          };
        }
      }
    };

    const onMouseUp = (e: MouseEvent): void => {
      if (!this.cb.isPlaying()) return;
      if (e.button === 0) {
        // Road or Wall drag finish
        if (this.placementTool && (this.placementTool.kind === 'road' || this.placementTool.kind === 'wall') && this.lineDragStart) {
          const endPt = this.screenToGround(e.clientX, e.clientY) ?? this.hoverWorld;
          if (endPt) {
            const ok = this.cb.onExecute(
              this.placementTool.kind === 'road'
                ? { type: 'placeRoad', side: 0, x0: this.lineDragStart.x, z0: this.lineDragStart.z, x1: endPt.x, z1: endPt.z }
                : { type: 'placeWall', side: 0, x0: this.lineDragStart.x, z0: this.lineDragStart.z, x1: endPt.x, z1: endPt.z },
            );
            this.cb.onPlayUiSound(ok ? 'uiClick' : 'uiError');
          }
          this.lineDragStart = null;
          if (!e.shiftKey) this.setPlacementTool(null);
          return;
        }

        if (!this.leftDown) return;
        this.leftDown = false;
        this.marqueeEl.classList.add('hidden');

        const dragDist = Math.hypot(e.clientX - this.leftStartX, e.clientY - this.leftStartY);
        const sim = this.cb.getSim();

        if (dragDist > 8) {
          // Box-select all player regiments inside marquee rectangle!
          const minX = Math.min(this.leftStartX, e.clientX);
          const maxX = Math.max(this.leftStartX, e.clientX);
          const minY = Math.min(this.leftStartY, e.clientY);
          const maxY = Math.max(this.leftStartY, e.clientY);
          const found: number[] = [];
          for (const r of sim.state.regiments) {
            if (r.side !== 0 || r.garrisonedInBuildingId !== null || countAliveSoldiers(r) === 0) continue;
            const sy = sim.terrain.heightAt(r.x, r.z) + 1.0;
            const scr = this.worldToScreen(r.x, sy, r.z);
            if (scr.visible && scr.x >= minX && scr.x <= maxX && scr.y >= minY && scr.y <= maxY) {
              found.push(r.id);
            }
          }
          this.selectRegiments(found, e.shiftKey);
          if (found.length > 0) this.cb.onPlayUiSound('uiClick');
        } else {
          // Single-click pick (friendly regiment first, then building!)
          const pt = this.screenToGround(e.clientX, e.clientY);
          if (!pt) return;
          const reg = this.pickNearestRegiment(pt.x, pt.z, 0, 7.5);
          if (reg) {
            const now = performance.now();
            if (this.lastLeftClickRegId === reg.id && now - this.lastLeftClickMs < 380) {
              // Double-click selects all friendly regiments of same unitType!
              const sameType = sim.state.regiments
                .filter((r) => r.side === 0 && r.unitType === reg.unitType && countAliveSoldiers(r) > 0)
                .map((r) => r.id);
              this.selectRegiments(sameType, e.shiftKey);
            } else {
              this.selectRegiments([reg.id], e.shiftKey);
            }
            this.lastLeftClickRegId = reg.id;
            this.lastLeftClickMs = now;
            this.cb.onPlayUiSound('uiClick');
            return;
          }
          const bId = this.pickNearestBuilding(pt.x, pt.z);
          this.selectBuilding(bId);
          if (bId !== null) this.cb.onPlayUiSound('uiClick');
        }
      } else if (e.button === 2 && this.rightDown) {
        this.rightDown = false;
        const dragDist = Math.hypot(e.clientX - this.rightStartX, e.clientY - this.rightStartY);

        if (this.rightFormationDrag && this.formationGhost) {
          const g = this.formationGhost;
          const ids = [...this.selectedRegimentIds];
          const rx = Math.cos(g.yawRad);
          const rz = -Math.sin(g.yawRad);
          const spacing = Math.max(9, g.width * 1.55);
          for (let i = 0; i < ids.length; i++) {
            const off = (i - (ids.length - 1) * 0.5) * spacing;
            this.cb.onExecute({
              type: 'issueOrder',
              side: 0,
              regimentIds: [ids[i]!],
              order: { kind: 'march', x: g.x + rx * off, z: g.z + rz * off, facingYawRad: g.yawRad, width: g.width },
              queue: e.shiftKey,
            });
          }
          this.formationGhost = null;
          this.rightFormationDrag = false;
          this.cb.onPlayUiSound('uiClick');
          return;
        }
        this.formationGhost = null;
        this.rightFormationDrag = false;

        // Short right-click (< 10 px drag -> not a camera orbit!) issues tactical context order
        if (dragDist < 10 && this.selectedRegimentIds.size > 0) {
          const pt = this.screenToGround(e.clientX, e.clientY);
          if (pt) {
            const now = performance.now();
            const doubleRight = now - this.lastRightClickMs < 360;
            this.lastRightClickMs = now;
            this.issueContextOrderAt(pt.x, pt.z, e.shiftKey, doubleRight);
          }
        }
      }
    };

    // Touch controls: single-tap selects/places; long-press (380 ms) issues context move/attack order!
    const onTouchStart = (e: TouchEvent): void => {
      if (!this.cb.isPlaying() || e.touches.length !== 1) {
        if (this.touchLongPressTimer !== null) {
          window.clearTimeout(this.touchLongPressTimer);
          this.touchLongPressTimer = null;
        }
        return;
      }
      const t = e.touches[0]!;
      this.touchStartX = t.clientX;
      this.touchStartY = t.clientY;

      if (this.selectedRegimentIds.size > 0 && !this.placementTool) {
        this.touchLongPressTimer = window.setTimeout(() => {
          this.touchLongPressTimer = null;
          const pt = this.screenToGround(this.touchStartX, this.touchStartY);
          if (pt) this.issueContextOrderAt(pt.x, pt.z, false, false);
        }, 380);
      }
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (this.touchLongPressTimer !== null && e.touches.length === 1) {
        const t = e.touches[0]!;
        if (Math.hypot(t.clientX - this.touchStartX, t.clientY - this.touchStartY) > 14) {
          window.clearTimeout(this.touchLongPressTimer);
          this.touchLongPressTimer = null;
        }
      }
    };

    const onTouchEnd = (e: TouchEvent): void => {
      if (this.touchLongPressTimer !== null) {
        window.clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = null;
      }
      if (!this.cb.isPlaying() || e.changedTouches.length !== 1 || e.touches.length > 0) return;
      const t = e.changedTouches[0]!;
      if (Math.hypot(t.clientX - this.touchStartX, t.clientY - this.touchStartY) > 14) return;

      const pt = this.screenToGround(t.clientX, t.clientY);
      if (!pt) return;
      if (this.placementTool) {
        if (this.placementTool.kind === 'building') {
          const ok = this.cb.onExecute({
            type: 'placeBuilding',
            side: 0,
            buildingType: this.placementTool.buildingType,
            x: pt.x,
            z: pt.z,
            yawRad: this.placementYawRad,
          });
          this.cb.onPlayUiSound(ok ? 'uiClick' : 'uiError');
          if (ok) this.setPlacementTool(null);
        } else if (this.placementTool.kind === 'gate') {
          const ok = this.cb.onExecute({ type: 'placeGate', side: 0, x: pt.x, z: pt.z, yawRad: this.placementYawRad });
          this.cb.onPlayUiSound(ok ? 'uiClick' : 'uiError');
          if (ok) this.setPlacementTool(null);
        }
        return;
      }

      const reg = this.pickNearestRegiment(pt.x, pt.z, 0, 9.0);
      if (reg) {
        this.selectRegiments([reg.id], false);
        this.cb.onPlayUiSound('uiClick');
      } else {
        const bId = this.pickNearestBuilding(pt.x, pt.z);
        if (bId !== null) {
          this.selectBuilding(bId);
          this.cb.onPlayUiSound('uiClick');
        } else if (this.selectedRegimentIds.size > 0) {
          this.issueContextOrderAt(pt.x, pt.z, false, false);
        }
      }
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    this.cleanupFns.push(() => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    });
  }

  getLastHoverReason(): PlacementRejectionReason | null {
    return this.lastHoverReason;
  }

  dispose(): void {
    for (const fn of this.cleanupFns) fn();
    this.marqueeEl.remove();
  }
}
