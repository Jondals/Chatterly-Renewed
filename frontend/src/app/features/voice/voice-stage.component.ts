/**
 * src/app/features/voice/voice-stage.component.ts
 * Call screen: participant tiles, controls, shared music and statistics.
 */
import { isDesktopApp } from '../../core/desktop-bridge';
import { ANDROID_APP } from '../../core/config';
import { androidScreenAvailable } from '../../core/android-screen';
import { parseMusicLink } from '../../shared/util/music-link';
import { FoldComponent } from '../../shared/components/fold.component';
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { embedUrl } from '../../shared/util/music-link';
import { FrameAllowDirective } from '../../shared/util/iframe-allow';
import { VOICE_MODES } from '../../core/audio-chain';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { SpinlyService } from '../../core/services/spinly.service';
import { SpinlyCallPanelComponent } from '../spinly/spinly-call-panel.component';
import { focusBoxes, gridBoxes, type Box } from './call-layout';
import { AuthService } from '../../core/services/auth.service';
import { CallService, type PeerView } from '../../core/services/call.service';
import { ToastService } from '../../core/services/toast.service';
import { DirectoryService } from '../../core/services/directory.service';
import { SettingsService } from '../../core/services/settings.service';
import { UiService } from '../../core/services/ui.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { SpinlyLogoComponent } from '../../shared/components/spinly-logo.component';
import { NameColorDirective } from '../../shared/util/name-color.directive';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { openBackgroundPicker } from './background-picker.component';
import { DeviceMenuComponent } from './device-menu.component';
import { PersonMenuComponent } from './person-menu.component';
import { SegmentedComponent, ToggleComponent } from '../../shared/components/controls.component';
import { MediaStreamDirective } from '../../shared/util/media-stream.directive';
import { GuildStore } from '../../store/guild.store';
import { MessageStore } from '../../store/message.store';
import { SocialStore } from '../../store/social.store';

type Drawer = 'stats';

interface Tile {
  id: string;
  kind: 'user' | 'camera' | 'screen' | 'activity';
  /** For an activity tile: which one. */
  activity?: 'music' | 'video' | 'spinly';
  user: ReturnType<DirectoryService['get']>;
  local: boolean;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  level: number;
  angle: number;
  rtt: number | null;
  connection: RTCPeerConnectionState | 'new' | undefined;
  stream: MediaStream | null;
  code: string | null;
}

import { DockableDirective, type DockPlace } from '../../shared/util/dockable.directive';
import { UserFontDirective } from '../../shared/util/user-font.directive';
import { NameFxDirective } from '../../shared/util/name-fx.directive';
import { fontClassOf } from '../../shared/util/user-font.directive';
import { decibels } from '../../shared/util/audio-level';
/** Where the music card goes in each place of the stage (the bottom ones are lifted by a style when somebody is pinned). */
const MUSIC_PLACES: Record<DockPlace, string> = {
  tl: 'left-3 top-3',
  tc: 'left-1/2 top-3 -translate-x-1/2',
  tr: 'right-3 top-3',
  bl: 'left-3',
  bc: 'left-1/2 -translate-x-1/2',
  br: 'right-3',
};

