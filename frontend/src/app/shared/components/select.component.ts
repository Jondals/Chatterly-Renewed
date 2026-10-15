/**
 * src/app/shared/components/select.component.ts
 * A drop-down list drawn by the page itself. The list of a native <select> belongs to the browser: it shows the
 * system cursor instead of the themed one and cannot be styled. This one lives in the top layer (so it is above
 * dialogs), follows the keyboard (arrows, Enter, Escape) and opens upward when there is no room below.
 */
import {
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { IconComponent } from './icon.component';
import { closeOnBack } from '../../core/services/back.service';
import { listenWhile } from '../util/listen-while';

/** One choice of the list. */
export interface SelectOption {
  value: string;
  label: string;
}

/** Height of the list at most (px). */
const MAX_HEIGHT = 288;

/** A drop-down list with the look of the rest of the interface. */
@Component({
  selector: 'app-select',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  host: { class: 'block' },
  template: `
    <button
      #trigger
      type="button"
      class="input flex w-full items-center justify-between gap-2 text-left"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label() | t"
      (mousedown)="$event.stopPropagation()"
      (click)="toggle()"
      (keydown)="onKey($event)"
    >
      <span class="min-w-0 flex-1 truncate">{{ currentLabel() }}</span>
      <app-icon
        name="chevron-down"
        [size]="15"
        class="shrink-0 text-muted transition-transform duration-200"
        [class.rotate-180]="open()"
      />
    </button>
    @if (open()) {
      <div
        #panel
        popover="manual"
        role="listbox"
        animate.leave="leave-pop"
        class="popover-reset select-panel anim-pop"
        [style.left.px]="box().x"
        [style.top.px]="box().y"
        [style.width.px]="box().w"
        [style.max-height.px]="box().h"
        (mousedown)="$event.stopPropagation()"
      >
        @for (option of options(); track option.value; let i = $index) {
          <button
            type="button"
            role="option"
            class="select-option"
            [class.is-on]="option.value === value()"
            [class.is-active]="i === active()"
            [attr.aria-selected]="option.value === value()"
            (mouseenter)="active.set(i)"
            (click)="choose(option.value)"
          >
            <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
            @if (option.value === value()) {
              <app-icon name="check" [size]="14" class="shrink-0 text-accent" />
            }
          </button>
        }
      </div>
    }
  `,
})
export class SelectComponent {
  /** The back key of the phone closes it (see BackService). */
  private readonly backKey = closeOnBack(this.backOpen.bind(this), this.backClose.bind(this));

  /** What can be chosen. */
  readonly options = input.required<SelectOption[]>();
  /** The value that is chosen now. */
  readonly value = input('');
  /** Name of the control for people who cannot see it. */
  readonly label = input('Choose');
  /** A new value was chosen. */
  readonly valueChange = output<string>();
  /** The list was opened (the owner can refresh what it offers). */
  readonly opened = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly box = signal({ x: 0, y: 0, w: 0, h: MAX_HEIGHT });
  /** The text of the chosen option. */
  protected readonly currentLabel = computed(this.pickLabel.bind(this));

  /** The label of the option whose value is the current one (the first option when none matches). */
  private pickLabel(): string {
    const options = this.options();
    const found = options.find(
      function same(this: SelectComponent, option: SelectOption) {
        return option.value === this.value();
      }.bind(this),
    );
    return (found ?? options[0])?.label ?? '';
  }

  /** Opens or closes the list. */
  protected toggle(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    this.opened.emit();
    const rect = this.host.nativeElement.getBoundingClientRect();
    const rows = Math.max(1, this.options().length);
    const wanted = Math.min(MAX_HEIGHT, rows * 40 + 12);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < wanted && above > below;
    const height = Math.max(96, Math.min(wanted, up ? above : below));
    this.box.set({
      x: Math.round(rect.left),
      y: Math.round(up ? rect.top - height - 6 : rect.bottom + 6),
      w: Math.round(rect.width),
      h: height,
    });
    const index = this.options().findIndex(
      function same(this: SelectComponent, option: SelectOption) {
        return option.value === this.value();
      }.bind(this),
    );
    this.active.set(Math.max(0, index));
    this.open.set(true);
    setTimeout(this.show.bind(this));
  }

  /** Moves the list to the top layer, above dialogs and menus. */
  private show(): void {
    const node = this.panel()?.nativeElement as
      (HTMLElement & { showPopover?: () => void }) | undefined;
    try {
      node?.showPopover?.();
    } catch {
      // It was already open.
    }
    node?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  /** Picks an option and closes the list. */
  protected choose(value: string): void {
    this.open.set(false);
    this.valueChange.emit(value);
    this.trigger()?.nativeElement.focus();
  }

  /** Arrows, Enter, Space and Escape. */
  protected onKey(event: KeyboardEvent): void {
    const count = this.options().length;
    if (event.key === 'Escape' && this.open()) {
      event.stopPropagation();
      this.open.set(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.open()) {
        this.toggle();
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active.set((this.active() + step + count) % count);
      setTimeout(this.show.bind(this));
    } else if ((event.key === 'Enter' || event.key === ' ') && this.open()) {
      event.preventDefault();
      const option = this.options()[this.active()];
      if (option) {
        this.choose(option.value);
      }
    }
  }

  /** While the list is open, a press anywhere else closes it, and so does a resize (the list does not follow the page). */
  private readonly outside = listenWhile(
    this.backOpen.bind(this),
    document,
    'mousedown',
    this.closeOutside.bind(this),
  );
  private readonly resized = listenWhile(
    this.backOpen.bind(this),
    window,
    'resize',
    this.closeOutside.bind(this),
  );

  /** Closes the list. */
  protected closeOutside(): void {
    this.open.set(false);
  }

  /** Whether it is open for the back key. */
  private backOpen(): boolean {
    return this.open();
  }

  /** The back key closes it. */
  private backClose(): void {
    this.open.set(false);
  }
}
