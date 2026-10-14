/**
 * src/app/shared/util/iframe-allow.ts
 * The `allow` attribute of the frames (YouTube, Spotify, the players of the links), written only with the permissions the
 * browser knows. Firefox does not know "autoplay" and "encrypted-media" and writes a warning to the console for each frame
 * that names them; the browsers that know them still get them.
 */
import { Directive, ElementRef, Input, inject } from '@angular/core';

/** Permissions that Firefox and Safari do not know (naming them only fills their console with warnings). */
const NOT_EVERYWHERE = ['autoplay', 'encrypted-media'];

/** Whether this browser tells which permissions it knows (Chromium does; Firefox and Safari do not). */
function knownFeatures(): string[] | null {
  const policy = (document as unknown as { featurePolicy?: { features?: () => string[] } })
    .featurePolicy;
  return typeof policy?.features === 'function' ? policy.features() : null;
}

/** The value of `allow` for a frame: the names in the list that this browser knows. */
function iframeAllow(names: string[]): string {
  const known = knownFeatures();
  return names
    .filter(function supported(name) {
      return known ? known.includes(name) : !NOT_EVERYWHERE.includes(name);
    })
    .join('; ');
}

/**
 * Sets the `allow` attribute of a frame the moment its list is given, with the permissions this browser knows. (Angular does
 * not let a template bind `allow` of a frame: it would be a way to hand permissions to any page, so it is set here, from
 * a fixed list.) Put it BEFORE `[src]` in the template, so the frame has its permissions when it goes to its address.
 * Use: `<iframe [frameAllow]="allowMedia" [src]="...">`.
 */
@Directive({ selector: 'iframe[frameAllow]', standalone: true })
export class FrameAllowDirective {
  private readonly frame = inject<ElementRef<HTMLIFrameElement>>(ElementRef);

  /** The permissions that are wanted (only the ones the browser knows are written). */
  @Input({ required: true }) set frameAllow(names: string[]) {
    this.frame.nativeElement.setAttribute('allow', iframeAllow(names));
  }
}
