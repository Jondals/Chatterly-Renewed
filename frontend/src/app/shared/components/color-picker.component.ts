/**
 * src/app/shared/components/color-picker.component.ts
 * Own color picker with an eyedropper that works in every browser.
 */
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { IconComponent } from './icon.component';

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * ? Turns hue, saturation and brightness into #rrggbb (the picker works in HSV because it is how the square and the bar are drawn).
 */
function hsvToHex(h: number, s: number, v: number): string {
  const f = function (n: number) {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return (
    '#' +
    [f(5), f(3), f(1)]
      .map(function (x) {
        return Math.round(x * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

/** Turns #rrggbb into hue, saturation and brightness to place the handles of the picker. */
function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(function (i) {
    return parseInt(hex.slice(i, i + 2), 16) / 255;
  }) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

/**
 * Our own colour picker (no browser dialog): saturation/brightness square, hue slider, hex field, preset
 * swatches and an eyedropper. The eyedropper uses the native EyeDropper API where it exists (Chromium) and
 * otherwise captures the screen with getDisplayMedia and lets you click a pixel, so it works in every browser.
 */
@Component({
  selector: 'app-color-picker',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <button
      type="button"
      class="swatch relative block overflow-hidden border border-white/20 hover:scale-105"
      [class]="shape() === 'round' ? 'rounded-full' : 'rounded-[calc(var(--r)*.6)]'"
      [style.width.px]="size()"
      [style.height.px]="size() * (shape() === 'round' ? 1 : 0.8)"
      [style.background]="
        rainbow()
          ? 'conic-gradient(#ff4d4d, #ffd24d, #4dff88, #4dc3ff, #a066ff, #ff4dd2, #ff4d4d)'
          : value() || 'transparent'
      "
      [attr.aria-label]="label() | t"
      [attr.title]="label() | t"
      (mousedown)="$event.stopPropagation()"
      (click)="toggle()"
    >
      @if (rainbow()) {
        <span
          class="absolute inset-[28%] rounded-full border-2 border-ink-900"
          [style.background]="value()"
        ></span>
      }
      @if (!value() && !rainbow()) {
        <span
          class="absolute inset-0"
          style="background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red)"
        ></span>
      }
    </button>

    @if (open() || closing()) {
      <div
        #panel
        popover="manual"
        class="popover-reset picker-panel anim-pop"
        [class.pick-closing]="closing()"
        [style.left.px]="pos().x"
        [style.top.px]="pos().y"
        (mousedown)="$event.stopPropagation()"
      >
        <!-- Title bar: drag it to move the window -->
        <div
          class="picker-bar"
          (pointerdown)="startMove($event)"
          (pointermove)="move($event)"
          (pointerup)="endMove($event)"
          [attr.title]="'Drag to move' | t"
        >
          <span class="flex items-center gap-2">
            <span class="label !text-[0.6875rem]">{{ 'Custom color' | t }}</span>
          </span>
          <button
            type="button"
            class="btn btn-icon btn-sm btn-ghost"
            (pointerdown)="$event.stopPropagation()"
            (click)="close()"
            [attr.aria-label]="'Close' | t"
          >
            <app-icon name="x" [size]="14" />
          </button>
        </div>
        <div class="space-y-3 p-3.5">
          <div
            class="sv-area"
            [style.background]="
              'linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(' +
              h() +
              ',100%,50%))'
            "
            (pointerdown)="dragSv($event)"
            (pointermove)="dragSv($event)"
            (pointerup)="endDrag()"
          >
            <span
              class="picker-thumb"
              [style.left.%]="s() * 100"
              [style.top.%]="(1 - v()) * 100"
              [style.background]="current()"
            ></span>
          </div>
          <div
            class="hue-bar"
            (pointerdown)="dragHue($event)"
            (pointermove)="dragHue($event)"
            (pointerup)="endDrag()"
          >
            <span
              class="picker-thumb"
              [style.left.%]="(h() / 360) * 100"
              [style.top.%]="50"
              [style.background]="'hsl(' + h() + ',100%,50%)'"
            ></span>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="btn btn-icon tip shrink-0"
              data-tip-pos="bottom"
              [attr.data-tip]="'Pick a color from the screen' | t"
              (click)="eyedrop()"
            >
              <app-icon name="pipette" [size]="16" />
            </button>
            <span class="picker-preview" [style.background]="current()"></span>
            <label class="picker-field w-[7.8rem] shrink-0">
              <span>HEX</span>
              <input
                class="selectable"
                maxlength="7"
                spellcheck="false"
                [value]="current()"
                (input)="typed($any($event.target).value)"
                [attr.aria-label]="'Hex color' | t"
              />
            </label>
          </div>
          <div class="grid grid-cols-3 gap-2">
            @for (c of canales(); track c.n) {
              <label class="picker-field">
                <span>{{ c.n }}</span>
                <input
                  class="selectable"
                  type="text"
                  inputmode="numeric"
                  maxlength="3"
                  [value]="c.v"
                  (input)="tecleado(c.n, +$any($event.target).value)"
                  [attr.aria-label]="c.n"
                />
              </label>
            }
          </div>
        </div>
      </div>
    }

    @if (shot(); as img) {
      <div
        #capa
        popover="manual"
        class="popover-reset fixed inset-0 h-dvh w-screen bg-black cursor-crosshair"
        (mousemove)="hover($event)"
        (click)="choose($event)"
        (keydown.escape)="cancelShot()"
        tabindex="-1"
      >
        <img
          [src]="img.url"
          alt=""
          class="h-full w-full select-none object-contain"
          draggable="false"
        />
        <div
          class="pointer-events-none fixed flex items-center gap-2 rounded-ui bg-black/85 px-2 py-1 font-mono text-xs text-white shadow-xl"
          [style.left.px]="cursor().x + 18"
          [style.top.px]="cursor().y + 18"
        >
          <span class="h-4 w-4 rounded border border-white/40" [style.background]="under()"></span
          >{{ under() }}
        </div>
        <div class="pointer-events-none fixed inset-x-0 top-3 text-center text-sm text-white/80">
          {{ 'Click any pixel · Esc to cancel' | t }}
        </div>
      </div>
    }
  `,
  host: { class: 'relative inline-block align-middle' },
})
export class ColorPickerComponent {
  readonly value = input<string>('');
  readonly label = input('Pick a color');
  readonly size = input(28);
  /** Draws the button as a multicolor wheel with the chosen color as a dot in the middle. */
  readonly rainbow = input(false);
  readonly shape = input<'round' | 'square'>('square');
  /** When false the value is emitted only once the drag ends (for actions that must not repeat, like wrapping text). */
  readonly live = input(true);
  readonly valueChange = output<string>();
  /** The picker was closed. */
  readonly closed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly capa = viewChild<ElementRef<HTMLElement>>('capa');
  protected readonly open = signal(false);
  /** True while the picker plays its closing animation. */
  protected readonly closing = signal(false);
  protected readonly pos = signal({ x: 0, y: 0 });
  protected readonly h = signal(0);
  protected readonly s = signal(1);
  protected readonly v = signal(1);
  protected readonly current = computed(
    function (this: ColorPickerComponent) {
      return hsvToHex(this.h(), this.s(), this.v());
    }.bind(this),
  );
  /** The three channels (R, G, B) of the current color, for their number fields. */
  protected readonly canales = computed(
    function (this: ColorPickerComponent) {
      const hex = this.current();
      return ['R', 'G', 'B'].map(function (n, i) {
        return { n, v: parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) };
      });
    }.bind(this),
  );
  private dragState: { dx: number; dy: number } | null = null;

  private readonly outsideHandler = this.onOutside.bind(this);
  private readonly keyHandler = this.onKey.bind(this);
  private readonly swallowHandler = this.swallowClick.bind(this);
  private closeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Stops listening when the picker goes away. */
  constructor() {
    inject(DestroyRef).onDestroy(this.cleanup.bind(this));
  }

  /** Removes the listeners and the pending timer. */
  private cleanup(): void {
    this.listen(false);
    clearTimeout(this.closeTimer);
  }

  /** Starts or stops watching for a press outside and for Escape, before anything else sees them. */
  private listen(on: boolean): void {
    const action = on ? 'addEventListener' : 'removeEventListener';
    document[action]('mousedown', this.outsideHandler, true);
    document[action]('keydown', this.keyHandler, true);
  }

  /** A press outside closes only this picker (and the click that follows does nothing, so no menu under it reacts). */
  private onOutside(event: Event): void {
    const target = event.target as Element | null;
    if (!this.open() || !target || this.host.nativeElement.contains(target)) {
      return;
    }
    event.stopPropagation();
    this.close();
    if (!target.closest?.('app-color-picker, [data-keep-click]')) {
      document.addEventListener('click', this.swallowHandler, true);
      setTimeout(this.stopSwallowing.bind(this), 400);
    }
  }

  /** Eats the click that ends the press that closed the picker. */
  private swallowClick(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.stopSwallowing();
  }

  /** The click that had to be eaten has passed. */
  private stopSwallowing(): void {
    document.removeEventListener('click', this.swallowHandler, true);
  }

  /** Escape closes only the picker (or the screen capture of the eyedropper), not the menu it was opened from. */
  private onKey(event: Event): void {
    if ((event as KeyboardEvent).key !== 'Escape') {
      return;
    }
    if (this.shot()) {
      event.stopPropagation();
      this.cancelShot();
    } else if (this.open()) {
      event.stopPropagation();
      this.close();
    }
  }

  /** Closes the picker with its animation. */
  close(): void {
    if (!this.open()) {
      return;
    }
    this.listen(false);
    this.open.set(false);
    this.closing.set(true);
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(this.finishClosing.bind(this), 170);
    this.closed.emit();
  }

  /** The closing animation ended. */
  private finishClosing(): void {
    this.closing.set(false);
  }

  /** Opens the picker with its corner at a point of the screen (used when something else, like a slice of a wheel, is the button). */
  openAt(x: number, y: number): void {
    this.anchor = null;
    this.begin({ x, y });
  }

  protected readonly shot = signal<{ url: string; canvas: HTMLCanvasElement } | null>(null);
  protected readonly cursor = signal({ x: 0, y: 0 });
  protected readonly under = signal('#000000');

  /** Opens the panel next to its button, or closes it when it is open. */
  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.anchor = rect;
    // A first guess, right under the button; `fitToScreen` corrects it with the real size of the panel once it is drawn.
    this.begin({ x: rect.left, y: rect.bottom + 8 });
  }

  /** The button the panel belongs to (null when it was opened at a point of the screen). */
  private anchor: DOMRect | null = null;

  /**
   * Places the open panel by its real size: under its button when it fits, above it when it does not (touching the
   * button, not at the top of the page) and inside the screen in any case.
   */
  private fitToScreen(): void {
    const el = this.panel()?.nativeElement;
    const anchor = this.anchor;
    if (!el || !anchor) {
      return;
    }
    const height = el.offsetHeight;
    const width = el.offsetWidth;
    let y = anchor.bottom + 8;
    if (y + height > window.innerHeight - 8) {
      const above = anchor.top - height - 8;
      y = above >= 8 ? above : Math.max(8, window.innerHeight - height - 8);
    }
    const x = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);
    this.pos.set({ x, y });
  }

  /** Shows the panel at a place, with the sliders on the color the picker has. */
  private begin(place: { x: number; y: number }): void {
    const value = this.value();
    const [h, s, v] = HEX.test(value) ? hexToHsv(value) : [0, 1, 1];
    this.h.set(h);
    this.s.set(s);
    this.v.set(v);
    clearTimeout(this.closeTimer);
    this.closing.set(false);
    this.pos.set({
      x: Math.min(Math.max(8, place.x), window.innerWidth - 304),
      // Inside the screen from the first frame (a panel is about 420 px tall); `fitToScreen` then uses its real height.
      y: Math.min(Math.max(8, place.y), Math.max(8, window.innerHeight - 420)),
    });
    this.open.set(true);
    this.listen(true);
    setTimeout(this.mostrar.bind(this, 'panel'));
  }

  /** Moves the panel to the browser's top layer: no container with transform or overflow can shift or clip it there. */
  private mostrar(cual: 'panel' | 'capa'): void {
    const nodo = (cual === 'panel' ? this.panel() : this.capa())?.nativeElement as
      | (HTMLElement & { showPopover?: () => void })
      | undefined;
    try {
      nodo?.showPopover?.();
    } catch {
      /* ya estaba abierto */
    }
    // The panel exists now, so its real height is known: sit next to the button.
    if (cual === 'panel') requestAnimationFrame(this.fitToScreen.bind(this));
  }

  /** Tells the parent the color that is chosen now. */
  private emit(): void {
    this.valueChange.emit(this.current());
  }

  /** Drags in the square of saturation and brightness. */
  protected dragSv(event: PointerEvent): void {
    if (event.type === 'pointermove' && !(event.buttons & 1)) return;
    const el = event.currentTarget as HTMLElement;
    if (event.type === 'pointerdown') el.setPointerCapture(event.pointerId);
    const r = el.getBoundingClientRect();
    this.s.set(Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)));
    this.v.set(1 - Math.min(1, Math.max(0, (event.clientY - r.top) / r.height)));
    if (this.live()) this.emit();
  }

  /** The drag ended: when the color is not sent live it is sent now. */
  protected endDrag(): void {
    if (!this.live()) this.emit();
  }

  /** Drags in the bar of hue. */
  protected dragHue(event: PointerEvent): void {
    if (event.type === 'pointermove' && !(event.buttons & 1)) return;
    const el = event.currentTarget as HTMLElement;
    if (event.type === 'pointerdown') el.setPointerCapture(event.pointerId);
    const r = el.getBoundingClientRect();
    this.h.set(Math.min(359.9, Math.max(0, ((event.clientX - r.left) / r.width) * 360)));
    if (this.live()) this.emit();
  }

  /** Changes one channel (R, G or B) with the typed value. */
  protected tecleado(canal: string, valor: number): void {
    if (!Number.isFinite(valor)) return;
    const rgb = this.canales().map(function (c) {
      return c.v;
    });
    rgb[['R', 'G', 'B'].indexOf(canal)] = Math.min(255, Math.max(0, Math.round(valor)));
    this.setHex(
      '#' +
        rgb
          .map(function (n) {
            return n.toString(16).padStart(2, '0');
          })
          .join(''),
    );
  }

  // ---- move la ventana --------------------------------------------------------------------------

  protected startMove(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.dragState = { dx: event.clientX - this.pos().x, dy: event.clientY - this.pos().y };
  }

  /** Moves the panel while its title bar is dragged. */
  protected move(event: PointerEvent): void {
    if (!this.dragState) return;
    const x = Math.min(Math.max(0, event.clientX - this.dragState.dx), window.innerWidth - 120);
    const y = Math.min(Math.max(0, event.clientY - this.dragState.dy), window.innerHeight - 48);
    this.pos.set({ x, y });
  }

  /** Stops moving the panel. */
  protected endMove(event: PointerEvent): void {
    this.dragState = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  /** The person typed a hex color: it is used once it is complete and valid. */
  protected typed(text: string): void {
    const hex = text.startsWith('#') ? text : '#' + text;
    if (HEX.test(hex)) this.setHex(hex);
  }

  /** Sets the color and puts the handles where it is. */
  protected setHex(hex: string): void {
    const [h, s, v] = hexToHsv(hex);
    this.h.set(h);
    this.s.set(s);
    this.v.set(v);
    this.valueChange.emit(hex.toLowerCase());
  }

  // ---- eyedropper -------------------------------------------------------------------------------

  protected async eyedrop(): Promise<void> {
    const Native = (
      window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }
    ).EyeDropper;
    if (Native) {
      try {
        this.setHex((await new Native().open()).sRGBHex);
      } catch {
        /* cancelled */
      }
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        preferCurrentTab: true,
      } as DisplayMediaStreamOptions);
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise(function (resolve) {
        return setTimeout(resolve, 250);
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0);
      for (const track of stream.getTracks()) track.stop();
      this.close();
      this.shot.set({ url: canvas.toDataURL('image/png'), canvas });
      setTimeout(this.mostrar.bind(this, 'capa'));
    } catch {
      this.toast.error(
        this.i18n.t('Eyedropper not available'),
        this.i18n.t('Your browser did not allow capturing the screen.'),
      );
    }
  }

  /** The color of the pixel under the pointer in the capture of the screen (the eyedropper). */
  private pixelAt(event: MouseEvent): string {
    const shot = this.shot();
    if (!shot) return '#000000';
    const { canvas } = shot;
    // the image is shown with object-fit: contain, so undo the letterboxing
    const scale = Math.min(window.innerWidth / canvas.width, window.innerHeight / canvas.height);
    const x = Math.floor((event.clientX - (window.innerWidth - canvas.width * scale) / 2) / scale);
    const y = Math.floor(
      (event.clientY - (window.innerHeight - canvas.height * scale) / 2) / scale,
    );
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return this.under();
    const [r, g, b] = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
    return (
      '#' +
      [r, g, b]
        .map(function (n) {
          return n!.toString(16).padStart(2, '0');
        })
        .join('')
    );
  }

  /** Follows the pointer over the capture of the screen and shows the color under it. */
  protected hover(event: MouseEvent): void {
    this.cursor.set({ x: event.clientX, y: event.clientY });
    this.under.set(this.pixelAt(event));
  }

  /** Takes the color of the pixel that was pressed in the capture. */
  protected choose(event: MouseEvent): void {
    const hex = this.pixelAt(event);
    this.shot.set(null);
    this.setHex(hex);
    this.open.set(true);
    setTimeout(this.mostrar.bind(this, 'panel'));
  }

  /** Leaves the eyedropper without choosing. */
  protected cancelShot(): void {
    this.shot.set(null);
    this.open.set(true);
    setTimeout(this.mostrar.bind(this, 'panel'));
  }
}
