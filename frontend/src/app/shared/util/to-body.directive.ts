/**
 * src/app/shared/util/to-body.directive.ts
 * Moves an element to the end of <body> while it exists (a portal), so a full-window layer opened from inside a page covers
 * the whole window.
 *
 * * Why: the panel of the pages (<main>) uses a backdrop filter, and an ancestor with a filter, a transform or a backdrop
 *   filter makes every "fixed" element inside it fixed to that ancestor instead of the window. A window opened from the
 *   call only darkened the call.
 * ! Angular only removes the first elements of a block from the page; an element moved somewhere else stays behind. So this
 *   directive removes it itself when its block goes away, after the leave animation given as `appToBody` (a class).
 */
import { Directive, ElementRef, inject, input, type OnDestroy, type OnInit } from '@angular/core';

/** The longest a leave animation is waited for. */
const LEAVE_MS = 450;

@Directive({ selector: '[appToBody]', standalone: true })
export class ToBodyDirective implements OnInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The class of the leave animation ('' for none). */
  readonly appToBody = input('');

  /** Moves the element out of the page that holds it. */
  ngOnInit(): void {
    // ! Marked, so a "press outside closes me" of the component that opened it does not take a press in it for outside.
    this.element.nativeElement.setAttribute('data-portal', '');
    document.body.appendChild(this.element.nativeElement);
  }

  /** Takes the element away (after its leave animation). */
  ngOnDestroy(): void {
    const element = this.element.nativeElement;
    const leave = this.appToBody();
    if (!leave || !element.isConnected) {
      element.remove();
      return;
    }
    element.classList.add(leave);
    element.style.pointerEvents = 'none';
    const remove = element.remove.bind(element);
    element.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, LEAVE_MS);
  }
}
