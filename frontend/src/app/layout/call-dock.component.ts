/**
 * src/app/layout/call-dock.component.ts
 * The floating panel of the call, shown when the person is on another page. It can be dragged by its handle and dropped on
 * one of six places (the corners and the middle of the top and the bottom), so it never has to sit over what is being
 * written. It shows what is being shared (a screen or a camera) in a window that fills the panel and resizes with it, from its corner, and
 * has the buttons of the call: mute, deafen, back to the call and hang up. When music or a video is shared it shows that
 * too, with a pause button.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { TranslatePipe } from '../core/i18n/i18n.service';
import { CallService } from '../core/services/call.service';
import { DirectoryService } from '../core/services/directory.service';
import { SettingsService } from '../core/services/settings.service';
import { UiService } from '../core/services/ui.service';
import { CallTimerComponent } from '../shared/components/call-timer.component';
import { IconComponent } from '../shared/components/icon.component';
import { DockableDirective, type DockPlace } from '../shared/util/dockable.directive';
import { MediaStreamDirective } from '../shared/util/media-stream.directive';

/** Classes that put the panel in each place. */
const PLACE_CLASSES: Record<DockPlace, string> = {
  tl: 'left-4 top-[4.5rem]',
  tc: 'left-1/2 top-[4.5rem] -translate-x-1/2',
  tr: 'right-4 top-[4.5rem]',
  bl: 'left-4 bottom-5',
  bc: 'left-1/2 bottom-5 -translate-x-1/2',
  br: 'right-4 bottom-5',
};
/** The places, to draw the targets while the panel is dragged. */
const PLACES: DockPlace[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];

/** What the window shows: a screen or a camera. */
interface Featured {
  userId: string;
  stream: MediaStream | null;
}

