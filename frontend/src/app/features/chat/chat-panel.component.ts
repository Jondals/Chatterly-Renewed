/**
 * src/app/features/chat/chat-panel.component.ts
 * Panel de chat: lista de mensajes, escritura y arrastrar archivos.
 */
import {
  Component,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DirectoryService } from '../../core/services/directory.service';
import { IconComponent } from '../../shared/components/icon.component';
import { MessageStore, type ViewMessage } from '../../store/message.store';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { MessageInputComponent } from './message-input.component';
import { MessageListComponent } from './message-list.component';

/**
 * Conversation body (history + composer) shared by DMs, guild channels and the in-call feed.
 * Opening it marks the conversation as being viewed, which silences notifications for it.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-chat-panel',
  standalone: true,
  imports: [MessageListComponent, MessageInputComponent, IconComponent, TranslatePipe],
  host: {
    class: 'relative flex h-full min-h-0 flex-col',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'dragging.set(false)',
    '(drop)': 'onDrop($event)',
  },
  template: `
    @if (keyChangedWith(); as other) {
      <div
        class="anim-fade-up mx-3 mt-2 flex items-center gap-3 rounded-ui border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber"
        role="alert"
      >
        <app-icon name="alert-triangle" [size]="16" />
        <span class="flex-1"
          ><b>{{ "{name}'s security code changed." | t: { name: other.displayName } }}</b>
          {{
            'This can mean a new device — or someone intercepting. Verify their safety number before sharing secrets.'
              | t
          }}</span
        >
        <button class="btn btn-sm" type="button" (click)="directory.acceptKeyChange(other.id)">
          {{ 'Trust new key' | t }}
        </button>
      </div>
    }
    <app-message-list
      [channelId]="channelId()"
      [canModerate]="canModerate()"
      (replyTo)="replying.set($event)"
    />
    <app-message-input
      [channelId]="channelId()"
      [placeholder]="placeholder()"
      [replyingTo]="replying()"
      (cancelReply)="replying.set(null)"
    />

    @if (dragging()) {
      <div
        class="anim-fade-in pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-ui-lg border-2 border-dashed border-accent bg-ink-950/80 backdrop-blur"
      >
        <div class="text-center">
          <div class="animate-float text-5xl">📎</div>
          <div class="mt-2 text-lg font-bold text-accent">{{ 'Drop to encrypt & attach' | t }}</div>
        </div>
      </div>
    }
  `,
})
export class ChatPanelComponent implements OnDestroy {
  readonly channelId = input.required<string>();
  readonly placeholder = input('Type a message or paste a snippet…');
  readonly canModerate = input(false);
  /** For DMs: the other person, so we can warn when their identity key changes. */
  readonly peerId = input<string | null>(null);

  protected readonly store = inject(MessageStore);
  protected readonly directory = inject(DirectoryService);
  protected readonly replying = signal<ViewMessage | null>(null);
  protected readonly dragging = signal(false);
  private readonly composer = viewChild(MessageInputComponent);

  /** The friend whose security code changed, if the chat is with them, to warn the person. */
  protected keyChangedWith() {
    const id = this.peerId();
    return id && this.directory.keyChanges().has(id) ? this.directory.get(id) : undefined;
  }

  constructor() {
    effect(
      function (this: ChatPanelComponent) {
        const id = this.channelId();
        untracked(
          function (this: ChatPanelComponent) {
            this.replying.set(null);
            this.store.viewing.set(id);
            void this.store.open(id).catch(function () {
              return undefined;
            });
          }.bind(this),
        );
      }.bind(this),
    );
  }

  /** A file is dragged over the chat: the drop area is shown. */
  protected onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      this.dragging.set(true);
    }
  }

  /** A file was dropped: it goes to the box to be sent. */
  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (event.dataTransfer?.files.length) this.composer()?.addFiles(event.dataTransfer.files);
  }

  /** Forgets that the chat was in view. */
  ngOnDestroy(): void {
    if (this.store.viewing() === this.channelId()) this.store.viewing.set(null);
  }
}
