/**
 * src/app/shared/components/rich-text.component.ts
 * Draws formatted text (bold, color, code) without using HTML.
 */
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Segment } from '../util/rich-text';
import { IconComponent } from './icon.component';
import { TranslatePipe } from '../../core/i18n/i18n.service';

/** Renders parsed message segments (recursive for colour/gradient spans). Pure bindings: no innerHTML. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-rich-text',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `@for (s of segments(); track $index) {
    @switch (s.type) {
      @case ('bold') {
        <b>{{ s.text }}</b>
      }
      @case ('italic') {
        <i>{{ s.text }}</i>
      }
      @case ('strike') {
        <s>{{ s.text }}</s>
      }
      @case ('code') {
        <code
          class="rounded bg-black/35 px-1.5 py-0.5 font-[family-name:var(--font-code)] text-[0.88em]"
          >{{ s.text }}</code
        >
      }
      @case ('link') {
        <a
          [href]="s.href"
          target="_blank"
          rel="noopener noreferrer nofollow"
          class="underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >{{ s.text }}</a
        >
      }
      @case ('color') {
        <span [style.color]="s.color"
          ><app-rich-text [segments]="s.children" (copy)="copy.emit($event)"
        /></span>
      }
      @case ('gradient') {
        <span class="bg-clip-text text-transparent" [style.background-image]="gradient(s.colors)"
          ><app-rich-text [segments]="s.children" (copy)="copy.emit($event)"
        /></span>
      }
      @case ('codeblock') {
        <span class="code-block my-2 block overflow-hidden text-left text-fg">
          <span
            class="flex items-center justify-between border-b border-white/6 bg-white/[.03] px-3 py-1.5 font-sans text-[0.6875rem] text-muted"
          >
            <span class="flex items-center gap-1.5"
              ><app-icon name="code" [size]="12" class="text-accent" />
              {{ s.lang || 'snippet' }}</span
            >
            <button
              type="button"
              class="flex items-center gap-1 hover:text-accent"
              (click)="copy.emit(s.code)"
            >
              <app-icon name="copy" [size]="12" /> {{ 'Copy snippet' | t }}
            </button>
          </span>
          <span class="block overflow-x-auto whitespace-pre p-3 leading-[normal]">{{
            s.code
          }}</span>
        </span>
      }
      @default {
        <ng-container>{{ s.text }}</ng-container>
      }
    }
  }`,
})
export class RichTextComponent {
  readonly segments = input.required<Segment[]>();
  readonly copy = output<string>();

  /** The CSS of a gradient of colors for a text. */
  protected gradient(colors: string[]): string {
    return `linear-gradient(90deg, ${colors.join(', ')})`;
  }
}
