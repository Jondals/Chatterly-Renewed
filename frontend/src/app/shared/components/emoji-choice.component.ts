/**
 * src/app/shared/components/emoji-choice.component.ts
 * Chooses ONE emoji: a row of quick choices and a "more" panel with every emoji (search and categories).
 * Used for the icon of the tag of a group.
 */
import { Component, computed, inject, input, model, signal } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { loadEmojiData, type EmojiEntry } from '../util/emoji-data';
import { IconComponent } from './icon.component';

/** The categories of the full list (the number is the `group` of the emoji data) and the emoji that stands for each. */
const CATEGORIES: { id: number; icon: string; name: string }[] = [
  { id: 0, icon: '😀', name: 'Smileys & emotion' },
  { id: 1, icon: '👋', name: 'People & body' },
  { id: 3, icon: '🐶', name: 'Animals & nature' },
  { id: 4, icon: '🍎', name: 'Food & drink' },
  { id: 5, icon: '✈️', name: 'Travel & places' },
  { id: 6, icon: '⚽', name: 'Activities' },
  { id: 7, icon: '💡', name: 'Objects' },
  { id: 8, icon: '❤️', name: 'Symbols' },
  { id: 9, icon: '🏳️', name: 'Flags' },
];
/** Most emoji shown at once in the panel (a search narrows it down much sooner). */
const MAX_SHOWN = 320;

/** One emoji out of all of them. `value` is the chosen one, or '' for none. */
@Component({
  selector: 'app-emoji-choice',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="flex flex-wrap items-center gap-1">
      <button
        type="button"
        class="choice-card !min-h-0 px-2 py-1 text-xs"
        [class.is-on]="!value()"
        (click)="choose('')"
      >
        {{ 'No icon' | t }}
      </button>
      @for (icon of shown(); track icon) {
        <button
          type="button"
          class="choice-card !min-h-0 px-2 py-1 text-base"
          [class.is-on]="value() === icon"
          [attr.aria-label]="icon"
          (click)="choose(icon)"
        >
          {{ icon }}
        </button>
      }
      <button
        type="button"
        class="choice-card !min-h-0 gap-1 px-2 py-1 text-xs"
        [class.is-on]="open()"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <app-icon name="smile" [size]="14" /> {{ 'Any emoji' | t }}
      </button>
    </div>
    @if (open()) {
      <div class="mt-2 rounded-ui border border-white/8 bg-black/25 p-2">
        <input
          type="search"
          class="input w-full"
          [value]="query()"
          [placeholder]="'Search an emoji' | t"
          [attr.aria-label]="'Search an emoji' | t"
          (input)="query.set($any($event.target).value)"
        />
        @if (!query().trim()) {
          <div class="mt-2 flex gap-0.5 overflow-x-auto">
            @for (c of categories; track c.id) {
              <button
                type="button"
                class="rounded-ui px-2 py-1 text-lg hover:bg-white/10"
                [class.bg-white/10]="group() === c.id"
                [attr.title]="c.name | t"
                (click)="group.set(c.id)"
              >
                {{ c.icon }}
              </button>
            }
          </div>
        }
        <div class="mt-2 grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto sm:grid-cols-10">
          @if (loading()) {
            <span class="col-span-full p-3 text-center text-xs text-muted">{{
              'Loading…' | t
            }}</span>
          } @else {
            @for (entry of results(); track entry.hexcode) {
              <button
                type="button"
                class="aspect-square rounded-ui text-xl hover:bg-white/10"
                [class.bg-white/10]="value() === entry.unicode"
                [attr.title]="entry.label"
                [attr.aria-label]="entry.label"
                (click)="choose(entry.unicode)"
              >
                {{ entry.unicode }}
              </button>
            } @empty {
              <span class="col-span-full p-3 text-center text-xs text-muted">{{
                'No emoji found' | t
              }}</span>
            }
          }
        </div>
      </div>
    }
  `,
})
export class EmojiChoiceComponent {
  /** The chosen emoji ('' for none). */
  readonly value = model('');
  /** The emoji offered in the quick row. */
  readonly quick = input<string[]>([]);

  private readonly i18n = inject(I18nService);
  protected readonly categories = CATEGORIES;
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly query = signal('');
  protected readonly group = signal(0);
  private readonly all = signal<EmojiEntry[]>([]);

  /** The quick row, plus the chosen emoji when it is not one of them (so what is chosen is always visible). */
  protected readonly shown = computed(
    function (this: EmojiChoiceComponent) {
      const quick = this.quick();
      const chosen = this.value();
      return chosen && !quick.includes(chosen) ? [...quick, chosen] : quick;
    }.bind(this),
  );

  /** What the panel lists: the search results, or the emoji of the chosen category. */
  protected readonly results = computed(this.findResults.bind(this));

  protected choose(emoji: string): void {
    this.value.set(emoji);
    if (emoji) {
      this.open.set(false);
    }
  }

  /** Opens or closes the panel (the list of emoji is downloaded the first time). */
  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next && this.all().length === 0) {
      this.loading.set(true);
      loadEmojiData(this.i18n.lang())
        .then(this.all.set.bind(this.all))
        .catch(function ignore(): void {
          return undefined;
        })
        .finally(this.loading.set.bind(this.loading, false));
    }
  }

  private findResults(): EmojiEntry[] {
    const query = this.query().trim().toLowerCase();
    const list = this.all();
    if (!query) {
      const group = this.group();
      return list
        .filter(function inGroup(entry): boolean {
          return entry.group === group;
        })
        .slice(0, MAX_SHOWN);
    }
    return list
      .filter(function matches(entry): boolean {
        return (
          entry.label.toLowerCase().includes(query) ||
          (entry.tags ?? []).some(function tagMatches(tag): boolean {
            return tag.toLowerCase().includes(query);
          })
        );
      })
      .slice(0, MAX_SHOWN);
  }
}
