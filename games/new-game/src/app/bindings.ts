// Single rebindable keyboard action layer (`event.code` appears ONLY in this file).
// Source: docs/ROUTINE.md §5, GUIDE.md §4.

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
  | 'nextLighting';

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
};

export class InputBindings {
  private readonly bindings: Record<ActionName, string[]>;
  private readonly heldCodes = new Set<string>();

  constructor(initial: KeyBindingMap = DEFAULT_BINDINGS) {
    this.bindings = {
      panUp: [...initial.panUp],
      panDown: [...initial.panDown],
      panLeft: [...initial.panLeft],
      panRight: [...initial.panRight],
      rotateLeft: [...initial.rotateLeft],
      rotateRight: [...initial.rotateRight],
      pause: [...initial.pause],
      menu: [...initial.menu],
      perfOverlay: [...initial.perfOverlay],
      nextLighting: [...initial.nextLighting],
    };
  }

  rebind(action: ActionName, codes: readonly string[]): void {
    this.bindings[action] = [...codes];
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
