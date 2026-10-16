/**
 * src/app/shared/components/collapse.component.ts
 * Compact collapsible section with a preview of the chosen option.
 */
import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { IconComponent } from './icon.component';
import { listenWhile } from '../util/listen-while';

/**
 * A compact section: the header shows the title, the current choice and an optional preview
 * (`<span preview>`); the full list of options only takes space when it is opened.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-collapse',
  standalone: true,
  host: { class: 'block', '[attr.title]': 'null' },
  imports: [IconComponent, TranslatePipe],
  template: `
    <section class="overflow-hidden rounded-ui-lg border border-white/8 bg-black/10">
      <button
        type="button"
        class="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-white/5"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold leading-snug">{{ title() | t }}</span>
          <span class="block truncate text-xs text-muted">{{ summary() | t }}</span>
        </span>
        <ng-content select="[preview]" />
        <app-icon
          name="chevron-down"
          [size]="17"
          class="text-muted transition-transform duration-300"
          [class.rotate-180]="open()"
        />
      </button>
      @if (rendered()) {
        <div class="body" [class.open]="expanded()" [attr.inert]="open() ? null : ''">
          <div class="inner">
            <div class="border-t border-white/6 p-5"><ng-content /></div>
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    .body {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.4s var(--ease);
    }
    .body.open {
      grid-template-rows: 1fr;
    }
    .inner {
      min-height: 0;
      overflow: hidden;
      opacity: 0;
      transition: opacity 0.28s var(--ease-suave);
    }
    .open > .inner {
      opacity: 1;
      transition-delay: 0.08s;
    }
  `,
})
export class CollapseComponent {
  readonly title = input.required<string>();
  readonly summary = input('');
  readonly open = signal(false);
  /** The content is created the first time the section opens, and kept so it can fold away smoothly. */
  protected readonly rendered = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** What the animation shows: it follows `open`, one frame later the first time so that the opening is smooth too. */
  protected readonly expanded = signal(false);

  /** Opens or folds the section. The first time the content is created closed and opens on the next frames. */
  protected toggle(): void {
    this.setOpen(!this.open());
  }

  /** Sets the state, creating the content first when it is needed. */
  private setOpen(value: boolean): void {
    this.open.set(value);
    if (!value || this.rendered()) {
      this.expanded.set(value);
      return;
    }
    this.rendered.set(true);
    requestAnimationFrame(this.openLater.bind(this));
  }

  /** Waits one more frame (the closed content has to be painted once) and opens. */
  private openLater(): void {
    requestAnimationFrame(this.expandNow.bind(this));
  }

  /** The animation of opening starts. */
  private expandNow(): void {
    this.expanded.set(this.open());
  }

  /** While open, a press outside the section folds it (the page is not listened to while it is folded). */
  private readonly outside = listenWhile(
    this.isOpen.bind(this),
    document,
    'mousedown',
    this.closeOnOutside.bind(this),
  );

  /** Whether the section is open. */
  private isOpen(): boolean {
    return this.open();
  }

  /** A press outside the section folds it. */
  protected closeOnOutside(event: Event): void {
    const target = event.target as Element;
    if (
      this.open() &&
      !this.host.nativeElement.contains(target) &&
      !target.closest?.('app-collapse')
    ) {
      this.setOpen(false);
    }
  }
}