@Component({
  selector: 'app-voice-stage',
  standalone: true,
  imports: [
    FoldComponent,
    PersonMenuComponent,
    DeviceMenuComponent,
    DockableDirective,
    UserFontDirective,
    NameFxDirective,
    NameColorDirective,
    AvatarComponent,
    IconComponent,
    ModalComponent,
    PageHeaderComponent,
    MediaStreamDirective,
    SpinlyCallPanelComponent,
    SpinlyLogoComponent,
    ToggleComponent,
    FrameAllowDirective,
    SegmentedComponent,
    NgTemplateOutlet,
    TranslatePipe,
  ],
  host: { class: 'page-enter block h-full min-h-0' },
  template: `
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      @if (call.roomId()) {
        <app-page-header [title]="roomTitle()" icon="volume" [subtitle]="subtitle()">
          <button
            type="button"
            class="chip !px-3 !py-1.5 hover:brightness-125"
            [class.chip-accent]="call.mediaEncryption() === 'active'"
            [class.chip-amber]="call.mediaEncryption() === 'pending'"
            [class.chip-red]="call.mediaEncryption() === 'failing'"
            [attr.title]="encryptionTitle()"
            [attr.aria-label]="'End-to-end encryption' | t"
            (click)="verifyOpen.set(true)"
          >
            <app-icon
              [name]="call.mediaEncryption() === 'pending' ? 'shield' : 'lock'"
              [size]="17"
              [class.animate-pulse]="call.mediaEncryption() === 'pending'"
            />
            @if (call.mediaEncryption() === 'failing') {
              <span class="max-sm:hidden">{{ 'Encryption problem' | t }}</span>
            }
          </button>
          <span class="hidden font-mono text-xs text-muted md:inline"
            >{{ call.stats().rttMs ?? '—' }} ms · {{ call.stats().outKbps }}↑
            {{ call.stats().inKbps }}↓ kbps</span
          >
          <button
            class="btn btn-icon btn-ghost tip"
            data-tip-pos="bottom"
            [attr.data-tip]="'Minimize the call' | t"
            type="button"
            (click)="minimizeCall()"
          >
            <app-icon name="chevron-down" />
          </button>
          <button
            class="btn btn-icon btn-ghost tip"
            data-tip-pos="bottom"
            [class.btn-active]="drawer() === 'stats'"
            [attr.data-tip]="'Diagnostics' | t"
            type="button"
            (click)="toggleDrawer('stats')"
          >
            <app-icon name="activity" />
          </button>
        </app-page-header>

        <div class="flex min-h-0 flex-1">
          <div class="flex min-w-0 flex-1 flex-col">
            <div #stageHost class="stage-host relative min-h-0 flex-1">
              @if (tileMenu(); as menu) {
                <app-person-menu
                  [x]="menu.x"
                  [y]="menu.y"
                  [label]="menu.label"
                  [userId]="menu.userId"
                  [canAdjust]="menu.canAdjust"
                  (hide)="hideTile(menu.id)"
                  (closed)="tileMenu.set(null)"
                />
              }

              @if (musicTarget()) {
                <div class="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
                  @for (place of places; track place) {
                    <div
                      class="dock-zone absolute"
                      [class]="zoneClass(place)"
                      [style.bottom.px]="place.startsWith('b') ? zoneBottom() : null"
                      [class.is-on]="musicTarget() === place"
                    ></div>
                  }
                </div>
              }
              @if (call.music(); as m) {
                @if (!m.video) {
                  <div
                    appDockable
                    [dockArea]="stageHostEl()"
                    [allowed]="places"
                    [class.!w-64]="settings.musicMini()"
                    class="music-card absolute z-30 w-[25rem] max-w-[calc(100%-1.5rem)] transition-[width] duration-300 select-none rounded-ui-lg border border-white/10 bg-ink-900/95 p-3.5 shadow-xl backdrop-blur"
                    [class]="musicClass()"
                    [style.bottom.px]="musicBottom()"
                    (docked)="settings.musicPlace.set($event)"
                    (over)="musicTarget.set($event)"
                  >
                    @if (queueOpen()) {
                      <div
                        animate.leave="leave-pop"
                        class="absolute left-0 right-0 z-20"
                        [class]="
                          settings.musicPlace().startsWith('t')
                            ? 'top-full mt-2'
                            : 'bottom-full mb-2'
                        "
                      >
                        <ng-container [ngTemplateOutlet]="queuePanel" />
                      </div>
                    }
                    @if (musicSrc(); as src) {
                      <iframe
                        class="music-frame"
                        [class.is-spotify]="m.link.kind === 'spotify'"
                        [frameAllow]="allowAudio"
                        [src]="src"
                        referrerpolicy="strict-origin-when-cross-origin"
                        sandbox="allow-scripts allow-same-origin allow-presentation"
                        [title]="'Music' | t"
                        #reproductor
                        (load)="notifyPlayer(reproductor)"
                      ></iframe>
                    }
                    <div
                      class="music-grip flex items-center gap-3"
                      data-drag
                      [attr.title]="'Drag to move' | t"
                    >
                      <span class="mc-badge" aria-hidden="true">
                        <span class="ring-bars" [class.is-paused]="paused()"
                          ><i></i><i></i><i></i><i></i
                        ></span>
                      </span>
                      <div class="min-w-0 flex-1 leading-tight">
                        <div class="truncate text-sm font-semibold">{{ titleOf(m.url) }}</div>
                        <div class="mt-0.5 truncate text-xs text-muted">
                          {{ 'Listening together' | t }} · {{ directory.get(m.by)?.displayName }}
                        </div>
                      </div>
                      @if (settings.musicMini() && musicSrc() && m.link.kind === 'youtube') {
                        <button
                          type="button"
                          class="btn btn-icon btn-sm shrink-0"
                          [attr.aria-label]="(paused() ? 'Play' : 'Pause') | t"
                          (click)="togglePause()"
                        >
                          <app-icon [name]="paused() ? 'play' : 'pause'" [size]="15" />
                        </button>
                      }
                      <button
                        type="button"
                        class="btn btn-icon btn-sm btn-ghost shrink-0"
                        [attr.title]="(settings.musicMini() ? 'Expand' : 'Minimize') | t"
                        [attr.aria-label]="(settings.musicMini() ? 'Expand' : 'Minimize') | t"
                        (click)="settings.musicMini.set(!settings.musicMini())"
                      >
                        <app-icon
                          [name]="settings.musicMini() ? 'chevron-up' : 'chevron-down'"
                          [size]="15"
                        />
                      </button>
                      <button
                        type="button"
                        class="btn btn-icon btn-sm btn-ghost shrink-0"
                        [attr.title]="'Close for me' | t"
                        [attr.aria-label]="'Close for me' | t"
                        (click)="stopMedia($event)"
                      >
                        <app-icon name="x" [size]="15" />
                      </button>
                    </div>
                    <!-- the body folds away and comes back smoothly (the same movement both ways) -->
                    <div
                      class="mc-body"
                      [class.is-open]="!settings.musicMini()"
                      [attr.inert]="settings.musicMini() ? '' : null"
                    >
                      <div class="mc-inner">
                        @if (musicSrc() && m.link.kind === 'youtube' && duration() > 0) {
                          <span class="timeline mt-3.5 flex min-w-0 items-center gap-2.5">
                            <span
                              class="min-w-[2.7rem] text-right font-mono text-[0.625rem] tabular-nums text-muted"
                              >{{ clock(scrubbing() ? scrubTime() : elapsed()) }}</span
                            >
                            <input
                              type="range"
                              class="ui-range min-w-0 flex-1"
                              min="0"
                              step="1"
                              [style.--p.%]="timeFill()"
                              [max]="duration()"
                              [value]="elapsed()"
                              [attr.aria-label]="'Timeline' | t"
                              (pointerdown)="scrubbing.set(true)"
                              (pointerup)="endScrub()"
                              (pointercancel)="endScrub()"
                              (input)="scrubTime.set(+$any($event.target).value)"
                              (change)="seekTo(+$any($event.target).value)"
                            />
                            <span
                              class="min-w-[2.7rem] font-mono text-[0.625rem] tabular-nums text-muted"
                              >{{ clock(duration()) }}</span
                            >
                          </span>
                        }
                        <!-- the queue on the left, play and skip in the middle, the volume on the right -->
                        <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div class="flex justify-start">
                            <button
                              type="button"
                              class="mc-chip"
                              [class.is-on]="queueOpen()"
                              [attr.title]="'Queue' | t"
                              [attr.aria-label]="'Queue' | t"
                              (mousedown)="$event.stopPropagation()"
                              (click)="queueOpen.set(!queueOpen())"
                            >
                              <app-icon name="list" [size]="14" />
                              <span class="font-mono text-[0.6875rem]">{{ queuedCount() }}</span>
                            </button>
                          </div>
                          <div class="flex items-center gap-2.5">
                            @if (musicSrc() && m.link.kind === 'youtube') {
                              <button
                                type="button"
                                class="btn btn-icon btn-primary !h-10 !w-10 !rounded-full"
                                [attr.title]="(paused() ? 'Play' : 'Pause') | t"
                                [attr.aria-label]="(paused() ? 'Play' : 'Pause') | t"
                                (click)="togglePause()"
                              >
                                <app-icon [name]="paused() ? 'play' : 'pause'" [size]="18" />
                              </button>
                            }
                            @if (call.hasNext()) {
                              <button
                                type="button"
                                class="mc-chip"
                                [class.is-on]="iVotedSkip()"
                                [attr.title]="'Vote to skip' | t"
                                [attr.aria-label]="'Vote to skip' | t"
                                (click)="call.voteSkip()"
                              >
                                <app-icon name="skip-forward" [size]="14" />
                                <span class="font-mono text-[0.6875rem]"
                                  >{{ call.skipVotes().length }}/{{ call.skipNeeded() }}</span
                                >
                              </button>
                            }
                          </div>
                          <div class="relative flex justify-end">
                            @if (musicSrc() && m.link.kind === 'youtube') {
                              <button
                                type="button"
                                class="mc-chip"
                                [class.is-on]="volumeOpen()"
                                [attr.title]="'Volume' | t"
                                [attr.aria-label]="'Volume' | t"
                                (mousedown)="$event.stopPropagation()"
                                (click)="toggleVolume()"
                              >
                                <app-icon
                                  [name]="settings.musicVolume() === 0 ? 'volume-x' : 'volume-2'"
                                  [size]="15"
                                />
                              </button>
                              @if (volumeOpen()) {
                                <div
                                  animate.leave="leave-pop"
                                  class="volume-pop anim-pop"
                                  (mousedown)="$event.stopPropagation()"
                                >
                                  <b class="font-mono text-[0.6875rem] text-accent"
                                    >{{ settings.musicVolume() }}%</b
                                  >
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    step="1"
                                    class="volume-range ui-range"
                                    [style.--p.%]="settings.musicVolume()"
                                    [value]="settings.musicVolume()"
                                    [attr.aria-label]="'Music volume' | t"
                                    (input)="setMusicVolume($event)"
                                  />
                                </div>
                              }
                            }
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              }

              @if (queueOpen() && call.music()?.video) {
                <div
                  animate.leave="leave-pop"
                  class="absolute right-4 top-4 z-30 w-[min(22rem,calc(100%-2rem))]"
                >
                  <ng-container [ngTemplateOutlet]="queuePanel" />
                </div>
              }
              <div
                #stage
                class="absolute"
                [class]="fullscreen() ? 'inset-0' : 'inset-3 md:inset-4'"
                [class.is-resizing]="resizing()"
              >
                @for (t of tiles(); track t.id) {
                  @let box = boxes().get(t.id);
                  @let floating = fullscreen() && !!featured() && featured()?.id !== t.id;
                  <div
                    class="call-tile"
                    [class.is-focus]="featured()?.id === t.id"
                    [class.is-floating]="floating"
                    [class.is-dragging]="dragId() === t.id"
                    [style.left.px]="box?.x ?? 0"
                    [style.top.px]="box?.y ?? 0"
                    [style.width.px]="box?.w ?? 0"
                    [style.height.px]="box?.h ?? 0"
                    [style.opacity]="box ? 1 : 0"
                    (pointerdown)="floating ? startFloat($event, t.id, 'move') : null"
                    (pointermove)="moveFloat($event)"
                    (pointerup)="endFloat($event)"
                    (pointercancel)="endFloat($event)"
                  >
                    @if (floating) {
                      @for (corner of corners; track corner) {
                        <span
                          class="float-handle"
                          [attr.data-corner]="corner"
                          (pointerdown)="startFloat($event, t.id, corner)"
                        ></span>
                      }
                    }
                    <ng-container
                      [ngTemplateOutlet]="tileTpl"
                      [ngTemplateOutletContext]="{
                        $implicit: t,
                        small: !!box && box.w < 250,
                        short: !!box && box.h < 540,
                        focus: featured()?.id === t.id,
                      }"
                    />
                  </div>
                }
              </div>
            </div>

            <!-- Music is only sound: a small card with its queue, at the left of the controls (above them on a narrow stage). -->
            <div class="@container relative shrink-0">
              @if (hiddenCount()) {
                <div class="flex justify-center pb-1">
                  <button
                    type="button"
                    class="chip cursor-pointer hover:bg-white/10"
                    (click)="showHidden()"
                  >
                    <app-icon name="eye" [size]="12" />
                    {{ 'Show hidden ({n})' | t: { n: hiddenCount() } }}
                  </button>
                </div>
              }

              <!-- Controls -->
              <div class="flex shrink-0 justify-center px-3 pb-4 pt-2">
                <div
                  class="call-bar flex flex-wrap items-center justify-center gap-3 rounded-ui-lg border border-white/8 bg-black/30 px-4 py-3"
                >
                  <div class="flex items-stretch gap-0.5">
                    <button
                      class="btn btn-icon h-12 w-12 tip !rounded-r-[calc(var(--r)*.4)]"
                      [class.btn-soft-danger]="call.muted()"
                      [attr.data-tip]="(call.muted() ? 'Unmute' : 'Mute') | t"
                      type="button"
                      (click)="call.toggleMute()"
                    >
                      <app-icon [name]="call.muted() ? 'mic-off' : 'mic'" [size]="20" />
                    </button>
                    <app-device-menu kind="mic" />
                  </div>
                  <div class="flex items-stretch gap-0.5">
                    <button
                      class="btn btn-icon h-12 w-12 tip !rounded-r-[calc(var(--r)*.4)]"
                      [class.btn-soft-danger]="call.deafened()"
                      [attr.data-tip]="(call.deafened() ? 'Undeafen' : 'Deafen') | t"
                      type="button"
                      (click)="call.toggleDeafen()"
                    >
                      <app-icon
                        [name]="call.deafened() ? 'headphones-off' : 'headphones'"
                        [size]="20"
                      />
                    </button>
                    <app-device-menu kind="speakers" />
                  </div>
                  <span class="mx-1 h-8 w-px bg-white/10"></span>
                  <div class="flex items-stretch gap-0.5">
                    <button
                      class="btn btn-icon h-12 w-12 tip !rounded-r-[calc(var(--r)*.4)]"
                      [class.btn-active]="call.cameraOn()"
                      [attr.data-tip]="(call.cameraOn() ? 'Turn camera off' : 'Turn camera on') | t"
                      type="button"
                      (click)="call.toggleCamera()"
                    >
                      <app-icon [name]="call.cameraOn() ? 'video' : 'video-off'" [size]="20" />
                    </button>
                    <app-device-menu kind="video" />
                  </div>
                  <div class="relative">
                    <button
                      class="btn btn-icon h-12 w-12 tip"
                      [class.btn-active]="call.screenOn() || shareOpen()"
                      [class.opacity-40]="android && !androidShare"
                      [attr.data-tip]="(call.screenOn() ? 'Stop sharing' : 'Share your screen') | t"
                      type="button"
                      (mousedown)="$event.stopPropagation()"
                      (click)="screenClick()"
                      (contextmenu)="shareOptions($event)"
                    >
                      <app-icon name="monitor" [size]="20" />
                    </button>
                    @if (shareOpen()) {
                      <div
                        animate.leave="leave-pop"
                        class="panel anim-pop absolute bottom-14 left-1/2 z-30 w-[24rem] -translate-x-1/2 !bg-ink-850 p-4 shadow-2xl max-md:fixed max-md:inset-x-3 max-md:bottom-28 max-md:left-3 max-md:w-auto max-md:translate-x-0"
                        (mousedown)="$event.stopPropagation()"
                      >
                        <div class="mb-3.5 flex items-center gap-3">
                          <span class="menu-icon bg-violet/15 text-violet"
                            ><app-icon name="monitor" [size]="18"
                          /></span>
                          <div>
                            <b class="block text-sm">{{ 'Share your screen' | t }}</b>
                            <span class="block text-xs text-muted">{{
                              (desktop
                                ? 'A screen is shared at once; for a window you pick which one next.'
                                : 'The browser will ask you to confirm what to show.'
                              ) | t
                            }}</span>
                          </div>
                        </div>
                        <div class="label mb-1.5">{{ 'What to share' | t }}</div>
                        <div
                          class="grid gap-2"
                          [class.grid-cols-3]="!desktop"
                          [class.grid-cols-2]="desktop"
                        >
                          @for (option of surfaceChoices; track option.id) {
                            <button
                              type="button"
                              class="sb-tile"
                              [class.is-hit]="settings.screenShare().surface === option.id"
                              (click)="setShare({ surface: option.id })"
                            >
                              <app-icon [name]="option.icon" [size]="20" />
                              <span class="text-[0.6875rem]">{{ option.label | t }}</span>
                            </button>
                          }
                        </div>
                        <div class="label mb-1.5 mt-3.5">{{ 'Quality' | t }}</div>
                        <div class="grid grid-cols-3 gap-2">
                          @for (option of shareQualities; track option.id) {
                            <button
                              type="button"
                              class="sb-tile !min-h-[3.2rem]"
                              [class.is-hit]="settings.screenShare().quality === option.id"
                              (click)="setShare({ quality: option.id })"
                            >
                              <b class="text-xs">{{ option.label }}</b>
                              <span class="text-[0.625rem] text-muted">{{ option.hint | t }}</span>
                            </button>
                          }
                        </div>
                        <label
                          class="mt-3.5 flex cursor-pointer items-center justify-between gap-3"
                        >
                          <span class="text-sm">{{ 'Share the sound too' | t }}</span>
                          <app-toggle
                            [checked]="settings.screenShare().audio"
                            (checkedChange)="setShare({ audio: $event })"
                            [label]="'Share the sound too' | t"
                          />
                        </label>
                        <button
                          type="button"
                          class="btn btn-primary mt-4 w-full"
                          (click)="startShare()"
                        >
                          <app-icon name="monitor" [size]="15" /> {{ 'Start sharing' | t }}
                        </button>
                      </div>
                    }
                  </div>
                  <span class="mx-1 h-8 w-px bg-white/10"></span>
                  <div class="relative">
                    <button
                      class="btn btn-icon h-12 w-12 tip"
                      [class.btn-active]="activitiesOpen() || hasActivity()"
                      [attr.data-tip]="'Activities' | t"
                      type="button"
                      (mousedown)="$event.stopPropagation()"
                      (click)="toggleActivities()"
                    >
                      <app-icon name="grid" [size]="20" />
                    </button>
                    @if (activitiesOpen()) {
                      <div
                        animate.leave="leave-pop"
                        class="panel act-menu anim-pop absolute bottom-14 left-1/2 z-30 w-[26rem] -translate-x-1/2 !bg-ink-850 p-4 shadow-2xl max-md:fixed max-md:inset-x-3 max-md:bottom-28 max-md:left-3 max-md:w-auto max-md:translate-x-0"
                        (mousedown)="$event.stopPropagation()"
                      >
                        @if (!activityForm()) {
                          <div
                            class="px-1 pb-3 pt-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-dim"
                          >
                            {{ 'Activities' | t }}
                          </div>
                          @for (a of activityChoices; track a.id) {
                            <div class="menu-card anim-fade-up" [style.--d]="$index * 40 + 'ms'">
                              <button
                                type="button"
                                class="flex min-w-0 flex-1 items-center gap-3 text-left"
                                (click)="chooseActivity(a.id)"
                              >
                                @if (a.id === 'spinly') {
                                  <span class="menu-icon !bg-white/5"
                                    ><app-spinly-logo [size]="28"
                                  /></span>
                                } @else {
                                  <span class="menu-icon" [class]="a.tone"
                                    ><app-icon [name]="a.icon" [size]="18"
                                  /></span>
                                }
                                <span class="min-w-0 flex-1"
                                  ><b class="block text-sm">{{ a.title | t }}</b
                                  ><span class="block text-xs text-muted">{{
                                    a.hint | t
                                  }}</span></span
                                >
                              </button>
                              @if (isActive(a.id)) {
                                <button
                                  type="button"
                                  class="btn btn-sm btn-soft-danger"
                                  (click)="stopActivity(a.id)"
                                >
                                  {{ 'Stop' | t }}
                                </button>
                              }
                            </div>
                          }
                        } @else {
                          <form class="act-form" (submit)="startLink($event)">
                            <button
                              type="button"
                              class="mb-3 flex items-center gap-1.5 text-xs text-muted hover:text-fg"
                              (click)="activityForm.set(null)"
                            >
                              <app-icon name="arrow-left" [size]="13" /> {{ 'Activities' | t }}
                            </button>
                            <div class="mb-4 flex items-center gap-3">
                              <span
                                class="menu-icon !h-12 !w-12"
                                [class]="
                                  activityForm() === 'video'
                                    ? 'bg-sky/15 text-sky'
                                    : 'bg-accent/15 text-accent'
                                "
                                ><app-icon
                                  [name]="activityForm() === 'video' ? 'play' : 'music'"
                                  [size]="22"
                              /></span>
                              <span class="min-w-0 leading-tight">
                                <b class="block text-base">{{
                                  (activityForm() === 'video'
                                    ? 'Watch together'
                                    : 'Listen together'
                                  ) | t
                                }}</b>
                                <span class="block text-xs text-muted">{{
                                  (activityForm() === 'video'
                                    ? 'Everybody sees the same video at the same second'
                                    : 'Everybody hears the same song at the same second'
                                  ) | t
                                }}</span>
                              </span>
                            </div>
                            <div class="mb-2 flex flex-wrap items-center gap-1.5">
                              <span class="act-source" [class.is-hit]="linkKind() === 'youtube'"
                                >YouTube</span
                              >
                              @if (activityForm() === 'music') {
                                <span class="act-source" [class.is-hit]="linkKind() === 'spotify'"
                                  >Spotify</span
                                >
                              }
                            </div>
                            <label
                              class="act-link"
                              [class.is-ok]="linkOk()"
                              [class.is-bad]="linkBad()"
                            >
                              <app-icon
                                [name]="linkOk() ? 'check' : 'link'"
                                [size]="16"
                                class="shrink-0"
                                [class.text-muted]="!linkOk()"
                                [class.text-emerald]="linkOk()"
                              />
                              <input
                                class="min-w-0 flex-1 bg-transparent text-sm outline-none"
                                [value]="linkText()"
                                (input)="
                                  linkText.set($any($event.target).value); linkInvalid.set(false)
                                "
                                placeholder="https://youtu.be/…"
                                [attr.aria-label]="'Link' | t"
                                autocomplete="off"
                                spellcheck="false"
                              />
                              @if (linkText()) {
                                <button
                                  type="button"
                                  class="btn btn-icon btn-sm btn-ghost !h-7 !w-7 shrink-0"
                                  [attr.aria-label]="'Clear the link' | t"
                                  (click)="linkText.set(''); linkInvalid.set(false)"
                                >
                                  <app-icon name="x" [size]="13" />
                                </button>
                              } @else {
                                <button
                                  type="button"
                                  class="btn btn-sm shrink-0"
                                  (click)="pasteLink()"
                                >
                                  <app-icon name="copy" [size]="13" /> {{ 'Paste' | t }}
                                </button>
                              }
                            </label>
                            <div class="mt-1.5 min-h-[1.1rem] text-xs">
                              @if (linkOk()) {
                                <span class="text-emerald">{{ linkSummary() | t }}</span>
                              } @else if (linkBad() || linkInvalid()) {
                                <span class="text-amber">
                                  {{
                                    (activityForm() === 'video'
                                      ? 'That is not a valid YouTube link.'
                                      : 'That is not a valid YouTube or Spotify link.'
                                    ) | t
                                  }}
                                </span>
                              } @else {
                                <span class="text-dim">{{
                                  (activityForm() === 'video'
                                    ? 'Paste the link of a YouTube video.'
                                    : 'Paste the link of a YouTube or Spotify song, album or list.'
                                  ) | t
                                }}</span>
                              }
                            </div>
                            <div class="mt-4 flex flex-col gap-2">
                              <button
                                type="submit"
                                class="btn btn-primary w-full"
                                [disabled]="!linkText()"
                              >
                                <app-icon name="play" [size]="15" /> {{ 'Play for everyone' | t }}
                              </button>
                              @if (call.music()) {
                                <button
                                  type="button"
                                  class="btn w-full"
                                  [disabled]="!linkText()"
                                  (click)="queueFromForm()"
                                >
                                  <app-icon name="list" [size]="14" /> {{ 'Add to queue' | t }}
                                </button>
                              }
                            </div>
                          </form>
                        }
                      </div>
                    }
                  </div>
                  <button
                    class="btn btn-icon h-12 w-12 tip"
                    [class.btn-active]="ui.soundboardOpen()"
                    [attr.data-tip]="'Soundboard' | t"
                    type="button"
                    (mousedown)="$event.stopPropagation()"
                    (click)="toggleSoundboard($event)"
                  >
                    <app-icon name="waveform" [size]="20" />
                  </button>
                  <span class="mx-1 h-8 w-px bg-white/10"></span>
                  <button
                    class="btn btn-danger h-12 w-14 tip"
                    data-tip-pos="top"
                    [attr.data-tip]="'Hang up' | t"
                    [attr.aria-label]="'Hang up' | t"
                    type="button"
                    (click)="call.leave()"
                  >
                    <app-icon name="phone" [size]="21" class="rotate-[135deg]" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          @let tab = drawer() ?? 'stats';
          <div class="drawer-wrap" [class.is-open]="!!drawer()" [attr.inert]="drawer() ? null : ''">
            <aside class="flex h-full flex-col border-l border-white/6 bg-ink-900">
              <div
                class="flex shrink-0 items-center justify-between border-b border-white/6 px-4 py-2.5"
              >
                <span class="text-sm font-semibold">{{ 'Call data' | t }}</span>
                <button
                  class="btn btn-icon btn-sm btn-ghost"
                  type="button"
                  (click)="drawer.set(null)"
                  [attr.aria-label]="'Close' | t"
                >
                  <app-icon name="x" [size]="15" />
                </button>
              </div>
              @switch (tab) {
                @case ('stats') {
                  <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                    <div class="grid grid-cols-3 gap-2 text-center">
                      <div class="drawer-stat">
                        <b>{{ call.stats().lossPct }}%</b><span>{{ 'Packet loss' | t }}</span>
                      </div>
                      <div class="drawer-stat">
                        <b>{{ call.stats().jitterMs ?? '—' }} ms</b><span>{{ 'Jitter' | t }}</span>
                      </div>
                      <div class="drawer-stat">
                        <b>{{ cipherLabel() }}</b
                        ><span>DTLS-SRTP</span>
                      </div>
                    </div>
                    <div class="rounded-ui border border-white/6 p-3">
                      <div class="label">{{ 'Latency' | t }}</div>
                      <svg viewBox="0 0 200 70" preserveAspectRatio="none" class="my-2 h-16 w-full">
                        <defs>
                          <linearGradient id="lat" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stop-color="var(--accent)" stop-opacity=".35" />
                            <stop offset="1" stop-color="var(--accent)" stop-opacity="0" />
                          </linearGradient>
                        </defs>
                        <path [attr.d]="latencyArea()" fill="url(#lat)" />
                        <path
                          [attr.d]="latencyLine()"
                          fill="none"
                          stroke="var(--accent)"
                          stroke-width="1.8"
                          stroke-linejoin="round"
                          vector-effect="non-scaling-stroke"
                        />
                      </svg>
                      <div class="flex justify-between font-mono text-[0.6875rem] text-muted">
                        <span
                          >min <b class="text-fg">{{ latencyStats().min }}</b></span
                        ><span
                          >avg <b class="text-accent">{{ latencyStats().avg }}</b></span
                        ><span
                          >max <b class="text-fg">{{ latencyStats().max }}</b></span
                        >
                      </div>
                    </div>
                    <app-fold>
                      <span foldTitle>{{ 'Microphone' | t }}</span>
                      <span foldHint>{{ dbfs(myLevel()) }} dB</span>

                      <div class="contents">
                        <div class="drawer-row">
                          <span>{{ 'Noise suppression' | t }}</span>
                          <app-toggle
                            [checked]="settings.noiseSuppression()"
                            (checkedChange)="setDsp('noise', $event)"
                            [label]="'Noise suppression' | t"
                          />
                        </div>
                        <div class="drawer-row">
                          <span>{{ 'Echo cancellation' | t }}</span>
                          <app-toggle
                            [checked]="settings.echoCancellation()"
                            (checkedChange)="setDsp('echo', $event)"
                            [label]="'Echo cancellation' | t"
                          />
                        </div>
                        <div class="drawer-row">
                          <span>{{ 'Auto gain' | t }}</span>
                          <app-toggle
                            [checked]="settings.autoGain()"
                            (checkedChange)="setDsp('agc', $event)"
                            [label]="'Auto gain' | t"
                          />
                        </div>
                        <div class="drawer-block">
                          <span>{{ 'Voice mode' | t }}</span>
                          <div
                            class="radio-list"
                            role="radiogroup"
                            [attr.aria-label]="'Voice mode' | t"
                          >
                            @for (m of voiceModes; track m.id) {
                              <button
                                type="button"
                                role="radio"
                                class="radio-row"
                                [class.is-on]="settings.voiceMode() === m.id"
                                [attr.aria-checked]="settings.voiceMode() === m.id"
                                (click)="settings.voiceMode.set(m.id); call.changeInputDevice()"
                              >
                                <span class="radio-dot"></span>
                                <span class="min-w-0 flex-1">
                                  <b>{{ m.label | t }}</b>
                                  <small>{{ m.hint | t }}</small>
                                </span>
                              </button>
                            }
                          </div>
                        </div>
                        <div>
                          <div class="mb-1 flex justify-between text-xs text-muted">
                            <span>{{ 'Level' | t }}</span
                            ><b class="text-fg">{{ dbfs(myLevel()) }} dB</b>
                          </div>
                          <div class="h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              class="h-full rounded-full bg-accent transition-[width] duration-100"
                              [style.width.%]="myLevel() * 100"
                            ></div>
                          </div>
                        </div>
                        <label class="block text-xs text-muted"
                          >{{ 'Microphone volume' | t }}
                          <b class="float-right text-fg">{{ settings.inputVolume() }}%</b>
                          <input
                            type="range"
                            min="0"
                            max="200"
                            class="mt-1 w-full accent-[var(--accent)]"
                            [value]="settings.inputVolume()"
                            (input)="settings.inputVolume.set(+$any($event.target).value)"
                            (change)="call.changeInputDevice()"
                        /></label>
                        <label class="block text-xs text-muted"
                          >{{ 'Input gate' | t }}
                          <b class="float-right text-fg">{{ settings.inputGate() }}%</b>
                          <input
                            type="range"
                            min="0"
                            max="60"
                            class="mt-1 w-full accent-[var(--accent)]"
                            [value]="settings.inputGate()"
                            (input)="settings.inputGate.set(+$any($event.target).value)"
                        /></label>
                      </div>
                    </app-fold>
                    <app-fold>
                      <span foldTitle>{{ 'Camera' | t }}</span>
                      <span foldHint
                        >{{ settings.cameraQuality() }}p · {{ settings.cameraFps() }}</span
                      >

                      <div class="contents">
                        <div class="drawer-block">
                          <span>{{ 'Quality' | t }}</span>
                          <app-segmented
                            [options]="qualityOptions"
                            [value]="settings.cameraQuality()"
                            (valueChange)="
                              settings.cameraQuality.set($any($event)); call.changeCamera()
                            "
                          />
                        </div>
                        <div class="drawer-block">
                          <span>{{ 'Frames per second' | t }}</span>
                          <app-segmented
                            [options]="fpsOptions"
                            [value]="settings.cameraFps()"
                            (valueChange)="
                              settings.cameraFps.set($any($event)); call.changeCamera()
                            "
                          />
                        </div>
                        <button
                          type="button"
                          class="btn btn-sm w-full gap-1.5"
                          (click)="openCameraOptions()"
                        >
                          <app-icon name="sparkles" [size]="14" />
                          {{ 'Background and adjustments' | t }}
                        </button>
                      </div>
                    </app-fold>
                  </div>
                }
              }
            </aside>
          </div>
        </div>
      }
    </div>

    <!-- The queue of the music and the videos, with the playlist that is playing on top. -->
    <ng-template #queuePanel>
      <div
        data-queue
        class="panel anim-pop !bg-ink-850 p-3 shadow-2xl"
        (mousedown)="$event.stopPropagation()"
      >
        @if (call.playlist().ids.length > 0) {
          <div class="mb-1.5 flex items-center justify-between">
            <b class="text-sm">{{ 'Playlist' | t }}</b>
            <span class="count-pill"
              >{{ call.playlist().index + 1 }}/{{ call.playlist().ids.length }}</span
            >
          </div>
          <ul class="mb-3 max-h-40 space-y-1 overflow-y-auto">
            @for (id of call.playlist().ids; track $index; let i = $index) {
              <li
                class="group flex items-center rounded-ui text-xs transition-colors"
                [class]="
                  i === call.playlist().index
                    ? 'bg-accent/15 text-accent'
                    : 'bg-white/5 hover:bg-white/10'
                "
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                  (click)="playlistGo(i)"
                >
                  <span class="w-4 shrink-0 text-center font-mono text-dim">{{ i + 1 }}</span>
                  <span class="min-w-0 flex-1 truncate">{{
                    titleOf('https://youtu.be/' + id)
                  }}</span>
                </button>
                @if (call.playlist().ids.length > 1) {
                  <button
                    type="button"
                    class="mr-1.5 shrink-0 rounded-full p-1 text-muted opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 focus:opacity-100"
                    [attr.aria-label]="'Remove' | t"
                    (click)="removeFromPlaylist($event, id)"
                  >
                    <app-icon name="x" [size]="13" />
                  </button>
                }
              </li>
            }
          </ul>
        }
        <div class="mb-2 flex items-center justify-between">
          <b class="text-sm">{{ 'Queue' | t }}</b>
          <span class="count-pill">{{ call.musicQueue().length }}</span>
        </div>
        <ul class="max-h-48 space-y-1 overflow-y-auto">
          @for (item of call.musicQueue(); track item.id; let i = $index) {
            <li class="flex items-center gap-2 rounded-ui bg-white/5 px-2 py-1.5 text-xs">
              <span class="w-4 shrink-0 text-center font-mono text-dim">{{ i + 1 }}</span>
              <app-icon
                [name]="item.video ? 'play' : 'music'"
                [size]="12"
                class="shrink-0 text-muted"
              />
              <span class="min-w-0 flex-1 truncate">{{ titleOf(item.url) }}</span>
              <span class="max-w-16 shrink-0 truncate text-muted">{{
                directory.get(item.by)?.displayName
              }}</span>
              <button
                type="button"
                class="shrink-0 text-muted hover:text-fg"
                [attr.aria-label]="'Remove' | t"
                (click)="call.removeFromQueue(item.id)"
              >
                <app-icon name="x" [size]="13" />
              </button>
            </li>
          } @empty {
            <li class="px-1 py-2 text-xs text-muted">
              {{ 'Nothing queued. Add a link and it plays after this one.' | t }}
            </li>
          }
        </ul>
        <form class="mt-2 flex gap-1.5" (submit)="addToQueue($event)">
          <button
            type="button"
            class="btn btn-icon btn-sm shrink-0"
            [attr.title]="(queueKind() === 'video' ? 'A video' : 'A song') | t"
            [attr.aria-label]="(queueKind() === 'video' ? 'A video' : 'A song') | t"
            (click)="queueKind.set(queueKind() === 'video' ? 'music' : 'video')"
          >
            <app-icon [name]="queueKind() === 'video' ? 'play' : 'music'" [size]="15" />
          </button>
          <input
            class="input min-w-0 flex-1 !py-1.5 !text-xs"
            [value]="queueLink()"
            (input)="queueLink.set($any($event.target).value); queueInvalid.set(false)"
            placeholder="https://youtu.be/…"
            [attr.aria-label]="'Link' | t"
          />
          <button type="submit" class="btn btn-sm btn-primary" [disabled]="!queueLink()">
            {{ 'Add' | t }}
          </button>
        </form>
        @if (queueInvalid()) {
          <div class="mt-1 text-xs text-amber">
            {{
              (queueKind() === 'video'
                ? 'That is not a valid YouTube link.'
                : 'That is not a valid YouTube or Spotify link.'
              ) | t
            }}
          </div>
        }
      </div>
    </ng-template>

    <!-- An activity (music, a video, Spinly) as a tile of the call. -->
    <ng-template #activityTpl let-t let-small="small" let-focus="focus" let-short="short">
      @switch (t.activity) {
        @case ('spinly') {
          @if (small) {
            <button
              type="button"
              class="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/20 p-2 text-center"
              (click)="toggleFocus($event, t)"
            >
              <span class="menu-icon !bg-white/5"><app-spinly-logo [size]="28" /></span>
              <b class="text-xs">Spinly</b>
              <span class="text-[0.625rem] text-muted">{{ 'Click to enlarge' | t }}</span>
            </button>
          } @else {
            <app-spinly-call-panel class="block h-full" [embedded]="true" [tight]="short">
              <span actions class="contents">
                <button
                  type="button"
                  class="btn btn-icon btn-sm"
                  [attr.title]="(focus ? 'Back to the grid' : 'Enlarge') | t"
                  [attr.aria-label]="(focus ? 'Back to the grid' : 'Enlarge') | t"
                  (click)="toggleFocus($event, t)"
                >
                  <app-icon [name]="focus ? 'layout' : 'pin'" [size]="15" />
                </button>
              </span>
            </app-spinly-call-panel>
          }
        }
        @default {
          @if (call.music(); as m) {
            <div class="flex h-full flex-col">
              <div
                class="flex shrink-0 items-center gap-2 border-b border-white/8 bg-black/30 px-3"
                [class]="small ? 'h-8' : 'h-11'"
              >
                <app-icon name="play" [size]="small ? 13 : 16" class="shrink-0 text-accent" />
                <div class="min-w-0 flex-1 leading-tight">
                  <div
                    class="truncate font-semibold"
                    [class]="small ? 'text-[0.6875rem]' : 'text-sm'"
                  >
                    {{ 'Watching together' | t }}
                  </div>
                  @if (!small) {
                    <div class="truncate text-[0.6875rem] text-muted">
                      {{ directory.get(m.by)?.displayName }} · YouTube
                    </div>
                  }
                </div>
                @if (!small) {
                  <button
                    type="button"
                    class="btn btn-icon btn-sm btn-ghost"
                    [attr.title]="(focus ? 'Back to the grid' : 'Enlarge') | t"
                    [attr.aria-label]="(focus ? 'Back to the grid' : 'Enlarge') | t"
                    (click)="toggleFocus($event, t)"
                  >
                    <app-icon [name]="focus ? 'layout' : 'pin'" [size]="15" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-icon btn-sm btn-ghost"
                    [attr.title]="'Full screen' | t"
                    [attr.aria-label]="'Full screen' | t"
                    (click)="toggleFullscreen($event, t)"
                  >
                    <app-icon name="maximize" [size]="15" />
                  </button>
                }
                <button
                  type="button"
                  class="btn btn-sm btn-ghost gap-1"
                  data-queue-toggle
                  [class.btn-active]="queueOpen()"
                  [attr.title]="'Queue' | t"
                  [attr.aria-label]="'Queue' | t"
                  (mousedown)="$event.stopPropagation()"
                  (click)="toggleQueue($event)"
                >
                  <app-icon name="list" [size]="14" />
                  <span class="font-mono text-[0.6875rem]">{{ call.musicQueue().length }}</span>
                </button>
                @if (call.hasNext()) {
                  <button
                    type="button"
                    class="btn btn-icon btn-sm btn-ghost"
                    [class.btn-active]="iVotedSkip()"
                    [attr.title]="'Vote to skip' | t"
                    [attr.aria-label]="'Vote to skip' | t"
                    (click)="call.voteSkip()"
                  >
                    <app-icon name="skip-forward" [size]="14" />
                  </button>
                }
                <button
                  type="button"
                  class="btn btn-icon btn-sm btn-soft-danger"
                  [attr.title]="'Close for me' | t"
                  [attr.aria-label]="'Close for me' | t"
                  (click)="stopMedia($event)"
                >
                  <app-icon name="x" [size]="15" />
                </button>
              </div>
              <div class="player-box relative min-h-0 flex-1 bg-black">
                @if (musicSrc(); as src) {
                  <iframe
                    class="player-frame pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-0"
                    [frameAllow]="allowMedia"
                    [src]="src"
                    allowfullscreen
                    referrerpolicy="strict-origin-when-cross-origin"
                    sandbox="allow-scripts allow-same-origin allow-presentation"
                    [title]="'Video' | t"
                    #reproductor
                    (load)="notifyPlayer(reproductor)"
                  ></iframe>
                  <!-- the picture is only a picture: a press on it plays or pauses for everybody, nothing of YouTube answers. While it is paused YouTube draws its own title, "more videos" and logo: a thick blur covers them (and our own mark shows). -->
                  <div
                    class="absolute inset-0 flex cursor-pointer items-center justify-center transition-colors duration-300"
                    [class.paused-cover]="paused() || unstarted()"
                    [class.settle-cover]="settling() && !paused() && !unstarted()"
                    role="button"
                    tabindex="-1"
                    [attr.aria-label]="(paused() ? 'Play' : 'Pause') | t"
                    (click)="togglePause()"
                  >
                    @if (paused() || unstarted()) {
                      <span
                        class="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20"
                        ><app-icon name="play" [size]="28"
                      /></span>
                    }
                  </div>
                } @else {
                  <div
                    class="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted"
                  >
                    {{ 'Muted while you are deafened.' | t }}
                  </div>
                }
              </div>
              @if (musicSrc()) {
                <div
                  class="timeline flex items-center gap-4 border-t border-white/8 px-4 py-3"
                  (dblclick)="$event.stopPropagation()"
                >
                  <button
                    type="button"
                    class="btn btn-icon btn-primary shrink-0 !rounded-full"
                    [attr.title]="(paused() ? 'Play' : 'Pause') | t"
                    [attr.aria-label]="(paused() ? 'Play' : 'Pause') | t"
                    (click)="togglePause()"
                  >
                    <app-icon [name]="paused() ? 'play' : 'pause'" [size]="16" />
                  </button>
                  <div class="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      class="min-w-[2.7rem] text-right font-mono text-[0.6875rem] tabular-nums text-muted"
                      >{{ clock(scrubbing() ? scrubTime() : elapsed()) }}</span
                    >
                    <input
                      type="range"
                      class="min-w-0 flex-1"
                      min="0"
                      step="1"
                      [max]="duration() || 1"
                      [value]="elapsed()"
                      [disabled]="duration() <= 0"
                      [attr.aria-label]="'Timeline' | t"
                      (pointerdown)="scrubbing.set(true)"
                      (pointerup)="endScrub()"
                      (pointercancel)="endScrub()"
                      (input)="scrubTime.set(+$any($event.target).value)"
                      (change)="seekTo(+$any($event.target).value)"
                    />
                    <span
                      class="min-w-[2.7rem] font-mono text-[0.6875rem] tabular-nums text-muted"
                      >{{ clock(duration()) }}</span
                    >
                  </div>
                  <span class="mx-1 h-6 w-px shrink-0 bg-white/10"></span>
                  <button
                    type="button"
                    class="btn btn-icon btn-sm shrink-0"
                    [class.btn-active]="captions()"
                    [attr.title]="(captions() ? 'Hide the subtitles' : 'Show the subtitles') | t"
                    [attr.aria-label]="
                      (captions() ? 'Hide the subtitles' : 'Show the subtitles') | t
                    "
                    [attr.aria-pressed]="captions()"
                    (click)="toggleCaptions()"
                  >
                    <span class="text-[0.6875rem] font-extrabold tracking-wide">CC</span>
                  </button>
                  <div class="relative shrink-0">
                    <button
                      type="button"
                      class="btn btn-icon btn-sm"
                      [class.btn-active]="volumeOpen()"
                      [attr.title]="'Volume' | t"
                      [attr.aria-label]="'Volume' | t"
                      (mousedown)="$event.stopPropagation()"
                      (click)="toggleVolume()"
                    >
                      <app-icon
                        [name]="settings.musicVolume() === 0 ? 'volume-x' : 'volume-2'"
                        [size]="15"
                      />
                    </button>
                    @if (volumeOpen()) {
                      <div
                        animate.leave="leave-pop"
                        class="volume-pop anim-pop"
                        (mousedown)="$event.stopPropagation()"
                      >
                        <b class="font-mono text-[0.6875rem] text-accent"
                          >{{ settings.musicVolume() }}%</b
                        >
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          class="volume-range"
                          [value]="settings.musicVolume()"
                          [attr.aria-label]="'Music volume' | t"
                          (input)="setMusicVolume($event)"
                        />
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        }
      }
    </ng-template>

    <!-- One participant: every overlay is absolutely positioned, so muting never moves anything. -->
    <ng-template #tileTpl let-t let-small="small" let-focus="focus" let-short="short">
      <article
        class="tile-card anim-fade-in group isolate relative h-full w-full cursor-pointer overflow-hidden rounded-ui-lg border bg-ink-900"
        (click)="t.kind !== 'activity' ? clickTile(t) : null"
        (contextmenu)="t.kind !== 'activity' && openTileMenu($event, t)"
        (dblclick)="toggleFullscreen($event, t)"
        [attr.title]="(focus ? 'Click to go back to the grid' : 'Click to enlarge') | t"
        [style.border-color]="speakingOf(t) ? 'var(--accent)' : 'rgba(255,255,255,.08)'"
        [style.box-shadow]="
          speakingOf(t) ? '0 0 0 1px var(--accent), 0 0 26px -8px var(--accent)' : null
        "
      >
        @if (t.kind === 'activity') {
          <ng-container
            [ngTemplateOutlet]="activityTpl"
            [ngTemplateOutletContext]="{ $implicit: t, small: small, focus: focus, short: short }"
          />
        } @else if (t.stream) {
          <video
            class="absolute inset-0 h-full w-full rounded-[inherit] bg-black"
            [class.object-cover]="t.kind === 'camera' && !focus"
            [class.object-contain]="t.kind === 'screen' || focus"
            [appMediaStream]="t.stream"
            autoplay
            playsinline
            [muted]="t.local || t.kind === 'screen'"
          ></video>
          <div
            class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/25"
          ></div>
        } @else {
          <div class="absolute inset-0 flex items-center justify-center">
            <app-avatar
              [user]="t.user"
              [size]="small ? 44 : 88"
              [ringRatio]="0.07"
              [aura]="true"
              [speaking]="speakingOf(t)"
            />
          </div>
        }
        @if (t.kind !== 'activity') {
          <div class="absolute left-3 top-3 flex min-h-6 gap-1.5">
            @if (t.kind === 'screen') {
              <span class="chip chip-violet"
                ><app-icon name="monitor" [size]="11" /> {{ 'Screen' | t }}</span
              >
            } @else {
              @if (t.muted) {
                <span class="state-badge"><app-icon name="mic-off" [size]="13" /></span>
              }
              @if (t.deafened) {
                <span class="state-badge"><app-icon name="headphones-off" [size]="13" /></span>
              }
            }
          </div>
          <div class="tile-actions absolute right-3 top-3 flex gap-1.5">
            <button
              type="button"
              class="tile-btn"
              [attr.title]="(focus ? 'Back to the grid' : 'Enlarge') | t"
              [attr.aria-label]="(focus ? 'Back to the grid' : 'Enlarge') | t"
              (click)="toggleFocus($event, t)"
            >
              <app-icon [name]="focus ? 'layout' : 'pin'" [size]="14" />
            </button>
            @if (!small) {
              <button
                type="button"
                class="tile-btn"
                [attr.title]="'Full screen' | t"
                [attr.aria-label]="'Full screen' | t"
                (click)="toggleFullscreen($event, t)"
              >
                <app-icon name="maximize" [size]="14" />
              </button>
            }
          </div>
          <div
            class="absolute top-3 flex min-h-6 gap-1"
            [class.right-3]="small"
            [class.right-[5.4rem]]="!small"
          >
            @if (!small && !t.local && t.rtt !== null && t.kind !== 'screen') {
              <span class="chip">{{ t.rtt }} ms</span>
            }
          </div>
          <div class="absolute inset-x-4 bottom-3.5 flex items-end justify-between gap-2">
            <div class="min-w-0">
              <div
                class="truncate font-semibold leading-tight"
                [class]="nameClass(t.user)"
                [class.text-sm]="small"
                [appNameColor]="t.user?.profileColor"
                [appUserFont]="t.user?.nameFont"
                [nameFx]="t.user?.nameFx"
              >
                {{ t.user?.displayName }}
              </div>
              @if (!small && !t.code && !t.local) {
                <div class="text-xs text-muted">{{ 'Connecting…' | t }}</div>
              }
            </div>
            @if (t.kind === 'screen' && !t.local && t.user && hasScreenSound(t.user.id)) {
              <!-- the volume of this shared screen, only for you: the sound of the screen is not the voice of the person -->
              <div
                class="screen-vol flex items-center gap-2 rounded-full bg-black/60 px-2.5 py-1 text-white"
                (click)="$event.stopPropagation()"
                (dblclick)="$event.stopPropagation()"
                (mousedown)="$event.stopPropagation()"
                (contextmenu)="$event.stopPropagation()"
              >
                <button
                  type="button"
                  class="grid place-items-center"
                  [attr.title]="'Stream volume' | t"
                  [attr.aria-label]="'Stream volume' | t"
                  (click)="muteScreen(t.user.id)"
                >
                  <app-icon
                    [name]="screenVolume(t.user.id) === 0 ? 'volume-x' : 'volume-2'"
                    [size]="14"
                  />
                </button>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  class="w-24 accent-[var(--accent)]"
                  [attr.aria-label]="'Stream volume' | t"
                  [value]="screenVolume(t.user.id)"
                  (input)="setScreenVolume(t.user.id, +$any($event.target).value)"
                  (dblclick)="setScreenVolume(t.user.id, 100)"
                />
                <b class="w-9 text-right font-mono text-[0.6875rem]"
                  >{{ screenVolume(t.user.id) }}%</b
                >
              </div>
            }
            @if (!t.muted && t.kind !== 'screen') {
              <span class="flex h-5 items-end gap-[2px]">
                @for (b of bars; track $index) {
                  <span
                    class="w-[3px] rounded-full bg-accent transition-[height] duration-100"
                    [style.height.px]="3 + levelOf(t) * 16 * b"
                  ></span>
                }
              </span>
            }
          </div>
        }
      </article>
    </ng-template>

    @if (verifyOpen()) {
      <app-modal
        [title]="'Verify this call' | t"
        [subtitle]="
          'Frames are encrypted on your device with keys only you and each participant hold.' | t
        "
        [width]="480"
        (closed)="verifyOpen.set(false)"
      >
        <p class="mb-3 text-sm text-muted">
          {{
            'Read these numbers aloud to each person. If they see the same ones, nobody can be listening in the middle.'
              | t
          }}
        </p>
        <div class="space-y-2">
          @for (p of peerCodes(); track p.id) {
            <div
              class="flex items-center gap-3 rounded-ui border border-white/8 bg-white/[.03] p-3"
            >
              <app-avatar [user]="p.user" [size]="38" />
              <div class="min-w-0 flex-1">
                <div
                  class="truncate font-semibold"
                  [appNameColor]="p.user?.profileColor"
                  [appUserFont]="p.user?.nameFont"
                  [nameFx]="p.user?.nameFx"
                >
                  {{ p.user?.displayName }}
                </div>
                <div class="text-xs text-muted">
                  {{ 'Sent, encrypted' | t }}: {{ p.sent }} · {{ 'Received, decrypted' | t }}:
                  {{ p.received }}
                  @if (p.failed) {
                    · <span class="text-red-300">{{ 'rejected' | t }}: {{ p.failed }}</span>
                  }
                </div>
              </div>
              <span class="font-mono text-xl font-semibold tracking-widest">{{
                p.code ?? '…'
              }}</span>
            </div>
          } @empty {
            <p class="p-4 text-center text-sm text-muted">
              {{ 'Waiting for other participants…' | t }}
            </p>
          }
        </div>
        <ul class="mt-4 space-y-1 text-xs text-muted">
          <li>
            🔐
            {{ 'AES-256-GCM on every audio and video frame, before it leaves your browser.' | t }}
          </li>
          <li>
            🔁
            {{
              'Keys come from a fresh ECDH exchange per call and rotate every 30 s (forward secrecy).'
                | t
            }}
          </li>
          <li>🛡️ {{ 'Frames that fail authentication are dropped, never played.' | t }}</li>
        </ul>
      </app-modal>
    }
  `,
})
export class VoiceStageComponent {
  private readonly environment = inject(EnvironmentInjector);

