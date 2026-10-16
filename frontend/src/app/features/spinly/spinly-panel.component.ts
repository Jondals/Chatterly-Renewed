/**
 * src/app/features/spinly/spinly-panel.component.ts
 * The panel that shows Spinly inside Chatterly (in a chat or during a call) so the wheel can decide things without
 * leaving the conversation. It frames the real Spinly (nothing is copied here), shows its state, and lets the person
 * post the last result in the chat or open Spinly in its own window.
 */
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, effect, inject, viewChild } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { SpinlyService } from '../../core/services/spinly.service';
import { SettingsService } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/components/icon.component';
import { SpinlyLogoComponent } from '../../shared/components/spinly-logo.component';
import { SpinlyComposerComponent } from './spinly-composer.component';
import { closeOnBack } from '../../core/services/back.service';

/** Large panel with the Spinly frame, opened from the "+" menu of the composer and from the call screen. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-spinly-panel',
  standalone: true,
  imports: [IconComponent, SpinlyComposerComponent, SpinlyLogoComponent, TranslatePipe],
  template: `
    @if (spinly.composing(); as request) {
      <app-spinly-composer
        [initial]="request.initial"
        [confirmLabel]="confirmLabel(request.purpose, request.initial !== null)"
        [subtitle]="
          request.purpose === 'chat'
            ? 'Everybody in the chat can run it, once'
            : 'Everybody in the call sees it and can spin it'
        "
        (confirmed)="spinly.finishCompose($event)"
        (closed)="spinly.cancelCompose()"
      />
    }
    @if (spinly.panelOpen()) {
      <div
        animate.leave="leave-fade"
        class="anim-fade-in fixed inset-0 z-[85] flex items-center justify-center bg-black/65 p-3 sm:p-6"
        (mousedown)="onBackdrop($event)"
        role="presentation"
      >
        <section
          class="panel anim-pop flex h-[min(52rem,94dvh)] w-[min(72rem,96vw)] flex-col overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Spinly"
        >
          <header class="flex flex-wrap items-center gap-3 border-b border-white/8 px-4 py-3">
            <app-spinly-logo [size]="36" />
            <div class="min-w-0 leading-tight">
              <h2 class="text-[0.9375rem] font-bold">Spinly</h2>
              <p class="truncate text-xs text-muted">{{ subtitle() | t }}</p>
            </div>
            <span class="flex-1"></span>
            @if (spinly.frameState() === 'ready') {
              <button
                type="button"
                class="btn btn-sm"
                [class.btn-primary]="spinly.linking()"
                (click)="spinly.importProfile()"
              >
                <app-icon name="link" [size]="14" /> {{ 'Use my themes and presets' | t }}
              </button>
            }
            <button
              type="button"
              class="btn btn-icon btn-sm"
              [attr.aria-label]="'Close' | t"
              (click)="spinly.close()"
            >
              <app-icon name="x" [size]="16" />
            </button>
          </header>
          <div class="relative min-h-0 flex-1 bg-black/30">
            @for (nonce of [spinly.frameNonce()]; track nonce) {
              <iframe
                #frame
                class="absolute inset-0 h-full w-full border-0"
                [class.opacity-0]="spinly.frameState() !== 'ready'"
                [src]="safeSrc"
                title="Spinly"
                referrerpolicy="strict-origin-when-cross-origin"
                allow="clipboard-write; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
              ></iframe>
            }
            @if (spinly.linking() && spinly.frameState() === 'ready') {
              <div
                class="anim-fade-up pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4"
              >
                <div
                  class="pointer-events-auto max-w-lg rounded-ui-lg border border-accent/40 bg-ink-900/95 px-4 py-2.5 text-center text-xs shadow-2xl"
                >
                  {{
                    'Sign in to Spinly here if you want your account, then press Use my themes and presets.'
                      | t
                  }}
                </div>
              </div>
            }
            @if (spinly.frameState() === 'blocked') {
              <div
                class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center"
              >
                <span class="menu-icon bg-amber/15 text-amber !h-14 !w-14"
                  ><app-icon name="wheel" [size]="26"
                /></span>
                <b class="text-lg">{{ 'Spinly could not be loaded' | t }}</b>
                <p class="max-w-md text-sm text-muted">
                  {{ 'Check your connection and try again.' | t }}
                </p>
                <button type="button" class="btn btn-primary" (click)="spinly.reloadFrame()">
                  <app-icon name="refresh" [size]="15" /> {{ 'Try again' | t }}
                </button>
              </div>
            }
          </div>
        </section>
      </div>
    }
  `,
})
export class SpinlyPanelComponent {
  /** The back key of the phone closes it (see BackService). */
  private readonly backKey = closeOnBack(this.backOpen.bind(this), this.backClose.bind(this));

  protected readonly spinly = inject(SpinlyService);
  private readonly settings = inject(SettingsService);
  private readonly sanitizer = inject(DomSanitizer);
  /** The address of Spinly, marked as trusted (it is a fixed address, never something typed). */
  protected readonly safeSrc: SafeResourceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
    this.spinly.frameUrl,
  );
  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  /** Hands the frame to the service whenever it is created or removed. */
  constructor() {
    effect(this.syncFrame.bind(this));
  }

  /** Tells the service which frame to trust messages from. */
  private syncFrame(): void {
    this.spinly.attachFrame(this.frame()?.nativeElement ?? null);
  }

  /** The text of the button that finishes the composer. */
  protected confirmLabel(purpose: 'chat' | 'call', editing: boolean): string {
    if (purpose === 'chat') {
      return 'Send to the chat';
    }
    return editing ? 'Apply for everybody' : 'Start for everybody';
  }

  /** The line under the title: the state of the person's Spinly account. */
  protected subtitle(): string {
    const account = this.settings.spinlyAccount();
    if (account === 'in') {
      return 'Your Spinly account is connected: your presets are here.';
    }
    return account === 'out' ? 'Sign in to Spinly to use your presets.' : 'The wheel decides.';
  }

  /** A press on the dark area around the panel closes it. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.spinly.close();
    }
  }

  /** Escape closes the panel. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.spinly.composing()) {
      return;
    }
    if (this.spinly.panelOpen()) {
      this.spinly.close();
    }
  }

  /** Whether it is open for the back key. */
  private backOpen(): boolean {
    return this.spinly.panelOpen() && !this.spinly.composing();
  }

  /** The back key closes it. */
  private backClose(): void {
    this.spinly.close();
  }
}
