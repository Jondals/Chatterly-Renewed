/**
 * src/app/core/services/viewer.service.ts
 * The picture that is open big on the screen (the profile picture of a person, pressed in their profile).
 */
import { Injectable, signal } from '@angular/core';

/** Holds the address of the picture that is shown big (null: none). */
@Injectable({ providedIn: 'root' })
export class ViewerService {
  /** What is shown, and the name that goes with it. */
  readonly open = signal<{ src: string; name: string } | null>(null);

  /** Shows a picture big. */
  show(src: string, name: string): void {
    this.open.set({ src, name });
  }

  /** Closes the picture. */
  close(): void {
    this.open.set(null);
  }
}