  /** Opens the window of the camera (background, mirror and adjustments, with a live preview). */
  protected openCameraOptions(): void {
    openBackgroundPicker(this.environment);
  }

  /** The place under the music card while it is dragged (null when it is not being dragged). */
  protected readonly musicTarget = signal<DockPlace | null>(null);
  protected readonly places: DockPlace[] = ['tl', 'tc', 'tr', 'bl', 'br'];
  /** The stage, so the card is dropped on places of the stage and not of the window. */
  protected readonly stageHostEl = computed(this.pickStageHost.bind(this));
  /** The classes that put the music card in its place. */
  protected readonly musicClass = computed(this.pickMusicClass.bind(this));
  /** Space the card leaves at the bottom: above the strip of small tiles when somebody is pinned. */
  protected readonly musicLift = computed(this.countMusicLift.bind(this));
  /** True when the stage is wide enough for the card to sit beside the bar of controls. */
  protected readonly musicBeside = computed(this.fitsBesideBar.bind(this));
  protected readonly musicBottom = computed(this.countMusicBottom.bind(this));
  /** What is still to play after the current one: the queue plus the rest of a playlist. */
  protected readonly queuedCount = computed(this.countQueued.bind(this));

  /** The element of the stage. */
  private pickStageHost(): HTMLElement | null {
    return this.stageHost()?.nativeElement ?? null;
  }

