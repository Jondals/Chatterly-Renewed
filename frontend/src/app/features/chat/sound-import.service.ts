/**
 * src/app/features/chat/sound-import.service.ts
 * Takes the sounds that arrive in a chat (voice notes, audio, the sound of a video, and the packs that people share) into
 * the soundboard of the person. A single sound opens the editor (to cut it, name it, give it an emoji); a pack is added
 * at once, as a category with the name of the pack.
 */
import { EnvironmentInjector, Injectable, inject } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { SettingsService } from '../../core/services/settings.service';
import { SoundboardStore } from '../../core/services/soundboard.store';
import { SoundService } from '../../core/services/sound.service';
import { ToastService } from '../../core/services/toast.service';
import { MessageStore, type ViewAttachment } from '../../store/message.store';

/** Longest name of a category (the same as in the soundboard). */
const PACK_NAME_MAX = 20;

/** Puts the sounds of the chat in the soundboard. */
@Injectable({ providedIn: 'root' })
export class SoundImportService {
  private readonly messages = inject(MessageStore);
  private readonly board = inject(SoundboardStore);
  private readonly settings = inject(SettingsService);
  private readonly sound = inject(SoundService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly injector = inject(EnvironmentInjector);

  /** The decrypted file of an attachment. */
  private async blobOf(att: ViewAttachment): Promise<Blob> {
    return this.messages.attachmentBlob(att);
  }

  /** The name of a sound from the name of its file. */
  private nameOf(att: ViewAttachment): string {
    return att.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Sound';
  }

  /** Opens the editor for one sound of the chat and keeps it in the soundboard when the person accepts. */
  async addOne(att: ViewAttachment): Promise<void> {
    try {
      await this.board.load();
      const blob = await this.blobOf(att);
      const editor = await import('../../shared/components/sound-edit.component');
      const result = await editor.editSound(this.injector, blob, null, this.nameOf(att));
      if (result) {
        await this.board.save({
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          ...result,
          emoji: result.emoji || att.emoji,
        });
        this.toast.success(this.i18n.t('Added to your soundboard'));
      }
    } catch (e) {
      this.fail(e);
    }
  }

  /**
   * Adds the sounds of a pack at once. They go to a category with the name of the pack (it is made when it does not exist).
   * A sound longer than the limit is left out (it can be added one by one, cutting it).
   */
  async addPack(atts: ViewAttachment[]): Promise<void> {
    try {
      await this.board.load();
      const name = (atts[0]?.pack ?? '').trim().slice(0, PACK_NAME_MAX);
      const category = name ? this.categoryFor(name) : undefined;
      const editor = await import('../../shared/components/sound-edit.component');
      let added = 0;
      for (const att of atts) {
        const blob = await this.blobOf(att);
        let seconds = Infinity;
        try {
          seconds = (await this.sound.context.decodeAudioData(await blob.arrayBuffer())).duration;
        } catch {
          /* a sound this browser cannot read: it is left out */
        }
        if (seconds <= editor.MAX_CLIP_SECONDS) {
          await this.board.save({
            id: crypto.randomUUID(),
            name: this.nameOf(att),
            emoji: att.emoji,
            blob,
            duration: seconds,
            createdAt: Date.now(),
            category,
          });
          added++;
        }
      }
      if (added > 0) {
        this.toast.success(this.i18n.t('{n} sounds added to your soundboard', { n: added }));
      } else {
        this.toast.error(this.i18n.t('Could not add the sound'));
      }
    } catch (e) {
      this.fail(e);
    }
  }

  /** The id of the category with that name (it is made when it does not exist yet). */
  private categoryFor(name: string): string {
    const known = this.settings.soundCategories().find(function same(category) {
      return category.name.toLowerCase() === name.toLowerCase();
    });
    if (known) {
      return known.id;
    }
    const id = crypto.randomUUID();
    this.settings.soundCategories.set([...this.settings.soundCategories(), { id, name }]);
    return id;
  }

  /** Says that a sound could not be added. */
  private fail(e: unknown): void {
    this.toast.error(
      this.i18n.t('Could not add the sound'),
      this.i18n.t(e instanceof Error ? e.message : 'Unknown error'),
    );
  }
}
