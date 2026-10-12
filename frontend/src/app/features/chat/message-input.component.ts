/**
 * src/app/features/chat/message-input.component.ts
 * Composer: formatted and colored text, emoji, GIFs, stickers, attachments, voice notes and the Spinly menu.
 */
import { SpinlyService } from '../../core/services/spinly.service';
import { GradientControlsComponent } from '../../shared/components/gradient-controls.component';
import { sortedStops, type GradientParts } from '../../shared/util/gradient';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { DirectoryService } from '../../core/services/directory.service';
import { GifService, type GifResult } from '../../core/services/gif.service';
import { SoundService } from '../../core/services/sound.service';
import type { Sticker } from '../../core/services/sticker.store';
import { ToastService } from '../../core/services/toast.service';
import { ExpressionPickerComponent } from '../../shared/components/expression-picker.component';
import { SpinlyLogoComponent } from '../../shared/components/spinly-logo.component';
import { ColorPickerComponent } from '../../shared/components/color-picker.component';
import { IconComponent } from '../../shared/components/icon.component';
import { NameColorDirective } from '../../shared/util/name-color.directive';
import { UserFontDirective } from '../../shared/util/user-font.directive';
import { NameFxDirective } from '../../shared/util/name-fx.directive';
import { RichTextComponent } from '../../shared/components/rich-text.component';
import { formatBytes, formatDuration } from '../../shared/pipes/timestamp.pipe';
import { describeError } from '../../shared/util/errors';
import {
  firstLink,
  shrinkImage,
  videoEmbed,
  type LinkPreview,
} from '../../shared/util/link-preview';
import {
  autoFenceCode,
  colorOpen,
  GRADIENT_CLOSE,
  gradientOpen,
  parseRichText,
  plainText,
  RAINBOW,
} from '../../shared/util/rich-text';
import { ApiService } from '../../core/services/api.service';
import { UiService } from '../../core/services/ui.service';
import { MessageStore, type OutgoingFile, type ViewMessage } from '../../store/message.store';
import { PresetShareComponent } from './preset-share.component';

const MAX_FILE = 10 * 1024 * 1024;
const COLORS = ['#ff5d6c', '#4ade80', '#38bdf8'];
const GRADIENTS = [
  { name: 'Sunset', colors: ['#ff512f', '#f09819'] },
  { name: 'Ocean', colors: ['#00c6ff', '#7f5af0'] },
  { name: 'Rainbow', colors: RAINBOW },
];

