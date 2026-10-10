/**
 * src/app/core/services/profile-draft.store.ts
 * What the person has written in "My profile" and has not saved yet (name, status, colors, About me...). It lives here and
 * not in the page, so closing the settings (or going to another section) does not lose it: it is there when they come back
 * and it is applied only when they press Save.
 */
import { Injectable, signal } from '@angular/core';
import type { AuraId, NameFont } from '../models';

/** The fields of the profile that the forms edit. */
export interface ProfileDraft {
  displayName: string;
  pronouns: string;
  statusText: string;
  bio: string;
  nameFont: NameFont;
  nameFx: string;
  profileColor: string;
  bannerColor: string;
  aura: AuraId;
  auraColor: string;
}

/** The unsaved changes of one person (null when there are none). */
@Injectable({ providedIn: 'root' })
export class ProfileDraftStore {
  /** The changes that are waiting for Save, and whose they are (another person who signs in on this page does not get them). */
  readonly pending = signal<{ userId: string; draft: ProfileDraft } | null>(null);
}
