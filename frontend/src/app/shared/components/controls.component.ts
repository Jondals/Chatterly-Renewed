/**
 * src/app/shared/components/controls.component.ts
 * Small controls of the settings: switch, segmented selector and setting row.
 */
import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';

/** Animated on/off switch. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-toggle',
  standalone: true,
  template: `
    <button
      type="button"
      role="switch"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="label()"
      class="relative h-6 w-11 shrink-0 rounded-full"
      [style.background]="checked() ? 'var(--accent)' : 'rgba(255,255,255,.16)'"
      (click)="checked.set(!checked())"
    >
      <span
        class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-300"
        [style.left.px]="checked() ? 22 : 2"
        [style.background]="checked() ? 'var(--accent-ink)' : '#fff'"
      ></span>
    </button>
  `,
})
export class ToggleComponent {
  readonly checked = model(false);
  readonly label = input('');
}

/** A row of mutually exclusive options. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-segmented',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div
      class="inline-flex max-w-full flex-wrap gap-1 rounded-ui bg-black/30 p-1"
      role="radiogroup"
    >
      @for (o of options(); track o.id) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="value() === o.id"
          class="whitespace-nowrap rounded-[calc(var(--r)*.75)] px-3 py-1.5 text-xs font-semibold max-md:px-3.5 max-md:py-2"
          [class.bg-accent]="value() === o.id"
          [class.text-accent-ink]="value() === o.id"
          [class.text-muted]="value() !== o.id"
          [class.hover:text-fg]="value() !== o.id"
          (click)="value.set(o.id)"
        >
          {{ o.label | t }}
        </button>
      }
    </div>
  `,
})
export class SegmentedComponent {
  readonly options = input.required<{ id: string; label: string }[]>();
  readonly value = model<string>('');
}

/** Label + hint on the left, control on the right. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-setting-row',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div class="min-w-[11rem] flex-1">
        <div class="text-sm font-semibold">{{ title() | t }}</div>
        @if (hint()) {
          <div class="mt-0.5 text-xs leading-relaxed text-muted">{{ hint() | t }}</div>
        }
      </div>
      <div class="max-w-full shrink-0"><ng-content /></div>
    </div>
  `,
  host: { class: 'block border-b border-white/6 last:border-0', '[attr.title]': 'null' },
})
export class SettingRowComponent {
  readonly title = input.required<string>();
  readonly hint = input('');
}
