import { ThrottleInput } from './config';
import { clamp } from './math';

export class Input {
  private canvas: HTMLCanvasElement;
  private fwdBtn: HTMLElement | null = null;
  private revBtn: HTMLElement | null = null;
  private onStartCallback: (() => void) | null = null;

  // Keyboard state
  private forwardHeld = false;
  private reverseHeld = false;
  private leftHeld = false;
  private rightHeld = false;

  // Touch button state
  private pointerForwardHeld = false;
  private pointerReverseHeld = false;
  private fwdPointerId: number | null = null;
  private revPointerId: number | null = null;

  // Canvas steer pointer state
  private activePointerId: number | null = null;
  private pointerStartX = 0;
  private pointerSteer = 0;
  private isTouch = false;

  // Listener references for disposal
  private handleKeyDown: (e: KeyboardEvent) => void;
  private handleKeyUp: (e: KeyboardEvent) => void;
  private handleCanvasPointerDown: (e: PointerEvent) => void;
  private handleCanvasPointerMove: (e: PointerEvent) => void;
  private handleCanvasPointerClear: (e: PointerEvent) => void;
  private handleWindowBlur: () => void;
  private handleVisibilityChange: () => void;

  private handleFwdDown: (e: PointerEvent) => void;
  private handleFwdUp: (e: PointerEvent) => void;
  private handleRevDown: (e: PointerEvent) => void;
  private handleRevUp: (e: PointerEvent) => void;
  private handleContextMenu: (e: MouseEvent) => void;