/** Composer: formatted/coloured text, emoji · GIF · sticker picker, files, voice notes and replies. */
@Component({
  selector: 'app-message-input',
  standalone: true,
  imports: [
    PresetShareComponent,
    ColorPickerComponent,
    NameColorDirective,
    UserFontDirective,
    NameFxDirective,
    SpinlyLogoComponent,
    IconComponent,
    GradientControlsComponent,
    ExpressionPickerComponent,
    RichTextComponent,
    TranslatePipe,
  ],
  host: { class: 'block shrink-0' },
  template: `
    <div class="relative px-3 pb-2 pt-1">
      @if (replyingTo(); as r) {
        <div
          class="anim-fade-up mb-2 flex items-center gap-2 rounded-ui border-l-2 border-accent bg-white/5 px-3 py-1.5 text-xs"
        >
          <app-icon name="reply" [size]="13" class="text-accent" />
          <span class="text-muted">{{ 'Replying to' | t }}</span>
          <b
            [appNameColor]="directory.users().get(r.senderId)?.profileColor"
            [appUserFont]="directory.users().get(r.senderId)?.nameFont"
            [nameFx]="directory.users().get(r.senderId)?.nameFx"
            >{{ directory.users().get(r.senderId)?.displayName }}</b
          >
          <span class="flex-1 truncate text-muted">{{
            r.text ? plain(r.text) : ('Attachment' | t)
          }}</span>
          <button
            class="btn btn-icon btn-sm btn-ghost !h-6 !w-6"
            type="button"
            (click)="cancelReply.emit()"
            [attr.aria-label]="'Cancel' | t"
          >
            <app-icon name="x" [size]="13" />
          </button>
        </div>
      }

      @if (staged().length) {
        <div class="mb-2 flex flex-wrap gap-2">
          @for (f of staged(); track $index) {
            <div
              class="anim-pop flex items-center gap-2 rounded-ui border border-white/10 bg-white/5 py-1.5 pl-2.5 pr-1.5 text-xs"
            >
              <app-icon
                [name]="
                  f.mime.startsWith('image/')
                    ? 'image'
                    : f.mime.startsWith('audio/')
                      ? 'mic'
                      : 'file'
                "
                [size]="14"
                class="text-accent"
              />
              <span class="max-w-40 truncate font-semibold">{{ f.name }}</span
              ><span class="text-dim">{{ bytes(f.data.size) }}</span>
              @if (f.mime.startsWith('audio/') || f.mime.startsWith('video/')) {
                <button
                  class="btn btn-sm !h-6 gap-1 !px-2"
                  [class.btn-active]="f.soundboard"
                  type="button"
                  [attr.aria-pressed]="!!f.soundboard"
                  [attr.title]="'Let the others add it to their soundboard' | t"
                  (click)="toggleSoundboard($index)"
                >
                  <app-icon name="waveform" [size]="12" /> {{ 'For the soundboard' | t }}
                </button>
              }
              <button
                class="btn btn-icon btn-sm btn-ghost !h-6 !w-6"
                type="button"
                (click)="unstage($index)"
                [attr.aria-label]="'Remove' | t"
              >
                <app-icon name="x" [size]="12" />
              </button>
            </div>
          }
        </div>
      }

      @if (codeBlock(); as code) {
        <div
          class="anim-fade-up mb-2 overflow-hidden rounded-ui border border-accent/30 bg-ink-800"
        >
          <div
            class="flex items-center gap-2 border-b border-white/8 bg-accent/10 px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-accent"
          >
            <app-icon name="code" [size]="13" />
            <span class="flex-1">{{ 'It will be sent as code' | t }}</span>
            <button
              type="button"
              class="btn btn-sm btn-ghost normal-case"
              (click)="codeOff.set(true)"
            >
              {{ 'Send as plain text' | t }}
            </button>
          </div>
          <div class="max-h-52 overflow-y-auto p-2.5 text-sm">
            <app-rich-text [segments]="codeSegments(code)" />
          </div>
        </div>
      } @else if (codeFormatted() && codeOff()) {
        <div class="anim-fade-up mb-2 flex items-center gap-2 text-xs text-muted">
          <app-icon name="code" [size]="13" />
          <span class="flex-1">{{
            'This looks like code. It will be sent as plain text.' | t
          }}</span>
          <button type="button" class="btn btn-sm btn-ghost" (click)="codeOff.set(false)">
            {{ 'Send as code' | t }}
          </button>
        </div>
      }

      @if (firstUrl(); as url) {
        <div class="anim-fade-up mb-2 overflow-hidden rounded-ui border border-white/10 bg-ink-800">
          @switch (linkPreview().phase) {
            @case ('ready') {
              <div class="flex">
                @if (linkPreview().card?.image) {
                  <img
                    [src]="linkPreview().card!.image"
                    alt=""
                    class="h-auto w-20 shrink-0 object-cover"
                  />
                }
                <div class="min-w-0 flex-1 p-3">
                  <div class="flex items-center gap-1 text-[0.6875rem] text-muted">
                    <app-icon name="link" [size]="11" />
                    <span class="truncate">{{ linkPreview().card!.site }}</span>
                  </div>
                  <div class="line-clamp-1 text-sm font-semibold">
                    {{ linkPreview().card!.title }}
                  </div>
                  <div class="line-clamp-1 text-xs text-muted">
                    {{ linkPreview().card!.description }}
                  </div>
                  <div class="mt-1 text-[0.6875rem] text-accent">
                    {{ 'The preview will be sent with your message.' | t }}
                  </div>
                </div>
                <button
                  class="btn btn-icon btn-sm btn-ghost m-1.5 tip"
                  type="button"
                  [attr.data-tip]="'Send without preview' | t"
                  (click)="dismissPreview()"
                >
                  <app-icon name="x" [size]="14" />
                </button>
              </div>
            }
            @case ('loading') {
              <div class="flex items-center gap-2 px-3 py-2.5 text-xs text-muted">
                <span
                  class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                ></span>
                {{ 'Getting the preview…' | t }}
              </div>
            }
            @case ('error') {
              <div class="flex items-center justify-between gap-2 px-3 py-2.5 text-xs text-muted">
                <span>{{ 'No preview is available for this link.' | t }}</span>
                <button
                  class="btn btn-icon btn-sm btn-ghost !h-6 !w-6"
                  type="button"
                  (click)="linkPreview.set({ phase: 'hidden', url, card: null })"
                  [attr.aria-label]="'Dismiss' | t"
                >
                  <app-icon name="x" [size]="12" />
                </button>
              </div>
            }
            @case ('hidden') {}
            @default {
              <div class="flex items-center gap-2.5 py-1 pl-3 pr-1.5">
                <app-icon name="link" [size]="14" class="shrink-0 text-accent" />
                <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ host(url) }}</span>
                <button
                  class="btn btn-sm btn-ghost tip"
                  type="button"
                  [attr.data-tip]="
                    'Getting a preview makes the server open this link once. Nothing is sent unless you add it.'
                      | t
                  "
                  (click)="requestPreview(url)"
                >
                  {{ 'Add preview' | t }}
                </button>
                <button
                  class="btn btn-icon btn-sm btn-ghost !h-7 !w-7"
                  type="button"
                  (click)="dismissPreview()"
                  [attr.aria-label]="'Dismiss' | t"
                >
                  <app-icon name="x" [size]="12" />
                </button>
              </div>
            }
          }
        </div>
      }

      @if (previewSegments().length && formatted() && !codeBlock()) {
        <div
          class="anim-fade-up mb-2 rounded-ui border border-white/8 bg-black/20 px-3 py-2 text-sm"
        >
          <span class="label mr-2">{{ 'Preview' | t }}</span
          ><span class="whitespace-pre-wrap break-words"
            ><app-rich-text [segments]="previewSegments()"
          /></span>
        </div>
      }

      @if (toolbar() && !recording()) {
        <div
          class="anim-fade-up mb-1.5 flex flex-wrap items-center gap-1 rounded-ui border border-white/10 bg-ink-800 p-1.5"
        >
          <button
            class="btn btn-icon btn-sm btn-ghost tip"
            [attr.data-tip]="('Bold' | t) + ' · Ctrl+B'"
            type="button"
            (mousedown)="$event.preventDefault()"
            (click)="wrap('**', '**')"
          >
            <app-icon name="bold" [size]="15" />
          </button>
          <button
            class="btn btn-icon btn-sm btn-ghost tip"
            [attr.data-tip]="('Italic' | t) + ' · Ctrl+I'"
            type="button"
            (mousedown)="$event.preventDefault()"
            (click)="wrap('_', '_')"
          >
            <app-icon name="italic" [size]="15" />
          </button>
          <button
            class="btn btn-icon btn-sm btn-ghost tip"
            [attr.data-tip]="('Strikethrough' | t) + ' · Ctrl+Shift+X'"
            type="button"
            (mousedown)="$event.preventDefault()"
            (click)="wrap('~~', '~~')"
          >
            <app-icon name="strike" [size]="15" />
          </button>
          <button
            class="btn btn-icon btn-sm btn-ghost tip"
            [attr.data-tip]="'Code' | t"
            type="button"
            (mousedown)="$event.preventDefault()"
            (click)="wrap('\`', '\`')"
          >
            <app-icon name="code" [size]="15" />
          </button>
          <span class="mx-1 h-5 w-px bg-white/10"></span>
          @for (c of colors; track c) {
            <button
              class="h-5 w-5 dot rounded-full ring-offset-1 ring-offset-ink-850 hover:scale-110 hover:ring-1"
              [style.background]="c"
              [style.--tw-ring-color]="c"
              type="button"
              (mousedown)="$event.preventDefault()"
              (click)="color(c)"
              [attr.aria-label]="c"
            ></button>
          }
          <!-- any color: it is chosen in the picker and put on the selection when the picker closes -->
          <app-color-picker
            [value]="customColor()"
            [size]="22"
            [rainbow]="true"
            shape="round"
            label="Any color"
            (valueChange)="customColor.set($event); customTouched.set(true)"
            (closed)="applyCustomColor()"
          />
          <span class="mx-1 h-5 w-px bg-white/10"></span>
          <button
            type="button"
            class="btn btn-sm btn-ghost gap-1.5"
            [class.btn-active]="gradientOpen()"
            (mousedown)="$event.preventDefault()"
            (click)="gradientOpen.set(!gradientOpen())"
          >
            <span
              class="h-3.5 w-6 rounded-full ring-1 ring-white/30"
              [style.background]="gradientCss()"
            ></span>
            {{ 'Gradient' | t }}
          </button>
        </div>
        @if (gradientOpen()) {
          <div
            class="anim-fade-up mb-1.5 flex flex-wrap items-center gap-2 rounded-ui border border-white/10 bg-ink-800 px-2.5 py-2"
          >
            @for (g of gradients; track g.name) {
              <button
                class="h-5 w-8 dot rounded-full ring-1 ring-white/20 hover:scale-105"
                [style.background]="'linear-gradient(90deg,' + g.colors.join(',') + ')'"
                type="button"
                (mousedown)="$event.preventDefault()"
                (click)="gradient(g.colors); gradientOpen.set(false)"
                [attr.title]="g.name | t"
                [attr.aria-label]="g.name | t"
              ></button>
            }
            <span class="mx-0.5 h-5 w-px bg-white/10"></span>
            <div class="min-w-[11rem] flex-1">
              <app-gradient-controls
                [compact]="true"
                [parts]="gradientParts()"
                [showAngle]="false"
                [showPosition]="false"
                (changed)="gradientParts.set({ ...gradientParts(), ...$event })"
              />
            </div>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              (mousedown)="$event.preventDefault()"
              (click)="applyGradient()"
            >
              {{ 'Apply' | t }}
            </button>
          </div>
        }
      }

      @if (recording()) {
        <div class="anim-fade-up panel flex h-14 items-center gap-3 px-3">
          <span class="h-2.5 w-2.5 rounded-full bg-red-500"></span>
          <span class="font-mono text-sm font-bold">{{ recTime() }}</span>
          <div class="flex h-8 flex-1 items-center gap-[2px]">
            @for (v of liveBars(); track $index) {
              <span
                class="w-[3px] flex-1 rounded-full bg-accent transition-[height] duration-100"
                [style.height.%]="10 + v * 90"
              ></span>
            }
          </div>
          <button
            class="btn btn-icon btn-sm"
            type="button"
            (click)="stopRecording(false)"
            [attr.aria-label]="'Cancel' | t"
          >
            <app-icon name="trash" [size]="15" />
          </button>
          <button
            class="btn btn-icon btn-primary"
            type="button"
            (click)="stopRecording(true)"
            [attr.aria-label]="'Send' | t"
          >
            <app-icon name="send" [size]="16" />
          </button>
        </div>
      } @else {
        <div class="panel flex items-end gap-1 p-1.5">
          <input
            #file
            type="file"
            multiple
            class="hidden"
            (change)="onFiles($any($event.target).files); $any($event.target).value = ''"
          />
          <input
            #photo
            type="file"
            multiple
            accept="image/*,video/*"
            class="hidden"
            (change)="onFiles($any($event.target).files); $any($event.target).value = ''"
          />
          <button
            class="btn btn-icon btn-ghost tip"
            [class.btn-active]="toolbar()"
            [attr.data-tip]="'Text style & colors' | t"
            type="button"
            (mousedown)="$event.preventDefault()"
            (click)="toggleMenu('toolbar')"
          >
            <app-icon name="type" />
          </button>
          <textarea
            #box
            class="selectable max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-snug outline-none placeholder:text-dim"
            rows="1"
            [placeholder]="placeholder() | t"
            [value]="text()"
            (input)="onInput($any($event.target))"
            (keydown)="onKey($event)"
            (paste)="onPaste($event)"
            maxlength="8000"
            aria-label="Message"
          ></textarea>
          <div class="relative">
            <button
              class="btn btn-icon btn-ghost tip"
              [class.btn-active]="pickerOpen()"
              [attr.data-tip]="'Emoji, GIFs & stickers' | t"
              type="button"
              (mousedown)="$event.stopPropagation()"
              (click)="toggleMenu('picker')"
            >
              <app-icon name="smile" />
            </button>
            @if (pickerOpen()) {
              <div
                class="absolute bottom-12 right-0 z-30 max-md:fixed max-md:inset-x-3 max-md:bottom-[5.5rem]"
              >
                <app-expression-picker
                  (emoji)="insert($event)"
                  (gif)="sendGif($event)"
                  (sticker)="sendSticker($event)"
                  (closed)="pickerOpen.set(false)"
                />
              </div>
            }
          </div>
          <div class="relative">
            <button
              class="btn btn-icon btn-ghost tip"
              [class.btn-active]="plusOpen()"
              [attr.data-tip]="'More' | t"
              type="button"
              (mousedown)="$event.stopPropagation()"
              (click)="toggleMenu('plus')"
            >
              <app-icon name="plus" />
            </button>
            @if (plusOpen()) {
              <div
                class="anim-pop absolute bottom-12 right-0 z-30 w-72 origin-bottom-right overflow-hidden rounded-ui-lg border border-white/10 bg-ink-800 shadow-2xl"
                (mousedown)="$event.stopPropagation()"
              >
                <div
                  class="px-4 pb-1 pt-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-dim"
                >
                  {{ 'Add to your message' | t }}
                </div>
                <div class="grid grid-cols-3 gap-1.5 px-2.5 pb-1 pt-1.5">
                  <button
                    type="button"
                    class="sb-tile anim-fade-up"
                    style="--d: 0ms"
                    (click)="plusOpen.set(false); photo.click()"
                  >
                    <span class="menu-icon !h-10 !w-10 bg-sky/15 text-sky"
                      ><app-icon name="image" [size]="19"
                    /></span>
                    <span class="text-[0.6875rem] font-semibold">{{ 'Photo or video' | t }}</span>
                  </button>
                  <button
                    type="button"
                    class="sb-tile anim-fade-up"
                    style="--d: 30ms"
                    (click)="plusOpen.set(false); file.click()"
                  >
                    <span class="menu-icon !h-10 !w-10 bg-violet/15 text-violet"
                      ><app-icon name="paperclip" [size]="19"
                    /></span>
                    <span class="text-[0.6875rem] font-semibold">{{ 'File' | t }}</span>
                  </button>
                  <button
                    type="button"
                    class="sb-tile anim-fade-up"
                    style="--d: 60ms"
                    (click)="plusOpen.set(false); startRecording()"
                  >
                    <span class="menu-icon !h-10 !w-10 bg-coral/15 text-coral"
                      ><app-icon name="mic" [size]="19"
                    /></span>
                    <span class="text-[0.6875rem] font-semibold">{{ 'Voice note' | t }}</span>
                  </button>
                </div>
                <p class="px-4 pb-2 pt-1 text-[0.6875rem] leading-snug text-dim">
                  {{
                    'Encrypted before they leave your device. Up to 10 MB each. You can also paste or drop them in the chat.'
                      | t
                  }}
                </p>
                <div class="mx-3 border-t border-white/6"></div>
                <div class="p-1.5">
                  <button
                    type="button"
                    class="menu-card anim-fade-up"
                    style="--d: 90ms"
                    (click)="plusOpen.set(false); openSpinly()"
                  >
                    <span class="menu-icon !bg-white/5"><app-spinly-logo [size]="28" /></span>
                    <span class="min-w-0 flex-1"
                      ><b class="block text-sm">Spinly</b
                      ><span class="block text-xs text-muted">{{
                        'A wheel or tournament everybody can run' | t
                      }}</span></span
                    >
                  </button>
                  <button
                    type="button"
                    class="menu-card anim-fade-up"
                    style="--d: 120ms"
                    (click)="plusOpen.set(false); presetShareOpen.set(true)"
                  >
                    <span class="menu-icon bg-violet/15 text-violet"
                      ><app-icon name="palette" [size]="18"
                    /></span>
                    <span class="min-w-0 flex-1"
                      ><b class="block text-sm">{{ 'Share a preset' | t }}</b
                      ><span class="block text-xs text-muted">{{
                        'Your profile or the look of the app, to import with one button' | t
                      }}</span></span
                    >
                  </button>
                </div>
              </div>
            }
          </div>
          <!-- only on a phone (on a computer Enter sends); always there, so that typing never moves what is beside it -->
          <button
            class="btn btn-icon btn-primary transition-[opacity,transform] duration-200 sm:!hidden"
            [class.pointer-events-none]="!canSend()"
            [class.scale-75]="!canSend()"
            [class.opacity-0]="!canSend()"
            type="button"
            (click)="send()"
            [disabled]="sending() || !canSend()"
            [attr.tabindex]="canSend() ? 0 : -1"
            [attr.aria-hidden]="!canSend()"
            [attr.aria-label]="'Send' | t"
          >
            <app-icon name="send" [size]="17" />
          </button>
        </div>
      }
      <div
        class="mt-1 flex items-center justify-between px-1 text-[0.625rem] text-dim max-sm:hidden"
      >
        <span>{{ 'Enter to send · Shift+Enter for a new line' | t }}</span>
      </div>
    </div>
    @if (presetShareOpen()) {
      <app-preset-share [channelId]="channelId()" (closed)="presetShareOpen.set(false)" />
    }
  `,
})
export class MessageInputComponent implements OnDestroy {
  protected readonly ui = inject(UiService);
  readonly channelId = input.required<string>();
  readonly placeholder = input('Type a message…');
  readonly replyingTo = input<ViewMessage | null>(null);
  readonly cancelReply = output<void>();
  readonly sent = output<void>();
  /** Files dropped on the surrounding panel get pushed in here by the parent. */
  readonly addFiles = function (this: MessageInputComponent, files: FileList | File[]) {
    return this.onFiles(files);
  }.bind(this);