  /** Classes of the place of the music card. */
  private pickMusicClass(): string {
    const place = this.settings.musicPlace();
    // The middle of the bottom is gone: it sat over the bar of controls.
    return MUSIC_PLACES[place === 'bc' ? 'br' : place];
  }

  /** Height of the strip of small tiles under a pinned one (nothing when nobody is pinned or in full screen). */
  private countMusicLift(): number {
    if (!this.featured() || this.fullscreen() || this.tiles().length < 2) {
      return 0;
    }
    return Math.round(Math.min(150, Math.max(88, this.area().h * 0.2))) + 12;
  }

  /** Whether the card fits at the left or the right of the bar of controls (about 640 px wide, in the middle). */
  private fitsBesideBar(): boolean {
    return !this.fullscreen() && this.area().w >= 2 * (352 + 24) + 640;
  }

  /** The distance of the card from the bottom: beside the bar when it fits, over the strip of tiles otherwise. */
  private countMusicBottom(): number | null {
    if (!this.settings.musicPlace().startsWith('b')) {
      return null;
    }
    return this.musicBeside() ? -84 : this.musicLift() + 12;
  }

  /** Where the targets at the bottom are. */
  protected zoneBottom(): number {
    return this.musicBeside() ? -84 : this.musicLift() + 12;
  }

