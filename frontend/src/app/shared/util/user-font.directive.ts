/**
 * src/app/shared/util/user-font.directive.ts
 * Gives a name the font the person chose for it (the `font-name-*` classes), so a name looks the same everywhere.
 * Use: `<span [appNameColor]="u.profileColor" [appUserFont]="u.nameFont">`.
 */
import { Directive, computed, input } from '@angular/core';

/** The class that gives a name the font its person chose (nothing for the default font): the one place that knows how it is named. */
export function fontClassOf(font: string | null | undefined): string {
  if (!font || font === 'default') {
    return '';
  }
  // A font a friend uploaded: its class is made when the file is opened (see NameFontShareService). Only the shape of an id
  // is accepted, so nothing else can become a class name.
  const shared = /^custom:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
    font,
  );
  if (shared) {
    return 'font-name-cf-' + shared[1];
  }
  return 'font-name-' + font.replace(/[^a-z0-9_-]/gi, '');
}

/** Puts the class of the chosen name font on the element. */
@Directive({
  selector: '[appUserFont]',
  standalone: true,
  host: { '[class]': 'fontClass()' },
})
export class UserFontDirective {
  readonly appUserFont = input<string | null | undefined>('');
  protected readonly fontClass = computed(this.pickClass.bind(this));

  /** The class of the font, or nothing for the default one. */
  private pickClass(): string {
    return fontClassOf(this.appUserFont());
  }
}
