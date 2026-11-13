export type Action = 'reload' | 'slot0' | 'slot1' | 'slot2' | 'swap' | 'gel' | 'nade' | 'heal' | 'ability' | 'pickup' | 'pause' | 'jump' | 'crouch' | 'ads';

export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export class Input {
  mx = 0;
  my = 0;
  lookX = 0;
  lookY = 0;
  fire = false;
  adsHold = false;
  adsToggle = false;
  crouchHold = false;
  private keys = new Set<string>();
  private queue = new Set<Action>();
  private joyId = -1;
  private joyOx = 0;
  private joyOy = 0;
  private joyX = 0;
  private joyY = 0;
  private looks = new Map<number, { x: number; y: number }>();
  private fireTouches = new Set<number>();
  enabled = false;
  locked = false;
  private cleanup: (() => void)[] = [];

  private root: HTMLElement;

  constructor(canvas: HTMLCanvasElement, root: HTMLElement) {
    this.root = root;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, ev: K | string, fn: (e: any) => void, opt?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn, opt);
      this.cleanup.push(() => t.removeEventListener(ev, fn, opt));
    };

    on(window, 'keydown', (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.code;
      if (!this.keys.has(k)) {
        const map: Record<string, Action> = {
          KeyR: 'reload', Digit1: 'slot0', Digit2: 'slot1', Digit3: 'slot2', KeyQ: 'ability', KeyG: 'nade',
          KeyE: 'gel', KeyH: 'heal', KeyF: 'pickup', Space: 'jump', KeyC: 'crouch', Escape: 'pause', KeyP: 'pause', Tab: 'swap',
        };
        if (map[k]) this.queue.add(map[k]);
      }
      this.keys.add(k);
      if (['Space', 'Tab'].includes(k)) e.preventDefault();
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, 'blur', () => {
      this.keys.clear();
      this.fire = false;
      this.adsHold = false;
    });

    on(canvas, 'mousedown', (e: MouseEvent) => {
      if (!this.enabled || isTouch) return;
      if (!this.locked) {
        canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.adsHold = true;
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.adsHold = false;
    });
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(document, 'pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      document.body.classList.toggle('locked', this.locked);
      if (was && !this.locked && this.enabled) this.queue.add('pause');
    });
    on(window, 'mousemove', (e: MouseEvent) => {
      if (!this.enabled || !this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });

    // ---------- touch (pointer events) ----------
    on(root, 'pointerdown', (e: PointerEvent) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      const t = e.target as HTMLElement;
      const btn = t.closest<HTMLElement>('[data-act]');
      if (btn) {
        const act = btn.dataset.act!;
        btn.classList.add('down');
        if (act === 'fire') {
          this.fireTouches.add(e.pointerId);
          this.fire = true;
          this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
        } else if (act === 'ads') {
          this.adsToggle = !this.adsToggle;
        } else this.queue.add(act as Action);
        e.preventDefault();
        return;
      }
      if (t.closest('.hud-ui')) return;
      if (e.clientX < innerWidth * 0.42 && this.joyId < 0) {
        this.joyId = e.pointerId;
        this.joyOx = e.clientX;
        this.joyOy = e.clientY;
        this.joyX = this.joyY = 0;
        this.showJoy(true);
      } else {
        this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      e.preventDefault();
    }, { passive: false });

    on(window, 'pointermove', (e: PointerEvent) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      if (e.pointerId === this.joyId) {
        const R = 52;
        let dx = e.clientX - this.joyOx, dy = e.clientY - this.joyOy;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          this.joyOx += (dx / d) * (d - R);
          this.joyOy += (dy / d) * (d - R);
          dx = e.clientX - this.joyOx;
          dy = e.clientY - this.joyOy;
        }
        this.joyX = dx / R;
        this.joyY = -dy / R;
        this.showJoy(true);
        return;
      }
      const l = this.looks.get(e.pointerId);
      if (l) {
        this.lookX += (e.clientX - l.x) * 1.6;
        this.lookY += (e.clientY - l.y) * 1.6;
        l.x = e.clientX;
        l.y = e.clientY;
      }
    });

    const up = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      if (e.pointerId === this.joyId) {
        this.joyId = -1;
        this.joyX = this.joyY = 0;
        this.showJoy(false);
      }
      this.looks.delete(e.pointerId);
      if (this.fireTouches.delete(e.pointerId) && this.fireTouches.size === 0) this.fire = false;
      root.querySelectorAll('[data-act].down').forEach((b) => {
        if (!this.fireTouches.size || (b as HTMLElement).dataset.act !== 'fire') b.classList.remove('down');
      });
    };
    on(window, 'pointerup', up);
    on(window, 'pointercancel', up);
  }

  private showJoy(on: boolean) {
    const base = this.root.querySelector<HTMLElement>('#joy');
    const knob = this.root.querySelector<HTMLElement>('#joyKnob');
    if (!base || !knob) return;
    if (!on) {
      base.classList.remove('active');
      base.style.left = '';
      base.style.top = '';
      knob.style.transform = '';
      return;
    }
    base.classList.add('active');
    base.style.left = `${this.joyOx}px`;
    base.style.top = `${this.joyOy}px`;
    knob.style.transform = `translate(${this.joyX * 52}px, ${-this.joyY * 52}px)`;
  }

  get ads() {
    return this.adsHold || this.adsToggle;
  }

  poll() {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    x += this.joyX;
    y += this.joyY;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    this.mx = x;
    this.my = y;
    this.crouchHold = this.keys.has('ControlLeft');
  }

  take(a: Action): boolean {
    if (this.queue.has(a)) {
      this.queue.delete(a);
      return true;
    }
    return false;
  }

  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookX, this.lookY];
    this.lookX = this.lookY = 0;
    return r;
  }

  reset() {
    this.queue.clear();
    this.fire = false;
    this.adsHold = false;
    this.adsToggle = false;
    this.lookX = this.lookY = 0;
    this.joyId = -1;
    this.joyX = this.joyY = 0;
    this.looks.clear();
    this.fireTouches.clear();
    this.showJoy(false);
  }

  dispose() {
    this.cleanup.forEach((f) => f());
  }
}
