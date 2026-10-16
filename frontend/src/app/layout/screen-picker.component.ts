/**
 * src/app/layout/screen-picker.component.ts
 * The menu to choose what to share, inside the app (desktop app only): two tabs (the whole screen or a window), the list with a
 * picture of each, a box to share the sound of the computer too, and Cancel. Esc or a click outside closes it.
 */
import { Component, HostListener, inject } from '@angular/core';
import { TranslatePipe } from '../core/i18n/i18n.service';
import { IconComponent } from '../shared/components/icon.component';
import { ScreenPickerService } from '../core/services/screen-picker.service';
import { closeOnBack } from '../core/services/back.service';

/** The menu to choose a screen or a window to share. */
@Component({
  selector: 'app-screen-picker',
  standalone: true,
  imports: [TranslatePipe, IconComponent],
  template: `
    @if (picker.request()) {
      <div
        class="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4"
        (mousedown)="closeOnBackdrop($event)"
      >
        <div
          class="panel flex max-h-[min(36rem,90dvh)] w-full max-w-3xl flex-col gap-3 p-4"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="'Choose what to share' | t"
        >
          <h2 class="text-base font-semibold">{{ 'Choose what to share' | t }}</h2>
          @if (picker.bothKinds()) {
            <div class="flex gap-2" role="tablist">
              <button
                type="button"
                role="tab"
                class="btn btn-sm"
                [class.btn-primary]="picker.tab() === 'screen'"
                [attr.aria-selected]="picker.tab() === 'screen'"
                (click)="picker.tab.set('screen')"
              >
                {{ 'Entire screen' | t }}
              </button>
              <button
                type="button"
                role="tab"
                class="btn btn-sm"
                [class.btn-primary]="picker.tab() === 'window'"
                [attr.aria-selected]="picker.tab() === 'window'"
                (click)="picker.tab.set('window')"
              >
                {{ 'A window' | t }}
              </button>
            </div>
          }
          <div
            class="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] content-start gap-3 overflow-y-auto"
          >
            @for (item of picker.shown(); track item.id) {
              <button
                type="button"
                class="flex flex-col gap-2 rounded-ui border border-white/10 bg-white/5 p-2 text-left hover:border-accent/70 hover:bg-white/10"
                (click)="picker.choose(item)"
              >
                <img
                  class="aspect-video w-full rounded-[calc(var(--r)*.6)] bg-black object-contain"
                  [src]="item.thumb"
                  alt=""
                />
                <span class="truncate text-xs">{{ item.name }}</span>
              </button>
            } @empty {
              <p class="col-span-full py-8 text-center text-sm text-muted">
                {{ 'Nothing to show here.' | t }}
              </p>
            }
          </div>
          @if (picker.tab() === 'window') {
            <p class="text-xs text-dim">
              {{
                'A minimized window cannot be shared and does not show here: restore it and press Refresh.'
                  | t
              }}
            </p>
          }
          <div class="flex flex-wrap items-center justify-between gap-3">
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                [checked]="picker.audio()"
                (change)="picker.audio.set($any($event.target).checked)"
              />
              {{ 'Share the sound of the computer' | t }}
            </label>
            <span class="flex gap-2">
              @if (picker.canRefresh) {
                <button type="button" class="btn btn-sm gap-1.5" (click)="picker.refresh()">
                  <app-icon name="refresh" [size]="13" /> {{ 'Refresh' | t }}
                </button>
              }
              <button type="button" class="btn btn-sm" (click)="picker.cancel()">
                {{ 'Cancel' | t }}
              </button>
            </span>
          </div>
        </div>
      </div>
    }
  `,
})
export class ScreenPickerComponent {
  /** The back key of the phone closes it (see BackService). */
  private readonly backKey = closeOnBack(this.backOpen.bind(this), this.backClose.bind(this));

  protected readonly picker = inject(ScreenPickerService);

  /** Esc closes the menu. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.picker.cancel();
  }

  /** A click on the dark area (not on the menu) closes it. */
  protected closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.picker.cancel();
    }
  }

  /** Whether it is open for the back key. */
  private backOpen(): boolean {
    return !!this.picker.request();
  }

  /** The back key closes it. */
  private backClose(): void {
    this.picker.cancel();
  }
}
