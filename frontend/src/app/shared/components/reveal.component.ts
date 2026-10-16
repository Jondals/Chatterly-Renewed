/**
 * src/app/shared/components/reveal.component.ts
 * Opens and folds its content with a smooth change of height (so a control that appears or goes away does not make
 * everything under it jump). The content is always there; when it is folded it is inert (no focus, no clicks).
 * Use: `<app-reveal [open]="gradient"> ...controls... </app-reveal>`.
 */
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A block that unfolds and folds with the same easing as the collapsible sections. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-reveal',
  standalone: true,
  host: { class: 'block' },
  template: `
    <div class="body" [class.open]="open()" [attr.inert]="open() ? null : ''">
      <div class="inner"><ng-content /></div>
    </div>
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
    @media (prefers-reduced-motion: reduce) {
      .body,
      .inner {
        transition: none;
      }
    }
  `,
})
export class RevealComponent {
  /** True when the content is shown. */
  readonly open = input(false);
}
