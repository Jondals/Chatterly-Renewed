/**
 * src/app/shared/components/image-adjust.component.ts
 * The window where a picture is adjusted before it is used as a profile picture, a banner or a group icon: drag it to
 * move it, scroll or use the slider to zoom, and see exactly what will be kept (a circle for square pictures, a wide
 * frame for banners). It is loaded only when a picture is chosen, and opened by `adjustImage`.
 */
import { I18nService } from '../../core/i18n/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import {
  ApplicationRef,
  AfterViewInit,
  Component,
  ElementRef,
  EnvironmentInjector,
  OnDestroy,
  OnInit,
  createComponent,
  inject,
  computed,
  input,
  output,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import {
  IMAGE_PRESETS,
  type ImageKind,
  type ImageService,
} from '../../core/services/image.service';
import { encodeGif, type GifFrame } from '../util/gif-encoder';
import { chooseImageSource, sourceToBlob } from './image-source.component';
import { ModalComponent } from './modal.component';

/** The biggest animated picture kept as it is (the server accepts up to 8 MB). */
const ANIMATED_MAX_BYTES = 8 * 1024 * 1024 - 2048;
/** The biggest original picture that is sent as it is when the canvas cannot be read (the server accepts up to 8 MB). */
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024 - 2048;
/** A picture that moves is cut at most this wide (a GIF has 256 colors and no compression of the movement: smaller keeps it light). */
const ANIMATED_MAX_WIDTH = 640;
/** The most frames of a picture that moves that are kept (the others are merged into the one before: it plays at the same speed). */
const ANIMATED_MAX_FRAMES = 90;
/** The most the picture can be zoomed in (times the size that just covers the frame). */
const MAX_ZOOM = 4;

