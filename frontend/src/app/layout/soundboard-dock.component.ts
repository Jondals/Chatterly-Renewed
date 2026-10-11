/**
 * src/app/layout/soundboard-dock.component.ts
 * The soundboard of a call: a few effects that come with the app and the person's own sounds, which they can sort in
 * categories of their own. Whatever is played is heard by everybody in the call (the sounds of the person are sent to
 * the others once, encrypted).
 *
 * * The list is drawn little by little (one screen first, more while it is scrolled), so a soundboard with hundreds of
 * sounds opens as fast as an empty one.
 */
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  EnvironmentInjector,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { I18nService, TranslatePipe } from '../core/i18n/i18n.service';
import { CallService } from '../core/services/call.service';
import { ContextMenuService, type MenuItem } from '../core/services/context-menu.service';
import { DialogService } from '../core/services/dialog.service';
import { SettingsService } from '../core/services/settings.service';
import { SoundboardStore, type CustomSound } from '../core/services/soundboard.store';
import { SOUNDBOARD, SoundService, type SfxId } from '../core/services/sound.service';
import { ToastService } from '../core/services/toast.service';
import { UiService } from '../core/services/ui.service';
import { MessageStore, type OutgoingFile } from '../store/message.store';
import { IconComponent } from '../shared/components/icon.component';

/** What a tile of the soundboard is: an effect of the app or a sound of the person. */
type Tile =
  | { kind: 'effect'; id: SfxId; icon: string; label: string }
  | { kind: 'own'; clip: CustomSound };

/** A part of the list: the sounds of one category (the first part has no title). */
interface Part {
  id: string;
  name: string;
  tiles: Tile[];
  /** How many sounds it has (also when it is folded and none is drawn). */
  count: number;
}

/** Tiles drawn when a tab opens (five rows of three, enough to fill the panel). */
const FIRST_TILES = 15;
/** Tiles added each time the end of the list gets close. */
const MORE_TILES = 12;
/** How close to the end (pixels) the next tiles are drawn. */
const AHEAD_PX = 260;
/** The longest name of a category. */
const CATEGORY_NAME_MAX = 20;

