/**
 * src/app/shared/components/image-viewer.component.ts
 * A picture shown big over the page: a press anywhere or Esc closes it.
 */
import { Component, HostListener, inject } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { ViewerService } from '../../core/services/viewer.service';
import { closeOnBack } from '../../core/services/back.service';

/** The big picture of a profile picture. */
@Component({
  selector: 'app-image-viewer',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (viewer.open(); as shown) {
      <div
        class="anim-fade-in fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="shown.name"
        (click)="viewer.close()"
      >
        <img
          [src]="shown.src"
          [alt]="shown.name"
          draggable="false"
          class="anim-pop max-h-full max-w-full rounded-ui-lg object-contain shadow-2xl"
        />
        <span
          class="absolute bottom-5 rounded-full bg-black/60 px-3 py-1 text-xs text-muted backdrop-blur"
          >{{ shown.name }} · {{ 'Press anywhere to close' | t }}</span
        >
      </div>
    }
  `,
})
export class ImageViewerComponent {
  /** The back key of the phone closes it (see BackService). */
  private readonly backKey = closeOnBack(this.backOpen.bind(this), this.backClose.bind(this));

  protected readonly viewer = inject(ViewerService);

  /** Esc closes the picture. */
  @HostListener('document:keydown.escape')
  protected close(): void {
    this.viewer.close();
  }

  /** Whether it is open for the back key. */
  private backOpen(): boolean {
    return !!this.viewer.open();
  }

  /** The back key closes it. */
  private backClose(): void {
    this.viewer.close();
  }
}