/** The window to adjust a picture. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-image-adjust',
  standalone: true,
  imports: [ModalComponent, TranslatePipe],
  template: `
    <app-modal [title]="'Adjust the picture' | t" [width]="520" (closed)="cancel()">
      <p class="mb-3 text-xs text-muted">
        {{ 'Drag the picture to move it, scroll or use the slider to zoom.' | t }}
      </p>
      <div
        #frame
        class="adjust-frame"
        [class.is-round]="round()"
        [style.aspect-ratio]="target().width + ' / ' + target().height"
        (pointerdown)="startDrag($event)"
        (pointermove)="drag($event)"
        (pointerup)="endDrag($event)"
        (pointercancel)="endDrag($event)"
        (wheel)="onWheel($event)"
      >
        <img
          #picture
          alt=""
          draggable="false"
          [src]="url()"
          [style.width.px]="drawWidth()"
          [style.height.px]="drawHeight()"
          [style.transform]="
            'translate(calc(-50% + ' + offsetX() + 'px), calc(-50% + ' + offsetY() + 'px))'
          "
          (load)="onLoaded()"
        />
        <span class="adjust-mask"></span>
      </div>
      <label class="mt-4 flex items-center gap-3 text-xs text-muted">
        {{ 'Zoom' | t }}
        <input
          class="flex-1"
          type="range"
          min="1"
          [max]="maxZoom"
          step="0.01"
          [value]="zoom()"
          [attr.aria-label]="'Zoom' | t"
          (input)="onSlider($event)"
        />
      </label>
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn" type="button" [disabled]="saving()" (click)="cancel()">
          {{ 'Cancel' | t }}
        </button>
        <button
          class="btn btn-primary"
          type="button"
          [disabled]="!ready() || saving()"
          (click)="save()"
        >
          {{ (saving() ? 'Saving…' : 'Save') | t }}
        </button>
      </div>
    </app-modal>
  `,
  styles: `
    .adjust-frame {
      position: relative;
      width: 100%;
      overflow: hidden;
      border-radius: var(--r-lg, 14px);
      background: #000;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .adjust-frame:active {
      cursor: grabbing;
    }
    .adjust-frame img {
      position: absolute;
      left: 50%;
      top: 50%;
      max-width: none;
      pointer-events: none;
    }
    .adjust-mask {
      position: absolute;
      inset: 0;
      pointer-events: none;
      box-shadow: inset 0 0 0 2px #ffffff55;
    }
    .adjust-frame.is-round {
      max-width: 22rem;
      margin: 0 auto;
      border-radius: 50%;
    }
  `,
})
export class ImageAdjustComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  readonly file = input.required<Blob>();
  readonly target = input.required<{ width: number; height: number }>();
  /** The result: the adjusted picture, or null when the person cancels. */
  readonly done = output<Blob | null>();
  protected readonly maxZoom = MAX_ZOOM;
  protected readonly url = signal('');
  private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');
  private readonly picture = viewChild.required<ElementRef<HTMLImageElement>>('picture');
  protected readonly zoom = signal(1);
  /** A picture that moves is being cut frame by frame. */
  protected readonly saving = signal(false);
  protected readonly offsetX = signal(0);
  protected readonly offsetY = signal(0);
  private readonly frameWidth = signal(0);
  private readonly natural = signal({ width: 0, height: 0 });
  private readonly observer = new ResizeObserver(this.measure.bind(this));
  private dragging: { x: number; y: number } | null = null;

  /** Whether the picture is square (shown in a circle, like the profile pictures and the group icons). */
  protected readonly round = computed(this.isSquare.bind(this));
  /** Whether the picture finished loading. */
  protected readonly ready = computed(this.isReady.bind(this));
  /** Height of the frame in pixels. */
  private readonly frameHeight = computed(this.heightOfFrame.bind(this));
  /** Scale that makes the picture just cover the frame, times the zoom. */
  private readonly scale = computed(this.scaleOfPicture.bind(this));
  protected readonly drawWidth = computed(this.widthOfPicture.bind(this));
  protected readonly drawHeight = computed(this.heightOfPicture.bind(this));

  /** Makes the address of the picture from the file (the inputs are set before this runs). */
  ngOnInit(): void {
    this.url.set(URL.createObjectURL(this.file()));
  }

  /** Starts to watch the size of the frame. */
  ngAfterViewInit(): void {
    this.observer.observe(this.frame().nativeElement);
    this.measure();
  }

  /** Whether the target is a square. */
  private isSquare(): boolean {
    return this.target().width === this.target().height;
  }

  /** Whether the picture is ready to be adjusted. */
  private isReady(): boolean {
    return this.natural().width > 0 && this.frameWidth() > 0;
  }

  /** Height of the frame, from its width and the proportions of the target. */
  private heightOfFrame(): number {
    return (this.frameWidth() * this.target().height) / this.target().width;
  }

  /** Scale of the picture on screen. */
  private scaleOfPicture(): number {
    const size = this.natural();
    if (!size.width) {
      return 1;
    }
    return Math.max(this.frameWidth() / size.width, this.frameHeight() / size.height) * this.zoom();
  }

  /** Width of the picture on screen. */
  private widthOfPicture(): number {
    return this.natural().width * this.scale();
  }

  /** Height of the picture on screen. */
  private heightOfPicture(): number {
    return this.natural().height * this.scale();
  }

  /** Reads the width of the frame (it changes with the window). */
  private measure(): void {
    this.frameWidth.set(this.frame().nativeElement.clientWidth);
    this.keepInside();
  }

  /** The picture finished loading. */
  protected onLoaded(): void {
    const image = this.picture().nativeElement;
    this.natural.set({ width: image.naturalWidth, height: image.naturalHeight });
    this.keepInside();
  }

  /** Moves the picture back inside when it left a gap (the frame must always be full). */
  private keepInside(): void {
    const roomX = Math.max(0, (this.drawWidth() - this.frameWidth()) / 2);
    const roomY = Math.max(0, (this.drawHeight() - this.frameHeight()) / 2);
    this.offsetX.set(Math.min(roomX, Math.max(-roomX, this.offsetX())));
    this.offsetY.set(Math.min(roomY, Math.max(-roomY, this.offsetY())));
  }

  /** The press starts a drag. */
  protected startDrag(event: PointerEvent): void {
    this.dragging = { x: event.clientX, y: event.clientY };
    this.frame().nativeElement.setPointerCapture(event.pointerId);
  }

  /** The pointer moves the picture while it is pressed. */
  protected drag(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }
    this.offsetX.set(this.offsetX() + event.clientX - this.dragging.x);
    this.offsetY.set(this.offsetY() + event.clientY - this.dragging.y);
    this.dragging = { x: event.clientX, y: event.clientY };
    this.keepInside();
  }

  /** The release ends the drag. */
  protected endDrag(event: PointerEvent): void {
    this.dragging = null;
    this.frame().nativeElement.releasePointerCapture(event.pointerId);
  }

  /** The wheel zooms. */
  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.setZoom(this.zoom() * (1 - event.deltaY * 0.0015));
  }

  /** The slider zooms. */
  protected onSlider(event: Event): void {
    this.setZoom(Number((event.target as HTMLInputElement).value));
  }

  /** Sets the zoom inside its limits and keeps the picture covering the frame. */
  private setZoom(value: number): void {
    this.zoom.set(Math.min(MAX_ZOOM, Math.max(1, value)));
    this.keepInside();
  }

  /** Cuts what the frame shows and hands it over (a picture that moves is cut frame by frame and stays a moving one). */
  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (await isAnimated(this.file())) {
      this.saving.set(true);
      try {
        this.done.emit(await this.cutAnimated());
      } finally {
        this.saving.set(false);
      }
      return;
    }
    this.saveStill();
  }

  /**
   * Cuts a picture that moves: every frame is decoded, drawn where the frame shows it and written again as a GIF. If this browser
   * cannot decode the frames, or the result is too big even when small, the picture is kept as it was (or, when that is too big
   * too, saved still).
   */
  private async cutAnimated(): Promise<Blob | null> {
    const file = this.file();
    for (const scale of [1, 0.75, 0.55, 0.4]) {
      let blob: Blob | null = null;
      try {
        blob = await this.renderAnimated(Math.min(1, (ANIMATED_MAX_WIDTH / this.target().width) * scale));
      } catch {
        blob = null;
      }
      if (!blob) {
        break;
      }
      if (blob.size <= ANIMATED_MAX_BYTES) {
        return blob;
      }
    }
    if (file.size <= ANIMATED_MAX_BYTES) {
      return file;
    }
    // ! Said, not silent: a picture that moves but is too big is saved as a still one, and the person must know why it does not move.
    this.toast.info(
      this.i18n.t('This picture is too big to keep moving'),
      this.i18n.t('Pictures that move can weigh up to 8 MB: this one is saved still.'),
      '🖼️',
    );
    return this.stillBlob();
  }

  /** Decodes every frame of the picture and writes the cut ones as a GIF, `scale` times the size of the target. Null when it cannot. */
  private async renderAnimated(scale: number): Promise<Blob | null> {
    const Decoder = (
      window as unknown as {
        ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => {
          tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } };
          decode(options: { frameIndex: number }): Promise<{
            image: { duration: number | null; close(): void } & CanvasImageSource;
          }>;
          close(): void;
        };
      }
    ).ImageDecoder;
    if (!Decoder) {
      return null;
    }
    const bytes = await this.file().arrayBuffer();
    const head = String.fromCharCode(...new Uint8Array(bytes.slice(0, 4)));
    const decoder = new Decoder({ data: bytes, type: head === 'GIF8' ? 'image/gif' : 'image/webp' });
    try {
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack.frameCount;
      if (count < 2) {
        return null;
      }
      const target = this.target();
      const width = Math.max(16, Math.round(target.width * scale));
      const height = Math.max(16, Math.round(target.height * scale));
      const ratio = width / this.frameWidth();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        return null;
      }
      context.imageSmoothingQuality = 'high';
      const drawW = this.drawWidth() * ratio;
      const drawH = this.drawHeight() * ratio;
      const step = Math.max(1, Math.ceil(count / ANIMATED_MAX_FRAMES));
      const frames: GifFrame[] = [];
      for (let index = 0; index < count; index++) {
        const { image } = await decoder.decode({ frameIndex: index });
        // Every `step`-th frame is kept, and the time of the ones left out is added to it (the speed does not change).
        const delay = Math.max(1, Math.round((image.duration ?? 100_000) / 10_000));
        if (index % step === 0) {
          context.fillStyle = '#10131c';
          context.fillRect(0, 0, width, height);
          context.drawImage(
            image,
            width / 2 + this.offsetX() * ratio - drawW / 2,
            height / 2 + this.offsetY() * ratio - drawH / 2,
            drawW,
            drawH,
          );
          frames.push({ data: context.getImageData(0, 0, width, height).data, delay });
        } else if (frames.length > 0) {
          frames[frames.length - 1]!.delay += delay;
        }
        image.close();
      }
      return encodeGif(frames, width, height);
    } finally {
      decoder.close();
    }
  }

  /** The first frame, cut like a still picture (when a picture that moves cannot be kept moving). */
  private stillBlob(): Promise<Blob | null> {
    return new Promise<Blob | null>((resolve) => {
      this.saveStill(resolve);
    });
  }

  /** Cuts what the frame shows as a still picture and hands it over. */
  private saveStill(deliver: (blob: Blob | null) => void = this.done.emit.bind(this.done)): void {
    const target = this.target();
    const ratio = target.width / this.frameWidth();
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) {
      deliver(null);
      return;
    }
    context.imageSmoothingQuality = 'high';
    const width = this.drawWidth() * ratio;
    const height = this.drawHeight() * ratio;
    context.drawImage(
      this.picture().nativeElement,
      target.width / 2 + this.offsetX() * ratio - width / 2,
      target.height / 2 + this.offsetY() * ratio - height / 2,
      width,
      height,
    );
    // Browsers that protect against fingerprinting (Firefox with that option, Brave) hand back a blank canvas: then the
    // ? picture that was chosen is kept as it is instead of a blank one (the server checks its type and size).
    if (this.isBlank(context, target) && this.file().size <= MAX_ORIGINAL_BYTES) {
      deliver(this.file());
      return;
    }
    canvas.toBlob(deliver, 'image/webp', 0.86);
  }

  /** Whether what was drawn on the canvas reads back as one single color (a blank canvas). */
  private isBlank(
    context: CanvasRenderingContext2D,
    target: { width: number; height: number },
  ): boolean {
    const data = context.getImageData(0, 0, target.width, target.height).data;
    for (let i = 4; i < data.length; i += 4 * 97) {
      if (
        data[i] !== data[0] ||
        data[i + 1] !== data[1] ||
        data[i + 2] !== data[2] ||
        data[i + 3] !== data[3]
      ) {
        return false;
      }
    }
    return true;
  }

  /** Closes without a picture. */
  protected cancel(): void {
    this.done.emit(null);
  }

  /** Releases the address of the picture and stops watching. */
  ngOnDestroy(): void {
    this.observer.disconnect();
    URL.revokeObjectURL(this.url());
  }
}