/** A floating soundboard available anywhere. */
@Component({
  selector: 'app-soundboard-dock',
  standalone: true,
  imports: [IconComponent, NgTemplateOutlet, TranslatePipe],
  template: `
    @if (ui.soundboardOpen()) {
      @if (ui.soundboardAnchor(); as anchor) {
        <div
          animate.leave="leave-pop"
          class="sb-pop anim-pop fixed z-[75] flex max-h-[min(34rem,72dvh)] flex-col overflow-hidden rounded-ui-lg border border-white/10 bg-ink-800 shadow-2xl"
          [style.left.px]="left(anchor)"
          [style.bottom.px]="bottom(anchor)"
          [style.width.px]="width()"
          (mousedown)="$event.stopPropagation()"
        >
          <ng-container [ngTemplateOutlet]="board" />
        </div>
      } @else {
        <div
          animate.leave="leave-fade"
          class="anim-fade-in fixed inset-0 z-[75] flex items-center justify-center bg-black/55 p-3 sm:p-4"
          (mousedown)="ui.soundboardOpen.set(false)"
        >
          <div
            animate.leave="leave-pop"
            class="anim-pop flex max-h-[min(40rem,90dvh)] w-[32rem] max-w-full flex-col overflow-hidden rounded-ui-lg border border-white/10 bg-ink-800 shadow-2xl"
            (mousedown)="$event.stopPropagation()"
          >
            <ng-container [ngTemplateOutlet]="board" />
          </div>
        </div>
      }
    }

    <ng-template #board>
      <div class="sb-head">
        <span class="sb-mark"><app-icon name="music" [size]="20" /></span>
        <div class="min-w-0 flex-1">
          <div class="text-[0.95rem] font-semibold">{{ 'Soundboard' | t }}</div>
          <div class="text-[0.6875rem] text-muted">
            {{
              call.inCall()
                ? 'Everybody in the call hears what you play.'
                : ('Join a call to share them: now only you hear them.' | t)
            }}
          </div>
        </div>
        <button
          type="button"
          class="btn btn-icon btn-sm btn-ghost"
          (click)="ui.soundboardOpen.set(false)"
          [attr.aria-label]="'Close' | t"
        >
          <app-icon name="x" [size]="15" />
        </button>
      </div>

      <div class="sb-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="sb-pill"
          [class.is-on]="current() === 'all'"
          [attr.aria-selected]="current() === 'all'"
          (click)="open('all')"
        >
          <app-icon name="grid" [size]="14" />
          {{ 'All' | t }}
        </button>
        @for (category of settings.soundCategories(); track category.id) {
          <button
            type="button"
            role="tab"
            class="sb-pill"
            [class.is-on]="current() === category.id"
            [attr.aria-selected]="current() === category.id"
            (click)="open(category.id)"
          >
            {{ category.name }}
          </button>
        }
        <button
          type="button"
          class="sb-pill"
          [attr.aria-label]="'New category' | t"
          [attr.title]="'New category' | t"
          (click)="newCategory()"
        >
          <app-icon name="plus" [size]="14" />
        </button>
      </div>

      <div class="sb-volume">
        <app-icon name="volume" [size]="15" class="text-muted" />
        <input
          type="range"
          min="0"
          max="100"
          class="ui-range min-w-0 flex-1"
          [style.--p.%]="settings.callEffectsVolume()"
          [value]="settings.callEffectsVolume()"
          (input)="settings.callEffectsVolume.set(+$any($event.target).value)"
          [attr.aria-label]="'Soundboard volume' | t"
        />
        <b class="w-10 text-right font-mono text-xs text-accent"
          >{{ settings.callEffectsVolume() }}%</b
        >
      </div>

      @if (category(); as c) {
        <div class="flex items-center gap-2 border-b border-white/8 px-5 py-2 text-xs text-muted">
          <span class="min-w-0 flex-1 truncate font-semibold text-fg">{{ c.name }}</span>
          <button type="button" class="btn btn-sm btn-ghost gap-1" (click)="sharePack(c.id)">
            <app-icon name="send" [size]="12" /> {{ 'Share as a pack' | t }}
          </button>
          <button type="button" class="btn btn-sm btn-ghost gap-1" (click)="renameCategory(c.id)">
            <app-icon name="edit" [size]="12" /> {{ 'Rename' | t }}
          </button>
          <button
            type="button"
            class="btn btn-sm btn-ghost btn-soft-danger gap-1"
            (click)="deleteCategory(c.id)"
          >
            <app-icon name="trash" [size]="12" /> {{ 'Delete category' | t }}
          </button>
        </div>
      }

      <div
        #scroller
        class="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-1"
        (scroll)="drawMore(scroller)"
      >
        @for (tab of [current()]; track tab) {
          <div class="anim-fade-in">
            <button type="button" class="sb-add" (click)="upload()">
              <app-icon name="plus" [size]="15" /> {{ 'Add a sound' | t }}
            </button>
            @for (part of visibleParts(); track part.id) {
              @if (part.name) {
                <button
                  type="button"
                  class="sb-section"
                  [attr.aria-expanded]="!isClosed(part.id)"
                  (click)="toggleSection(part.id)"
                >
                  <app-icon
                    name="chevron-down"
                    [size]="14"
                    class="transition-transform duration-200"
                    [class.-rotate-90]="isClosed(part.id)"
                  />
                  <span class="flex-1 truncate text-left">{{ part.name | t }}</span>
                  <span class="count-pill">{{ part.count }}</span>
                </button>
              }
              <div class="sb-grid grid grid-cols-3 gap-2.5">
                @for (tile of part.tiles; track tileKey(tile)) {
                  @if (tile.kind === 'effect') {
                    <button
                      type="button"
                      class="sb-tile"
                      [class.is-hit]="hit() === tile.id"
                      (click)="playBuiltin(tile.id)"
                    >
                      <span class="emoji-glyph text-2xl leading-none">{{ tile.icon }}</span>
                      <span class="w-full truncate text-[0.6875rem]">{{ tile.label | t }}</span>
                    </button>
                  } @else {
                    <div class="group relative">
                      <button
                        type="button"
                        class="sb-tile h-full w-full"
                        [class.is-hit]="hit() === tile.clip.id"
                        (click)="playClip(tile.clip)"
                      >
                        @if (tile.clip.emoji) {
                          <span class="emoji-glyph text-2xl leading-none">{{
                            tile.clip.emoji
                          }}</span>
                        } @else {
                          <app-icon name="music" [size]="22" class="text-accent" />
                        }
                        <span class="w-full truncate text-[0.6875rem]">{{ tile.clip.name }}</span>
                      </button>
                      <button
                        type="button"
                        class="sb-act absolute left-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-accent group-hover:flex"
                        (click)="edit(tile.clip)"
                        [attr.aria-label]="'Edit the sound' | t"
                      >
                        <app-icon name="edit" [size]="11" />
                      </button>
                      <button
                        type="button"
                        class="sb-act absolute bottom-1 left-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-muted group-hover:flex"
                        (click)="shareClip(tile.clip)"
                        [attr.aria-label]="'Send to the chat' | t"
                        [attr.title]="'Send to the chat' | t"
                      >
                        <app-icon name="send" [size]="11" />
                      </button>
                      @if (settings.soundCategories().length) {
                        <button
                          type="button"
                          class="sb-act absolute bottom-1 right-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-muted group-hover:flex"
                          (click)="moveMenu($event, tile.clip)"
                          [attr.aria-label]="'Move to a category' | t"
                          [attr.title]="'Move to a category' | t"
                        >
                          <app-icon name="tag" [size]="11" />
                        </button>
                      }
                      <button
                        type="button"
                        class="sb-act absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-red-300 group-hover:flex"
                        (click)="store.remove(tile.clip.id)"
                        [attr.aria-label]="'Delete' | t"
                      >
                        <app-icon name="x" [size]="11" />
                      </button>
                    </div>
                  }
                }
              </div>
            }
          </div>
        }
        <p class="mt-3 text-[0.6875rem] leading-snug text-dim">
          {{
            'Add any audio file and keep the part you want (up to 30 seconds): you can cut it, rename it and give it an emoji. Everybody in the call hears it; it is sent once, encrypted, and kept only on your device.'
              | t
          }}
        </p>
      </div>
    </ng-template>
  `,
  styles: `
    @media (hover: none) {
      .sb-act {
        display: flex;
      }
    }
  `,
})
export class SoundboardDockComponent {
  protected readonly ui = inject(UiService);
  protected readonly store = inject(SoundboardStore);
  protected readonly call = inject(CallService);
  protected readonly settings = inject(SettingsService);
  private readonly sound = inject(SoundService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly dialog = inject(DialogService);
  private readonly menu = inject(ContextMenuService);
  private readonly injector = inject(EnvironmentInjector);
  private readonly messages = inject(MessageStore);
  /** The tab shown: 'all' or the id of a category. */
  protected readonly current = signal('all');
  /** The sound that was just played (it lights up for a moment). */
  protected readonly hit = signal<string | null>(null);
  /** How many tiles are drawn so far. */
  private readonly drawn = signal(FIRST_TILES);
  private hitTimer: ReturnType<typeof setTimeout> | undefined;

  /** The category of the open tab (null in "All"). */
  protected readonly category = computed(this.findCategory.bind(this));
  /** Every part of the open tab with all its tiles. */
  private readonly parts = computed(this.buildParts.bind(this));
  /** The parts cut to the tiles that are drawn so far. */
  protected readonly visibleParts = computed(this.cutParts.bind(this));

  constructor() {
    void this.store.load();
    inject(DestroyRef).onDestroy(this.clearHit.bind(this));
  }

  /** The category of the open tab. */
  private findCategory(): { id: string; name: string } | null {
    const id = this.current();
    return (
      this.settings.soundCategories().find(function same(category) {
        return category.id === id;
      }) ?? null
    );
  }

  /**
   * The sounds of the open tab. In "All": the ones that come with the app ("Default"), the person's own without category
   * ("Custom") and each category, every one a part that can be folded. In a category: just its sounds.
   */
  private buildParts(): Part[] {
    const clips = this.store.clips();
    const categories = this.settings.soundCategories();
    const own = function own(clip: CustomSound): Tile {
      return { kind: 'own', clip };
    };
    const open = this.current();
    if (open !== 'all') {
      const tiles = clips
        .filter(function inCategory(clip) {
          return clip.category === open;
        })
        .map(own);
      return [{ id: open, name: '', tiles, count: tiles.length }];
    }
    const known = new Set(
      categories.map(function id(category) {
        return category.id;
      }),
    );
    const defaults: Tile[] = SOUNDBOARD.map(function effect(entry): Tile {
      return { kind: 'effect', id: entry.id, icon: entry.icon, label: entry.label };
    });
    const custom = clips
      .filter(function loose(clip) {
        return !clip.category || !known.has(clip.category);
      })
      .map(own);
    const parts: Part[] = [
      { id: 'default', name: 'Default sounds', tiles: defaults, count: defaults.length },
    ];
    if (custom.length) {
      parts.push({ id: 'custom', name: 'Custom sounds', tiles: custom, count: custom.length });
    }
    for (const category of categories) {
      const tiles = clips
        .filter(function inCategory(clip) {
          return clip.category === category.id;
        })
        .map(own);
      if (tiles.length) {
        parts.push({ id: category.id, name: category.name, tiles, count: tiles.length });
      }
    }
    return parts;
  }

  /** The parts with only the first tiles; a folded part has none (its header still tells how many it has). */
  private cutParts(): Part[] {
    let left = this.drawn();
    const closed = this.closed();
    const out: Part[] = [];
    for (const part of this.parts()) {
      if (part.name && closed.includes(part.id)) {
        out.push({ ...part, tiles: [] });
        continue;
      }
      out.push({ ...part, tiles: part.tiles.slice(0, Math.max(0, left)) });
      left -= part.tiles.length;
    }
    return out;
  }

  /** The parts that are folded (by id). */
  private readonly closed = signal<string[]>([]);

  /** Whether a part is folded. */
  protected isClosed(id: string): boolean {
    return this.closed().includes(id);
  }

  /** Folds or opens a part. */
  protected toggleSection(id: string): void {
    this.closed.update(function flip(list) {
      return list.includes(id)
        ? list.filter(function other(entry) {
            return entry !== id;
          })
        : [...list, id];
    });
  }

  /** A key that tells a tile from the others while the list is redrawn. */
  protected tileKey(tile: Tile): string {
    return tile.kind === 'effect' ? 'effect:' + tile.id : 'own:' + tile.clip.id;
  }

  /** Opens a tab: the list starts again with its first tiles. */
  protected open(tab: string): void {
    this.current.set(tab);
    this.drawn.set(FIRST_TILES);
  }

  /** The list was scrolled: when its end is near, more tiles are drawn. */
  protected drawMore(box: HTMLElement): void {
    if (box.scrollTop + box.clientHeight < box.scrollHeight - AHEAD_PX) {
      return;
    }
    let total = 0;
    for (const part of this.parts()) {
      total += part.tiles.length;
    }
    if (this.drawn() < total) {
      this.drawn.set(this.drawn() + MORE_TILES);
    }
  }

  /** Asks for the name of a new category and opens it. */
  protected async newCategory(): Promise<void> {
    const name = await this.dialog.prompt(
      this.i18n.t('New category'),
      this.i18n.t('Sounds can be sorted in categories of your own.'),
      '',
      this.i18n.t('Name'),
    );
    const clean = (name ?? '').trim().slice(0, CATEGORY_NAME_MAX);
    if (!clean) {
      return;
    }
    const id = crypto.randomUUID();
    this.settings.soundCategories.set([...this.settings.soundCategories(), { id, name: clean }]);
    this.open(id);
  }

  /** Changes the name of a category. */
  protected async renameCategory(id: string): Promise<void> {
    const current = this.category();
    const name = await this.dialog.prompt(
      this.i18n.t('Rename'),
      this.i18n.t('Sounds can be sorted in categories of your own.'),
      current?.name ?? '',
      this.i18n.t('Name'),
    );
    const clean = (name ?? '').trim().slice(0, CATEGORY_NAME_MAX);
    if (!clean) {
      return;
    }
    this.settings.soundCategories.set(
      this.settings.soundCategories().map(function rename(category) {
        return category.id === id ? { ...category, name: clean } : category;
      }),
    );
  }

  /** Deletes a category: its sounds are kept, without category. */
  protected async deleteCategory(id: string): Promise<void> {
    const ok = await this.dialog.confirm(
      this.i18n.t('Delete category'),
      this.i18n.t('Its sounds are kept: they go back to All.'),
      { confirmLabel: this.i18n.t('Delete'), danger: true },
    );
    if (!ok) {
      return;
    }
    for (const clip of this.store.clips()) {
      if (clip.category === id) {
        await this.store.setCategory(clip.id, undefined);
      }
    }
    this.settings.soundCategories.set(
      this.settings.soundCategories().filter(function keep(category) {
        return category.id !== id;
      }),
    );
    this.open('all');
  }

  /** Opens the menu that moves a sound to a category. */
  protected moveMenu(event: MouseEvent, clip: CustomSound): void {
    const items: MenuItem[] = [];
    const store = this.store;
    if (clip.category) {
      items.push({
        label: this.i18n.t('No category'),
        icon: 'grid',
        action: function none(): void {
          void store.setCategory(clip.id, undefined);
        },
      });
    }
    for (const category of this.settings.soundCategories()) {
      if (category.id !== clip.category) {
        items.push({
          label: category.name,
          icon: 'tag',
          action: function move(): void {
            void store.setCategory(clip.id, category.id);
          },
        });
      }
    }
    this.menu.open(event, items);
  }

  /** A sound of the person as a file of a message, marked for the soundboard of whoever receives it. */
  private fileOf(clip: CustomSound, pack?: string): OutgoingFile {
    const type = clip.blob.type || 'audio/wav';
    const extension = type.includes('mpeg') ? '.mp3' : type.includes('ogg') ? '.ogg' : '.wav';
    return {
      data: clip.blob,
      name: clip.name + extension,
      mime: type,
      soundboard: true,
      emoji: clip.emoji,
      pack,
    };
  }

  /** Sends a message with these sounds to the chat that is open (or says there is none). */
  private async sendToChat(files: OutgoingFile[]): Promise<void> {
    const channel = this.ui.chatChannelId();
    if (!channel || files.length === 0) {
      this.toast.error(this.i18n.t('Open a chat to send it there.'));
      return;
    }
    try {
      await this.messages.send(channel, { text: '', files });
      this.toast.success(this.i18n.t('Sent to the chat'));
    } catch (e) {
      this.toast.error(
        this.i18n.t('Message not sent'),
        this.i18n.t(e instanceof Error ? e.message : 'Unknown error'),
      );
    }
  }

  /** Sends one sound to the chat: the people who get it can add it to their soundboard. */
  protected shareClip(clip: CustomSound): Promise<void> {
    return this.sendToChat([this.fileOf(clip)]);
  }

  /** Sends all the sounds of a category as a pack: whoever gets it adds all of them with one button. */
  protected sharePack(categoryId: string): Promise<void> {
    const category = this.settings.soundCategories().find(function same(entry) {
      return entry.id === categoryId;
    });
    const pack = category?.name ?? '';
    const files = this.store
      .clips()
      .filter(function inCategory(clip) {
        return clip.category === categoryId;
      })
      .map(
        function toFile(this: SoundboardDockComponent, clip: CustomSound) {
          return this.fileOf(clip, pack);
        }.bind(this),
      );
    return this.sendToChat(files);
  }

  /** Width of the board when it opens from the button of the call. */
  protected width(): number {
    return Math.min(560, window.innerWidth - 16);
  }

  /** Left edge of the board: centered over the button, kept inside the window. */
  protected left(anchor: DOMRect): number {
    const width = this.width();
    return Math.min(
      Math.max(8, anchor.left + anchor.width / 2 - width / 2),
      window.innerWidth - width - 8,
    );
  }

  /** Distance from the bottom of the window: the board opens upward from the button. */
  protected bottom(anchor: DOMRect): number {
    return window.innerHeight - anchor.top + 12;
  }

  /** Forgets the pending highlight. */
  private clearHit(): void {
    clearTimeout(this.hitTimer);
  }

  /** A press anywhere else closes the board (but not a press inside the windows that open from it). */
  @HostListener('document:mousedown', ['$event']) closeOutside(event: MouseEvent) {
    const target = event.target as Element;
    if (!target.closest('app-sound-edit, app-context-menu, app-toast-host')) {
      this.ui.soundboardOpen.set(false);
    }
  }

  /** Lights a sound up for a moment. */
  private flash(id: string): void {
    this.hit.set(id);
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(this.endFlash.bind(this), 500);
  }

  /** The highlight ends. */
  private endFlash(): void {
    this.hit.set(null);
  }

  /** Plays an effect: for everybody in the call, or only here when there is no call. */
  protected playBuiltin(id: SfxId): void {
    this.flash(id);
    if (this.call.inCall()) this.call.sendSfx(id);
    else this.sound.sfx(id);
  }

  /** Plays a sound of the person here and for the call. */
  protected playClip(clip: CustomSound): void {
    this.flash(clip.id);
    void this.call.sendClip(clip);
  }

  /** Adds a sound chosen by the person (to the open category): it opens the window to cut and name it. */
  protected async upload(): Promise<void> {
    const file = await this.store.pickFile();
    if (!file) return;
    try {
      const editor = await import('../shared/components/sound-edit.component');
      if (file.size > editor.MAX_SOURCE_BYTES) {
        throw new Error('Sounds can be up to 25 MB.');
      }
      const result = await editor.editSound(
        this.injector,
        file,
        null,
        file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Sound',
      );
      if (result) {
        const open = this.current();
        await this.store.save({
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          category: open === 'all' ? undefined : open,
          ...result,
        });
        this.toast.success(this.i18n.t('Sound added'));
      }
    } catch (e) {
      this.toast.error(
        this.i18n.t('Could not add the sound'),
        this.i18n.t(e instanceof Error ? e.message : 'Unknown error'),
      );
    }
  }

  /**
   * Edits a sound: cut, name and emoji. The edited sound gets a new identity, so the people in a call (who keep the
   * sounds they received by identity) get the new one instead of the old.
   */
  protected async edit(clip: CustomSound): Promise<void> {
    try {
      const editor = await import('../shared/components/sound-edit.component');
      const result = await editor.editSound(
        this.injector,
        clip.original ?? clip.blob,
        clip,
        clip.name,
      );
      if (result) {
        await this.store.remove(clip.id);
        await this.store.save({
          id: crypto.randomUUID(),
          createdAt: clip.createdAt,
          category: clip.category,
          ...result,
        });
        this.toast.success(this.i18n.t('Sound updated'));
      }
    } catch (e) {
      this.toast.error(
        this.i18n.t('Could not add the sound'),
        this.i18n.t(e instanceof Error ? e.message : 'Unknown error'),
      );
    }
  }
}
