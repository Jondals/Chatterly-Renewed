/**
 * src/app/shared/components/banner.component.ts
 * Profile banner: an image plus a color or gradient layer with opacity.
 */
import { Component, computed, input } from '@angular/core';
import { bannerLayer } from '../util/banner';

/** Profile banner: the uploaded picture with the (optional) colour or gradient layer on top at its own opacity. */
@Component({
  selector: 'app-banner',
  standalone: true,
  template: `
    <div
      class="relative h-full w-full overflow-hidden bg-cover bg-center"
      [style.background-image]="image()"
    >
      @if (!image() && !layer()) {
        <div
          class="gradient-pan absolute inset-0 opacity-90"
          style="background-image: linear-gradient(120deg, color-mix(in oklab, var(--accent) 55%, #0b0d12), color-mix(in oklab, var(--accent-2) 60%, #0b0d12), color-mix(in oklab, var(--accent) 40%, #0b0d12))"
        ></div>
      }
      @if (layer(); as l) {
        <div
          class="absolute inset-0"
          [style.background]="l.background"
          [style.opacity]="l.opacity"
        ></div>
      }
      <ng-content />
    </div>
  `,
  host: { class: 'block' },
})
export class BannerComponent {
  /** CSS value such as `url(blob:...)`, or null. */
  readonly image = input<string | null>(null);
  readonly color = input('');
  protected readonly layer = computed(
    function (this: BannerComponent) {
      return this.image() ? null : bannerLayer(this.color());
    }.bind(this),
  );
}
