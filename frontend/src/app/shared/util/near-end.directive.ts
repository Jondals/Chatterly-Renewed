/**
 * src/app/shared/util/near-end.directive.ts
 * An empty marker at the end of a list: when it comes near the screen it says so (`nearEnd`), and the list asks for more by itself.
 * The marker is drawn only while there is more to ask for, so after each page it is created again and, if it is still near the
 * screen, it says so again (a list that is not filled yet keeps asking until it is).
 */
import { DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';

/** Tells when the end of a list is near the screen. */
@Directive({ selector: '[appNearEnd]', standalone: true })
export class NearEndDirective {
  readonly nearEnd = output<void>();

  constructor() {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(this.seen.bind(this), { rootMargin: '0px 0px 800px 0px' });
    observer.observe(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement);
    inject(DestroyRef).onDestroy(observer.disconnect.bind(observer));
  }

  private seen(entries: IntersectionObserverEntry[]): void {
    if (
      entries.some(function visible(entry) {
        return entry.isIntersecting;
      })
    ) {
      this.nearEnd.emit();
    }
  }
}
