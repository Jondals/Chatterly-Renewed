/**
 * src/app/shared/components/titlebar.component.ts
 * The bar at the top of the desktop app (Windows): the name of the app on the left, a place to drag the window and, on the
 * right, the buttons to minimize, maximize and close, which Windows itself draws over the bar (so the layouts that appear
 * when the pointer rests on the maximize button keep working).
 *
 * * Only the desktop app shows it (the browser has its own bar). The window is made without its frame by the shell, and the
 *   page learns the height of the bar from it (`--titlebar-h`, see main.ts).
 * * The color of the buttons of Windows follows the theme: the page reads the color of this bar and tells the shell.
 */
import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { desktopBridge } from '../../core/desktop-bridge';
import { SettingsService } from '../../core/services/settings.service';

/** "rgb(6, 7, 11)" as "#06070b" (null when it is not a plain color). */
function toHex(color: string): string | null {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!match) {
    return null;
  }
  return (
    '#' +
    [match[1], match[2], match[3]]
      .map(function pad(part) {
        return Number(part).toString(16).padStart(2, '0');
      })
      .join('')
  );
}

/** Light or dark text for a background (the symbols of the buttons of Windows). */
function symbolFor(hex: string): string {
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 140 ? '#1b1d27' : '#e8eaf2';
}

/** The bar of the desktop window. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-titlebar',
  standalone: true,
  template: `
    <header #bar class="titlebar" role="banner">
      <img class="titlebar-logo" src="favicon.svg" alt="" width="16" height="16" />
      <span class="titlebar-name">Chatterly</span>
    </header>
  `,
})
export class TitlebarComponent {
  private readonly settings = inject(SettingsService);
  private readonly bar = viewChild.required<ElementRef<HTMLElement>>('bar');

  constructor() {
    // The theme decides the color of the bar; when it changes, the buttons of Windows change with it.
    effect(this.syncColors.bind(this));
  }

  /** Tells the shell the color of the bar (after the theme has painted) so its buttons match. */
  private syncColors(): void {
    this.settings.theme();
    requestAnimationFrame(this.sendColors.bind(this));
  }

  private sendColors(): void {
    const hex = toHex(getComputedStyle(this.bar().nativeElement).backgroundColor);
    if (hex) {
      void desktopBridge()?.titlebar?.setColors({ color: hex, symbolColor: symbolFor(hex) });
    }
  }
}
