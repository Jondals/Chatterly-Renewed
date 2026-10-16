/**
 * src/app/features/settings/preset-thumb.component.ts
 * The small picture of a preset: a theme shows a tiny chat with its background (or wallpaper), its bubbles, its corners and
 * its accent color; a profile shows a tiny card with its banner, picture and name. It is drawn from the data of the preset
 * itself, so a preset that a friend shared has its picture too.
 */
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { BannerComponent } from '../../shared/components/banner.component';
import { NameColorDirective } from '../../shared/util/name-color.directive';
import { UserFontDirective } from '../../shared/util/user-font.directive';
import type { Preset } from '../../core/preset';
import { ACCENTS, THEMES } from '../../core/theme-data';

/** The radius of the corners by the step chosen in the settings (the big one, for the bubbles). */
const CORNERS = [2, 6, 10, 14, 18, 22];

/** A small picture of a preset. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-preset-thumb',
  standalone: true,
  imports: [BannerComponent, NameColorDirective, UserFontDirective],
  template: `
    @if (urls().thumb) {
      <img class="thumb" [src]="urls().thumb" alt="" />
    } @else if (preset().kind === 'theme') {
      <div class="thumb" [style.background]="background()" [style.background-size]="'cover'">
        <span
          class="bubble"
          [style.background]="other()"
          [style.border-radius.px]="radius()"
        ></span>
        <span
          class="bubble own"
          [style.background]="own()"
          [style.border-radius.px]="radius()"
        ></span>
        <span class="dot" [style.background]="accent()"></span>
      </div>
    } @else {
      <div class="thumb profile">
        <app-banner class="banner" [color]="text('bannerColor')" />
        <span class="face" style="background-color: #4b5263"></span>
        <span
          class="who"
          [appNameColor]="text('profileColor')"
          [appUserFont]="text('nameFont')"
          fallback="var(--fg)"
          >{{ preset().name }}</span
        >
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      flex-shrink: 0;
    }
    img.thumb {
      object-fit: cover;
    }
    .thumb {
      position: relative;
      width: 5.5rem;
      height: 3.6rem;
      overflow: hidden;
      border-radius: 0.6rem;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background-position: center;
    }
    .bubble {
      position: absolute;
      left: 0.45rem;
      top: 0.5rem;
      width: 2.6rem;
      height: 0.8rem;
    }
    .bubble.own {
      left: auto;
      right: 0.45rem;
      top: 1.5rem;
      width: 2.2rem;
    }
    .dot {
      position: absolute;
      right: 0.4rem;
      bottom: 0.4rem;
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
    }
    .profile .banner {
      display: block;
      height: 1.7rem;
    }
    .face {
      position: absolute;
      left: 0.5rem;
      top: 0.95rem;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      border: 2px solid #0b0d12;
      background-size: cover;
      background-position: center;
    }
    .who {
      position: absolute;
      left: 0.5rem;
      right: 0.4rem;
      top: 2.5rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.6875rem;
      font-weight: 700;
      line-height: 1.1;
    }
  `,
})
export class PresetThumbComponent {
  readonly preset = input.required<Preset>();
  private readonly destroyRef = inject(DestroyRef);
  /** The addresses made for the pieces of the preset (they are given back when the picture goes). */
  protected readonly urls = signal<{ thumb: string }>({ thumb: '' });

  protected readonly accent = computed(this.pickAccent.bind(this));
  protected readonly background = computed(this.pickBackground.bind(this));
  protected readonly own = computed(this.pickOwn.bind(this));
  protected readonly other = computed(this.pickOther.bind(this));
  protected readonly radius = computed(this.pickRadius.bind(this));

  constructor() {
    effect(this.makeUrls.bind(this));
    this.destroyRef.onDestroy(this.freeUrls.bind(this));
  }

  /** Makes an address for each picture the preset carries. */
  private makeUrls(): void {
    const assets = this.preset().assets;
    untracked(this.freeUrls.bind(this));
    this.urls.set({
      thumb: assets.thumb ? URL.createObjectURL(assets.thumb) : '',
    });
  }

  /** Gives the addresses back. */
  private freeUrls(): void {
    for (const url of Object.values(this.urls())) {
      if (url) {
        URL.revokeObjectURL(url);
      }
    }
  }

  /** A text field of the profile of the preset. */
  protected text(field: string): string {
    const value = this.preset().data[field];
    return typeof value === 'string' ? value : '';
  }

  /** A text setting of the theme of the preset. */
  private setting(key: string): string {
    const value = this.preset().data['pref.' + key];
    return typeof value === 'string' ? value : '';
  }

  /** The accent color of the theme. */
  private pickAccent(): string {
    const id = this.setting('accent');
    return id === 'custom'
      ? this.setting('customAccent') || '#2ef2b0'
      : (ACCENTS.find(function same(accent) {
          return accent.id === id;
        })?.color ?? '#2ef2b0');
  }

  /** The background: the colors of the theme (the wallpaper is not drawn: it can be a heavy animation). */
  private pickBackground(): string {
    const id = this.setting('theme');
    const theme = THEMES.find(function same(entry) {
      return entry.id === id;
    });
    const custom = this.setting('customTheme') || '#1b1530';
    const colors = theme ? theme.colors : [custom, custom, custom];
    return 'linear-gradient(135deg,' + colors[0] + ',' + colors[1] + ' 60%,' + colors[2] + ')';
  }

  /** The color of the own bubbles. */
  private pickOwn(): string {
    return this.setting('bubbleOwn') || this.accent();
  }

  /** The color of the bubbles of the others. */
  private pickOther(): string {
    return this.setting('bubbleOther') || 'rgba(255,255,255,.16)';
  }

  /** The roundness of the bubbles. */
  private pickRadius(): number {
    const step = this.preset().data['pref.cornerStep'];
    return CORNERS[typeof step === 'number' ? Math.min(5, Math.max(0, step)) : 3]!;
  }
}
