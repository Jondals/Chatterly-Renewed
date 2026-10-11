/**
 * src/app/shared/util/top-layer.directive.ts
 * Puts an element in the top layer of the browser (a manual popover), next to another element: it is drawn over everything
 * (no layer of the page is above it) and no container cuts it. Use: `<div [appTopLayer]="button">...</div>`, with the
 * element it opens from (below it, ending at its right side; above it when there is no room below).
 */
import { AfterViewInit, Directive, ElementRef, inject, input } from '@angular/core';

/** The space kept from the edges of the window and from the element it opens from. */
const GAP = 8;

/** Draws its element in the top layer, next to an anchor. */
@Directive({
  selector: '[appTopLayer]',
  standalone: true,
})
export class TopLayerDirective implements AfterViewInit {
  /** The element the popover opens from. */
  readonly appTopLayer = input.required<HTMLElement>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngAfterViewInit(): void {
    const element = this.host.nativeElement;
    element.setAttribute('popover', 'manual');
    const style = element.style;
    style.position = 'fixed';
    style.margin = '0';
    style.padding = '0';
    style.border = '0';
    style.background = 'transparent';
    style.overflow = 'visible';
    style.inset = 'auto';
    try {
      element.showPopover();
    } catch {
      /* a browser without popovers draws it where it is */
      return;
    }
    const anchor = this.appTopLayer().getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const left = Math.min(
      Math.max(GAP, anchor.right - box.width),
      Math.max(GAP, window.innerWidth - box.width - GAP),
    );
    const below = anchor.bottom + GAP;
    const top =
      below + box.height <= window.innerHeight - GAP
        ? below
        : Math.max(GAP, anchor.top - box.height - GAP);
    style.left = left + 'px';
    style.top = top + 'px';
  }
}
