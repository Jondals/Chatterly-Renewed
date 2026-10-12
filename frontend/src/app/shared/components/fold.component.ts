/**
 * src/app/shared/components/fold.component.ts
 * A small section that opens and closes smoothly (the options of the drawer of a call). The title goes in an element with
 * `foldTitle`, a note at the right of it in one with `foldHint`, and what is inside opens under them.
 */
import { Component, OnInit, input, signal } from '@angular/core';
import { IconComponent } from './icon.component';

/** A folded section with a smooth opening. */
@Component({
  selector: 'app-fold',
  standalone: true,
  imports: [IconComponent],
  host: { class: 'block' },
  template: `
    <div class="fold">
      <button
        type="button"
        class="fold-head"
        [attr.aria-expanded]="open()"
        (click)="open.set(!open())"
      >
        <span class="min-w-0 flex-1 truncate text-left"><ng-content select="[foldTitle]" /></span>
        <span class="fold-hint"><ng-content select="[foldHint]" /></span>
        <app-icon
          name="chevron-down"
          [size]="15"
          class="shrink-0 text-muted transition-transform duration-300"
          [class.rotate-180]="open()"
        />
      </button>
      <div class="fold-body" [class.open]="open()" [attr.inert]="open() ? null : ''">
        <div class="fold-inner">
          <div class="fold-content"><ng-content /></div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .fold {
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: var(--r);
      overflow: hidden;
    }
    .fold-head {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      width: 100%;
      padding: 0.7rem 0.8rem;
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .fold-head:hover {
      background: rgba(255, 255, 255, 0.04);
    }
    .fold-hint {
      font-family: var(--font-code, monospace);
      font-size: 0.6875rem;
      font-weight: 400;
      color: var(--muted);
    }
    .fold-body {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.4s var(--ease, cubic-bezier(0.22, 1, 0.36, 1));
    }
    .fold-body.open {
      grid-template-rows: 1fr;
    }
    .fold-inner {
      min-height: 0;
      overflow: hidden;
      opacity: 0;
      transition: opacity 0.28s ease;
    }
    .open > .fold-inner {
      opacity: 1;
      transition-delay: 0.08s;
    }
    .fold-content {
      padding: 0.8rem;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      display: grid;
      gap: 0.7rem;
      font-size: 0.75rem;
    }
  `,
})
export class FoldComponent implements OnInit {
  /** Whether the section is open. */
  readonly open = signal(false);
  /** True for a section that starts open. */
  readonly startOpen = input(false);

  /** Opens the section when it asks to start open. */
  ngOnInit(): void {
    if (this.startOpen()) {
      this.open.set(true);
    }
  }
}