  protected readonly store = inject(MessageStore);
  protected readonly directory = inject(DirectoryService);
  private readonly toast = inject(ToastService);
  private readonly sound = inject(SoundService);
  private readonly gifs = inject(GifService);
  private readonly i18n = inject(I18nService);
  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');

  protected readonly colors = COLORS;
  /** The color chosen in the picker for the selected text. */
  protected readonly customColor = signal('#ff5d6c');
  protected readonly customTouched = signal(false);
  private readonly spinly = inject(SpinlyService);

  /** Opens the window to make a wheel or a tournament that is sent to this conversation. */
  protected openSpinly(): void {
    this.spinly.composeForChat(this.channelId());
  }
  protected readonly plusOpen = signal(false);
  /** Whether the window to send a preset is open. */
  protected readonly presetShareOpen = signal(false);

  @HostListener('document:mousedown') closeMenus() {
    this.plusOpen.set(false);
  }
  protected readonly gradients = GRADIENTS;
  /** Whether the panel to make a gradient is open. */
  protected readonly gradientOpen = signal(false);
  /** The gradient that is being made (two to five colors; their order is what counts). */
  protected readonly gradientParts = signal<GradientParts>({
    angle: 90,
    stops: [
      { color: '#ff5d6c', pos: 0 },
      { color: '#818cf8', pos: 100 },
    ],
  });
  /** The gradient being made, as the background of its button. */
  protected readonly gradientCss = computed(this.buildGradientCss.bind(this));
  private readonly api = inject(ApiService);
  protected readonly text = signal('');
  protected readonly staged = signal<OutgoingFile[]>([]);
  /** First https link of the text (its preview is offered, but never requested by itself). */
  protected readonly firstUrl = computed(
    function (this: MessageInputComponent) {
      return firstLink(this.text());
    }.bind(this),
  );
  protected readonly linkPreview = signal<{
    phase: 'idle' | 'loading' | 'ready' | 'error' | 'hidden';
    url: string;
    card: LinkPreview | null;
  }>({ phase: 'idle', url: '', card: null });
  protected readonly sending = signal(false);
  protected readonly pickerOpen = signal(false);
  protected readonly toolbar = signal(false);

