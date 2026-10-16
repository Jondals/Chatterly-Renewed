/**
 * src/app/shared/components/gif-thumb.component.ts
 * One GIF of a list of results. Its small picture is only asked for when it comes near the screen (a list of fifty does not ask for
 * fifty at once), and it fades in when it arrives.
 */
import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { GifService, type GifResult } from '../../core/services/gif.service';

/** One GIF of a list of results. */
@Component({
  selector: 'app-gif-thumb',
  standalone: true,
  template: `
    <button
      type="button"
      class="group relative mb-2 block w-full overflow-hidden rounded-ui bg-white/5"
      [style.aspect-ratio]="gif().width + '/' + gif().height"
      (click)="pick()"
      [attr.aria-label]="gif().title"
    >
      @if (src(); as url) {
        <img
          decoding="async"
          [src]="url"
          [alt]="gif().title"
          class="anim-fade-in h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
      } @else if (failed()) {
        <span class="flex h-full w-full items-center justify-center text-xs text-muted">↻</span>
      } @else {
        <div class="shimmer h-full w-full"></div>
      }
    </button>
  `,
})
export class GifThumbComponent {
  readonly gif = input.required<GifResult>();
  readonly chosen = output<GifResult>();
  private readonly service = inject(GifService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly src = signal<string | null>(null);
  /** The picture could not be loaded: pressing the thumbnail asks again. */
  protected readonly failed = signal(false);
  /** True once the thumbnail is near the screen. */
  private readonly near = signal(false);
  private observer: IntersectionObserver | null = null;

  constructor() {
    if (typeof IntersectionObserver === 'undefined') {
      this.near.set(true);
    } else {
      this.observer = new IntersectionObserver(this.seen.bind(this), { rootMargin: '240px' });
      this.observer.observe(this.host.nativeElement);
    }
    inject(DestroyRef).onDestroy(this.stop.bind(this));
    effect(this.load.bind(this));
  }

  /** The thumbnail came near the screen: from now on it may load. */
  private seen(entries: IntersectionObserverEntry[]): void {
    if (
      entries.some(function visible(entry) {
        return entry.isIntersecting;
      })
    ) {
      this.near.set(true);
      this.stop();
    }
  }

  /** Stops watching. */
  private stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Asks for the small picture (once the thumbnail is near the screen). */
  private load(): void {
    const url = this.gif().preview;
    if (!this.near()) {
      return;
    }
    untracked(this.fetch.bind(this, url));
  }

  /** Gets the picture and shows it. */
  private fetch(url: string): void {
    this.failed.set(false);
    void this.service.preview(url).then(this.src.set.bind(this.src), this.fail.bind(this));
  }

  private fail(): void {
    this.failed.set(true);
  }

  /** A press chooses the GIF, or asks again for the picture when it did not load. */
  protected pick(): void {
    if (this.failed()) {
      this.fetch(this.gif().preview);
    } else {
      this.chosen.emit(this.gif());
    }
  }
}
