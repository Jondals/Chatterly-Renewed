/**
 * src/app/shared/components/image-source.component.ts
 * The window that asks where a picture comes from: a file of the person (chosen or dropped here) or a GIF found in the GIF
 * search of the chat. It is used for the profile picture, the banner, the icon of a group and the backgrounds of a call,
 * and opened by `chooseImageSource`.
 */
import {
  ApplicationRef,
  Component,
  EnvironmentInjector,
  computed,
  createComponent,
  inject,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { pickFile } from '../../core/file-picker';
import { GifService, type GifResult } from '../../core/services/gif.service';
import { GifThumbComponent } from './gif-thumb.component';
import { IconComponent } from './icon.component';
import { ModalComponent } from './modal.component';

/** What the person chose. */
export type ImageSourceResult = { kind: 'file'; file: File } | { kind: 'gif'; gif: GifResult };

/** The types of file offered by the chooser. */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
/** How many GIFs appear each time, and how long to wait between one group and the next (ms). */
const REVEAL_STEP = 6;
const REVEAL_EVERY_MS = 90;
/** How long to wait after the last key before searching. */
const SEARCH_DELAY_MS = 350;

/** The window to choose where a picture comes from. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-image-source',
  standalone: true,
  imports: [ModalComponent, IconComponent, GifThumbComponent, TranslatePipe],
  template: `
    <app-modal [title]="title() | t" [subtitle]="subtitle() | t" [width]="580" (closed)="cancel()">
      <div class="isrc-tabs" role="tablist" [attr.data-tab]="tab()">
        <span class="isrc-pill" aria-hidden="true"></span>
        <button
          type="button"
          role="tab"
          class="isrc-tab"
          [class.is-on]="tab() === 'upload'"
          [attr.aria-selected]="tab() === 'upload'"
          (click)="show('upload')"
        >
          <app-icon name="upload" [size]="15" /> {{ 'Upload a file' | t }}
        </button>
        <button
          type="button"
          role="tab"
          class="isrc-tab"
          [class.is-on]="tab() === 'gif'"
          [attr.aria-selected]="tab() === 'gif'"
          (click)="show('gif')"
        >
          <app-icon name="gif" [size]="15" /> GIF
        </button>
      </div>

      @if (tab() === 'upload') {
        <button
          type="button"
          class="isrc-drop anim-fade-in"
          [class.is-over]="over()"
          (click)="choose()"
          (dragover)="dragOver($event)"
          (dragleave)="over.set(false)"
          (drop)="dropped($event)"
        >
          <span class="isrc-drop-icon"><app-icon name="upload" [size]="26" /></span>
          <b>{{ 'Drop a picture here' | t }}</b>
          <span class="text-xs text-muted">{{
            'or click to choose one from your device' | t
          }}</span>
          <span class="text-[0.6875rem] text-dim">PNG · JPG · WebP · AVIF · GIF</span>
        </button>
        @if (problem()) {
          <p class="mt-3 text-center text-sm text-red-300">{{ problem() | t }}</p>
        }
      } @else {
        <div class="anim-fade-in">
          <div
            class="flex h-10 items-center gap-2 rounded-ui bg-black/30 px-3 text-sm focus-within:ring-1 focus-within:ring-accent/60"
          >
            <app-icon name="search" [size]="14" class="text-dim" />
            <input
              class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-dim"
              [placeholder]="'Search GIPHY' | t"
              [value]="query()"
              (input)="onQuery($any($event.target).value)"
            />
          </div>
          <div class="isrc-grid mt-3">
            @if (gifs.enabled() === false) {
              <div
                class="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted"
              >
                <app-icon name="gif" [size]="34" class="text-dim" />
                <b class="text-fg">{{ 'GIF search is not enabled on this server' | t }}</b>
                <span>{{
                  'The server admin needs to set GIPHY_API_KEY (free at developers.giphy.com).' | t
                }}</span>
              </div>
            } @else {
              <div class="columns-2 gap-2 sm:columns-3">
                @for (g of shown(); track g.id) {
                  <app-gif-thumb [gif]="g" (chosen)="pick($event)" />
                }
              </div>
              @if (loading()) {
                <div class="shimmer mt-1 h-24 rounded-ui"></div>
              }
              @if (next() && !loading()) {
                <button type="button" class="btn btn-sm mt-1 w-full" (click)="load(true)">
                  {{ 'Load more' | t }}
                </button>
              }
              @if (error()) {
                <p class="mt-2 text-center text-sm text-red-300">{{ error() | t }}</p>
              }
              <p class="mt-3 text-center text-[0.625rem] text-dim">
                {{ 'GIFs are fetched through the server. Powered by GIPHY.' | t }}
              </p>
            }
          </div>
        </div>
      }
    </app-modal>
  `,
  styles: `
    .isrc-tabs {
      position: relative;
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 0.25rem;
      margin-bottom: 1rem;
      border-radius: calc(var(--r) * 0.9);
      background: rgba(255, 255, 255, 0.05);
    }
    .isrc-pill {
      position: absolute;
      top: 0.25rem;
      bottom: 0.25rem;
      left: 0.25rem;
      width: calc(50% - 0.25rem);
      border-radius: calc(var(--r) * 0.7);
      background: color-mix(in srgb, var(--accent) 22%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
      transition: transform 0.38s var(--ease);
    }
    .isrc-tabs[data-tab='gif'] .isrc-pill {
      transform: translateX(100%);
    }
    .isrc-tab {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.6rem 0.75rem;
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--muted, #9aa3b5);
      transition: color 0.25s var(--ease-suave);
    }
    .isrc-tab.is-on {
      color: var(--fg, #fff);
    }
    .isrc-drop {
      display: flex;
      width: 100%;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 2.75rem 1rem;
      border: 2px dashed rgba(255, 255, 255, 0.16);
      border-radius: var(--r-lg, 14px);
      background: rgba(255, 255, 255, 0.025);
      text-align: center;
      transition:
        border-color 0.3s var(--ease),
        background-color 0.3s var(--ease),
        transform 0.3s var(--ease);
    }
    .isrc-drop:hover,
    .isrc-drop.is-over {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 9%, transparent);
    }
    .isrc-drop.is-over {
      transform: scale(1.01);
    }
    .isrc-drop-icon {
      display: grid;
      place-items: center;
      width: 3.4rem;
      height: 3.4rem;
      margin-bottom: 0.4rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      color: var(--accent);
      transition: transform 0.4s var(--ease);
    }
    .isrc-drop:hover .isrc-drop-icon {
      transform: translateY(-3px) scale(1.06);
    }
    .isrc-grid {
      max-height: 22rem;
      min-height: 12rem;
      overflow-y: auto;
    }
  `,
})
class ImageSourceComponent {
  readonly title = input('Choose a picture');
  readonly subtitle = input('');
  /** The result: what was chosen, or null when the person cancels. */
  readonly done = output<ImageSourceResult | null>();

  protected readonly gifs = inject(GifService);
  protected readonly tab = signal<'upload' | 'gif'>('upload');
  protected readonly over = signal(false);
  protected readonly problem = signal('');
  protected readonly query = signal('');
  protected readonly results = signal<GifResult[]>([]);
  /** How many of the results are on the screen: they come a few at a time so the window never stalls. */
  protected readonly count = signal(0);
  protected readonly shown = computed(this.sliceResults.bind(this));
  private revealTimer: ReturnType<typeof setTimeout> | undefined;
  protected readonly next = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** The results that are on the screen. */
  private sliceResults(): GifResult[] {
    return this.results().slice(0, this.count());
  }

  /** Lets the next few results appear (and keeps going until all of them are). */
  private reveal(): void {
    clearTimeout(this.revealTimer);
    if (this.count() >= this.results().length) {
      return;
    }
    this.count.update(function more(n) {
      return n + REVEAL_STEP;
    });
    this.revealTimer = setTimeout(this.reveal.bind(this), REVEAL_EVERY_MS);
  }

  /** Changes the tab (the first time the GIF tab opens, it loads the trending GIFs). */
  protected show(tab: 'upload' | 'gif'): void {
    this.tab.set(tab);
    if (tab === 'gif' && this.results().length === 0) {
      void this.gifs.init().then(this.firstLoad.bind(this));
    }
  }

  /** Loads the first page once the server has said whether GIFs are available. */
  private firstLoad(): void {
    if (this.gifs.enabled()) {
      void this.load(false);
    }
  }

  /** Opens the file chooser. */
  protected async choose(): Promise<void> {
    const file = await pickFile(ACCEPT);
    if (file) {
      this.take(file);
    }
  }

  /** A file is being dragged over the area. */
  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.over.set(true);
  }

  /** A file was dropped on the area. */
  protected dropped(event: DragEvent): void {
    event.preventDefault();
    this.over.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.take(file);
    }
  }

  /** Accepts a file when it is a picture. */
  private take(file: File): void {
    if (!file.type.startsWith('image/')) {
      this.problem.set('That is not a picture.');
      return;
    }
    this.done.emit({ kind: 'file', file });
  }

  /** The search text changed: the search starts a moment after the last key. */
  protected onQuery(value: string): void {
    this.query.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(this.load.bind(this, false), SEARCH_DELAY_MS);
  }

  /** Loads GIFs (a search or the trending ones), more of them when asked. */
  protected async load(more: boolean): Promise<void> {
    if (!this.gifs.enabled()) {
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const text = this.query().trim();
      const position = more ? this.next() : '';
      const page = text
        ? await this.gifs.search(text, position)
        : await this.gifs.featured(position);
      if (!more) {
        this.count.set(0);
      }
      this.results.set(more ? [...this.results(), ...page.results] : page.results);
      this.next.set(page.next);
      this.reveal();
    } catch {
      this.error.set('Could not load GIFs. Try again.');
    } finally {
      this.loading.set(false);
    }
  }

  /** A GIF was chosen. */
  protected pick(gif: GifResult): void {
    this.done.emit({ kind: 'gif', gif });
  }

  /** Closes without a picture. */
  protected cancel(): void {
    clearTimeout(this.timer);
    clearTimeout(this.revealTimer);
    this.done.emit(null);
  }
}

