/**
 * src/app/layout/call-dock.component.ts
 * The floating panel of the call, shown when the person is on another page. It can be dragged by its handle and dropped on
 * one of six places (the corners and the middle of the top and the bottom), so it never has to sit over what is being
 * written. It shows who is talking (or what is being shared) in a small window that can be resized from its corner, and
 * has the buttons of the call: mute, deafen, back to the call and hang up. When music or a video is shared it shows that
 * too, with a pause button.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { TranslatePipe } from '../core/i18n/i18n.service';
import { CallService } from '../core/services/call.service';
import { DirectoryService } from '../core/services/directory.service';
import { SettingsService } from '../core/services/settings.service';
import { UiService } from '../core/services/ui.service';
import { AvatarComponent } from '../shared/components/avatar.component';
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

/** What the small window shows: a picture (a screen or a camera) or just the person who talks. */
interface Featured {
  userId: string;
  stream: MediaStream | null;
}

/** Floating panel that follows you around while a call is running and you are on another page. */
@Component({
  selector: 'app-call-dock',
  standalone: true,
  imports: [
    AvatarComponent,
    IconComponent,
    RouterLink,
    TranslatePipe,
    DockableDirective,
    MediaStreamDirective,
  ],
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
        class="anim-pop panel fixed z-50 flex max-w-[calc(100vw-1.5rem)] select-none flex-col gap-2 !bg-ink-850 p-2"
        [class]="placeClass()"
        (docked)="settings.dockPlace.set($event)"
        (over)="target.set($event)"
      >
        @if (featured(); as f) {
          <!-- Who talks, or what is shared: a window that can be made bigger or smaller from its corner -->
          <div class="dock-view" [class.is-sharing]="!!f.stream">
            @if (f.stream) {
              <video
                class="h-full w-full bg-black object-contain"
                [appMediaStream]="f.stream"
                autoplay
                playsinline
                muted
              ></video>
            } @else {
              <div class="flex h-full items-center justify-center">
                <app-avatar [user]="directory.get(f.userId)" [size]="64" [speaking]="true" />
              </div>
            }
            <span class="dock-name">{{ directory.get(f.userId)?.displayName }}</span>
          </div>
        }
        <div class="flex items-center gap-2">
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
          <a routerLink="/voice" class="min-w-0 leading-tight">
            <span class="block text-sm font-semibold hover:text-accent">{{
              'Call in progress' | t
            }}</span>
            <span class="block truncate text-[0.6875rem] text-muted">{{ activity() }}</span>
          </a>
          @if (call.music(); as m) {
            @if (m.link.kind === 'youtube') {
              <button
                type="button"
                class="btn btn-icon btn-sm"
                [attr.aria-label]="(call.musicPaused() ? 'Play' : 'Pause') | t"
                (click)="call.pauseRequest.set(call.pauseRequest() + 1)"
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
      width: 17rem;
      height: 9.5rem;
      min-width: 11rem;
      min-height: 6.5rem;
      max-width: calc(100vw - 2rem);
      max-height: 70vh;
      overflow: hidden;
      resize: both;
      border-radius: var(--r);
      background: rgba(255, 255, 255, 0.04);
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
  /** What the call is doing now (the video or music that is shared, a wheel, or how it is going). */
  protected readonly activity = computed(this.describeActivity.bind(this));
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

  /** A shared screen first; then the camera of whoever talks; then any camera; then the person who talks (with no picture). */
  private pickFeatured(): Featured | null {
    const peers = Object.values(this.call.peers());
    const speaking = this.call.speaking();
    const screen = peers.find(function sharing(peer) {
      return !!peer.screen;
    });
    if (screen) {
      return { userId: screen.userId, stream: screen.screen };
    }
    const talker = peers.find(function talks(peer) {
      return speaking.has(peer.userId) && !!peer.camera;
    });
    const withCamera =
      talker ??
      peers.find(function hasCamera(peer) {
        return !!peer.camera;
      });
    if (withCamera) {
      return { userId: withCamera.userId, stream: withCamera.camera };
    }
    const voice = peers.find(function talksOnly(peer) {
      return speaking.has(peer.userId);
    });
    return voice ? { userId: voice.userId, stream: null } : null;
  }

  /** The line under "Call in progress". */
  private describeActivity(): string {
    const music = this.call.music();
    if (music) {
      return this.call.musicTitles()[music.url] ?? 'YouTube';
    }
    return (this.call.stats().rttMs ?? '—') + ' ms';
  }

  /** The classes of the target that marks a place while the panel is dragged. */
  protected zoneClass(place: DockPlace): string {
    return PLACE_CLASSES[place];
  }
}
