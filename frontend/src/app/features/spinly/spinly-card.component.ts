/**
 * src/app/features/spinly/spinly-card.component.ts
 * The card a Spinly result shows as inside a chat message: the winner (or champion) in big letters and the
 * options (or podium) below it.
 */
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/components/icon.component';
import type { SpinlyResult } from './spinly-result';

/** Chat card for a wheel result or a tournament champion. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-spinly-card',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <div
      class="mt-1 w-72 max-w-full overflow-hidden rounded-ui-lg border border-white/10 bg-black/25"
    >
      <div
        class="flex items-center gap-2 border-b border-white/8 bg-accent/10 px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-accent"
      >
        <app-icon [name]="icon()" [size]="14" />
        {{ heading() | t }}
        @if (result().title) {
          <span class="truncate text-muted">· {{ result().title }}</span>
        }
      </div>
      <div class="px-3 py-3">
        <div class="text-[0.6875rem] text-muted">{{ caption() | t }}</div>
        <div class="break-words text-2xl font-black leading-tight">{{ result().winner }}</div>
        <div class="mt-3 flex flex-wrap gap-1.5">
          @for (name of result().names; track $index; let i = $index) {
            <span
              class="rounded-full border px-2 py-0.5 text-[0.6875rem]"
              [class]="
                name === result().winner && result().kind === 'wheel'
                  ? 'border-accent bg-accent/15 font-bold'
                  : 'border-white/10 text-muted'
              "
            >
              @if (result().kind === 'tournament') {
                {{ i + 1 }}.
              }
              {{ name }}
            </span>
          }
        </div>
      </div>
    </div>
  `,
})
export class SpinlyCardComponent {
  /** The result to show. */
  readonly result = input.required<SpinlyResult>();

  /** Icon of the card: a wheel or a trophy. */
  protected readonly icon = computed(this.pickIcon.bind(this));
  /** Title of the card. */
  protected readonly heading = computed(this.pickHeading.bind(this));
  /** Small caption above the winner. */
  protected readonly caption = computed(this.pickCaption.bind(this));

  /** The icon of the card: a wheel or a trophy. */
  private pickIcon(): string {
    return this.result().kind === 'wheel' ? 'wheel' : 'trophy';
  }

  /** The title of the card. */
  private pickHeading(): string {
    return this.result().kind === 'wheel' ? 'Spinly wheel' : 'Spinly tournament';
  }

  /** The words over the result: what the wheel says or who is the champion. */
  private pickCaption(): string {
    return this.result().kind === 'wheel' ? 'The wheel says' : 'Champion';
  }
}
