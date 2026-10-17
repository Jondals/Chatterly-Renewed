/**
 * src/app/features/chat/message-list.component.ts
 * List of messages with day separators, loading of older messages and automatic scrolling.
 */
import {
  AnimationCallbackEvent,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { DirectoryService } from '../../core/services/directory.service';
import { IconComponent } from '../../shared/components/icon.component';
import type { Guild, GuildChannel } from '../../core/models';
import { GuildStore } from '../../store/guild.store';
import { MessageStore, type ViewMessage } from '../../store/message.store';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { MessageItemComponent } from './message-item.component';

interface Row {
  message: ViewMessage;
  compact: boolean;
  dayLabel: string | null;
}

/** The separator text of a day: "Today", "Yesterday" or the full date, in the language of the app. */
function dayLabel(ts: number, i18n: I18nService): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return i18n.t('Today');
  if (d.toDateString() === yesterday.toDateString()) return i18n.t('Yesterday');
  return d.toLocaleDateString(i18n.locale(), { weekday: 'long', month: 'long', day: 'numeric' });
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-message-list',
  standalone: true,
  imports: [MessageItemComponent, IconComponent, TranslatePipe],
  host: { class: 'relative block min-h-0 flex-1' },
  template: `
    <div
      #scroller
      class="h-full overflow-y-auto px-3 py-4"
      [style.opacity]="revealed() ? 1 : 0"
      [style.transform]="revealed() ? 'none' : 'translateY(10px)'"
      [style.transition]="revealed() ? 'opacity 0.24s ease, transform 0.24s ease' : 'none'"
      (scroll)="onScroll()"
      (wheel)="stopFollowing()"
      (touchstart)="stopFollowing()"
      (pointerdown)="stopFollowing()"
    >
      <div #content>
        @if (state().loading() && !state().messages().length) {
          <div class="space-y-5 p-2">
            @for (i of [1, 2, 3, 4]; track i) {
              <div class="flex gap-3" [class.flex-row-reverse]="i % 2 === 0">
                <div class="shimmer h-9 w-9 rounded-full"></div>
                <div class="shimmer h-14 w-64 rounded-2xl"></div>
              </div>
            }
          </div>
        } @else {
          @if (state().hasMore() && state().messages().length >= 50) {
            <div class="mb-3 text-center">
              <button
                class="btn btn-sm"
                type="button"
                (click)="store.loadOlder(channelId())"
                [disabled]="state().loading()"
              >
                {{ 'Load earlier messages' | t }}
              </button>
            </div>
          }

          @for (row of rows(); track row.message.id) {
            @if (row.dayLabel) {
              <div class="my-4 flex items-center gap-3 text-[0.6875rem] font-semibold text-dim">
                <span class="h-px flex-1 bg-white/6"></span>{{ row.dayLabel
                }}<span class="h-px flex-1 bg-white/6"></span>
              </div>
            }
            <app-message-item
              (animate.leave)="onLeave($event)"
              [message]="row.message"
              [compact]="row.compact"
              [canModerate]="canModerate()"
              [all]="state().messages()"
              (replyTo)="replyTo.emit($event)"
            />
          } @empty {
            @if (state().loaded()) {
              <div
                class="anim-fade-up flex h-full min-h-60 flex-col items-center justify-center gap-2 text-center text-muted"
              >
                <div class="animate-float text-5xl">👋</div>
                <div class="text-base font-semibold text-fg">{{ 'Say hello' | t }}</div>
                <div class="text-sm">
                  {{ 'This is the very beginning of the conversation.' | t }}
                </div>
              </div>
            }
          }

          @if (typingNames().length) {
            <div class="anim-fade-up mt-2 flex items-center gap-2 px-3 text-xs text-muted">
              <span class="flex gap-1">
                @for (d of [0, 150, 300]; track d) {
                  <span
                    class="typing-dot h-1.5 w-1.5 rounded-full bg-accent"
                    [style.--d]="d + 'ms'"
                  ></span>
                }
              </span>
              {{
                (typingNames().length === 1 ? '{names} is typing…' : '{names} are typing…')
                  | t: { names: typingNames().join(', ') }
              }}
            </div>
          }
        }
      </div>
    </div>

    @if (!atBottom()) {
      <button
        animate.leave="leave-latest"
        class="anim-pop absolute bottom-4 right-6 flex items-center gap-1.5 rounded-ui border border-white/10 bg-ink-800 px-3 py-1.5 text-xs font-semibold text-fg shadow-xl hover:border-accent/60 hover:text-accent"
        type="button"
        (click)="jumpToLatest()"
      >
        <app-icon name="chevron-down" [size]="14" /> {{ 'Latest' | t }}
      </button>
    }
  `,
})
export class MessageListComponent {
  readonly channelId = input.required<string>();
  readonly canModerate = input(false);
  readonly replyTo = output<ViewMessage>();