  /** Classes of the target of a place. */
  protected zoneClass(place: DockPlace): string {
    return MUSIC_PLACES[place];
  }

  /** How many songs or videos are still to come. */
  private countQueued(): number {
    const list = this.call.playlist();
    const rest = list.ids.length > 0 ? Math.max(0, list.ids.length - list.index - 1) : 0;
    return rest + this.call.musicQueue().length;
  }

  protected readonly call = inject(CallService);
  protected readonly settings = inject(SettingsService);
  protected readonly guilds = inject(GuildStore);
  protected readonly social = inject(SocialStore);
  protected readonly directory = inject(DirectoryService);
  private readonly messages = inject(MessageStore);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private warnedConnection = false;

  protected readonly ui = inject(UiService);
  protected readonly bars = [0.5, 0.8, 1, 0.7, 0.4, 0.9, 0.6];
  protected readonly drawer = signal<Drawer | null>(null);
  private readonly router = inject(Router);
  private wasInCall = false;

  /** Watches the call: when it ends (or the page is opened without a call) the person goes back to the home screen. */
  constructor() {
    effect(this.watchCall.bind(this));
    effect(this.watchConnections.bind(this));
    this.startStage();
    // The player reports its time a couple of times a second: between two reports the timeline moves by the clock.
    const ticker = setInterval(this.smoothTime.bind(this), 250);
    this.destroyRef.onDestroy(clearInterval.bind(null, ticker));
    // In the capture phase, so that a press which something else stops on its way (a floating tile) still closes the queue.
    const close = this.closeQueueOutside.bind(this);
    document.addEventListener('pointerdown', close, true);
    this.destroyRef.onDestroy(
      document.removeEventListener.bind(document, 'pointerdown', close, true),
    );
  }

  /** Moves the timeline by the clock while the video plays, so that it never waits for the next report of the player. */
  private smoothTime(): void {
    if (
      !this.call.music() ||
      this.paused() ||
      this.scrubbing() ||
      this.duration() <= 0 ||
      !this.reportedAt
    ) {
      return;
    }
    const now = this.playerTime + (performance.now() - this.reportedAt) / 1000;
    this.elapsed.set(Math.min(this.duration(), now));
  }

  /** A press outside of the queue (and of the button that opens it) closes it. */
  private closeQueueOutside(event: Event): void {
    const target = event.target as Element | null;
    if (this.queueOpen() && !target?.closest('[data-queue], [data-queue-toggle]')) {
      this.queueOpen.set(false);
    }
  }

  /** Tells the person once per call when the media of somebody could not connect (the networks may need a TURN relay). */
  private watchConnections(): void {
    const failed = Object.values(this.call.peers()).some(function isFailed(peer: PeerView) {
      return peer.connection === 'failed';
    });
    if (failed && !this.warnedConnection) {
      this.warnedConnection = true;
      this.toast.error(
        this.i18n.t('The call could not connect'),
        this.i18n.t('The two networks may need a relay (TURN) server: see the deploy guide.'),
      );
    } else if (!failed && !this.call.inCall()) {
      this.warnedConnection = false;
    }
  }

  /** Follows the state of the call. */
  private watchCall(): void {
    const sala = this.call.roomId();
    const estado = this.call.status();
    untracked(
      function (this: VoiceStageComponent) {
        if (sala) {
          this.wasInCall = true;
        } else if (this.wasInCall && estado !== 'connecting') {
          this.goHome();
        } else if (estado !== 'connecting') {
          setTimeout(this.checkNoCall.bind(this), 1500);
        }
      }.bind(this),
    );
  }

  /** After a moment without a call the page goes back to the home screen. */
  private checkNoCall(): void {
    if (!this.call.roomId() && this.call.status() !== 'connecting') this.goHome();
  }

  /** Goes back to where the person was before the call. */
  private goHome(): void {
    if (!this.router.url.startsWith('/voice')) {
      return;
    }
    void this.router.navigateByUrl(this.ui.lastRoute || '/direct', { replaceUrl: true });
  }

  protected readonly verifyOpen = signal(false);
  /** The Activities menu is open. */
  protected readonly activitiesOpen = signal(false);
  /** Which link form of the menu is showing (listen or watch), if any. */
  protected readonly activityForm = signal<'music' | 'video' | null>(null);
  /** What can be started together in a call. */
  protected readonly activityChoices: {
    id: 'music' | 'video' | 'spinly';
    title: string;
    hint: string;
    icon: string;
    tone: string;
  }[] = [
    {
      id: 'music',
      title: 'Listen together',
      hint: 'YouTube or Spotify, in sync',
      icon: 'music',
      tone: 'bg-accent/15 text-accent',
    },
    {
      id: 'video',
      title: 'Watch together',
      hint: 'A YouTube video, in sync',
      icon: 'play',
      tone: 'bg-coral/15 text-coral',
    },
    {
      id: 'spinly',
      title: 'Spinly',
      hint: 'A wheel or tournament for everybody',
      icon: 'wheel',
      tone: 'bg-amber/15 text-amber',
    },
  ];
  protected readonly spinly = inject(SpinlyService);

  /** True while the call has something running. */
  protected hasActivity(): boolean {
    return !!this.call.music() || !!this.spinly.callActivity();
  }

  /** Whether an activity is running now. */
  protected isActive(id: 'music' | 'video' | 'spinly'): boolean {
    if (id === 'spinly') {
      return !!this.spinly.callActivity();
    }
    const media = this.call.music();
    return !!media && media.video === (id === 'video');
  }

  /** Opens or closes the Activities menu. */
  protected toggleActivities(): void {
    this.activityForm.set(null);
    const open = !this.activitiesOpen();
    this.closeOthers();
    this.activitiesOpen.set(open);
  }

  /** Whether the screen a person shares has sound (so it has a volume). */
  protected hasScreenSound(userId: string): boolean {
    return !!this.call.screenSound()[userId];
  }

  /** How loud the shared screen of a person is for you, in percent. */
  protected screenVolume(userId: string): number {
    return this.settings.screenVolumes()[userId] ?? 100;
  }

  /** Changes how loud the shared screen of a person is for you. */
  protected setScreenVolume(userId: string, percent: number): void {
    this.call.setScreenVolume(userId, percent);
  }

  /** The speaker button of the volume: mutes the shared screen, and brings it back to the normal level. */
  protected muteScreen(userId: string): void {
    this.call.setScreenVolume(userId, this.screenVolume(userId) === 0 ? 100 : 0);
  }

  /** The menu to start sharing the screen is open. */
  protected readonly shareOpen = signal(false);
  /** True in the desktop app, where the picker is the app's own: "a tab" does not exist and the sound is not shared. */
  protected readonly desktop = isDesktopApp();
  /** The Android app: its WebView cannot capture the screen (no getDisplayMedia), so the button only explains why. */
  protected readonly android = ANDROID_APP;
  /** The Android app can share the screen through its own plugin (pictures drawn on a canvas); see android-screen.ts. */
  protected readonly androidShare = androidScreenAvailable();
  protected readonly shareSurfaces: {
    id: 'any' | 'monitor' | 'window' | 'browser';
    label: string;
    icon: string;
  }[] = [
    { id: 'monitor', label: 'A screen', icon: 'monitor' },
    { id: 'window', label: 'A window', icon: 'layout' },
    { id: 'browser', label: 'A tab', icon: 'globe' },
  ];
  /** What can be shared: a screen or a window (and, in a browser, a tab). */
  protected readonly surfaceChoices = this.shareSurfaces.filter(
    function offered(this: VoiceStageComponent, option: { id: string }): boolean {
      return !(this.desktop && option.id === 'browser');
    }.bind(this),
  );
  protected readonly shareQualities: {
    id: 'standard' | 'high' | 'max';
    label: string;
    hint: string;
  }[] = [
    { id: 'standard', label: '720p · 30', hint: 'Light' },
    { id: 'high', label: '1080p · 30', hint: 'Balanced' },
    { id: 'max', label: '1080p · 60', hint: 'Smooth' },
  ];

  /**
   * The button of the screen: stops sharing. To start, in the desktop app it opens the menu (what to share, quality, sound:
   * nothing else asks for them there); in a browser it starts at once, as the browser asks what to show (the menu is on the
   * right click).
   */
  protected screenClick(): void {
    if (this.android && !this.androidShare) {
      this.toast.info(
        'Screen sharing is not available on Android',
        'The Android web view cannot capture the screen. Share it from the web or the desktop app.',
        '🖥️',
      );
      return;
    }
    if (this.call.screenOn()) {
      void this.call.toggleScreen();
      return;
    }
    if (this.desktop) {
      const open = !this.shareOpen();
      this.closeOthers();
      this.shareOpen.set(open);
      return;
    }
    // On a phone the system asks what to share and the quality is the one of the menu (opened with a long press).
    this.shareOpen.set(false);
    void this.call.toggleScreen();
  }

  /** The right click on the button of the screen opens its options (quality, sound, what to offer). */
  protected shareOptions(event: Event): void {
    event.preventDefault();
    // The Android app has nothing to choose here: the system asks what to share.
    if (this.call.screenOn() || this.android) {
      return;
    }
    const open = !this.shareOpen();
    this.closeOthers();
    this.shareOpen.set(open);
  }

  /** Remembers a change of what is going to be shared. */
  protected setShare(change: Partial<ReturnType<SettingsService['screenShare']>>): void {
    this.settings.screenShare.update(function merge(current) {
      return { ...current, ...change };
    });
  }

  /** Closes the menu and asks the browser what to show. */
  protected startShare(): void {
    this.shareOpen.set(false);
    void this.call.toggleScreen();
  }

  /** The soundboard opens upward from its button in the bar of the call. */
  protected toggleSoundboard(event: Event): void {
    const button = event.currentTarget as HTMLElement;
    const open = !this.ui.soundboardOpen();
    this.closeOthers();
    this.ui.soundboardAnchor.set(button.getBoundingClientRect());
    this.ui.soundboardOpen.set(open);
  }