/**
 * Opens the window to choose where a picture comes from and waits for the answer.
 * @param injector Where the window gets its services from.
 * @param options The title and the line under it.
 * @returns A file or a GIF, or null when the person cancels.
 */
export function chooseImageSource(
  injector: EnvironmentInjector,
  options: { title?: string; subtitle?: string } = {},
): Promise<ImageSourceResult | null> {
  // ! Pressing again while the window is on its way (or open) does not open a second one: it waits for the same answer.
  if (openWindow) {
    return openWindow;
  }
  openWindow = new Promise<ImageSourceResult | null>(function open(resolve) {
    const ref = createComponent(ImageSourceComponent, { environmentInjector: injector });
    if (options.title) {
      ref.setInput('title', options.title);
    }
    if (options.subtitle) {
      ref.setInput('subtitle', options.subtitle);
    }
    const app = injector.get(ApplicationRef);
    app.attachView(ref.hostView);
    document.body.appendChild(ref.location.nativeElement);
    const subscription = ref.instance.done.subscribe(function finish(
      result: ImageSourceResult | null,
    ) {
      subscription.unsubscribe();
      app.detachView(ref.hostView);
      ref.destroy();
      openWindow = null;
      resolve(result);
    });
  });
  return openWindow;
}

/** The window that is open now (null when there is none). */
let openWindow: Promise<ImageSourceResult | null> | null = null;

/**
 * Turns what the person chose into a file (a GIF is downloaded through the server).
 * @returns The picture as a file.
 */
export async function sourceToBlob(
  injector: EnvironmentInjector,
  choice: ImageSourceResult,
): Promise<Blob> {
  return choice.kind === 'file' ? choice.file : injector.get(GifService).download(choice.gif.url);
}