  protected readonly store = inject(MessageStore);
  private readonly guilds = inject(GuildStore);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly directory = inject(DirectoryService);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  protected readonly state = computed(
    function (this: MessageListComponent) {
      return this.store.state(this.channelId());
    }.bind(this),
  );
  protected readonly atBottom = signal(true);
  /**
   * False from the moment another conversation is opened until it is drawn and already at its end: it is hidden meanwhile
   * (so the person never sees it start at the top and fall to the bottom) and then fades in where the end is.
   */
  protected readonly revealed = signal(true);
  private revealTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly rows = computed<Row[]>(
    function (this: MessageListComponent) {
      // ! In a group, what was sent before the person joined (or with a key they were never given) is not shown as a row of locks:
      //   they could never have read it, and a wall of locks only says that nothing is wrong. In a direct chat it is shown.
      const channelId = this.channelId();
      const inGroup = this.guilds.guilds().some(function holds(guild: Guild) {
        return guild.channels.some(function same(channel: GuildChannel) {
          return channel.id === channelId;
        });
      });
      const list = inGroup
        ? this.state()
            .messages()
            .filter(function readable(message) {
              return !message.undecryptable;
            })
        : this.state().messages();
      const i18n = this.i18n;
      return list.map(function (message, i) {
        const prev = list[i - 1];
        const label =
          !prev ||
          new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString()
            ? dayLabel(message.createdAt, i18n)
            : null;
        const compact =
          !!prev &&
          !label &&
          prev.senderId === message.senderId &&
          message.createdAt - prev.createdAt < 5 * 60_000;
        return { message, compact, dayLabel: label };
      });
    }.bind(this),
  );

  protected readonly typingNames = computed(
    function (this: MessageListComponent) {
      const typing = this.state().typing();
      const now = Date.now();
      return Object.entries(typing)
        .filter(function ([, until]) {
          return until > now;
        })
        .map(
          function (this: MessageListComponent, [id]: [string, number]) {
            return this.directory.users().get(id)?.displayName ?? 'Someone';
          }.bind(this),
        );
    }.bind(this),
  );

  private stick = true;
  private readonly content = viewChild.required<ElementRef<HTMLElement>>('content');
  private resizer: ResizeObserver | null = null;
  private lastHeight = 0;
  private lastMessageId = '';
  /** Frame of the glide to the end of the conversation (0 when it is not gliding). */
  private glide = 0;

  constructor() {
    // Follow new messages unless the reader scrolled up (always for what the reader sends or when writing).
    effect(
      function (this: MessageListComponent) {
        const list = this.state().messages();
        this.state().typing();
        untracked(this.followNewMessage.bind(this, list));
      }.bind(this),
    );
    afterNextRender(this.watchSize.bind(this));
    inject(DestroyRef).onDestroy(this.stopWatching.bind(this));
    effect(
      function (this: MessageListComponent) {
        this.channelId();
        untracked(
          function (this: MessageListComponent) {
            this.openConversation();
          }.bind(this),
        );
      }.bind(this),
    );
  }

  /** A message arrived or was sent: the conversation glides to its end when it should. */
  private followNewMessage(list: ViewMessage[]): void {
    // ? Another conversation is opening: its messages arrive before the list is hidden, and gliding then would show it
    // running from the top to the end. openConversation puts it at its end instead.
    if (this.openedChannel !== this.channelId()) {
      return;
    }
    const last = list[list.length - 1];
    const id = last ? last.id : '';
    const isNew = id !== this.lastMessageId;
    this.lastMessageId = id;
    const mine = !!last && last.senderId === this.auth.user()?.id;
    const writing = document.activeElement?.tagName === 'TEXTAREA';
    if (isNew && (mine || writing)) {
      this.stick = true;
    }
    if (!this.revealed()) {
      // The conversation that was just opened is being drawn: it is not glided to, it is shown already at its end.
      requestAnimationFrame(this.tryReveal.bind(this));
      return;
    }
    if (this.stick) {
      queueMicrotask(this.glideToEnd.bind(this));
    }
  }

  /** Another conversation was opened: hide it, and show it as soon as it is drawn and at its end (or after a short wait). */
  private openConversation(): void {
    this.openedChannel = this.channelId();
    this.stick = true;
    this.stopFollowing();
    clearTimeout(this.revealTimer);
    if (document.documentElement.dataset['motion'] === 'reduced') {
      this.revealed.set(true);
      setTimeout(this.scrollToBottom.bind(this, false), 0);
      return;
    }
    this.revealed.set(false);
    // ! If the messages take long to arrive, the list is shown anyway so the screen never stays empty.
    this.revealTimer = setTimeout(this.reveal.bind(this), 700);
    requestAnimationFrame(this.tryReveal.bind(this));
  }

  /** Shows the conversation once it has messages (or is known to be empty): at its end, then it fades in. */
  private tryReveal(): void {
    if (this.revealed()) return;
    const state = this.state();
    if (state.messages().length || state.loaded()) this.reveal();
  }