  constructor(
    canvas: HTMLCanvasElement,
    onStart: () => void,
    fwdBtn: HTMLElement | null = null,
    revBtn: HTMLElement | null = null
  ) {
    this.canvas = canvas;
    this.onStartCallback = onStart;
    this.fwdBtn = fwdBtn ?? document.getElementById('touch-fwd');
    this.revBtn = revBtn ?? document.getElementById('touch-rev');

    this.handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;

      // Prevent browser scrolling for driving and navigation keys
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

      if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        this.forwardHeld = true;
        this.triggerStart();
      } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
        this.reverseHeld = true;
        this.triggerStart();
      } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
        this.leftHeld = true;
        this.triggerStart();
      } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
        this.rightHeld = true;
        this.triggerStart();
      } else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        // Start without throttle
        this.triggerStart();
      }
    };

    this.handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key;
      if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        this.forwardHeld = false;
      } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
        this.reverseHeld = false;
      } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
        this.leftHeld = false;
      } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
        this.rightHeld = false;
      }
    };

    this.handleCanvasPointerDown = (e: PointerEvent) => {
      if (this.activePointerId !== null) return;

      this.activePointerId = e.pointerId;
      this.pointerStartX = e.clientX;
      this.isTouch = e.pointerType === 'touch';

      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture error
      }

      if (this.isTouch) {
        this.triggerStart();
      }
    };

    this.handleCanvasPointerMove = (e: PointerEvent) => {
      if (this.activePointerId !== e.pointerId) return;

      const deltaX = e.clientX - this.pointerStartX;
      const maxRange = Math.min(160, window.innerWidth * 0.3);
      this.pointerSteer = clamp(maxRange > 0 ? deltaX / maxRange : 0, -1, 1);

      if (!this.isTouch && Math.abs(deltaX) > 4) {
        this.triggerStart();
      }
    };

    this.handleCanvasPointerClear = (e: PointerEvent) => {
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

    this.handleWindowBlur = () => {
      this.clear();
    };

    this.handleVisibilityChange = () => {
      if (document.hidden) {
        this.clear();
      }
    };

    this.handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Forward touch button handlers
    this.handleFwdDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.fwdPointerId = e.pointerId;
      this.pointerForwardHeld = true;
      try {
        (e.currentTarget as HTMLElement)?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      this.triggerStart();
    };

    this.handleFwdUp = (e: PointerEvent) => {
      if (this.fwdPointerId === e.pointerId || this.fwdPointerId === null) {
        this.pointerForwardHeld = false;
        this.fwdPointerId = null;
        try {
          if ((e.currentTarget as HTMLElement)?.hasPointerCapture(e.pointerId)) {
            (e.currentTarget as HTMLElement)?.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore
        }
      }
    };

    // Reverse touch button handlers
    this.handleRevDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.revPointerId = e.pointerId;
      this.pointerReverseHeld = true;
      try {
        (e.currentTarget as HTMLElement)?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      this.triggerStart();
    };

    this.handleRevUp = (e: PointerEvent) => {
      if (this.revPointerId === e.pointerId || this.revPointerId === null) {
        this.pointerReverseHeld = false;
        this.revPointerId = null;
        try {
          if ((e.currentTarget as HTMLElement)?.hasPointerCapture(e.pointerId)) {
            (e.currentTarget as HTMLElement)?.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore
        }
      }
    };

    this.setupListeners();
  }

  private setupListeners(): void {
    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.canvas.addEventListener('pointerdown', this.handleCanvasPointerDown);
    this.canvas.addEventListener('pointermove', this.handleCanvasPointerMove);
    this.canvas.addEventListener('pointerup', this.handleCanvasPointerClear);
    this.canvas.addEventListener('pointercancel', this.handleCanvasPointerClear);
    this.canvas.addEventListener('lostpointercapture', this.handleCanvasPointerClear);

    if (this.fwdBtn) {
      this.fwdBtn.addEventListener('pointerdown', this.handleFwdDown);
      this.fwdBtn.addEventListener('pointerup', this.handleFwdUp);
      this.fwdBtn.addEventListener('pointercancel', this.handleFwdUp);
      this.fwdBtn.addEventListener('lostpointercapture', this.handleFwdUp);
      this.fwdBtn.addEventListener('pointerleave', this.handleFwdUp);
      this.fwdBtn.addEventListener('contextmenu', this.handleContextMenu);
    }

    if (this.revBtn) {
      this.revBtn.addEventListener('pointerdown', this.handleRevDown);
      this.revBtn.addEventListener('pointerup', this.handleRevUp);
      this.revBtn.addEventListener('pointercancel', this.handleRevUp);
      this.revBtn.addEventListener('lostpointercapture', this.handleRevUp);
      this.revBtn.addEventListener('pointerleave', this.handleRevUp);
      this.revBtn.addEventListener('contextmenu', this.handleContextMenu);
    }
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

  public getThrottle(): ThrottleInput {
    const fwd = this.forwardHeld || this.pointerForwardHeld;
    const rev = this.reverseHeld || this.pointerReverseHeld;

    if (fwd && !rev) return 1;
    if (rev && !fwd) return -1;
    return 0;
  }

  public clear(): void {
    this.forwardHeld = false;
    this.reverseHeld = false;
    this.leftHeld = false;
    this.rightHeld = false;
    this.pointerForwardHeld = false;
    this.pointerReverseHeld = false;
    this.fwdPointerId = null;
    this.revPointerId = null;
    this.activePointerId = null;
    this.pointerSteer = 0;
  }

  public dispose(): void {
    this.clear();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    this.canvas.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    this.canvas.removeEventListener('pointermove', this.handleCanvasPointerMove);
    this.canvas.removeEventListener('pointerup', this.handleCanvasPointerClear);
    this.canvas.removeEventListener('pointercancel', this.handleCanvasPointerClear);
    this.canvas.removeEventListener('lostpointercapture', this.handleCanvasPointerClear);

    if (this.fwdBtn) {
      this.fwdBtn.removeEventListener('pointerdown', this.handleFwdDown);
      this.fwdBtn.removeEventListener('pointerup', this.handleFwdUp);
      this.fwdBtn.removeEventListener('pointercancel', this.handleFwdUp);
      this.fwdBtn.removeEventListener('lostpointercapture', this.handleFwdUp);
      this.fwdBtn.removeEventListener('pointerleave', this.handleFwdUp);
      this.fwdBtn.removeEventListener('contextmenu', this.handleContextMenu);
    }

    if (this.revBtn) {
      this.revBtn.removeEventListener('pointerdown', this.handleRevDown);
      this.revBtn.removeEventListener('pointerup', this.handleRevUp);
      this.revBtn.removeEventListener('pointercancel', this.handleRevUp);
      this.revBtn.removeEventListener('lostpointercapture', this.handleRevUp);
      this.revBtn.removeEventListener('pointerleave', this.handleRevUp);
      this.revBtn.removeEventListener('contextmenu', this.handleContextMenu);
    }

    this.onStartCallback = null;
  }
}
