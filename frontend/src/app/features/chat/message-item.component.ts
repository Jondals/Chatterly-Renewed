/**
 * src/app/features/chat/message-item.component.ts
 * One chat message: bubble, reactions, replies, editing, the hover menu and the right-click menu.
 */
import { NameColorDirective } from '../../shared/util/name-color.directive';
import { NameFxDirective } from '../../shared/util/name-fx.directive';
import { emojiCountOf, emojiMood, isOnlyEmoji } from '../../shared/util/emoji-only';
import { copyText } from '../../shared/util/clipboard';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { AuthService } from '../../core/services/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { DirectoryService } from '../../core/services/directory.service';
import { SettingsService } from '../../core/services/settings.service';
import { saveFile } from '../../shared/util/save-file';
import { ToastService } from '../../core/services/toast.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ExpressionPickerComponent } from '../../shared/components/expression-picker.component';
import { IconComponent } from '../../shared/components/icon.component';
import { RichTextComponent } from '../../shared/components/rich-text.component';
import { TimestampPipe } from '../../shared/pipes/timestamp.pipe';
import { QUICK_REACTIONS } from '../../shared/util/emoji';
import { parseRichText, plainText } from '../../shared/util/rich-text';
import { MessageStore, type ViewAttachment, type ViewMessage } from '../../store/message.store';
import { SoundImportService } from './sound-import.service';
import { AttachmentComponent } from './attachment.component';
import { LinkCardComponent } from './link-card.component';
import { StatusMarkComponent } from './status-mark.component';
import { SpinlyCardComponent } from '../spinly/spinly-card.component';
import { SpinlyMessageComponent } from '../spinly/spinly-message.component';
import { UiService } from '../../core/services/ui.service';
import { ContextMenuService, type MenuItem } from '../../core/services/context-menu.service';
import { fontClassOf } from '../../shared/util/user-font.directive';
import { ServerTagComponent } from '../../shared/components/server-tag.component';

/** A message younger than this (in milliseconds) counts as just arrived. */
const EMOJI_FRESH_MS = 6000;
/** Seconds of rest between the end of the show of a lone emoji and the next one. */
const EMOJI_REST_MS = 5000;

/** True for a file that is not a sticker (stickers cannot be saved). */
function notSticker(file: ViewAttachment): boolean {
  return !file.sticker;
}