  /** Opens one of the menus of the box (text style, emoji, "+") or closes it; only one is open at a time. */
  protected toggleMenu(which: 'toolbar' | 'picker' | 'plus'): void {
    const wasOpen =
      which === 'toolbar'
        ? this.toolbar()
        : which === 'picker'
          ? this.pickerOpen()
          : this.plusOpen();
    this.toolbar.set(false);
    this.pickerOpen.set(false);
    this.plusOpen.set(false);
    if (wasOpen) return;
    if (which === 'toolbar') this.toolbar.set(true);
    else if (which === 'picker') this.pickerOpen.set(true);
    else this.plusOpen.set(true);
  }
  /** True when the person chose to send what looks like code as plain text. */
  protected readonly codeOff = signal(false);
  /** The text as a code block when it looks like code (null otherwise). */
  protected readonly codeFormatted = computed(this.detectCode.bind(this));
  /** The code block to preview: only while the person has not opted out. */
  protected readonly codeBlock = computed(this.pickCodeBlock.bind(this));
  protected readonly recording = signal(false);
  protected readonly recMs = signal(0);
  protected readonly liveBars = signal<number[]>(Array(32).fill(0));
  protected readonly recTime = computed(
    function (this: MessageInputComponent) {
      return formatDuration(this.recMs());
    }.bind(this),
  );
  protected readonly canSend = computed(
    function (this: MessageInputComponent) {
      return !!this.text().trim() || this.staged().length > 0;
    }.bind(this),
  );
  protected readonly bytes = formatBytes;
  protected readonly plain = plainText;
  protected readonly previewSegments = computed(
    function (this: MessageInputComponent) {
      return parseRichText(this.text());
    }.bind(this),
  );
  protected readonly formatted = computed(
    function (this: MessageInputComponent) {
      return this.previewSegments().some(function (s) {
        return s.type !== 'text' && s.type !== 'link';
      });
    }.bind(this),
  );