/** Floating panel that follows you around while a call is running and you are on another page. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-call-dock',
  standalone: true,
  imports: [CallTimerComponent, IconComponent, RouterLink, TranslatePipe, DockableDirective, MediaStreamDirective],
  template: `
    @if (call.inCall() && !onVoicePage()) {
      @if (target()) {
        <div class="pointer-events-none fixed inset-0 z-[49]" aria-hidden="true">
          @for (place of places; track place) {
            <div
              class="dock-zone absolute"
              [class]="zoneClass(place)"
              [class.is-on]="target() === place"
            ></div>
          }
        </div>
      }
      <div
        appDockable
        class="anim-pop panel fixed z-50 flex max-w-[calc(100vw-1.5rem)] select-none flex-col overflow-hidden !bg-ink-850"
        [class]="placeClass()"
        [style.width.px]="featured() ? size().w : null"
        (docked)="settings.dockPlace.set($event)"
        (over)="target.set($event)"
      >
        @if (featured(); as f) {
          <!-- What is shared: it fills the width of the panel (no bars), and the whole block resizes from the corner far from its edge -->
          <div class="dock-view" [style.height.px]="size().h">
            @if (f.stream) {
              <video
                class="h-full w-full object-cover"
                [appMediaStream]="f.stream"
                autoplay
                playsinline
                muted
              ></video>
            }
            <span class="dock-name">{{ directory.get(f.userId)?.displayName }}</span>
            <span
              class="dock-resize"
              [class]="resizeClass()"
              (pointerdown)="startResize($event)"
              (pointermove)="moveResize($event)"
              (pointerup)="endResize($event)"
              (pointercancel)="endResize($event)"
            ></span>
          </div>
        }
        <div class="flex items-center gap-2 p-2">
          <span
            data-drag
            class="dock-grip flex items-center gap-2 rounded-ui px-1.5 py-1"
            [attr.title]="'Drag to move' | t"
          >
            <span class="flex items-end gap-0.5">
              @for (d of [0, 120, 240, 60]; track $index) {
                <span class="eq-bar h-4 w-1 rounded-full bg-accent" [style.--d]="d + 'ms'"></span>
              }
            </span>
          </span>
          <a routerLink="/voice" class="min-w-0 max-w-[13rem] leading-tight">
            <span class="block text-sm font-semibold hover:text-accent">{{
              'Call in progress' | t
            }}</span>
            <app-call-timer class="block" />
            <span class="dock-ping" [attr.data-level]="ping().level">
              <span class="flex items-end gap-px" aria-hidden="true">
                @for (bar of [1, 2, 3]; track bar) {
                  <i [class.is-lit]="bar <= ping().bars" [style.height.px]="3 + bar * 2.5"></i>
                }
              </span>
              {{ ping().value }} ms
            </span>
          </a>
          @if (call.music(); as m) {
            @if (m.link.kind === 'youtube') {
              <button
                type="button"
                class="btn btn-icon btn-sm"
                [attr.aria-label]="(call.musicPaused() ? 'Play' : 'Pause') | t"
                (click)="pauseMusic()"
              >
                <app-icon [name]="call.musicPaused() ? 'play' : 'pause'" [size]="14" />
              </button>
            }
          }
          <span class="mx-0.5 h-7 w-px bg-white/10"></span>
          <button
            class="btn btn-icon btn-sm"
            [class.btn-soft-danger]="call.muted()"
            type="button"
            (click)="call.toggleMute()"
            [attr.aria-label]="'Mute' | t"
          >
            <app-icon [name]="call.muted() ? 'mic-off' : 'mic'" [size]="15" />
          </button>
          <button
            class="btn btn-icon btn-sm"
            [class.btn-soft-danger]="call.deafened()"
            type="button"
            (click)="call.toggleDeafen()"
            [attr.aria-label]="'Deafen' | t"
          >
            <app-icon [name]="call.deafened() ? 'headphones-off' : 'headphones'" [size]="15" />
          </button>
          <a
            routerLink="/voice"
            class="btn btn-icon btn-sm"
            [attr.aria-label]="'Back to the call' | t"
            [attr.title]="'Back to the call' | t"
          >
            <app-icon name="maximize" [size]="15" />
          </a>
          <button
            class="btn btn-icon btn-sm btn-danger"
            type="button"
            (click)="call.leave()"
            [attr.aria-label]="'Hang up' | t"
          >
            <app-icon name="phone" [size]="15" class="rotate-[135deg]" />
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .dock-grip {
      cursor: var(--cur-grab, grab);
      touch-action: none;
    }
    .dock-grip:hover {
      background: rgba(255, 255, 255, 0.07);
    }
    .dock-view {
      position: relative;
      width: 100%;
      min-height: 7rem;
      max-height: 70vh;
      background: rgba(255, 255, 255, 0.04);
    }
    .dock-resize {
      position: absolute;
      width: 1.5rem;
      height: 1.5rem;
      touch-action: none;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .dock-view:hover .dock-resize {
      opacity: 1;
    }
    .dock-resize::after {
      content: '';
      position: absolute;
      inset: 0.35rem;
      border: 2px solid rgba(255, 255, 255, 0.8);
      border-radius: 2px;
      filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
    }
    .dock-resize.rb {
      right: 0;
      bottom: 0;
      cursor: nwse-resize;
    }
    .dock-resize.rb::after {
      border-left: 0;
      border-top: 0;
    }
    .dock-resize.lb {
      left: 0;
      bottom: 0;
      cursor: nesw-resize;
    }
    .dock-resize.lb::after {
      border-right: 0;
      border-top: 0;
    }
    .dock-resize.rt {
      right: 0;
      top: 0;
      cursor: nesw-resize;
    }
    .dock-resize.rt::after {
      border-left: 0;
      border-bottom: 0;
    }
    .dock-resize.lt {
      left: 0;
      top: 0;
      cursor: nwse-resize;
    }
    .dock-resize.lt::after {
      border-right: 0;
      border-bottom: 0;
    }
    /* the connection: a small signal and the delay, colored by how good it is */
    .dock-ping {
      --ping: #8b93a7;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      margin-top: 0.1rem;
      padding: 0.05rem 0.45rem 0.05rem 0.35rem;
      border-radius: 999px;
      background: color-mix(in oklab, var(--ping) 16%, transparent);
      color: var(--ping);
      font-size: 0.6875rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .dock-ping[data-level='good'] {
      --ping: #4ade80;
    }
    .dock-ping[data-level='ok'] {
      --ping: #fbbf24;
    }
    .dock-ping[data-level='bad'] {
      --ping: #f87171;
    }
    .dock-ping i {
      display: block;
      width: 3px;
      border-radius: 1px;
      background: currentColor;
      opacity: 0.28;
    }
    .dock-ping i.is-lit {
      opacity: 1;
    }
    .dock-name {
      position: absolute;
      left: 0.5rem;
      bottom: 0.4rem;
      padding: 0.1rem 0.5rem;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.55);
      font-size: 0.6875rem;
      font-weight: 600;
      pointer-events: none;
    }
  `,
})
export class CallDockComponent {
  protected readonly call = inject(CallService);
  protected readonly settings = inject(SettingsService);
  protected readonly directory = inject(DirectoryService);
  private readonly router = inject(Router);
  private readonly ui = inject(UiService);
  protected readonly places = PLACES;

  /** Remembers the pages that are not the call: "minimize the call" goes back to the last one. */
  constructor() {
    this.rememberPage(this.router.url);
    this.router.events
      .pipe(
        filter(function ended(event) {
          return event instanceof NavigationEnd;
        }),
      )
      .subscribe(
        function seen(this: CallDockComponent, event: unknown) {
          this.rememberPage((event as NavigationEnd).urlAfterRedirects);
        }.bind(this),
      );
  }

  /** Pauses or resumes the music or the video: the button changes at once, the player follows. */
  protected pauseMusic(): void {
    this.call.musicPaused.set(!this.call.musicPaused());
    this.call.pauseRequest.set(this.call.pauseRequest() + 1);
  }

  /** Keeps the address of a page that is not the call. */
  private rememberPage(url: string): void {
    if (!url.startsWith('/voice') && !url.startsWith('/login') && !url.startsWith('/register')) {
      this.ui.lastPage.set(url);
    }
  }
  /** The place under the panel while it is being dragged. */
  protected readonly target = signal<DockPlace | null>(null);
  protected readonly placeClass = computed(this.pickPlaceClass.bind(this));
  /** Who is shown in the window: a screen that is shared, or the camera or the voice of who talks. */
  protected readonly featured = computed(this.pickFeatured.bind(this));
  /** How the connection goes (the title of what plays is not shown, it made the bar long). */
  protected readonly ping = computed(this.describePing.bind(this));
  /** The size of the window of the camera or the screen (the width is the one of the whole panel). */
  protected readonly size = signal({ w: 400, h: 225 });
  /** The corner that resizes the block: the one far from the edge the panel rests on, so it grows toward the free space. */
  protected readonly resizeClass = computed(this.pickResizeClass.bind(this));
  private resizing: { x: number; y: number; w: number; h: number } | null = null;
  protected readonly onVoicePage = toSignal(
    this.router.events.pipe(
      filter(function (e) {
        return e instanceof NavigationEnd;
      }),
      map(
        function (this: CallDockComponent) {
          return this.router.url.startsWith('/voice');
        }.bind(this),
      ),
    ),
    { initialValue: this.router.url.startsWith('/voice') },
  );

  /** The classes of the place where the panel rests. */
  private pickPlaceClass(): string {
    return PLACE_CLASSES[this.settings.dockPlace()];
  }

  /**
   * What the small window shows: the screen that somebody shares, or else the camera of somebody else in the call. Nothing
   * when nobody has either on (and it does not change to whoever talks: it keeps showing the same one while it is on).
   */
  private pickFeatured(): Featured | null {
    const peers = Object.values(this.call.peers());
    const screen = peers.find(function sharing(peer) {
      return !!peer.screen;
    });
    if (screen) {
      return { userId: screen.userId, stream: screen.screen };
    }
    const camera = peers.find(function hasCamera(peer) {
      return !!peer.camera;
    });
    return camera ? { userId: camera.userId, stream: camera.camera } : null;
  }

  /** The delay of the call as a small signal: green when it is good, amber when it lags, red when it is bad. */
  private describePing(): { value: string; level: string; bars: number } {
    const rtt = this.call.stats().rttMs;
    if (rtt === null) {
      return { value: '—', level: 'none', bars: 0 };
    }
    const value = String(Math.round(rtt));
    if (rtt < 80) {
      return { value, level: 'good', bars: 3 };
    }
    return rtt < 180 ? { value, level: 'ok', bars: 2 } : { value, level: 'bad', bars: 1 };
  }

  /** Where the resize corner goes: toward the open side of the screen. */
  private pickResizeClass(): string {
    const place = this.settings.dockPlace();
    return (place.endsWith('r') ? 'l' : 'r') + (place.startsWith('b') ? 't' : 'b');
  }

  /** Starts resizing the block. */
  protected startResize(event: PointerEvent): void {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const { w, h } = this.size();
    this.resizing = { x: event.clientX, y: event.clientY, w, h };
  }

  /** Follows the pointer: the block grows away from the edge it rests on (twice as fast when it is centered, it grows both ways). */
  protected moveResize(event: PointerEvent): void {
    const start = this.resizing;
    if (!start) {
      return;
    }
    const place = this.settings.dockPlace();
    const toLeft = place.endsWith('r') ? -1 : 1;
    const toUp = place.startsWith('b') ? -1 : 1;
    const both = place.endsWith('c') ? 2 : 1;
    const w = start.w + (event.clientX - start.x) * toLeft * both;
    const h = start.h + (event.clientY - start.y) * toUp;
    this.size.set({
      w: Math.round(Math.min(Math.max(w, 320), Math.min(window.innerWidth - 24, 960))),
      h: Math.round(Math.min(Math.max(h, 112), window.innerHeight * 0.7)),
    });
  }

  /** Ends the resize. */
  protected endResize(event: PointerEvent): void {
    if (this.resizing) {
      this.resizing = null;
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    }
  }

  /** The classes of the target that marks a place while the panel is dragged. */
  protected zoneClass(place: DockPlace): string {
    return PLACE_CLASSES[place];
  }
}
