// Single rebindable keyboard action layer (`event.code` appears ONLY in this file).
// Source: docs/ROUTINE.md §5, GUIDE.md §4, BRIEF.md F23.

export type ActionName =
  | 'panUp'
  | 'panDown'
  | 'panLeft'
  | 'panRight'
  | 'rotateLeft'
  | 'rotateRight'
  | 'pause'
  | 'menu'
  | 'perfOverlay'
  | 'nextLighting'
  | 'buildRoad'
  | 'rotateBuilding'
  | 'haltRegiment'
  | 'formLine'
  | 'formColumn'
  | 'formSpecial'
  | 'speedDown'
  | 'speedUp'
  | 'selectAllArmy'
  | 'jumpKeep'
  | 'group1'
  | 'group2'
  | 'group3'
  | 'group4'
  | 'group5'
  | 'group6'
  | 'group7'
  | 'group8'
  | 'group9'
  | 'bookmark1'
  | 'bookmark2'
  | 'bookmark3'
  | 'bookmark4';

export type KeyBindingMap = Record<ActionName, readonly string[]>;

export const DEFAULT_BINDINGS: KeyBindingMap = {
  panUp: ['KeyW', 'ArrowUp'],
  panDown: ['KeyS', 'ArrowDown'],
  panLeft: ['KeyA', 'ArrowLeft'],
  panRight: ['KeyD', 'ArrowRight'],
  rotateLeft: ['KeyQ'],
  rotateRight: ['KeyE'],
  pause: ['Space'],
  menu: ['Escape'],
  perfOverlay: ['F3'],
  nextLighting: ['KeyL'],
  buildRoad: ['KeyG'],
  rotateBuilding: ['KeyR'],
  haltRegiment: ['KeyH'],
  formLine: ['F1'],
  formColumn: ['F2'],
  formSpecial: ['F4'],
  speedDown: ['BracketLeft', 'Minus'],
  speedUp: ['BracketRight', 'Equal'],
  selectAllArmy: ['KeyZ'],
  jumpKeep: ['Home'],
  group1: ['Digit1'],
  group2: ['Digit2'],
  group3: ['Digit3'],
  group4: ['Digit4'],
  group5: ['Digit5'],
  group6: ['Digit6'],
  group7: ['Digit7'],
  group8: ['Digit8'],
  group9: ['Digit9'],
  bookmark1: ['F5'],
  bookmark2: ['F6'],
  bookmark3: ['F7'],
  bookmark4: ['F8'],
};

const STORAGE_KEY_BINDINGS = 'marchland.bindings.v1';

export class InputBindings {
  private readonly bindings: Record<ActionName, string[]>;
  private readonly heldCodes = new Set<string>();

  constructor(initial: KeyBindingMap = DEFAULT_BINDINGS) {
    const out = {} as Record<ActionName, string[]>;
    for (const k of Object.keys(initial) as ActionName[]) {
      out[k] = [...initial[k]];
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY_BINDINGS);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<ActionName, string[]>>;
        for (const k of Object.keys(out) as ActionName[]) {
          if (Array.isArray(parsed[k]) && parsed[k]!.length > 0) {
            out[k] = [...parsed[k]!];
          }
        }
      }
    } catch {
      // Ignore storage failures
    }
    this.bindings = out;
  }

  rebind(action: ActionName, codes: readonly string[]): void {
    this.bindings[action] = [...codes];
    try {
      localStorage.setItem(STORAGE_KEY_BINDINGS, JSON.stringify(this.bindings));
    } catch {
      // Ignore storage failures
    }
  }

  resetDefaults(): void {
    for (const k of Object.keys(DEFAULT_BINDINGS) as ActionName[]) {
      this.bindings[k] = [...DEFAULT_BINDINGS[k]];
    }
    try {
      localStorage.removeItem(STORAGE_KEY_BINDINGS);
    } catch {
      // Ignore
    }
  }

  codesOf(action: ActionName): readonly string[] {
    return this.bindings[action];
  }

  /** Match a KeyboardEvent.code against an action (only call site for `event.code` is `handleKeyDown/Up`). */
  actionForCode(code: string): ActionName | null {
    for (const action of Object.keys(this.bindings) as ActionName[]) {
      if (this.bindings[action].includes(code)) return action;
    }
    return null;
  }

  onKeyDown(event: KeyboardEvent): ActionName | null {
    this.heldCodes.add(event.code);
    return this.actionForCode(event.code);
  }

  onKeyUp(event: KeyboardEvent): ActionName | null {
    this.heldCodes.delete(event.code);
    return this.actionForCode(event.code);
  }

  clearHeld(): void {
    this.heldCodes.clear();
  }

  isHeld(action: ActionName): boolean {
    for (const c of this.bindings[action]) {
      if (this.heldCodes.has(c)) return true;
    }
    return false;
  }
}
