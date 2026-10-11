/**
 * src/app/shared/components/server-tag.component.ts
 * The tag of a group ("server tag") next to the name of a person: a small pill with an icon and up to four letters, in the
 * color the owner of the group chose. The person decides in their profile whether to show it.
 */
import { Component, computed, input } from '@angular/core';
import type { ServerTag } from '../../core/models';

/** The icons the owner of a group chooses from (the server accepts only these). */
export const TAG_ICONS = [
  '💎',
  '🔥',
  '⚡',
  '🌙',
  '⭐',
  '🛡️',
  '👑',
  '🎮',
  '🎵',
  '🌸',
  '🐺',
  '🐉',
  '🍀',
  '☠️',
  '🚀',
  '🎯',
];

/** The colors offered for a tag. */
export const TAG_COLORS = [
  '#7c8cff',
  '#2ef2b0',
  '#ff4d8d',
  '#ffb02e',
  '#38bdf8',
  '#a855f7',
  '#ef4444',
  '#84cc16',
  '#f97316',
  '#e5e7eb',
];

/** A small pill with the tag of a group. */
@Component({
  selector: 'app-server-tag',
  standalone: true,
  template: `
    @if (tag(); as t) {
      @if (t.text) {
        <span class="server-tag" [style.--tag]="t.color" [attr.title]="title()">
          @if (t.icon) {
            <span class="server-tag-icon" aria-hidden="true">{{ t.icon }}</span>
          }
          {{ t.text }}</span
        >
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
      flex-shrink: 0;
    }
    .server-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.05rem 0.45rem 0.05rem 0.35rem;
      border-radius: 0.45rem;
      border: 1px solid color-mix(in oklab, var(--tag) 55%, transparent);
      background: color-mix(in oklab, var(--tag) 18%, #0b0d14);
      color: color-mix(in oklab, var(--tag) 75%, #fff);
      font-size: 0.6875rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      line-height: 1.35;
      text-transform: uppercase;
      font-style: normal;
    }
    .server-tag-icon {
      font-size: 0.8em;
      filter: drop-shadow(0 0 4px var(--tag));
    }
  `,
})
export class ServerTagComponent {
  readonly tag = input<Pick<ServerTag, 'text' | 'color' | 'icon'> | null | undefined>(null);
  protected readonly title = computed(this.makeTitle.bind(this));

  /** The text shown when the pointer rests on the tag. */
  private makeTitle(): string {
    return this.tag()?.text ?? '';
  }
}