  /** The volume panel of the music card is open. */
  protected readonly volumeOpen = signal(false);
  /** Whether the subtitles of the video are shown (off at the start: YouTube would turn them on by the choice of the person there). */
  protected readonly captions = signal(false);
  /** Places where the volume slider holds for a moment (it can still be moved anywhere). */
  protected readonly volumeTicks = [0, 25, 50, 75, 100];

  /** Changes the volume of the music; near a mark it clings to it, in between it moves freely. */
  protected setMusicVolume(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = Number(input.value);
    for (const tick of this.volumeTicks) {
      if (Math.abs(value - tick) <= 3) {
        value = tick;
      }
    }
    input.value = String(value);
    this.settings.musicVolume.set(value);
  }

  /** The queue of the music card is open. */
  protected readonly queueOpen = signal(false);
  protected readonly queueLink = signal('');
  protected readonly queueInvalid = signal(false);
  /** What the next link added to the queue is: a song or a video. */
  protected readonly queueKind = signal<'music' | 'video'>('music');
  private lastPlaylistNext = 0;
  private readonly titlesEffect = effect(this.loadPlaylistTitles.bind(this));

  /** While the queue is open, the titles of the videos of the playlist are looked up. */
  private loadPlaylistTitles(): void {
    if (!this.queueOpen()) {
      return;
    }
    const ids = this.call.playlist().ids.slice(0, 30);
    untracked(this.askTitles.bind(this, ids));
  }

  /** Asks for the title of each video. */
  private askTitles(ids: string[]): void {
    for (const id of ids) {
      this.call.findTitle('https://youtu.be/' + id);
    }
  }

  /** Opens or closes the volume of the music. */
  protected toggleVolume(): void {
    const open = !this.volumeOpen();
    this.closeOthers();
    this.volumeOpen.set(open);
  }

  /** Closes every menu of the bar except the one that is about to open. */
  private closeOthers(): void {
    this.activitiesOpen.set(false);
    this.activityForm.set(null);
    this.shareOpen.set(false);
    this.queueOpen.set(false);
    this.volumeOpen.set(false);
    this.ui.soundboardOpen.set(false);
  }
  private lastPauseRequest = 0;
  private readonly pauseEffect = effect(this.followPauseRequest.bind(this));
  private readonly mirrorPause = effect(this.mirrorPausedState.bind(this));

  /** The floating bar of the call asked to pause or resume. */
  private followPauseRequest(): void {
    const count = this.call.pauseRequest();
    if (count !== this.lastPauseRequest) {
      this.lastPauseRequest = count;
      untracked(this.togglePause.bind(this));
    }
  }

  /** Tells the call service whether the player is paused. */
  private mirrorPausedState(): void {
    this.call.musicPaused.set(this.paused());
  }
  private readonly playlistEffect = effect(this.followPlaylistNext.bind(this));

  /** Opens or closes the queue; it starts on the kind of what is playing and asks for the titles of the playlist. */
  protected toggleQueue(event: Event): void {
    event.stopPropagation();
    const opening = !this.queueOpen();
    this.closeOthers();
    if (opening) {
      this.queueKind.set(this.call.music()?.video ? 'video' : 'music');
      for (const id of this.call.playlist().ids.slice(0, 30)) {
        this.call.findTitle('https://youtu.be/' + id);
      }
    }
    this.queueOpen.set(opening);
  }

  /** Jumps to a video of the playlist; everybody follows. */
  protected playlistGo(index: number): void {
    this.commandPlayer('playVideoAt', [index]);
    this.call.playlist.update(function move(list) {
      return { ids: list.ids, index };
    });
    this.call.setMusicPaused(false, 0, index);
  }

  /** The vote to skip went through on a playlist: the player goes to its next video (and the others follow). */
  private followPlaylistNext(): void {
    const count = this.call.playlistNext();
    if (count !== this.lastPlaylistNext) {
      this.lastPlaylistNext = count;
      untracked(this.commandPlayer.bind(this, 'nextVideo', []));
    }
  }
  /** Tiles the person hid from their own screen. */
  private readonly hidden = signal<string[]>([]);
  protected readonly hiddenCount = computed(this.countHidden.bind(this));
  /** The little menu of a tile (right click). */
  protected readonly tileMenu = signal<{
    id: string;
    label: string;
    userId: string;
    canAdjust: boolean;
    x: number;
    y: number;
  } | null>(null);

  /** How many of the tiles that exist are hidden. */
  private countHidden(): number {
    return this.hidden().length;
  }

  /** True when this person already voted to skip the song. */
  protected iVotedSkip(): boolean {
    return this.call.skipVotes().includes(this.auth.user()?.id ?? '');
  }

  /** The title of a song, or the name of its service while the title is not known. */
  protected titleOf(url: string): string {
    const known = this.call.musicTitles()[url];
    if (known) {
      return known;
    }
    return url.includes('spotify') ? 'Spotify' : 'YouTube';
  }

  /** Adds the typed link to the queue. */
  protected addToQueue(event: Event): void {
    event.preventDefault();
    if (this.call.queueMusic(this.queueLink(), this.queueKind() === 'video')) {
      this.queueLink.set('');
    } else {
      this.queueInvalid.set(true);
    }
  }

  /** Adds the link of the Listen together form to the queue instead of playing it now. */
  protected queueFromForm(): void {
    if (this.call.queueMusic(this.linkText(), this.activityForm() === 'video')) {
      this.linkText.set('');
      this.activityForm.set(null);
      this.activitiesOpen.set(false);
    } else {
      this.linkInvalid.set(true);
    }
  }

  /** Right click on a tile: offers to hide it. */
  protected openTileMenu(event: MouseEvent, tile: Tile): void {
    event.preventDefault();
    event.stopPropagation();
    // The menu is placed next to the cursor by the menu itself (it knows its own size).
    this.tileMenu.set({
      id: tile.id,
      label: tile.user?.displayName ?? '',
      userId: tile.user?.id ?? '',
      canAdjust: !tile.local && !!tile.user && tile.kind !== 'screen',
      x: event.clientX,
      y: event.clientY,
    });
  }

  /** Hides a tile from this person's screen only. */
  protected hideTile(id: string): void {
    this.hidden.update(function add(ids) {
      return ids.includes(id) ? ids : [...ids, id];
    });
    this.tileMenu.set(null);
    if (this.focusChoice() === id) {
      this.focusChoice.set(null);
    }
  }

  /** Brings every hidden tile back. */
  protected showHidden(): void {
    this.hidden.set([]);
  }

  /** A press anywhere else closes the menus. */
  @HostListener('document:mousedown')
  protected closeMenus(): void {
    this.tileMenu.set(null);
    this.queueOpen.set(false);
    this.volumeOpen.set(false);
    this.shareOpen.set(false);
  }

  /** A press anywhere else closes the menu. */
  @HostListener('document:mousedown')
  protected closeActivities(): void {
    if (this.activitiesOpen()) {
      this.activitiesOpen.set(false);
      this.activityForm.set(null);
    }
  }

  /** An activity of the menu was chosen: Spinly opens its window, the others ask for a link. */
  protected chooseActivity(id: 'music' | 'video' | 'spinly'): void {
    if (id === 'spinly') {
      this.activitiesOpen.set(false);
      this.spinly.composeForCall();
      return;
    }
    this.linkText.set('');
    this.linkInvalid.set(false);
    this.activityForm.set(id);
  }

  /** Stops an activity for everybody. */
  protected stopActivity(id: 'music' | 'video' | 'spinly'): void {
    if (id === 'spinly') {
      this.spinly.closeInCall();
    } else {
      this.call.stopMusic();
    }
    this.activitiesOpen.set(false);
  }

  /** The close button of the music or video: it closes only for this person, the others keep listening. */
  protected stopMedia(event: Event): void {
    event.stopPropagation();
    this.call.dismissMusic();
  }