  private lastTyping = 0;
  private recorder: MediaRecorder | null = null;
  private recStream: MediaStream | null = null;
  private recCtx: AudioContext | null = null;
  private recTimer: ReturnType<typeof setInterval> | undefined;
  private recWave: number[] = [];
  private recStart = 0;

  constructor() {
    // The soundboard sends sounds to the chat that is open.
    effect(
      function announce(this: MessageInputComponent) {
        const id = this.channelId();
        untracked(this.ui.chatChannelId.set.bind(this.ui.chatChannelId, id));
      }.bind(this),
    );
    inject(DestroyRef).onDestroy(this.ui.chatChannelId.set.bind(this.ui.chatChannelId, null));
    // Switching conversations keeps the draft per channel.
    effect(
      function (this: MessageInputComponent) {
        const id = this.channelId();
        untracked(
          function (this: MessageInputComponent) {
            this.text.set(sessionStorage.getItem('draft.' + id) ?? '');
            this.staged.set([]);
            queueMicrotask(
              function (this: MessageInputComponent) {
                return this.resize();
              }.bind(this),
            );
          }.bind(this),
        );
      }.bind(this),
    );
    effect(
      function (this: MessageInputComponent) {
        if (this.replyingTo())
          untracked(
            function (this: MessageInputComponent) {
              return this.box()?.nativeElement.focus();
            }.bind(this),
          );
      }.bind(this),
    );
    effect(
      function (this: MessageInputComponent) {
        const current = this.firstUrl();
        untracked(
          function (this: MessageInputComponent) {
            const v = this.linkPreview();
            if (v.phase !== 'idle' && (!current || v.url !== current))
              this.linkPreview.set({ phase: 'idle', url: '', card: null });
          }.bind(this),
        );
      }.bind(this),
    );
    // Every time the text changes (also when sending and emptying the box) the height is recalculated once the new value is drawn.
    effect(
      function (this: MessageInputComponent) {
        this.text();
        requestAnimationFrame(this.resize.bind(this));
      }.bind(this),
    );
  }

