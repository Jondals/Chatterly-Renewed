/**
 * src/app/shared/util/listen-while.ts
 * Listens to an event of the page (a press anywhere, a resize) only while something is open.
 *
 * ? Why: a @HostListener('document:...') listens all the time, and every instance of the component does. With dozens of
 *   lists and folding sections in Settings, or hundreds of messages, every click of the page ran all of them and asked
 *   Angular to check all of them again. Listening only while open costs nothing the rest of the time.
 */
import { DestroyRef, effect, inject, untracked } from '@angular/core';

/**
 * Calls `handler` on every `type` event of `target` while `isOpen()` (read as a signal) is true. Call it in a constructor or
 * a field initializer.
 */
export function listenWhile(
  isOpen: () => boolean,
  target: EventTarget,
  type: string,
  handler: (event: Event) => void,
): void {
  let listening = false;
  effect(function follow() {
    const open = isOpen();
    untracked(function apply() {
      if (open && !listening) {
        target.addEventListener(type, handler);
        listening = true;
      } else if (!open && listening) {
        target.removeEventListener(type, handler);
        listening = false;
      }
    });
  });
  inject(DestroyRef).onDestroy(function forget() {
    target.removeEventListener(type, handler);
  });
}