/**
 * Opens the window to adjust a picture and waits for the answer.
 * @param injector Where the window gets its services from.
 * @param file The picture chosen.
 * @param target The size the picture will have.
 * @returns The adjusted picture, or null when the person cancels.
 */
export function adjustImage(
  injector: EnvironmentInjector,
  file: Blob,
  target: { width: number; height: number },
): Promise<Blob | null> {
  return new Promise<Blob | null>(function open(resolve) {
    const ref = createComponent(ImageAdjustComponent, { environmentInjector: injector });
    ref.setInput('file', file);
    ref.setInput('target', target);
    const app = injector.get(ApplicationRef);
    app.attachView(ref.hostView);
    document.body.appendChild(ref.location.nativeElement);
    const subscription = ref.instance.done.subscribe(function finish(result: Blob | null) {
      subscription.unsubscribe();
      app.detachView(ref.hostView);
      ref.destroy();
      resolve(result);
    });
  });
}

/** True for a GIF or an animated WebP (a picture that moves). */
async function isAnimated(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const text = String.fromCharCode(...head);
  if (text.startsWith('GIF8')) {
    return true;
  }
  return text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP' && text.includes('ANIM');
}

/**
 * Gets a picture ready: it is adjusted in the window (moved and zoomed) and cut to the target; a picture that moves keeps moving.
 * @returns The picture, or null when the person cancels.
 */