  /** Puts the conversation at its end at once and fades it in. */
  private reveal(): void {
    clearTimeout(this.revealTimer);
    if (this.revealed()) return;
    this.scrollToBottom(false);
    requestAnimationFrame(
      function (this: MessageListComponent) {
        this.scrollToBottom(false);
        this.revealed.set(true);
      }.bind(this),
    );
  }

  /** Starts watching how tall the conversation is: a picture, a GIF or a block of code that loads must not leave the end out of sight. */
  private watchSize(): void {
    this.lastHeight = this.content().nativeElement.offsetHeight;
    this.resizer = new ResizeObserver(this.onResize.bind(this));
    this.resizer.observe(this.content().nativeElement);
  }

  /** The conversation changed height: when it grew and the reader is at the end, it keeps the end in sight. */
  private onResize(): void {
    const height = this.content().nativeElement.offsetHeight;
    const grew = height > this.lastHeight;
    this.lastHeight = height;
    if (!this.revealed()) {
      requestAnimationFrame(this.tryReveal.bind(this));
      return;
    }
    if (grew && this.stick) {
      this.glideToEnd();
    }
  }

  /** Stops watching and gliding. */
  private stopWatching(): void {
    clearTimeout(this.revealTimer);
    this.resizer?.disconnect();
    cancelAnimationFrame(this.glide);
  }

  /** The conversation that is on screen (the list is hidden and put at its end when it changes). */
  private openedChannel = '';
  private glideFrom = 0;
  private glideStart = 0;
  private glideTime = 600;

  /** The reader took the scroll: the glide stops. */
  protected stopFollowing(): void {
    cancelAnimationFrame(this.glide);
    this.glide = 0;
  }

  /**
   * Glides to the end in a fixed time (longer when there is more to go), starting slowly, going fast in the middle and
   * landing softly. If the list grows while it glides, the target moves with it.
   */
  private glideToEnd(always = false): void {
    if (this.glide) {
      return;
    }
    const el = this.scroller().nativeElement;
    // ! Far from the end (a conversation that was just opened and drew its messages after being put at its end) it jumps instead of
    //   gliding: a long glide from the top looked like the chat going up and coming back.
    const far = el.scrollHeight - el.clientHeight - el.scrollTop > el.clientHeight * 1.5;
    if (document.documentElement.dataset['motion'] === 'reduced' || (far && !always)) {
      this.scrollToBottom(false);
      return;
    }
    this.glideFrom = el.scrollTop;
    this.glideStart = performance.now();
    this.glideTime = Math.min(900, 380 + (el.scrollHeight - el.clientHeight - el.scrollTop) * 0.12);
    this.glide = requestAnimationFrame(this.glideStep.bind(this));
  }

  /** One frame of the glide. */
  private glideStep(now: number): void {
    const el = this.scroller().nativeElement;
    const progress = Math.min(1, (now - this.glideStart) / this.glideTime);
    // ease in and out (cubic)
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    const end = el.scrollHeight - el.clientHeight;
    el.scrollTop = this.glideFrom + (end - this.glideFrom) * eased;
    if (progress >= 1) {
      this.glide = 0;
      return;
    }
    this.glide = requestAnimationFrame(this.glideStep.bind(this));
  }

  /** A message is deleted: it fades and folds away (its space closes smoothly) before it leaves the list. */
  protected onLeave(event: AnimationCallbackEvent): void {
    const el = event.target as HTMLElement;
    if (document.documentElement.dataset['motion'] === 'reduced' || !el.animate) {
      event.animationComplete();
      return;
    }
    const height = el.offsetHeight;
    el.style.overflow = 'hidden';
    const run = el.animate(
      [
        { height: height + 'px', opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateX(-14px) scale(0.97)', offset: 0.45 },
        { height: '0px', opacity: 0, transform: 'translateX(-14px) scale(0.97)' },
      ],
      { duration: 380, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
    );
    run.addEventListener('finish', function done(): void {
      event.animationComplete();
    });
  }

  /** The person scrolled: the list follows new messages only while they are at the end. */
  protected onScroll(): void {
    if (this.glide) {
      return;
    }
    const el = this.scroller().nativeElement;
    this.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    this.atBottom.set(this.stick);
    if (el.scrollTop < 40) void this.loadOlderKeepingPosition();
  }

  /** Loads older messages and keeps the person where they were reading. */
  private async loadOlderKeepingPosition(): Promise<void> {
    const el = this.scroller().nativeElement;
    const before = el.scrollHeight;
    await this.store.loadOlder(this.channelId());
    requestAnimationFrame(function () {
      return (el.scrollTop += el.scrollHeight - before);
    });
  }

  /** The "Latest" button: the conversation glides to its end and the button fades out at once (it is not needed any more). */
  protected jumpToLatest(): void {
    this.atBottom.set(true);
    this.scrollToBottom(true);
  }

  /** Goes to the end of the conversation, gliding or at once. */
  scrollToBottom(smooth: boolean): void {
    this.stick = true;
    if (smooth) {
      this.glideToEnd(true);
      return;
    }
    const el = this.scroller().nativeElement;
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  }
}