  /**
   * The text of the box changed: it is saved in the draft and in the history of undo, and the box grows with it.
   */
  protected onInput(el: HTMLTextAreaElement): void {
    this.text.set(el.value);
    this.recordHistory(false);
    sessionStorage.setItem('draft.' + this.channelId(), el.value);
    this.resize();
    const now = Date.now();
    if (el.value && now - this.lastTyping > 2500) {
      this.lastTyping = now;
      this.store.sendTyping(this.channelId());
    }
  }

  /** Makes the box as tall as its text, up to a limit. */
  private resize(): void {
    const el = this.box()?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  /**
   * Keys of the box: Enter sends, Control+Z undoes and Control+Y redoes (the browser cannot undo what the app writes by itself), Control+B / Control+I / Control+Shift+X make bold, italic and strikethrough.
   */
  protected onKey(event: KeyboardEvent): void {
    // Control+Z undoes and Control+Y (or Control+Shift+Z) redoes, also after formatting or emoji changes.
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const tecla = event.key.toLowerCase();
      if (tecla === 'z' && !event.shiftKey) {
        event.preventDefault();
        this.undo();
        return;
      }
      if (tecla === 'y' || (tecla === 'z' && event.shiftKey)) {
        event.preventDefault();
        this.redo();
        return;
      }
      // Control+B bold, Control+I italic, Control+Shift+X strikethrough (the same keys as Slack and Discord).
      if (tecla === 'b' && !event.shiftKey) {
        event.preventDefault();
        this.wrap('**', '**');
        return;
      }
      if (tecla === 'i' && !event.shiftKey) {
        event.preventDefault();
        this.wrap('_', '_');
        return;
      }
      if (tecla === 'x' && event.shiftKey) {
        event.preventDefault();
        this.wrap('~~', '~~');
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  // ---- formatting helpers --------------------------------------------------------------------

  /** Wraps the current selection (or drops the markers around the caret). */
  protected wrap(open: string, close: string): void {
    const el = this.box()?.nativeElement;
    if (!el) return;
    const value = this.text();
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const nuevo = value.slice(0, start) + open + selected + close + value.slice(end);
    // With nothing selected the caret stays between the marks, so typing goes straight into that format.
    const caret = selected
      ? start + open.length + selected.length + close.length
      : start + open.length;
    this.applyText(nuevo, caret, true);
  }

  /**
   * Changes the text of the box from the app (format, emoji, undo...) by setting the value directly on the
   * textarea before placing the caret: that way the caret stays where it belongs and does not jump to the end when redrawn.
   */
  private applyText(texto: string, caret: number, guardar: boolean): void {
    const el = this.box()?.nativeElement;
    if (guardar) this.recordHistory(true);
    this.text.set(texto);
    sessionStorage.setItem('draft.' + this.channelId(), texto);
    if (el) {
      el.value = texto;
      el.focus();
      el.selectionStart = el.selectionEnd = caret;
    }
    this.resize();
    if (guardar) this.recordHistory(true);
  }

  // ---- undo / redo ------------------------------------------------------------------------

  private history: { texto: string; caret: number }[] = [{ texto: '', caret: 0 }];
  private historyIndex = 0;
  private lastRecorded = 0;

  /** Saves the current text in the history. While typing, changes that are close in time are grouped. */
  private recordHistory(force: boolean): void {
    const el = this.box()?.nativeElement;
    const entry = { texto: this.text(), caret: el?.selectionStart ?? this.text().length };
    const now = Date.now();
    if (entry.texto === this.history[this.historyIndex]?.texto) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    if (!force && now - this.lastRecorded < 600 && this.historyIndex > 0)
      this.history[this.historyIndex] = entry;
    else {
      this.history.push(entry);
      this.historyIndex = this.history.length - 1;
    }
    this.lastRecorded = now;
    if (this.history.length > 200) {
      this.history.shift();
      this.historyIndex = this.history.length - 1;
    }
  }

  /** Goes one step back in the history of the text. */
  protected undo(): void {
    this.recordHistory(false);
    if (this.historyIndex === 0) return;
    this.historyIndex--;
    const e = this.history[this.historyIndex]!;
    this.applyText(e.texto, e.caret, false);
  }

  /** Goes one step forward in the history of the text. */
  protected redo(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    const e = this.history[this.historyIndex]!;
    this.applyText(e.texto, e.caret, false);
  }

  /** The picker closed: a color that was chosen in it goes on the selected text. */
  protected applyCustomColor(): void {
    if (this.customTouched()) {
      this.customTouched.set(false);
      this.color(this.customColor());
    }
  }

  /** Puts the chosen color on the selected text. */
  protected color(hex: string): void {
    this.wrap(colorOpen(hex, this.i18n.lang()), '[/c]');
  }

  /** The colors of the gradient being made, side by side, for the button. */
  private buildGradientCss(): string {
    return (
      'linear-gradient(90deg,' +
      sortedStops(this.gradientParts().stops)
        .map(function color(stop) {
          return stop.color;
        })
        .join(',') +
      ')'
    );
  }

  /** Puts the gradient that was made on the selected text. */
  protected applyGradient(): void {
    this.gradient(
      sortedStops(this.gradientParts().stops).map(function color(stop) {
        return stop.color;
      }),
    );
    this.gradientOpen.set(false);
  }

  /** Puts a gradient of colors on the selected text. */
  protected gradient(colors: string[]): void {
    this.wrap(gradientOpen(colors, this.i18n.lang()), GRADIENT_CLOSE);
  }

  /** Inserts an emoji where the caret is. */
  protected insert(emoji: string): void {
    const el = this.box()?.nativeElement;
    const value = this.text();
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    this.applyText(value.slice(0, start) + emoji + value.slice(end), start + emoji.length, true);
  }

  // ---- stickers & GIFs -----------------------------------------------------------------------

  protected async sendSticker(sticker: Sticker): Promise<void> {
    this.pickerOpen.set(false);
    await this.sendDirect({
      data: sticker.blob,
      name: 'sticker.webp',
      mime: sticker.blob.type || 'image/webp',
      sticker: true,
      move: sticker.move,
    });
  }

  /**
   * ! Sends a GIF at once: it is downloaded and sent as an encrypted attachment, so the GIF service never learns who got it.
   */
  protected async sendGif(gif: GifResult): Promise<void> {
    this.pickerOpen.set(false);
    try {
      const blob = await this.gifs.download(gif.url);
      await this.sendDirect({
        data: blob,
        name: (gif.title || 'animation').slice(0, 40) + '.gif',
        mime: blob.type || 'image/gif',
        gif: true,
      });
    } catch (error) {
      this.toast.error(this.i18n.t('Could not send the GIF'), describeError(error));
    }
  }

  /** Sends a file that is already chosen (a GIF or a voice note) without going through the box. */
  private async sendDirect(file: OutgoingFile): Promise<void> {
    try {
      await this.store.send(this.channelId(), {
        text: '',
        files: [file],
        replyTo: this.replyingTo()?.id,
      });
      this.cancelReply.emit();
      this.sent.emit();
    } catch (error) {
      this.toast.error(this.i18n.t('Message not sent'), describeError(error));
    }
  }

  // ---- files ---------------------------------------------------------------------------------

  protected onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length) {
      event.preventDefault();
      this.onFiles(files);
    }
  }

  /** Checks the files chosen or dropped (size limit) and keeps them to be sent with the message. */
  protected onFiles(list: FileList | File[] | null): void {
    for (const file of Array.from(list ?? [])) {
      if (file.size > MAX_FILE) {
        this.toast.error(this.i18n.t('File too large'), `${file.name} > ${formatBytes(MAX_FILE)}`);
        continue;
      }
      this.staged.update(function (s) {
        return [
          ...s,
          {
            data: file,
            name: file.name || 'pasted-file',
            mime: file.type || 'application/octet-stream',
          },
        ];
      });
    }
  }

  /** Marks a staged audio or video as offered for the soundboard of the people who receive it (or takes the mark off). */
  protected toggleSoundboard(index: number): void {
    this.staged.update(function mark(files) {
      return files.map(function toggle(file, i) {
        return i === index ? { ...file, soundboard: !file.soundboard } : file;
      });
    });
  }

  /** Takes a staged file out before sending. */
  protected unstage(index: number): void {
    this.staged.update(function (s) {
      return s.filter(function (_, i) {
        return i !== index;
      });
    });
  }

  /** The name of the site of a link, to show it short. */
  protected host(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /** Asks the server for the card of the link (only when the person presses "Add preview"). */
  protected async requestPreview(url: string): Promise<void> {
    this.linkPreview.set({ phase: 'loading', url, card: null });
    try {
      const card = await this.api.get<LinkPreview>(`/api/preview?url=${encodeURIComponent(url)}`);
      const picture = card.image ? await shrinkImage(card.image) : '';
      if (this.linkPreview().url !== url) return;
      this.linkPreview.set({ phase: 'ready', url, card: { ...card, image: picture || undefined } });
    } catch {
      if (this.linkPreview().url !== url) return;
      // A video link still gets a player even when the site gave no card.
      const video = videoEmbed(url);
      if (video)
        this.linkPreview.set({
          phase: 'ready',
          url,
          card: { url, title: '', description: '', site: video.provider },
        });
      else this.linkPreview.set({ phase: 'error', url, card: null });
    } finally {
      // Focus goes back to the box so the person can keep typing or send with Enter.
      this.box()?.nativeElement.focus();
    }
  }

  /** The message as a code block, or null when it does not look like code (or is already one). */
  private detectCode(): string | null {
    const text = this.text().trim();
    const fenced = text ? autoFenceCode(text) : text;
    return fenced !== text ? fenced : null;
  }

  /** The code block to preview, unless the person chose plain text. */
  private pickCodeBlock(): string | null {
    return this.codeOff() ? null : this.codeFormatted();
  }

  /** The parsed pieces of a code block for the preview. */
  protected codeSegments(code: string): ReturnType<typeof parseRichText> {
    return parseRichText(code);
  }

  /** Hides the preview of a link so the message goes out without a card. */
  protected dismissPreview(): void {
    this.linkPreview.set({ phase: 'hidden', url: this.linkPreview().url, card: null });
  }

  /**
   * Sends the message: formats code, encrypts the text and the files and puts them on the list at once as 'pending'.
   */
  protected async send(): Promise<void> {
    if (!this.canSend()) return;
    const written = this.text().trim();
    const text = this.codeOff() ? written : autoFenceCode(written);
    this.codeOff.set(false);
    const files = this.staged();
    const replyTo = this.replyingTo()?.id;
    // The card only goes if it was requested and the link is still in the text.
    const v = this.linkPreview();
    const preview =
      v.phase === 'ready' && v.card && text.includes(v.url.replace(/\/$/, '')) ? v.card : undefined;
    this.linkPreview.set({ phase: 'idle', url: '', card: null });
    this.history = [{ texto: '', caret: 0 }];
    this.historyIndex = 0;
    this.text.set('');
    this.staged.set([]);
    sessionStorage.removeItem('draft.' + this.channelId());
    this.cancelReply.emit();
    queueMicrotask(
      function (this: MessageInputComponent) {
        return this.resize();
      }.bind(this),
    );
    this.sending.set(true);
    try {
      await this.store.send(this.channelId(), { text, files, replyTo, preview });
      this.sent.emit();
    } catch (error) {
      this.toast.error(this.i18n.t('Message not sent'), describeError(error));
    } finally {
      this.sending.set(false);
    }
  }

  // ---- voice notes ---------------------------------------------------------------------------

  protected async startRecording(): Promise<void> {
    try {
      this.recStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      this.toast.error(
        this.i18n.t('Microphone blocked'),
        this.i18n.t('Allow microphone access to record voice notes.'),
      );
      return;
    }
    const mime =
      ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(function (m) {
        return MediaRecorder.isTypeSupported(m);
      }) ?? '';
    const chunks: Blob[] = [];
    this.recorder = new MediaRecorder(this.recStream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = function (e) {
      return e.data.size && chunks.push(e.data);
    };
    this.recWave = [];
    this.recCtx = new AudioContext();
    const analyser = this.recCtx.createAnalyser();
    analyser.fftSize = 256;
    this.recCtx.createMediaStreamSource(this.recStream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    this.recStart = performance.now();
    this.recMs.set(0);
    this.recTimer = setInterval(
      function (this: MessageInputComponent) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 3);
        this.recWave.push(level);
        this.liveBars.update(function (b) {
          return [...b.slice(1), level];
        });
        this.recMs.set(performance.now() - this.recStart);
        if (this.recMs() > 5 * 60_000) this.stopRecording(true);
      }.bind(this),
      90,
    );
    (this.recorder as MediaRecorder & { chunks?: Blob[]; mime?: string }).chunks = chunks;
    (this.recorder as MediaRecorder & { mime?: string }).mime = mime || 'audio/webm';
    this.recorder.start(250);
    this.recording.set(true);
    this.sound.play('unmute');
  }

  /** Stops the recording of a voice note and sends it (or throws it away). */
  protected stopRecording(send: boolean): void {
    const recorder = this.recorder as (MediaRecorder & { chunks: Blob[]; mime: string }) | null;
    if (!recorder) return;
    clearInterval(this.recTimer);
    const duration = performance.now() - this.recStart;
    const wave = this.downsample(this.recWave, 40);
    recorder.onstop = async function (this: MessageInputComponent) {
      this.recStream?.getTracks().forEach(function (t) {
        return t.stop();
      });
      void this.recCtx?.close();
      this.recorder = null;
      if (!send || !recorder.chunks.length || duration < 400) return;
      const blob = new Blob(recorder.chunks, { type: recorder.mime });
      const ext = recorder.mime.includes('ogg')
        ? 'ogg'
        : recorder.mime.includes('mp4')
          ? 'm4a'
          : 'webm';
      this.sending.set(true);
      try {
        await this.store.send(this.channelId(), {
          text: '',
          files: [
            {
              data: blob,
              name: `voice-note.${ext}`,
              mime: recorder.mime,
              wave,
              durationMs: Math.round(duration),
            },
          ],
          replyTo: this.replyingTo()?.id,
        });
        this.cancelReply.emit();
      } catch (error) {
        this.toast.error(this.i18n.t('Voice note not sent'), describeError(error));
      } finally {
        this.sending.set(false);
      }
    }.bind(this);
    recorder.stop();
    this.recording.set(false);
    this.liveBars.set(Array(32).fill(0));
  }

  /** Reduces the levels of a recording to a few bars for the drawing of the wave. */
  private downsample(values: number[], n: number): number[] {
    if (!values.length) return Array(n).fill(0.15);
    return Array.from({ length: n }, function (_, i) {
      const from = Math.floor((i / n) * values.length);
      const to = Math.max(from + 1, Math.floor(((i + 1) / n) * values.length));
      return Math.max(...values.slice(from, to));
    });
  }

  /** Stops the microphone and the timers when the box goes away. */
  ngOnDestroy(): void {
    clearInterval(this.recTimer);
    this.recStream?.getTracks().forEach(function (t) {
      return t.stop();
    });
    void this.recCtx?.close();
  }
}
