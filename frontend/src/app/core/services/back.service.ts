/**
 * src/app/core/services/back.service.ts
 * The back key of the phone (Android) closes what is open, the newest first: a menu, a window, a picker, a section of
 * Settings (back to the list of sections), Settings itself. Only when nothing is open does the app go back a page or
 * to the background (MainActivity.java asks `window.chatterlyBack` first).
 *
 * * Each thing that can be closed registers itself while it is open (closeOnBack); the last one registered is the one on
 *   top of the screen, so it is the one that closes.
 */
import { DestroyRef, Injectable, NgZone, effect, inject, untracked } from '@angular/core';

/** Something open that the back key can close. Returns true when it closed something. */
type BackHandler = () => boolean | void;

/** The stack of things the back key can close. */
@Injectable({ providedIn: 'root' })
export class BackService {
  private readonly zone = inject(NgZone);
  private readonly handlers: BackHandler[] = [];

  /** Gives the native side of the app the function it calls on every press of the back key. */
  constructor() {
    (window as unknown as { chatterlyBack?: () => boolean }).chatterlyBack = this.back.bind(this);
  }

  /** Adds something open on top of the stack; the function returned takes it out. */
  register(handler: BackHandler): () => void {
    this.handlers.push(handler);
    return this.unregister.bind(this, handler);
  }

  /** Takes something out of the stack (it closed). */
  private unregister(handler: BackHandler): void {
    const at = this.handlers.lastIndexOf(handler);
    if (at >= 0) {
      this.handlers.splice(at, 1);
    }
  }

  /** One press of the back key: the newest open thing closes. False when nothing was open. */
  back(): boolean {
    return this.zone.run(this.closeTop.bind(this));
  }

  /** Closes the thing on top (a handler that answers false did not close anything, so the next one is tried). */
  private closeTop(): boolean {
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      if (this.handlers[i]!() !== false) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Lets the back key close something while it is open (call it in a constructor or a field initializer). `isOpen` is
 * read as a signal: the thing joins the stack when it opens and leaves it when it closes or is destroyed.
 */
export function closeOnBack(isOpen: () => boolean, close: BackHandler): void {
  const back = inject(BackService);
  let dispose: (() => void) | null = null;
  effect(function follow() {
    const open = isOpen();
    untracked(function apply() {
      if (open && !dispose) {
        dispose = back.register(close);
      } else if (!open && dispose) {
        dispose();
        dispose = null;
      }
    });
  });
  inject(DestroyRef).onDestroy(function forget() {
    dispose?.();
  });
}

/** Always open while it exists (a window that is only on screen while open). */
export function alwaysOpen(): boolean {
  return true;
}
