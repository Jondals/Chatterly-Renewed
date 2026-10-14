/**
 * src/app/shared/util/dockable.directive.ts
 * Lets a floating element be dragged by its handle (`data-drag`) and dropped on one of six fixed places of the
 * screen (the corners and the middle of the top and the bottom), like the floating windows of Discord. While it is
 * dragged it follows the pointer; when it is dropped it glides from where it was let go to its place.
 */
import { Directive, ElementRef, inject, input, output } from '@angular/core';

/** The places an element can be docked in: row (t, b) and column (l, c, r). */
export type DockPlace = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';

/** Drag state of the element. */
interface Drag {
  pointer: number;
  startX: number;
  startY: number;
  moved: boolean;
}

/** The place of the screen under a point. */
function placeAt(x: number, y: number, area?: DOMRect | null): DockPlace {
  const left = area ? area.left : 0;
  const top = area ? area.top : 0;
  const width = area ? area.width : window.innerWidth;
  const height = area ? area.height : window.innerHeight;
  const column = x < left + width / 3 ? 'l' : x > left + (width * 2) / 3 ? 'r' : 'c';
  const row = y < top + height / 2 ? 't' : 'b';
  return (row + column) as DockPlace;
}

/** Drag an element by its handle and dock it. */
@Directive({
  selector: '[appDockable]',
  standalone: true,
  host: {
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'onUp($event)',
    '(pointercancel)': 'onUp($event)',
  },
})
export class DockableDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private drag: Drag | null = null;
  /** The element whose area is divided in the six places (the whole window when there is none). */
  readonly dockArea = input<HTMLElement | null>(null);
  /** The places the element can rest on (all six when it is not given). */
  readonly allowed = input<DockPlace[] | null>(null);
  /** The element was dropped on a place. */
  readonly docked = output<DockPlace>();
  /** The place under the pointer while dragging (null when nothing is being dragged). */
  readonly over = output<DockPlace | null>();

  /** Starts dragging when the press is on the handle. */
  protected onDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (
      event.button !== 0 ||
      !target.closest('[data-drag]') ||
      target.closest('button, a, input')
    ) {
      return;
    }
    this.drag = {
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    this.host.nativeElement.setPointerCapture?.(event.pointerId);
  }

  /** Moves the element with the pointer. */
  protected onMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) {
      return;
    }
    drag.moved = true;
    const style = this.host.nativeElement.style;
    // An entrance animation would hold the transform of the element: it must stop for the drag to be seen.
    style.animation = 'none';
    style.transition = 'none';
    style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
    style.cursor = 'var(--cur-grabbing, grabbing)';
    this.over.emit(this.placeFor(event));
  }

  /** Drops the element on the place under the pointer and makes it glide there. */
  protected onUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }
    this.drag = null;
    this.over.emit(null);
    const element = this.host.nativeElement;
    element.style.cursor = '';
    if (!drag.moved) {
      return;
    }
    const before = element.getBoundingClientRect();
    element.style.transform = '';
    element.style.transition = '';
    this.docked.emit(
      placeAt(event.clientX, event.clientY, this.dockArea()?.getBoundingClientRect()),
    );
    // The new place is painted after the next change detection: the glide starts two frames later.
    requestAnimationFrame(this.waitOneMore.bind(this, before));
  }

  /** The place under the pointer; when it is not one of the places that exist, the nearest one of the same row. */
  private placeFor(event: PointerEvent): DockPlace {
    const area = this.dockArea()?.getBoundingClientRect();
    const place = placeAt(event.clientX, event.clientY, area);
    const allowed = this.allowed();
    if (!allowed || allowed.includes(place)) {
      return place;
    }
    const sameRow = allowed.filter(function row(candidate) {
      return candidate[0] === place[0];
    });
    const pool = sameRow.length ? sameRow : allowed;
    const middle = area ? area.left + area.width / 2 : window.innerWidth / 2;
    const wantsLeft = event.clientX < middle;
    const side = pool.find(function near(candidate) {
      return candidate[1] === (wantsLeft ? 'l' : 'r');
    });
    return side ?? pool[0]!;
  }

  /** One more frame, so the new place is already on screen. */
  private waitOneMore(before: DOMRect): void {
    requestAnimationFrame(this.glide.bind(this, before));
  }

  /** After the element is in its new place: it starts from where it was let go and glides to it. */
  private glide(before: DOMRect): void {
    const element = this.host.nativeElement;
    const after = element.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (Math.abs(dx) + Math.abs(dy) < 2) {
      return;
    }
    element.style.transition = 'none';
    element.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
    requestAnimationFrame(this.settle.bind(this));
  }

  /** The glide itself. */
  private settle(): void {
    const element = this.host.nativeElement;
    element.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
    element.style.transform = '';
  }
}