@Component({
  selector: 'app-message-item',
  standalone: true,
  imports: [
    ServerTagComponent,
    AvatarComponent,
    LinkCardComponent,
    SpinlyCardComponent,
    SpinlyMessageComponent,
    StatusMarkComponent,
    NameColorDirective,
    NameFxDirective,
    IconComponent,
    TimestampPipe,
    AttachmentComponent,
    ExpressionPickerComponent,
    RichTextComponent,
    TranslatePipe,
  ],
  host: { class: 'block' },
  template: `
    @let m = message();
    <div
      class="group relative flex gap-3 rounded-ui px-2 py-1 hover:bg-white/[.02]"
      [class.flex-row-reverse]="bubbles() && mine()"
      [class.mt-3]="!compact()"
      (contextmenu)="openMenu($event)"
      (click)="onTap($event)"
    >
      <!-- on a phone the picture goes inline with the name (22 px): no empty column on the left of every message -->
      <div class="w-9 shrink-0 pt-0.5 max-sm:hidden">
        @if (!compact()) {
          <app-avatar [user]="sender()" [size]="36" />
        } @else if (!bubbles()) {
          <span class="hidden pt-1 text-xs text-muted group-hover:block">{{
            m.createdAt | timestamp
          }}</span>
        }
      </div>

      <div
        class="flex min-w-0 max-w-[85%] flex-col max-sm:max-w-[94%]"
        [class.items-end]="bubbles() && mine()"
      >
        @if (!compact()) {
          <div class="mb-2 flex items-baseline gap-3 max-sm:items-center max-sm:gap-2">
            <app-avatar class="sm:hidden" [user]="sender()" [size]="22" />
            <button
              type="button"
              class="msg-name text-base font-semibold"
              [class]="nameClass()"
              [appNameColor]="sender()?.profileColor ?? ''"
              [fallback]="mine() ? 'var(--accent)' : 'var(--fg)'"
              [nameFx]="sender()?.nameFx"
              (click)="openProfile()"
            >
              {{ sender()?.displayName ?? auth.user()?.displayName ?? '…' }}
            </button>
            <app-server-tag class="-ml-1.5 self-center" [tag]="sender()?.serverTag" />
            <span class="text-[0.8125rem] text-muted">{{ m.createdAt | timestamp }}</span>
            @if (mine() && settings.showMessageStatus() && !m.pending && !m.failed && m.verified) {
              <app-status-mark [status]="store.statusOf(m)" />
            }
          </div>
        }

        @if (
          compact() &&
          mine() &&
          settings.showMessageStatus() &&
          !m.pending &&
          !m.failed &&
          m.verified
        ) {
          <!-- the messages that follow another one of yours have no header, so their mark sits at the corner -->
          <app-status-mark class="absolute right-3 top-2.5" [status]="store.statusOf(m)" />
        }

        @if (replied(); as r) {
          <div
            class="mb-1 flex max-w-sm items-center gap-2 truncate rounded-ui border-l-2 border-accent bg-white/5 px-2.5 py-1 text-xs text-muted"
          >
            <app-icon name="reply" [size]="12" /> <b class="text-fg">{{ r.name }}</b>
            <span class="truncate">{{ r.text }}</span>
          </div>
        }

        @if (editing()) {
          <div class="w-full min-w-72">
            <textarea
              class="input"
              rows="2"
              [value]="draft()"
              (input)="draft.set($any($event.target).value)"
              (keydown.enter)="$event.preventDefault(); saveEdit()"
              (keydown.escape)="editing.set(false)"
            ></textarea>
            <div class="mt-1 text-[0.6875rem] text-muted">
              {{ 'Enter to save · Esc to cancel' | t }}
            </div>
          </div>
        } @else if ((m.text || m.undecryptable) && textShown()) {
          <div
            class="anim-pop selectable w-fit max-w-full px-3.5 pb-2.5 pt-2 text-[0.95em] leading-relaxed"
            [class.bubble-out]="bubbles() && mine()"
            [class.bubble-in]="bubbles() && !mine()"
            [class.bubble-emoji]="bigEmoji()"
            [class.is-single]="bigEmoji() && singleEmoji()"
            [class.is-fresh]="bigEmoji() && emojiFresh()"
            (click)="replayEmoji($event)"
            [class.is-many]="bigEmoji() && emojiCount() > 3 && emojiCount() <= 6"
            [class.is-lots]="bigEmoji() && emojiCount() > 6 && emojiCount() <= 14"
            [class.is-heaps]="bigEmoji() && emojiCount() > 14"
            [attr.data-pop]="bigEmoji() ? emojiPop() : null"
            [attr.data-mood]="bigEmoji() && singleEmoji() ? emojiMoodOf() : null"
            [class.px-0]="!bubbles()"
            [class.opacity-60]="m.pending"
            [class.text-red-300]="m.failed"
          >
            @if (m.undecryptable) {
              <span class="flex items-center gap-2 italic opacity-80"
                ><app-icon name="lock" [size]="14" />
                {{ 'Unable to decrypt — you may not have the key for this message.' | t }}</span
              >
            } @else {
              <span class="whitespace-pre-wrap [overflow-wrap:anywhere]"
                ><app-rich-text [segments]="segments()" (copy)="copy($event)"
              /></span>
            }
          </div>
        }

        @if (m.preview) {
          <app-link-card [preview]="m.preview" />
        }
        @if (m.spinly; as spinly) {
          <app-spinly-card [result]="spinly" />
        }
        @if (m.activity) {
          <app-spinly-message [message]="m" />
        }
        @for (a of m.attachments; track a.fileId) {
          <app-attachment [att]="a" />
        }
        @if (pack().length > 1) {
          <button
            type="button"
            class="btn btn-sm mt-1.5 gap-1.5 self-start"
            [disabled]="addingPack()"
            (click)="addPack()"
          >
            <app-icon name="waveform" [size]="14" />
            {{ 'Add the pack to my soundboard' | t }} ({{ pack().length }})
          </button>
        }

        @if (visibleReactions().length) {
          <div class="mt-1.5 flex flex-wrap gap-1.5" [class.justify-end]="bubbles() && mine()">
            @for (r of visibleReactions(); track r.emoji) {
              <button
                type="button"
                class="anim-pop flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold hover:scale-105"
                [class.border-accent/50]="r.mine"
                [class.bg-accent/15]="r.mine"
                [class.border-white/10]="!r.mine"
                [class.bg-white/5]="!r.mine"
                (click)="react(r.emoji)"
              >
                <span class="text-sm">{{ r.emoji }}</span> {{ r.users.length }}
              </button>
            }
          </div>
        }

        <div
          class="mt-0.5 flex items-center gap-1.5 px-1 text-[0.625rem]"
          [class.flex-row-reverse]="bubbles() && mine()"
        >
          @if (m.pending) {
            <span class="text-muted">{{ 'Encrypting & sending…' | t }}</span>
          } @else if (m.failed) {
            <span class="text-red-300">{{ 'Failed to send' | t }}</span>
            <button type="button" class="underline" (click)="dismiss()">{{ 'Dismiss' | t }}</button>
          } @else {
            @if (m.editedAt) {
              <span class="text-dim">({{ 'edited' | t }})</span>
            }
            @if (!m.verified && !m.undecryptable) {
              <span
                class="flex items-center gap-1 font-semibold text-amber"
                [attr.title]="'The signature does not match the sender\\'s identity key' | t"
                ><app-icon name="alert-triangle" [size]="10" />
                {{ 'Signature not verified' | t }}</span
              >
            }
          }
        </div>
      </div>

      @if (!m.pending && !m.failed && !editing() && settings.messageActions()) {
        <div
          class="msg-actions absolute -top-4 z-10 hidden items-center gap-0.5 rounded-ui border border-white/10 bg-ink-800 p-1 shadow-xl group-hover:flex group-focus-within:flex"
          [class.!flex]="tapped()"
          [class.right-4]="!(bubbles() && mine())"
          [class.left-4]="bubbles() && mine()"
        >
          @for (e of quick; track e) {
            <button
              type="button"
              class="msg-quick flex h-9 w-9 items-center justify-center rounded-[calc(var(--r)*.7)] text-xl hover:bg-white/10"
              (click)="react(e)"
            >
              {{ e }}
            </button>
          }
          <div class="relative">
            <button
              type="button"
              class="btn btn-icon btn-sm btn-ghost !h-8 !w-8 tip"
              [attr.data-tip]="'More reactions' | t"
              (mousedown)="$event.stopPropagation()"
              (click)="pickerOpen.set(!pickerOpen())"
            >
              <app-icon name="smile" [size]="16" />
            </button>
            @if (pickerOpen()) {
              <div
                class="absolute bottom-10 z-20 max-md:fixed max-md:inset-x-3 max-md:bottom-24"
                [class.right-0]="!(bubbles() && mine())"
                [class.left-0]="bubbles() && mine()"
              >
                <app-expression-picker
                  [tabs]="['emoji']"
                  (emoji)="react($event); pickerOpen.set(false)"
                  (closed)="pickerOpen.set(false)"
                />
              </div>
            }
          </div>
          <span class="mx-0.5 h-5 w-px bg-white/10"></span>
          <button
            type="button"
            class="btn btn-icon btn-sm btn-ghost !h-8 !w-8 tip"
            [attr.data-tip]="'Reply' | t"
            (click)="replyTo.emit(m)"
          >
            <app-icon name="reply" [size]="16" />
          </button>
          <button
            type="button"
            class="btn btn-icon btn-sm btn-ghost !h-8 !w-8 tip"
            [attr.data-tip]="'Message options' | t"
            (mousedown)="$event.stopPropagation()"
            (click)="openMenu($event)"
          >
            <app-icon name="more" [size]="16" />
          </button>
        </div>
      }
    </div>
  `,
})
export class MessageItemComponent {
  readonly message = input.required<ViewMessage>();
  readonly compact = input(false);
  readonly canModerate = input(false);
  /** Lookup for reply previews. */
  readonly all = input<ViewMessage[]>([]);
  readonly replyTo = output<ViewMessage>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly auth = inject(AuthService);
  private readonly directory = inject(DirectoryService);
  protected readonly store = inject(MessageStore);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly dialog = inject(DialogService);
  protected readonly settings = inject(SettingsService);

