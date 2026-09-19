import { clamp } from './math';

export class Input {
  private canvas: HTMLCanvasElement;
  private onStartCallback: (() => void) | null = null;

  // Keyboard state
  private leftHeld = false;
  private rightHeld = false;

  // Pointer state
  private activePointerId: number | null = null;
  private pointerStartX = 0;
  private pointerSteer = 0;
  private isTouch = false;

  constructor(canvas: HTMLCanvasElement, onStart: () => void) {
    this.canvas = canvas;
    this.onStartCallback = onStart;

    this.setupKeyboardListeners();
    this.setupPointerListeners();
    this.setupWindowListeners();
  }

  private setupKeyboardListeners(): void {
    window.addEventListener(
      'keydown',
      (e) => {
        const key = e.key;

        // Prevent browser scrolling for navigation keys
        if (
          key === 'ArrowLeft' ||
          key === 'ArrowRight' ||
          key === 'ArrowUp' ||
          key === 'ArrowDown' ||
          key === ' ' ||
          key === 'Spacebar'
        ) {
          e.preventDefault();
        }

        if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
          this.leftHeld = true;
          this.triggerStart();
        } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
          this.rightHeld = true;
          this.triggerStart();
        } else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
          this.triggerStart();
        }
      },
      { passive: false }
    );

    window.addEventListener('keyup', (e) => {
      const key = e.key;
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
        this.leftHeld = false;
      } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
        this.rightHeld = false;
      }
    });
  }

  private setupPointerListeners(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.activePointerId !== null) return;

      this.activePointerId = e.pointerId;
      this.pointerStartX = e.clientX;
      this.isTouch = e.pointerType === 'touch';

      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture might fail if already released
      }

      // Touch starts immediately
      if (this.isTouch) {
        this.triggerStart();
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.activePointerId !== e.pointerId) return;

      const deltaX = e.clientX - this.pointerStartX;
      const maxRange = Math.min(160, window.innerWidth * 0.3);
      this.pointerSteer = clamp(maxRange > 0 ? deltaX / maxRange : 0, -1, 1);

      // Mouse starts when actual horizontal drag occurs
      if (!this.isTouch && Math.abs(deltaX) > 4) {
        this.triggerStart();
      }
    });

    const clearPointer = (e: PointerEvent) => {
      if (this.activePointerId === e.pointerId) {
        try {
          if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore
        }
        this.activePointerId = null;
        this.pointerSteer = 0;
      }
    };

    this.canvas.addEventListener('pointerup', clearPointer);
    this.canvas.addEventListener('pointercancel', clearPointer);
    this.canvas.addEventListener('lostpointercapture', clearPointer);
  }

  private setupWindowListeners(): void {
    window.addEventListener('blur', () => {
      this.clear();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.clear();
      }
    });
  }

  private triggerStart(): void {
    if (this.onStartCallback) {
      this.onStartCallback();
    }
  }

  public getSteer(): number {
    let keySteer = 0;
    if (this.leftHeld && !this.rightHeld) {
      keySteer = -1;
    } else if (this.rightHeld && !this.leftHeld) {
      keySteer = 1;
    }

    // If keyboard and pointer coexist, use the larger absolute magnitude
    if (Math.abs(this.pointerSteer) > Math.abs(keySteer)) {
      return this.pointerSteer;
    }
    return keySteer;
  }

  public clear(): void {
    this.leftHeld = false;
    this.rightHeld = false;
    this.activePointerId = null;
    this.pointerSteer = 0;
  }
}