export async function prepareImage(
  injector: EnvironmentInjector,
  file: Blob,
  target: { width: number; height: number },
): Promise<Blob | null> {
  // A picture that moves is adjusted too: the window cuts every frame and keeps it moving (see ImageAdjustComponent.cutAnimated).
  return adjustImage(injector, file, target);
}

/**
 * Lets the person choose where the picture comes from (a file of theirs or a GIF) and adjust it (the first part of the
 * path of a new picture, banner or icon).
 * @returns The picture, or null when the person cancels.
 */
export async function pickAndPrepareImage(
  injector: EnvironmentInjector,
  kind: ImageKind,
): Promise<Blob | null> {
  const choice = await chooseImageSource(injector, {
    title: kind === 'banner' ? 'Choose a banner' : 'Choose a picture',
    subtitle: 'Upload your own file or pick a GIF.',
  });
  if (!choice) {
    return null;
  }
  const file = await sourceToBlob(injector, choice);
  return prepareImage(injector, file, IMAGE_PRESETS[kind]);
}

/**
 * Lets the person pick a profile picture or banner, adjust it and uploads it.
 * @returns The id of the new picture, or null when the person cancels.
 */
export async function pickAndUploadImage(
  images: ImageService,
  injector: EnvironmentInjector,
  kind: 'avatar' | 'banner',
): Promise<string | null> {
  const blob = await pickAndPrepareImage(injector, kind);
  return blob ? images.upload(kind, blob) : null;
}