  protected readonly quick = QUICK_REACTIONS.slice(0, 3);
  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly pickerOpen = signal(false);

  protected readonly bubbles = computed(
    function (this: MessageItemComponent) {
      return this.settings.chatStyle() === 'bubbles';
    }.bind(this),
  );
  protected readonly mine = computed(
    function (this: MessageItemComponent) {
      return this.message().senderId === this.auth.user()?.id;
    }.bind(this),
  );
  protected readonly sender = computed(
    function (this: MessageItemComponent) {
      return this.directory.users().get(this.message().senderId);
    }.bind(this),
  );
  protected readonly nameClass = computed(
    function (this: MessageItemComponent) {
      const font = this.sender()?.nameFont;
      return fontClassOf(font);
    }.bind(this),
  );
  /** The reactions of the message, as shown under it. */
  protected readonly visibleReactions = computed(
    function (this: MessageItemComponent) {
      return this.message().reactions;
    }.bind(this),
  );
  private readonly menu = inject(ContextMenuService);
  private readonly imports = inject(SoundImportService);
  protected readonly addingPack = signal(false);
  /** The sounds of this message that belong to a pack (the people who receive them can add all at once). */
  protected readonly pack = computed(this.findPack.bind(this));
  private readonly ui = inject(UiService);
  /** False when the message is only a link whose preview card already shows it (so it is not drawn twice). */
  protected readonly textShown = computed(
    function (this: MessageItemComponent) {
      const message = this.message();
      if (message.activity && !message.undecryptable) {
        return false;
      }
      if (!message.preview || message.undecryptable) {
        return true;
      }
      return message.text.replace(/https?:\/\/\S+/g, '').trim().length > 0;
    }.bind(this),
  );
  /** A message that is exactly one emoji (it gets its own little show). */
  protected readonly singleEmoji = computed(
    function (this: MessageItemComponent) {
      return this.emojiCount() === 1;
    }.bind(this),
  );
  /** How many emoji the message has, spaces apart (the more there are, the smaller each one is drawn). */
  protected readonly emojiCount = computed(
    function (this: MessageItemComponent) {
      return emojiCountOf(this.message().text);
    }.bind(this),
  );
  /** True when the message is only emoji: they are drawn big, without a bubble. */
  protected readonly bigEmoji = computed(
    function (this: MessageItemComponent) {
      const message = this.message();
      return !message.undecryptable && !message.attachments?.length && isOnlyEmoji(message.text);
    }.bind(this),
  );
  /** The kind of animation of a lone emoji (a heart beats, a kiss sends a heart, a critter hops, a rocket takes off...). */
  protected readonly emojiMoodOf = computed(
    function (this: MessageItemComponent) {
      return emojiMood(this.message().text, this.message().id);
    }.bind(this),
  );
  /** Which of the eight entrances this emoji message uses: always the same for the same message, but different between messages. */
  protected readonly emojiPop = computed(
    function (this: MessageItemComponent) {
      let hash = 0;
      for (const char of this.message().id) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      }
      return hash % 8;
    }.bind(this),
  );
  /**
   * True for an emoji that has just arrived (or that this person just sent): it makes its entrance and its little show.
   * The ones that were already there when the chat was opened only settle in softly, so entering a chat does not set a
   * dozen emoji spinning at once.
   */
  protected readonly emojiFresh = computed(
    function (this: MessageItemComponent) {
      return Date.now() - this.message().createdAt < EMOJI_FRESH_MS;
    }.bind(this),
  );
  /** Pressing a lone emoji plays its show again (the same one, with its little particles). */
  protected replayEmoji(event: Event): void {
    if (!this.singleEmoji() || !this.bigEmoji()) {
      return;
    }
    this.playEmoji(event.currentTarget as HTMLElement);
  }

  /** Starts the show of a lone emoji from the beginning. Returns how long it lasts, in milliseconds. */
  private playEmoji(element: HTMLElement): number {
    element.classList.remove('emo-play');
    // Reading the size makes the browser notice the class is gone, so adding it again starts the animation again.
    void element.offsetWidth;
    element.classList.add('emo-play');
    const style = getComputedStyle(element);
    const seconds = parseFloat(style.getPropertyValue('--emo-dur')) || 1.8;
    const times = parseFloat(style.getPropertyValue('--emo-count')) || 1;
    return 500 + seconds * times * 1000;
  }

  /** The timer of the next show of this lone emoji. */
  private emojiTimer: ReturnType<typeof setTimeout> | undefined;

  /** Waits, plays the show if the emoji is on the screen, and waits again: a rest of 5 seconds between shows. */
  private scheduleEmojiShow(wait: number): void {
    clearTimeout(this.emojiTimer);
    this.emojiTimer = setTimeout(
      function show(this: MessageItemComponent): void {
        const element =
          this.host.nativeElement.querySelector<HTMLElement>('.bubble-emoji.is-single');
        if (!element || !this.singleEmoji() || !this.bigEmoji()) {
          return;
        }
        const box = element.getBoundingClientRect();
        const onScreen =
          !document.hidden && box.bottom > 0 && box.top < window.innerHeight && box.width > 0;
        const still = this.settings.animations() === 'off';
        const lasts = onScreen && !still ? this.playEmoji(element) : 0;
        this.scheduleEmojiShow(lasts + EMOJI_REST_MS);
      }.bind(this),
      wait,
    );
  }

  private readonly emojiShows = effect(
    function (this: MessageItemComponent): void {
      const lone = this.singleEmoji() && this.bigEmoji() && !this.message().pending;
      if (lone) {
        // the first show comes after it settles in and rests
        this.scheduleEmojiShow(EMOJI_REST_MS);
      } else {
        clearTimeout(this.emojiTimer);
      }
    }.bind(this),
  );
  private readonly stopEmojiShows = inject(DestroyRef).onDestroy(
    function (this: MessageItemComponent): void {
      clearTimeout(this.emojiTimer);
    }.bind(this),
  );
  protected readonly segments = computed(
    function (this: MessageItemComponent) {
      return parseRichText(this.message().text.trim());
    }.bind(this),
  );
  protected readonly replied = computed(
    function (this: MessageItemComponent) {
      const id = this.message().replyTo;
      if (!id) return null;
      const target = this.all().find(function (m) {
        return m.id === id;
      });
      if (!target) return { name: '…', text: '' };
      return {
        name: this.directory.users().get(target.senderId)?.displayName ?? '…',
        text: target.text ? plainText(target.text) : '📎',
      };
    }.bind(this),
  );

  /** Click on the name: your own opens the profile settings; someone else's opens their profile card. */
  protected openProfile(): void {
    if (this.mine()) {
      this.ui.openSettings();
    } else {
      this.ui.profileUserId.set(this.message().senderId);
    }
  }

  /** Clic derecho sobre un mensaje: responder, copiar, editar y confirmDelete. */
  /** True on a phone: the bar of actions was opened by tapping the message. */
  protected readonly tapped = signal(false);

  /** On a screen without hover a tap on the message (not on a link or button) shows or hides its actions. */
  protected onTap(event: MouseEvent): void {
    if (!window.matchMedia('(hover: none)').matches) {
      return;
    }
    const target = event.target as Element | null;
    if (target?.closest('a, button, input, textarea, video, audio, img, iframe, .selectable a')) {
      return;
    }
    this.tapped.update(function toggle(open) {
      return !open;
    });
  }

  /**
   * A press anywhere else hides the actions that a tap opened. ! The page is listened to only while the actions are open:
   * every message listening to every press of the page made each click run hundreds of handlers in a long chat.
   */
  private readonly outsidePress = this.closeTapped.bind(this);
  private readonly followTapped = effect(
    function (this: MessageItemComponent) {
      if (this.tapped()) {
        document.addEventListener('pointerdown', this.outsidePress, { passive: true });
      } else {
        document.removeEventListener('pointerdown', this.outsidePress);
      }
    }.bind(this),
  );
  private readonly forgetTapped = inject(DestroyRef).onDestroy(
    function (this: MessageItemComponent) {
      document.removeEventListener('pointerdown', this.outsidePress);
    }.bind(this),
  );

  /** A press outside the message closes its actions. */
  private closeTapped(event: Event): void {
    if (this.tapped() && !this.host.nativeElement.contains(event.target as Node)) {
      this.tapped.set(false);
    }
  }

  /**
   * Right click on a message: copy, edit, delete or react, depending on who wrote it and what the person may do.
   */
  protected openMenu(event: MouseEvent): void {
    const m = this.message();
    if (m.pending || m.failed || this.editing()) return;
    const items: MenuItem[] = [
      {
        label: 'Reply',
        icon: 'reply',
        action: function (this: MessageItemComponent) {
          return this.replyTo.emit(m);
        }.bind(this),
      },
    ];
    if (m.text)
      items.push({
        label: 'Copy',
        icon: 'copy',
        action: function (this: MessageItemComponent) {
          return void this.copy(plainText(m.text));
        }.bind(this),
      });
    // Every file of the message can be kept: a GIF, a picture, a voice note or any file (on the phone, in Downloads).
    // With several files each one is named. ! Stickers are not offered: they belong to whoever made them.
    const files = m.attachments.filter(notSticker).slice(0, 6);
    for (const file of files) {
      items.push({
        label:
          files.length > 1
            ? this.i18n.t('Download {name}', { name: file.name.slice(0, 28) })
            : file.gif
              ? 'Save GIF'
              : file.kind === 'image'
                ? 'Save image'
                : 'Download',
        icon: 'download',
        action: this.saveAttachment.bind(this, file),
      });
    }
    if (this.mine() && m.text && !m.spinly && !m.activity)
      items.push({
        label: 'Edit',
        icon: 'edit',
        action: function (this: MessageItemComponent) {
          return this.startEdit();
        }.bind(this),
      });
    if (this.mine() || this.canModerate())
      items.push({
        label: 'Delete',
        icon: 'trash',
        danger: true,
        separator: true,
        action: function (this: MessageItemComponent) {
          return void this.remove();
        }.bind(this),
      });
    this.menu.open(event, items);
  }

  /** Decrypts a file of the message (if it was not yet) and saves it on the device. */
  private async saveAttachment(file: ViewAttachment): Promise<void> {
    try {
      const url = await this.store.attachmentUrl(file);
      const where = await saveFile(url, file.name, file.mime);
      if (where === 'downloads') {
        this.toast.success(this.i18n.t('Saved in Downloads'), file.name);
      }
    } catch {
      this.toast.error(this.i18n.t('Could not save the file'));
    }
  }

  /** Reacts to the message with an emoji. */
  protected async react(emoji: string): Promise<void> {
    try {
      await this.store.toggleReaction(this.message(), emoji);
    } catch {
      this.toast.error('Could not react');
    }
  }

  /** The attachments that are sounds of a pack. */
  private findPack(): ViewAttachment[] {
    return this.message().attachments.filter(function inPack(a) {
      return !!a.pack && a.kind === 'audio';
    });
  }

  /** Adds all the sounds of the pack to the soundboard. */
  protected async addPack(): Promise<void> {
    this.addingPack.set(true);
    try {
      await this.imports.addPack(this.pack());
    } finally {
      this.addingPack.set(false);
    }
  }

  /** Starts editing the text of the message. */
  protected startEdit(): void {
    this.draft.set(this.message().text);
    this.editing.set(true);
  }

  /** Saves the edited text. */
  protected async saveEdit(): Promise<void> {
    const text = this.draft().trim();
    this.editing.set(false);
    if (text === this.message().text) return;
    try {
      await this.store.edit(this.message(), text);
    } catch {
      this.toast.error('Could not edit the message');
    }
  }

  /** Asks to confirm and deletes the message for everybody. */
  protected async remove(): Promise<void> {
    if (
      await this.dialog.confirm(
        'Delete message?',
        'This removes it for everyone in the conversation.',
        { danger: true, confirmLabel: 'Delete' },
      )
    ) {
      try {
        await this.store.remove(this.message());
      } catch {
        this.toast.error('Could not delete the message');
      }
    }
  }

  /** Takes a message that failed to send out of the list. */
  protected dismiss(): void {
    this.store.dismissFailed(this.message().channelId, this.message().id);
  }

  /** Copies a text to the clipboard. */
  protected async copy(text: string): Promise<void> {
    if (await copyText(text)) this.toast.success('Copied to clipboard');
    else this.toast.error('Clipboard unavailable');
  }
}