  /** A time in seconds as m:ss (or h:mm:ss). */
  protected clock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = String(total % 60).padStart(2, '0');
    return hours > 0
      ? hours + ':' + String(minutes).padStart(2, '0') + ':' + rest
      : minutes + ':' + rest;
  }

  /** True while the shared YouTube player is paused. */
  protected readonly paused = signal(false);
  /** Where the YouTube player says it is, in seconds. */
  private playerTime = 0;
  /** When the player last said where it is, to move the timeline by the clock between two reports. */
  private reportedAt = 0;
  /** Length of what plays, in seconds (0 when unknown). */
  protected readonly duration = signal(0);
  /** The second shown on the timeline of the music bar. */
  protected readonly elapsed = signal(0);
  /** True while the person drags the timeline of the music bar. */
  /** The permissions of the frames of the players, only the ones this browser knows (see iframeAllow). */
  protected readonly allowAudio = ['autoplay', 'encrypted-media'];
  protected readonly allowMedia = [
    'autoplay',
    'encrypted-media',
    'picture-in-picture',
    'fullscreen',
  ];
  protected readonly scrubbing = signal(false);
  /** True while the player has not started (the browser asked for a press first). */
  protected readonly unstarted = signal(false);
  /** True for a few seconds after a video starts or jumps: YouTube draws its title, buttons and logo then, and a blur covers them. */
  protected readonly settling = signal(false);
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Where the thumb of the timeline is while it is dragged (the bar itself is not rewritten during the drag: a browser that is given a new value while the thumb is held stops the drag). */
  protected readonly scrubTime = signal(0);
  /** How much of the timeline is filled (percent), following the thumb while it is dragged. */
  protected readonly timeFill = computed(
    function (this: VoiceStageComponent) {
      const total = this.duration();
      const now = this.scrubbing() ? this.scrubTime() : this.elapsed();
      return total > 0 ? Math.min(100, (now / total) * 100) : 0;
    }.bind(this),
  );
  /** The last time the player reported, to notice a jump made inside the video itself. */
  private lastSample: { time: number; at: number } | null = null;
  /** The position of the playlist the player is at. */
  private playlistIndex = -1;
  private lastState = -2;
  private captionsReset = false;
  /** A command from the others was just applied: the echo of the player is not sent back before this time. */
  private quietUntil = 0;
  private readonly controlEffect = effect(this.applyControl.bind(this));
  private lastRemoval = 0;
  private readonly removalEffect = effect(this.followRemoval.bind(this));

  /** A video was taken out of the playlist: the player loads the playlist again without it, on the same video. */
  private followRemoval(): void {
    const removal = this.call.playlistRemoval();
    if (!removal || removal.seq === this.lastRemoval) {
      return;
    }
    this.lastRemoval = removal.seq;
    untracked(this.dropFromPlaylist.bind(this, removal.id));
  }

  /** Reloads the playlist of the player without one video and keeps the person where they were. */
  private dropFromPlaylist(id: string): void {
    const list = this.call.playlist();
    const at = list.ids.indexOf(id);
    if (at < 0 || list.ids.length < 2) {
      return;
    }
    const ids = list.ids.filter(function other(item) {
      return item !== id;
    });
    const playingIt = at === list.index;
    const index = Math.max(
      0,
      Math.min(at < list.index ? list.index - 1 : list.index, ids.length - 1),
    );
    this.quietUntil = Date.now() + 2500;
    this.lastSample = null;
    this.commandPlayer('loadPlaylist', [ids, index, playingIt ? 0 : Math.floor(this.playerTime)]);
    this.call.playlist.set({ ids, index });
    this.playlistIndex = index;
  }

  /** The person takes a video out of the playlist (for everybody). */
  protected removeFromPlaylist(event: Event, id: string): void {
    event.stopPropagation();
    this.call.removeFromPlaylist(id);
  }

  /** Covers the player for a moment (YouTube shows its own marks over a picture that has just started or moved). */
  private settle(): void {
    this.settling.set(true);
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(this.settling.set.bind(this.settling, false), 3000);
  }

  /** Shows or hides the subtitles of the video. */
  protected toggleCaptions(): void {
    const next = !this.captions();
    this.captions.set(next);
    this.commandPlayer(next ? 'loadModule' : 'unloadModule', ['captions']);
  }

  /** The pause button of the music bar. */
  protected togglePause(): void {
    if (this.unstarted()) {
      this.unstarted.set(false);
      this.paused.set(false);
      this.commandPlayer('playVideo', []);
      return;
    }
    const next = !this.paused();
    this.paused.set(next);
    this.commandPlayer(next ? 'pauseVideo' : 'playVideo', []);
    this.call.setMusicPaused(next, this.playerTime);
  }

  /**
   * The pointer left the timeline. The bar follows the player again a moment later (after the jump, if there was one): if the
   * person pressed it and let go without moving it, nothing else would give it back to the player and it would stay still.
   */
  protected endScrub(): void {
    setTimeout(this.scrubbing.set.bind(this.scrubbing, false), 250);
  }

  /** The person moved the timeline of the music bar: the player jumps, and so does everybody's. */
  protected seekTo(seconds: number): void {
    this.scrubbing.set(false);
    this.elapsed.set(seconds);
    this.playerTime = seconds;
    this.lastSample = null;
    this.quietUntil = Date.now() + 1500;
    this.commandPlayer('seekTo', [seconds, true]);
    this.settle();
    this.call.setMusicPaused(this.paused(), seconds);
  }

  /** Sends a command to the YouTube player (it must have been started with enablejsapi). */
  private commandPlayer(func: string, args: unknown[]): void {
    try {
      this.musicFrame?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }),
        'https://www.youtube-nocookie.com',
      );
    } catch {
      /* the frame is changing page: the command is lost, as it would be on a page that is loading */
    }
  }

  /** Somebody else paused or resumed: the player does the same, from the second they were at. */
  private applyControl(): void {
    const control = this.call.musicControl();
    if (!control || !control.remote) {
      return;
    }
    untracked(this.followControl.bind(this, control));
  }

  /** Obeys a pause, resume, seek or next song of another person without telling everybody again. */
  private followControl(control: { paused: boolean; pos: number; index?: number }): void {
    this.quietUntil = Date.now() + 1500;
    this.lastSample = null;
    this.paused.set(control.paused);
    if (control.index !== undefined && control.index !== this.playlistIndex) {
      this.playlistIndex = control.index;
      this.commandPlayer('playVideoAt', [control.index]);
    }
    this.elapsed.set(control.pos);
    this.commandPlayer('seekTo', [control.pos, true]);
    this.settle();
    this.commandPlayer(control.paused ? 'pauseVideo' : 'playVideo', []);
  }

  /** Keeps the time and the length the player reports, and shares a jump made inside the video or a new song of a playlist. */
  private noteTime(info: {
    currentTime?: number;
    duration?: number;
    playlistIndex?: number;
    playlist?: string[];
  }): void {
    const now = Date.now();
    if (Array.isArray(info.playlist) && info.playlist.length > 0) {
      const ids = info.playlist
        .filter(function text(id) {
          return typeof id === 'string';
        })
        .slice(0, 200);
      const index =
        typeof info.playlistIndex === 'number' ? info.playlistIndex : this.call.playlist().index;
      const known = this.call.playlist();
      if (known.ids.length !== ids.length || known.index !== index) {
        this.call.playlist.set({ ids, index });
      }
    } else if (typeof info.playlistIndex === 'number' && this.call.playlist().ids.length > 0) {
      const index = info.playlistIndex;
      if (this.call.playlist().index !== index) {
        this.call.playlist.update(function move(list) {
          return { ids: list.ids, index };
        });
      }
    }
    if (typeof info.duration === 'number' && info.duration > 0) {
      this.duration.set(info.duration);
    }
    if (typeof info.currentTime === 'number') {
      const time = info.currentTime;
      this.playerTime = time;
      this.reportedAt = performance.now();
      if (!this.scrubbing()) {
        this.elapsed.set(time);
      }
      const sample = this.lastSample;
      this.lastSample = { time, at: now };
      const expected = sample ? sample.time + (this.paused() ? 0 : (now - sample.at) / 1000) : time;
      if (sample && now >= this.quietUntil && Math.abs(time - expected) > 2.5) {
        this.call.setMusicPaused(this.paused(), time);
      }
    }
    if (typeof info.playlistIndex === 'number' && info.playlistIndex !== this.playlistIndex) {
      const changed = this.playlistIndex !== -1;
      this.playlistIndex = info.playlistIndex;
      if (changed) {
        this.settle();
      }
      if (changed && now >= this.quietUntil) {
        this.lastSample = null;
        this.call.setMusicPaused(false, 0, info.playlistIndex);
      }
    }
  }

  /** What the YouTube player reports (state and time): a pause or resume by this person is shared with the call. */
  @HostListener('window:message', ['$event'])
  protected onPlayerMessage(event: MessageEvent): void {
    if (!this.musicFrame || event.source !== this.musicFrame.contentWindow) {
      return;
    }
    let data: { event?: string; info?: unknown };
    try {
      data = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const info = data.info as
      | {
          playerState?: number;
          currentTime?: number;
          duration?: number;
          playlistIndex?: number;
          playlist?: string[];
        }
      | number
      | undefined;
    let state: number | undefined;
    if (typeof info === 'number' && data.event === 'onStateChange') {
      state = info;
    } else if (info && typeof info === 'object') {
      state = info.playerState;
      this.noteTime(info);
    }
    // ? A browser that does not let the video start by itself (Firefox with sound) leaves it "unstarted" or "cued": the picture
    // asks for a press (the press is a gesture of the person, so the player may start).
    if (state !== undefined) {
      // the player is ready: the subtitles start off, whatever the person chose in YouTube (asked once, never before it is ready)
      if (!this.captionsReset && !this.captions()) {
        this.captionsReset = true;
        this.commandPlayer('unloadModule', ['captions']);
      }
      this.unstarted.set(state === -1 || state === 5);
      if (state === 1 && this.lastState !== 1) {
        this.settle();
      }
      this.lastState = state;
    }
    if (state === 0 && this.call.music()) {
      this.call.musicEnded();
      return;
    }
    if ((state !== 1 && state !== 2) || Date.now() < this.quietUntil) {
      return;
    }
    const paused = state === 2;
    if (paused !== this.paused()) {
      this.paused.set(paused);
      this.call.setMusicPaused(paused, this.playerTime);
    }
  }

  protected readonly linkText = signal('');
  protected readonly linkInvalid = signal(false);
  /** The link that is typed, understood (null when it is not a link this activity accepts). */
  private readonly parsedLink = computed(
    function (this: VoiceStageComponent) {
      const link = parseMusicLink(this.linkText());
      if (!link) {
        return null;
      }
      return this.activityForm() === 'video' && link.kind !== 'youtube' ? null : link;
    }.bind(this),
  );
  /** Which site the typed link is from, once it is understood. */
  protected readonly linkKind = computed(
    function (this: VoiceStageComponent) {
      return this.parsedLink()?.kind ?? null;
    }.bind(this),
  );
  /** The typed link is good. */
  protected readonly linkOk = computed(
    function (this: VoiceStageComponent) {
      return this.parsedLink() !== null;
    }.bind(this),
  );
  /** Something that does not look like a link we accept has been typed (it is said as soon as it is clear, not only on sending). */
  protected readonly linkBad = computed(
    function (this: VoiceStageComponent) {
      const text = this.linkText().trim();
      return text.length >= 8 && this.parsedLink() === null;
    }.bind(this),
  );
  /** What the good link is, in words ("YouTube video", "Spotify playlist"...). */
  protected readonly linkSummary = computed(
    function (this: VoiceStageComponent) {
      const link = this.parsedLink();
      if (!link) {
        return '';
      }
      if (link.kind === 'youtube') {
        return link.type === 'list' ? 'YouTube playlist, ready' : 'YouTube video, ready';
      }
      return 'Spotify link, ready';
    }.bind(this),
  );

  /** Pastes what is on the clipboard into the link field. */
  protected async pasteLink(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      this.linkText.set(text.trim());
      this.linkInvalid.set(false);
    } catch {
      // The browser did not allow reading the clipboard: the person pastes with Ctrl+V.
    }
  }
  private readonly sanitizer = inject(DomSanitizer);
  private musicFrame: HTMLIFrameElement | null = null;
  private readonly volumeEffect = effect(this.applyMusicVolume.bind(this));

  /** Address of the embedded player. It is built only from identifiers that were already validated, never from free text. */
  protected readonly musicSrc = computed(this.computeMusic.bind(this));

  /**
   * YouTube accepts commands by message (enablejsapi): it is given the music volume chosen in the settings.
   * Spotify does not offer this, so its volume is controlled in its own player.
   */
  protected notifyPlayer(marco: HTMLIFrameElement): void {
    // ? Firefox fires "load" for the empty page the frame has before the player: nothing can be said to it yet (its origin is
    // this page's, and a message to the player's origin fails). The real load comes next.
    if (this.isBlank(marco)) {
      return;
    }
    this.musicFrame = marco;
    this.paused.set(false);
    this.captions.set(false);
    this.captionsReset = false;
    this.duration.set(0);
    this.elapsed.set(0);
    this.lastSample = null;
    this.playlistIndex = -1;
    this.listen(marco);
    // ? The player starts telling its time and its length only once it has been asked after it is ready, and a first
    // ask that arrives too early is lost: it is repeated until the length is known (then the timeline can be used).
    for (const wait of [400, 1000, 2000, 3500, 6000, 10000]) {
      setTimeout(this.listenAgain.bind(this, marco), wait);
    }
    this.applyMusicVolume();
  }

  /** Whether the frame still shows its empty first page (the player has not loaded). */
  private isBlank(marco: HTMLIFrameElement): boolean {
    try {
      return marco.contentWindow?.location.href === 'about:blank';
    } catch {
      return false; // another origin: the player is there
    }
  }

  /** Asks the player to start reporting its state. */
  private listen(marco: HTMLIFrameElement): void {
    try {
      marco.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        'https://www.youtube-nocookie.com',
      );
    } catch {
      /* the frame is changing page: the next ask (they are repeated) arrives */
    }
  }

  /** Asks again while the length of the video is still unknown and this is still the frame that plays. */
  private listenAgain(marco: HTMLIFrameElement): void {
    if (marco !== this.musicFrame || !marco.isConnected) {
      return;
    }
    if (this.duration() <= 0) {
      this.listen(marco);
    }
  }

  /** Sets the volume of the music player (silent when the person is deafened). */
  private applyMusicVolume(): void {
    const volumen = this.call.deafened() ? 0 : this.settings.musicVolume();
    this.commandPlayer('setVolume', [volumen]);
  }

  /** The address of the player of the music, set at the second the song has reached for everybody. */
  private computeMusic(): SafeResourceUrl | null {
    const m = this.call.music();
    if (!m) return null;
    const transcurrido = m.pos + (Date.now() - m.receivedAt) / 1000;
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      embedUrl(m.link, m.by === this.auth.user()?.id ? 0 : transcurrido),
    );
  }

  /** Starts the song or the video from the form of the Activities menu. */
  protected startLink(evento: Event): void {
    evento.preventDefault();
    if (this.call.startMusic(this.linkText(), this.activityForm() === 'video')) {
      this.linkText.set('');
      this.activityForm.set(null);
      this.activitiesOpen.set(false);
    } else {
      this.linkInvalid.set(true);
    }
  }

  /** Opens or closes the drawer of diagnostics. */
  protected toggleDrawer(kind: Drawer): void {
    this.drawer.set(this.drawer() === kind ? null : kind);
  }

  /** What the person chose to see big: a tile id, 'none' for the grid, or null to let a shared screen take the stage. */
  protected readonly focusChoice = signal<string | null>(null);
  /** The tile that fills the stage, if any. */
  protected readonly featured = computed(this.computeFeatured.bind(this));
  /** Size of the stage in pixels. */
  protected readonly area = signal({ w: 0, h: 0 });
  /** True while the window is being resized (the tiles then follow at once instead of gliding). */
  protected readonly resizing = signal(false);
  /** Where every tile goes. */
  protected readonly boxes = computed(this.computeBoxes.bind(this));
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly stageHost = viewChild<ElementRef<HTMLElement>>('stageHost');
  private readonly destroyRef = inject(DestroyRef);
  private observer: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private clickTimer: ReturnType<typeof setTimeout> | undefined;
  private lastScreens = '';

  /** Starts following the size of the stage and the arrival of shared screens. */
  private startStage(): void {
    effect(this.watchStage.bind(this));
    effect(this.watchScreens.bind(this));
    this.destroyRef.onDestroy(this.stopStage.bind(this));
  }

  /** Measures the stage whenever it appears and whenever its size changes. */
  private watchStage(): void {
    const element = this.stage()?.nativeElement;
    this.observer?.disconnect();
    this.observer = null;
    if (!element) {
      return;
    }
    this.observer = new ResizeObserver(this.onStageResize.bind(this));
    this.observer.observe(element);
  }

  /** The stage changed size: the tiles are placed again. */
  private onStageResize(entries: ResizeObserverEntry[]): void {
    const box = entries[entries.length - 1]?.contentRect;
    if (!box) {
      return;
    }
    const first = this.area().w === 0;
    this.area.set({ w: Math.floor(box.width), h: Math.floor(box.height) });
    if (!first) {
      this.resizing.set(true);
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(this.endResize.bind(this), 160);
    }
  }

  /** The window stopped changing size. */
  private endResize(): void {
    this.resizing.set(false);
  }

  /** Forgets the observer and the pending timers. */
  private stopStage(): void {
    this.observer?.disconnect();
    clearTimeout(this.resizeTimer);
    clearTimeout(this.clickTimer);
  }

  /** A newly shared screen takes the stage again, even if the person had chosen the grid. */
  private watchScreens(): void {
    const key = this.tiles()
      .filter(function takesTheStage(t) {
        return t.kind === 'screen' || t.activity === 'video' || t.activity === 'spinly';
      })
      .map(function toId(t) {
        return t.id;
      })
      .join('|');
    untracked(this.noteScreens.bind(this, key));
  }

  /** Remembers which screens are shared and, when a new one appears, lets it take the stage. */
  private noteScreens(key: string): void {
    if (key !== this.lastScreens) {
      const known = this.lastScreens.split('|');
      const fresh = key.split('|').some(function isNew(id) {
        return id !== '' && !known.includes(id);
      });
      if (fresh) {
        this.focusChoice.set(null);
      }
      this.lastScreens = key;
    }
  }

  /** The tile that fills the stage: the one the person chose, or a shared screen; none shows the grid. */
  private computeFeatured(): Tile | null {
    const list = this.tiles();
    const choice = this.focusChoice();
    if (choice === 'none') {
      return null;
    }
    if (choice) {
      const chosen = list.find(function byId(t) {
        return t.id === choice;
      });
      if (chosen) {
        return chosen;
      }
    }
    return (
      list.find(function isScreen(t) {
        return t.kind === 'screen';
      }) ??
      list.find(function isVideo(t) {
        return t.activity === 'video';
      }) ??
      list.find(function isSpinly(t) {
        return t.activity === 'spinly';
      }) ??
      null
    );
  }

  /** The box of every tile: a grid, or one big tile with the others in a strip. */
  private computeBoxes(): Map<string, Box> {
    const { w, h } = this.area();
    const list = this.tiles();
    const big = this.featured();
    const map = new Map<string, Box>();
    if (w < 10 || h < 10 || !list.length) {
      return map;
    }
    if (big && this.fullscreen()) {
      return this.floatingBoxes(big, list, w, h);
    }
    if (big) {
      const ordered = [
        big,
        ...list.filter(function others(t) {
          return t !== big;
        }),
      ];
      const boxes = focusBoxes(ordered.length, w, h);
      if (big.activity === 'video') {
        // The big video is as wide as its 16:9 picture allows (plus its header), so there are no black sides.
        const main = boxes[0];
        const header = 44;
        const width = Math.min(main.w, Math.floor(((main.h - header) * 16) / 9));
        boxes[0] = {
          x: Math.round(main.x + (main.w - width) / 2),
          y: Math.round(main.y + (main.h - (Math.round((width * 9) / 16) + header)) / 2),
          w: width,
          h: Math.round((width * 9) / 16) + header,
        };
      }
      ordered.forEach(function place(t, i) {
        map.set(t.id, boxes[i]);
      });
      return map;
    }
    const boxes = gridBoxes(list.length, w, h);
    list.forEach(function place(t, i) {
      map.set(t.id, boxes[i]);
    });
    return map;
  }

  /** In full screen the big tile fills everything and the others float at the top right, where the person left them. */
  private floatingBoxes(big: Tile, list: Tile[], w: number, h: number): Map<string, Box> {
    const map = new Map<string, Box>();
    map.set(big.id, { x: 0, y: 0, w, h });
    const width = w < 640 ? 132 : 232;
    const height = Math.round((width * 9) / 16);
    const saved = this.floats();
    let index = 0;
    for (const tile of list) {
      // In full screen only the people showing a camera or a screen float over the big tile.
      if (tile === big || tile.kind === 'user') {
        continue;
      }
      const mine = saved[tile.id];
      const box = mine
        ? {
            ...mine,
            x: Math.max(0, Math.min(mine.x, w - mine.w)),
            y: Math.max(0, Math.min(mine.y, h - mine.h)),
          }
        : { x: w - width - 14, y: 14 + index * (height + 10), w: width, h: height };
      map.set(tile.id, box);
      index++;
    }
    return map;
  }

  /** A click on a tile enlarges it, or goes back to the grid when it already is the big one. It waits a moment so a double click can go full screen instead. */
  protected clickTile(tile: Tile): void {
    if (this.justDragged) {
      return;
    }
    clearTimeout(this.clickTimer);
    this.clickTimer = setTimeout(this.focusTile.bind(this, tile), 220);
  }

  /** The button of a tile that enlarges it or sends it back to the grid. */
  protected toggleFocus(event: Event, tile: Tile): void {
    event.stopPropagation();
    clearTimeout(this.clickTimer);
    this.focusTile(tile);
  }

  /** Enlarges a tile, or goes back to the grid when it is already the big one. */
  private focusTile(tile: Tile): void {
    this.focusChoice.set(this.featured()?.id === tile.id ? 'none' : tile.id);
  }

  /** True while the stage is in full screen. */
  protected readonly fullscreen = signal(false);
  /** The corners that resize a floating tile. */
  protected readonly corners = ['nw', 'ne', 'sw', 'se'];
  /** Where the person put (or sized) the floating tiles. */
  private readonly floats = signal<Record<string, Box>>({});
  /** True just after a floating tile was moved, so the click that ends the drag does not enlarge it. */
  private justDragged = false;
  /** The floating tile being moved or resized. */
  protected readonly dragId = signal<string | null>(null);
  private drag: {
    id: string;
    mode: string;
    startX: number;
    startY: number;
    box: Box;
    pointer: number;
  } | null = null;

  /** Puts the tile on the whole screen with the others floating over it (or brings it back). Spinly never goes full screen. */
  protected toggleFullscreen(event: Event, tile: Tile): void {
    event.stopPropagation();
    clearTimeout(this.clickTimer);
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (tile.activity === 'spinly') {
      return;
    }
    this.focusChoice.set(tile.id);
    this.stageHost()
      ?.nativeElement.requestFullscreen()
      .catch(function ignore() {
        return undefined;
      });
  }

  /** The browser entered or left full screen. */
  @HostListener('document:fullscreenchange')
  protected onFullscreenChange(): void {
    const on = document.fullscreenElement === this.stageHost()?.nativeElement;
    this.fullscreen.set(on);
    if (!on) {
      this.drag = null;
      this.dragId.set(null);
    }
  }

  /** Starts moving (the body) or resizing (a corner) a floating tile. */
  protected startFloat(event: PointerEvent, id: string, mode: string): void {
    const target = event.target as HTMLElement;
    if (mode === 'move' && target.closest('button, input, a, iframe')) {
      return;
    }
    const box = this.boxes().get(id);
    if (!box) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    this.drag = {
      id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      box: { ...box },
      pointer: event.pointerId,
    };
    this.dragId.set(id);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    (event.currentTarget as HTMLElement)
      .closest('.call-tile')
      ?.setPointerCapture?.(event.pointerId);
  }

  /** Moves or resizes the floating tile while the pointer is down. */
  protected moveFloat(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }
    const { w, h } = this.area();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const start = drag.box;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      this.justDragged = true;
    }
    let box: Box;
    if (drag.mode === 'move') {
      box = { ...start, x: start.x + dx, y: start.y + dy };
    } else {
      const east = drag.mode.endsWith('e');
      const north = drag.mode.startsWith('n');
      const width = Math.round(
        Math.max(120, Math.min(start.w + (east ? dx : -dx), Math.min(w * 0.7, 720))),
      );
      const height = Math.round((width * start.h) / start.w);
      box = {
        x: east ? start.x : start.x + start.w - width,
        y: north ? start.y + start.h - height : start.y,
        w: width,
        h: height,
      };
    }
    box.x = Math.round(Math.max(0, Math.min(box.x, w - box.w)));
    box.y = Math.round(Math.max(0, Math.min(box.y, h - box.h)));
    this.floats.update(function put(all) {
      return { ...all, [drag.id]: box };
    });
  }

  /** The pointer was released: the floating tile stays where it is. */
  protected endFloat(event: PointerEvent): void {
    if (this.drag && event.pointerId === this.drag.pointer) {
      this.drag = null;
      this.dragId.set(null);
      setTimeout(this.clearDragged.bind(this), 250);
    }
  }

  /** The click that ends a drag has passed. */
  private clearDragged(): void {
    this.justDragged = false;
  }

  protected readonly myLevel = computed(
    function (this: VoiceStageComponent) {
      return this.call.levels()[this.auth.user()?.id ?? ''] ?? 0;
    }.bind(this),
  );
  protected readonly roomTitle = computed(
    function (this: VoiceStageComponent) {
      const id = this.call.roomId();
      if (!id) return '';
      const dm = this.social.dmByChannel(id);
      if (dm)
        return this.i18n.t('Call with {name}', {
          name: this.directory.get(dm.userId)?.displayName ?? '…',
        });
      const guild = this.guilds.guildOfChannel(id);
      return (
        guild?.channels.find(function (c) {
          return c.id === id;
        })?.name ?? this.i18n.t('Voice')
      );
    }.bind(this),
  );
  protected readonly subtitle = computed(
    function (this: VoiceStageComponent) {
      const n = this.call.participants().length;
      return this.i18n.t('{n} in the call', { n });
    }.bind(this),
  );
  /** Leaves the page of the call without leaving the call: it goes on in the floating panel. */
  protected minimizeCall(): void {
    void this.router.navigateByUrl(this.ui.lastPage());
  }

  /** What the chip of the encryption says when the pointer is over it. */
  protected encryptionTitle(): string {
    const state = this.call.mediaEncryption();
    if (state === 'active') {
      return this.i18n.t('End-to-end encrypted');
    }
    return this.i18n.t(state === 'failing' ? 'Encryption problem' : 'End-to-end encryption');
  }

  /** The cipher of the media, short: "AES-128-GCM" or "AES-128-CM" (the name the browser gives is long and varies). */
  protected readonly cipherLabel = computed(
    function (this: VoiceStageComponent) {
      const raw = this.call.stats().srtpCipher ?? '';
      const size = /256/.test(raw) ? '256' : '128';
      return raw ? 'AES-' + size + (/GCM/.test(raw) ? '-GCM' : '-CM') : 'AES-128';
    }.bind(this),
  );

  protected readonly tiles = computed(
    function (this: VoiceStageComponent) {
      const me = this.auth.user()?.id;
      // ! The voice levels change 12 times a second: they are read by the template (levelOf, speakingOf), not here, so
      //   the tiles and their layout are not rebuilt for every level.
      const peers = this.call.peers();
      const angles = this.call.angles();
      const out: Tile[] = [];
      for (const p of this.call.participants()) {
        const local = p.userId === me;
        const peer = peers[p.userId];
        const base: Omit<Tile, 'id' | 'kind' | 'stream'> = {
          user: this.directory.get(p.userId),
          local,
          muted: p.muted,
          deafened: p.deafened,
          speaking: false,
          level: 0,
          angle: angles[p.userId] ?? 0,
          rtt: peer?.rttMs ?? null,
          connection: peer?.connection,
          code: peer?.securityCode ?? null,
        };
        const camera = local
          ? p.video
            ? this.call.localCamera()
            : null
          : p.video
            ? (peer?.camera ?? null)
            : null;
        out.push({ ...base, id: p.userId, kind: camera ? 'camera' : 'user', stream: camera });
        const screen = local ? this.call.localScreen() : p.screen ? (peer?.screen ?? null) : null;
        if (screen)
          out.push({
            ...base,
            id: p.userId + ':screen',
            kind: 'screen',
            muted: false,
            deafened: false,
            speaking: false,
            level: 0,
            stream: screen,
          });
      }
      const media = this.call.music();
      if (media?.video) {
        out.push(this.activityTile('video'));
      }
      if (this.spinly.callActivity()) {
        out.push(this.activityTile('spinly'));
      }
      const hidden = this.hidden();
      return hidden.length
        ? out.filter(function shown(tile) {
            return !hidden.includes(tile.id);
          })
        : out;
    }.bind(this),
  );

  /** Whether the person of a tile is speaking (a shared screen or an activity never is). */
  protected speakingOf(t: Tile): boolean {
    return t.kind !== 'screen' && !!t.user && this.call.speaking().has(t.user.id);
  }

  /** The voice level (0 to 1) of the person of a tile. */
  protected levelOf(t: Tile): number {
    return t.user ? (this.call.levels()[t.user.id] ?? 0) : 0;
  }

  /** A tile for an activity of the call (it has no person, no voice and no stream). */
  private activityTile(activity: 'music' | 'video' | 'spinly'): Tile {
    return {
      id: 'activity:' + activity,
      kind: 'activity',
      activity,
      user: undefined,
      local: false,
      muted: false,
      deafened: false,
      speaking: false,
      level: 0,
      angle: 0,
      rtt: null,
      connection: undefined,
      stream: null,
      code: null,
    };
  }

  protected readonly peerCodes = computed(
    function (this: VoiceStageComponent) {
      return Object.values(this.call.peers()).map(
        function (this: VoiceStageComponent, p: PeerView) {
          return {
            id: p.userId,
            user: this.directory.get(p.userId),
            code: p.securityCode,
            sent: p.mediaStats.encrypted,
            received: p.mediaStats.decrypted,
            failed: p.mediaStats.failed,
          };
        }.bind(this),
      );
    }.bind(this),
  );

  /** The choices of the drawer of data (the same ones as in the settings of voice and video). */
  protected readonly voiceModes = VOICE_MODES;
  protected readonly qualityOptions = [
    { id: '480', label: '480p' },
    { id: '720', label: '720p' },
    { id: '1080', label: '1080p' },
  ];
  protected readonly fpsOptions = [
    { id: '15', label: '15' },
    { id: '30', label: '30' },
    { id: '60', label: '60' },
  ];

  protected readonly latencyStats = computed(
    function (this: VoiceStageComponent) {
      const h = this.call.rttHistory();
      if (!h.length) return { min: '—', avg: '—', max: '—' };
      const avg =
        h.reduce(function (a, b) {
          return a + b;
        }, 0) / h.length;
      return {
        min: Math.min(...h).toFixed(1),
        avg: avg.toFixed(1),
        max: Math.max(...h).toFixed(1),
      };
    }.bind(this),
  );
  protected readonly latencyPoints = computed(
    function (this: VoiceStageComponent) {
      const h = this.call.rttHistory().slice(-40);
      if (h.length < 2) return [] as [number, number][];
      const min = Math.min(...h);
      const max = Math.max(...h, min + 1);
      return h.map(function (v, i): [number, number] {
        return [(i / (h.length - 1)) * 200, 62 - ((v - min) / (max - min)) * 52];
      });
    }.bind(this),
  );
  protected readonly latencyLine = computed(
    function (this: VoiceStageComponent) {
      return this.smooth(this.latencyPoints());
    }.bind(this),
  );
  protected readonly latencyArea = computed(
    function (this: VoiceStageComponent) {
      const pts = this.latencyPoints();
      return pts.length ? `${this.smooth(pts)} L200,70 L0,70 Z` : '';
    }.bind(this),
  );

  protected readonly media = computed(
    function (this: VoiceStageComponent) {
      const id = this.call.roomId();
      return id
        ? this.messages
            .state(id)
            .messages()
            .flatMap(function (m) {
              return m.attachments;
            })
            .filter(function (a) {
              return a.kind === 'image' && !a.sticker;
            })
            .reverse()
        : [];
    }.bind(this),
  );

  /** The class of the font a person chose for their name. */
  protected nameClass(u: Tile['user']): string {
    return fontClassOf(u?.nameFont);
  }

  /** The level of a signal in decibels. */
  protected dbfs(level: number): string {
    return decibels(level);
  }

  /** A smooth line through some points, for the graph of the latency. */
  private smooth(pts: [number, number][]): string {
    if (pts.length < 2) return '';
    let d = `M${pts[0]![0]},${pts[0]![1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      d += ` Q${x0},${y0} ${(x0 + x1) / 2},${(y0 + y1) / 2}`;
    }
    const last = pts[pts.length - 1]!;
    return d + ` T${last[0]},${last[1]}`;
  }

  /** Turns noise suppression, echo cancellation or automatic gain on or off. */
  protected setDsp(kind: 'noise' | 'echo' | 'agc', value: boolean): void {
    if (kind === 'noise') this.settings.noiseSuppression.set(value);
    if (kind === 'echo') this.settings.echoCancellation.set(value);
    if (kind === 'agc') this.settings.autoGain.set(value);
    void this.call.changeInputDevice();
  }
}
