/**
 * src/app/store/guild.store.ts
 * State of the groups: channels, members, keys and key rotation.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { generateGuildKey, unwrapGuildKey, wrapGuildKey } from '../core/crypto/guild-keys';
import { isSealedText, openMeta, sealMeta } from '../core/crypto/guild-meta';
import { openBytes, sealBytes } from '../core/crypto/pairwise';
import type { ChannelRef, Guild, GuildChannel, GuildTag, User } from '../core/models';
import { ApiService } from '../core/services/api.service';
import { AuthService } from '../core/services/auth.service';
import { DirectoryService } from '../core/services/directory.service';
import { ImageService } from '../core/services/image.service';
import { SocketService, type ServerEvent } from '../core/services/socket.service';

/** What shows where a name could not be opened (its key is missing). */
const LOCKED = '🔒';
/** A color of a tag that came from another person is used only when it is one of this shape. */
const COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Guilds (servers) and their E2EE group keys. A guild shares one AES-256-GCM key per "key
 * version"; each member holds an envelope of it wrapped for their own key pair. The server only
 * ever sees those envelopes.
 */
@Injectable({ providedIn: 'root' })
export class GuildStore {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly images = inject(ImageService);
  private readonly directory = inject(DirectoryService);
  private readonly socket = inject(SocketService);

  readonly guilds = signal<Guild[]>([]);
  readonly loaded = signal(false);
  readonly activeGuildId = signal<string | null>(localStorage.getItem('chatterly.activeGuild'));
  readonly activeGuild = computed(
    function (this: GuildStore) {
      const list = this.guilds();
      return (
        list.find(
          function (this: GuildStore, g: Guild) {
            return g.id === this.activeGuildId();
          }.bind(this),
        ) ??
        list[0] ??
        null
      );
    }.bind(this),
  );

  /** guildId → keyVersion → key. In memory only. */
  private readonly keys = new Map<string, Map<number, CryptoKey>>();
  /** The groups whose old icon or old names (not encrypted) this browser is already encrypting. */
  private readonly encrypting = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private started = false;

  /** Starts listening to the server for changes of the groups; only once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.socket.events$.subscribe(
      function (this: GuildStore, event: ServerEvent) {
        if (event.t === 'ready' || event.t === 'guild.update') void this.refresh();
        if (event.t === 'guild.removed') {
          const id = (event as unknown as { guildId: string }).guildId;
          this.guilds.update(function (list) {
            return list.filter(function (g) {
              return g.id !== id;
            });
          });
          this.keys.delete(id);
        }
      }.bind(this),
    );
  }

  /** Forgets every group and key (sign out). */
  reset(): void {
    this.guilds.set([]);
    this.keys.clear();
    this.loaded.set(false);
  }

  /** Remembers which group the person is looking at, so the side bar returns to it. */
  setActive(guildId: string): void {
    this.activeGuildId.set(guildId);
    localStorage.setItem('chatterly.activeGuild', guildId);
  }

  /** A group by its id. */
  guild(id: string): Guild | undefined {
    return this.guilds().find(function (g) {
      return g.id === id;
    });
  }

  /** How to open a channel of a group (its group and key) from its id. */
  channelRef(channelId: string): ChannelRef | undefined {
    for (const guild of this.guilds()) {
      const channel = guild.channels.find(function (c) {
        return c.id === channelId;
      });
      if (channel) {
        return {
          kind: 'guild',
          channelId,
          guildId: guild.id,
          name: channel.name,
          type: channel.type,
        };
      }
    }
    return undefined;
  }

  /** The group a channel belongs to. */
  guildOfChannel(channelId: string): Guild | undefined {
    return this.guilds().find(function (g) {
      return g.channels.some(function (c) {
        return c.id === channelId;
      });
    });
  }

  /** A channel by its id, whatever group it is in. */
  channel(channelId: string): GuildChannel | undefined {
    return this.guildOfChannel(channelId)?.channels.find(function (c) {
      return c.id === channelId;
    });
  }

  /** The users of a group, in the order the owner chose. */
  members(guildId: string): User[] {
    const guild = this.guild(guildId);
    if (!guild) return [];
    const users = this.directory.users();
    return guild.members
      .map(function (m) {
        return users.get(m.userId);
      })
      .filter(function (u): u is User {
        return !!u;
      });
  }

  /** Whether the person is the owner of a group (the owner decides channels, members and tags). */
  isOwner(guild: Guild | null | undefined): boolean {
    return !!guild && guild.ownerId === this.auth.user()?.id;
  }

  // ---- loading & key management --------------------------------------------------------------

  /** Serialised so overlapping websocket events cannot interleave key unwrapping. */
  refresh(): Promise<void> {
    this.queue = this.queue
      .then(
        function (this: GuildStore) {
          return this.doRefresh();
        }.bind(this),
      )
      .catch(function () {
        return undefined;
      });
    return this.queue;
  }

  /** Loads the groups and opens the key of each one with the private key of the person. */
  private async doRefresh(): Promise<void> {
    const res = await this.api.get<{ guilds: Guild[]; users: User[] }>('/api/guilds');
    this.directory.merge(res.users);
    const me = this.auth.user()!;
    for (const guild of res.guilds) {
      const known = this.keys.get(guild.id) ?? new Map<number, CryptoKey>();
      this.keys.set(guild.id, known);
      for (const row of guild.keys) {
        if (known.has(row.keyVersion)) continue;
        try {
          const wrapperKey =
            row.wrapperPub ?? (await this.directory.require(row.wrapperId)).publicKeys.ecdh;
          known.set(
            row.keyVersion,
            await unwrapGuildKey(
              { iv: row.iv, data: row.data },
              this.auth.identity.ecdhPrivate,
              this.auth.identity.publicKeys.ecdh,
              wrapperKey,
              { guildId: guild.id, keyVersion: row.keyVersion, recipientId: me.id },
            ),
          );
        } catch (error) {
          console.warn('Could not unwrap guild key', guild.id, row.keyVersion, error);
        }
      }
    }
    const opened: Guild[] = [];
    const old = new Set<string>();
    for (const guild of res.guilds) {
      await this.openIconKey(guild);
      if (!this.namesSealed(guild)) {
        old.add(guild.id);
      }
      opened.push(await this.openNames(guild));
    }
    this.guilds.set(opened);
    this.loaded.set(true);
    const active = this.activeGuildId();
    if (
      !active ||
      !opened.some(function (g) {
        return g.id === active;
      })
    ) {
      if (opened[0]) this.setActive(opened[0].id);
    }
    // An old icon that is not encrypted: its owner encrypts it now.
    for (const guild of opened) {
      if (guild.ownerId === me.id && guild.iconImage && !guild.iconKey) {
        void this.encryptOldIcon(guild);
      }
    }
    // Names that were written before they were sealed: their owner seals them now (a rotation seals them too).
    for (const guild of opened) {
      if (guild.ownerId === me.id && old.has(guild.id) && !guild.needsRotation) {
        void this.sealOldNames(guild);
      }
    }
    // Someone left or was removed: replace the key so they can't read what is written next.
    for (const guild of opened) {
      if (guild.needsRotation && guild.ownerId === me.id)
        await this.rotate(guild).catch(function () {
          return undefined;
        });
    }
  }

  /** Whether the name of the group, of its channels and of its tags came sealed (the old groups did not). */
  private namesSealed(guild: Guild): boolean {
    return (
      isSealedText(guild.name) &&
      guild.channels.every(function sealed(c) {
        return isSealedText(c.name);
      }) &&
      guild.tags.every(function sealed(tag) {
        return isSealedText(tag.name);
      })
    );
  }

  /** Opens the names of a group with its key (what cannot be opened shows as a lock; an old name in clear is shown as it is). */
  private async openNames(guild: Guild): Promise<Guild> {
    const keys = this.keys.get(guild.id);
    const text = async function (
      this: GuildStore,
      field: 'name' | 'channel' | 'tag',
      id: string,
      value: string,
    ): Promise<unknown> {
      if (!isSealedText(value)) {
        return value;
      }
      const version = Number(value.split('.')[1]);
      const key = keys?.get(version);
      try {
        if (!key) {
          throw new Error('Missing guild key v' + version);
        }
        return await openMeta<unknown>(key, guild.id, field, id, value);
      } catch (error) {
        console.warn('Could not open a name of a group', guild.id, field, error);
        return null;
      }
    }.bind(this);
    const name = await text('name', guild.id, guild.name);
    const channels: GuildChannel[] = [];
    for (const channel of guild.channels) {
      const opened = await text('channel', channel.id, channel.name);
      channels.push({ ...channel, name: typeof opened === 'string' ? opened : LOCKED });
    }
    const tags: GuildTag[] = [];
    for (const tag of guild.tags) {
      const opened = await text('tag', tag.id, tag.name);
      const value = opened as { name?: unknown; color?: unknown } | string | null;
      if (typeof value === 'string') {
        tags.push({ ...tag, name: value });
      } else if (value && typeof value.name === 'string') {
        tags.push({
          ...tag,
          name: value.name,
          color:
            typeof value.color === 'string' && COLOR.test(value.color) ? value.color : '#94a3b8',
        });
      } else {
        tags.push({ ...tag, name: LOCKED, color: '#94a3b8' });
      }
    }
    return { ...guild, name: typeof name === 'string' ? name : LOCKED, channels, tags };
  }

  /** Every name of a group sealed with one version of its key (for a rotation, and for the old groups). */
  private async sealNames(
    guild: Guild,
    key: CryptoKey,
    version: number,
  ): Promise<{
    name: string;
    channels: { id: string; name: string }[];
    tags: { id: string; name: string }[];
  }> {
    const channels = [];
    for (const channel of guild.channels) {
      channels.push({
        id: channel.id,
        name: await sealMeta(key, guild.id, version, 'channel', channel.id, channel.name),
      });
    }
    const tags = [];
    for (const tag of guild.tags) {
      tags.push({
        id: tag.id,
        name: await sealMeta(key, guild.id, version, 'tag', tag.id, {
          name: tag.name,
          color: tag.color,
        }),
      });
    }
    return {
      name: await sealMeta(key, guild.id, version, 'name', guild.id, guild.name),
      channels,
      tags,
    };
  }

  /** Seals the names of an old group (they were written in clear): only its owner does it, with the key it has now. */
  private async sealOldNames(guild: Guild): Promise<void> {
    if (this.encrypting.has('names|' + guild.id)) return;
    this.encrypting.add('names|' + guild.id);
    try {
      const key = this.keys.get(guild.id)?.get(guild.keyVersion);
      if (key && guild.name !== LOCKED) {
        await this.api.put(
          '/api/guilds/' + guild.id + '/meta',
          await this.sealNames(guild, key, guild.keyVersion),
        );
      }
    } catch {
      /* it is tried again the next time the groups are loaded */
    } finally {
      this.encrypting.delete('names|' + guild.id);
    }
  }

  /** A name of a group, ready to be sealed: no control characters, no spaces around, no longer than the field. */
  private tidy(text: string, max: number): string {
    // eslint-disable-next-line no-control-regex
    return text
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, max);
  }

  /** The context a sealed key of an icon is bound to. */
  private iconContext(guildId: string, version: number, imageId: string): string {
    return 'group-icon|' + guildId + '|' + version + '|' + imageId;
  }

  /** Opens the sealed key of the icon of a group and gives it to the pictures (the icon can be shown after this). */
  private async openIconKey(guild: Guild): Promise<void> {
    const sealed = guild.iconKey;
    const key = sealed ? this.keys.get(guild.id)?.get(sealed.keyVersion) : undefined;
    if (!sealed || !key || !guild.iconImage) return;
    try {
      const raw = await openBytes(
        key,
        { iv: sealed.iv, ciphertext: sealed.data },
        this.iconContext(guild.id, sealed.keyVersion, guild.iconImage),
      );
      await this.images.learnGroupIcon(guild.iconImage, raw);
    } catch (error) {
      console.warn('Could not open the icon of a group', guild.id, error);
    }
  }

  /** Puts a new icon on a group (owner only): it is encrypted here, and its key is sealed with the key of the group. */
  async setIcon(guildId: string, blob: Blob): Promise<void> {
    const guild = this.guild(guildId)!;
    const { id, raw } = await this.images.uploadGroupIcon(guildId, blob);
    const sealed = await sealBytes(
      await this.keyFor(guildId, guild.keyVersion),
      raw,
      this.iconContext(guildId, guild.keyVersion, id),
    );
    await this.update(guildId, {
      iconImage: id,
      iconKey: { version: guild.keyVersion, iv: sealed.iv, data: sealed.ciphertext },
    });
  }

  /** Encrypts the old icon of a group that was made before icons were encrypted (it is downloaded and uploaded again). */
  private async encryptOldIcon(guild: Guild): Promise<void> {
    if (this.encrypting.has(guild.id)) return;
    this.encrypting.add(guild.id);
    try {
      const bytes = await this.api.download('/api/images/' + guild.iconImage);
      await this.setIcon(guild.id, new Blob([bytes]));
    } catch {
      /* it is tried again the next time the groups are loaded */
    } finally {
      this.encrypting.delete(guild.id);
    }
  }

  /** The key of a group in a version; when it is not known yet the groups are loaded again. */
  async keyFor(guildId: string, version: number): Promise<CryptoKey> {
    const found = this.keys.get(guildId)?.get(version);
    if (found) return found;
    await this.refresh();
    const key = this.keys.get(guildId)?.get(version);
    if (!key) throw new Error(`Missing guild key v${version}`);
    return key;
  }

  /** The version of the key a group has now (it changes when somebody leaves). */
  currentVersion(guildId: string): number {
    return this.guild(guildId)?.keyVersion ?? 1;
  }

  // ---- mutations -----------------------------------------------------------------------------

  /** Creates a group: its key, and its name and first channels sealed with that key. */
  async create(name: string): Promise<Guild> {
    const key = await generateGuildKey();
    const me = this.auth.user()!;
    // The envelope is bound to the guild id, so the client picks the id (a random UUID).
    const guildId = crypto.randomUUID();
    const bound = await wrapGuildKey(
      key,
      this.auth.identity.ecdhPrivate,
      this.auth.identity.publicKeys.ecdh,
      this.auth.identity.publicKeys.ecdh,
      { guildId, keyVersion: 1, recipientId: me.id },
    );
    const text = crypto.randomUUID();
    const voice = crypto.randomUUID();
    await this.api.post('/api/guilds', {
      id: guildId,
      name: await sealMeta(key, guildId, 1, 'name', guildId, this.tidy(name, 48) || 'New Guild'),
      envelope: bound,
      channels: [
        {
          id: text,
          type: 'text',
          name: await sealMeta(key, guildId, 1, 'channel', text, 'general'),
        },
        {
          id: voice,
          type: 'voice',
          name: await sealMeta(key, guildId, 1, 'channel', voice, 'Voice'),
        },
      ],
    });
    this.keys.set(guildId, new Map([[1, key]]));
    await this.refresh();
    this.setActive(guildId);
    return this.guild(guildId)!;
  }

  /** Invites a friend: the key of the group is wrapped for their public key, so only they can open it. */
  async invite(guildId: string, userId: string): Promise<void> {
    const guild = this.guild(guildId)!;
    const friend = await this.directory.require(userId);
    const key = await this.keyFor(guildId, guild.keyVersion);
    const envelope = await wrapGuildKey(
      key,
      this.auth.identity.ecdhPrivate,
      this.auth.identity.publicKeys.ecdh,
      friend.publicKeys.ecdh,
      { guildId, keyVersion: guild.keyVersion, recipientId: userId },
    );
    await this.api.post(`/api/guilds/${guildId}/members`, { userId, envelope });
    await this.refresh();
  }

  /** Removes a member; the key must be changed afterwards so they cannot read what comes next. */
  async removeMember(guildId: string, userId: string): Promise<void> {
    await this.api.delete(`/api/guilds/${guildId}/members/${userId}`);
    await this.refresh();
  }

  /** The person leaves a group. */
  async leave(guildId: string): Promise<void> {
    await this.api.delete(`/api/guilds/${guildId}/members/${this.auth.user()!.id}`);
    this.guilds.update(function (list) {
      return list.filter(function (g) {
        return g.id !== guildId;
      });
    });
    this.keys.delete(guildId);
  }

  /** Deletes a group (only its owner). */
  async deleteGuild(guildId: string): Promise<void> {
    await this.api.delete(`/api/guilds/${guildId}`);
    this.guilds.update(function (list) {
      return list.filter(function (g) {
        return g.id !== guildId;
      });
    });
    this.keys.delete(guildId);
  }

  async update(
    guildId: string,
    patch: {
      name?: string;
      iconImage?: string | null;
      iconKey?: { version: number; iv: string; data: string };
      tag?: string;
      tagColor?: string;
      tagIcon?: string;
    },
  ): Promise<void> {
    const body: Record<string, unknown> = { ...patch };
    if (patch.name !== undefined) {
      const name = this.tidy(patch.name, 48);
      if (name) {
        body['name'] = await this.sealFor(guildId, 'name', guildId, name);
      } else {
        delete body['name'];
      }
    }
    await this.api.patch(`/api/guilds/${guildId}`, body);
    await this.refresh();
  }

  /** Seals a value with the key the group has now. */
  private async sealFor(
    guildId: string,
    field: 'name' | 'channel' | 'tag',
    id: string,
    value: unknown,
  ): Promise<string> {
    const version = this.currentVersion(guildId);
    return sealMeta(await this.keyFor(guildId, version), guildId, version, field, id, value);
  }

  /** Adds a text or voice channel (only the owner). */
  async addChannel(guildId: string, name: string, type: 'text' | 'voice'): Promise<GuildChannel> {
    const clean = this.channelName(name, type);
    if (!clean) {
      throw new Error('Invalid name');
    }
    const id = crypto.randomUUID();
    await this.api.post(`/api/guilds/${guildId}/channels`, {
      id,
      type,
      name: await this.sealFor(guildId, 'channel', id, clean),
    });
    await this.refresh();
    return this.channel(id)!;
  }

  /** The name of a channel as it is kept: a text channel has no spaces and no capitals. */
  private channelName(name: string, type: 'text' | 'voice'): string {
    const clean = this.tidy(name, 32);
    return type === 'text' ? clean.toLowerCase().replace(/\s+/g, '-') : clean;
  }

  /** Changes the name of a channel (group owner only). */
  async renameChannel(guildId: string, channelId: string, name: string): Promise<void> {
    const clean = this.channelName(name, this.channel(channelId)?.type ?? 'text');
    if (!clean) {
      throw new Error('Invalid name');
    }
    await this.api.patch(`/api/guilds/${guildId}/channels/${channelId}`, {
      name: await this.sealFor(guildId, 'channel', channelId, clean),
    });
    await this.refresh();
  }

  /** Creates a tag in the group (owner only). */
  async createTag(guildId: string, name: string, color: string): Promise<string> {
    const clean = this.tidy(name, 24);
    if (!clean) {
      throw new Error('Invalid name');
    }
    const id = crypto.randomUUID();
    await this.api.post('/api/guilds/' + guildId + '/tags', {
      id,
      name: await this.sealFor(guildId, 'tag', id, { name: clean, color }),
    });
    await this.refresh();
    return id;
  }

  /** Puts the tags in a new order (owner only): the sections of the members list follow it. */
  async reorderTags(guildId: string, ids: string[]): Promise<void> {
    this.guilds.update(function (list) {
      return list.map(function (guild) {
        if (guild.id !== guildId) {
          return guild;
        }
        const tags = ids
          .map(function find(id) {
            return guild.tags.find(function same(tag) {
              return tag.id === id;
            });
          })
          .filter(function present(tag): tag is NonNullable<typeof tag> {
            return !!tag;
          });
        return { ...guild, tags };
      });
    });
    try {
      await this.api.patch('/api/guilds/' + guildId + '/tags/order', { ids });
    } finally {
      await this.refresh();
    }
  }

  /** Deletes a tag of the group (owner only); the members lose it. */
  async deleteTag(guildId: string, tagId: string): Promise<void> {
    await this.api.delete('/api/guilds/' + guildId + '/tags/' + tagId);
    await this.refresh();
  }

  /** Sets the tags a member has (owner only). */
  async setMemberTags(guildId: string, userId: string, tagIds: string[]): Promise<void> {
    await this.api.patch('/api/guilds/' + guildId + '/members/' + userId + '/tags', { tagIds });
    await this.refresh();
  }

  /** Changes the order of the members (owner only): shown at once and saved on the server for everyone. */
  async reorderMembers(guildId: string, ids: string[]): Promise<void> {
    this.guilds.update(function (list) {
      return list.map(function (guild) {
        if (guild.id !== guildId) {
          return guild;
        }
        const ordered = [];
        for (const id of ids) {
          const member = guild.members.find(function (item) {
            return item.userId === id;
          });
          if (member) {
            ordered.push(member);
          }
        }
        return { ...guild, members: ordered };
      });
    });
    try {
      await this.api.patch('/api/guilds/' + guildId + '/members/order', { ids: ids });
    } finally {
      await this.refresh();
    }
  }

  /** Changes the order of the channels (owner only): shown at once and saved on the server. */
  async reorderChannels(guildId: string, ids: string[]): Promise<void> {
    this.guilds.update(function (list) {
      return list.map(function (g) {
        return g.id !== guildId
          ? g
          : {
              ...g,
              channels: ids
                .map(function (id) {
                  return g.channels.find(function (c) {
                    return c.id === id;
                  })!;
                })
                .filter(Boolean),
            };
      });
    });
    try {
      await this.api.patch(`/api/guilds/${guildId}/channels/order`, { ids });
    } finally {
      await this.refresh();
    }
  }

  /** Deletes a channel (only the owner). */
  async deleteChannel(guildId: string, channelId: string): Promise<void> {
    await this.api.delete(`/api/guilds/${guildId}/channels/${channelId}`);
    await this.refresh();
  }

  /** Owner only: fresh key for exactly the people who are still members. */
  private async rotate(guild: Guild): Promise<void> {
    const version = guild.keyVersion + 1;
    const key = await generateGuildKey();
    const envelopes = [];
    for (const member of guild.members) {
      const user = await this.directory.require(member.userId);
      const envelope = await wrapGuildKey(
        key,
        this.auth.identity.ecdhPrivate,
        this.auth.identity.publicKeys.ecdh,
        user.publicKeys.ecdh,
        { guildId: guild.id, keyVersion: version, recipientId: member.userId },
      );
      envelopes.push({ userId: member.userId, ...envelope });
    }
    // the key of the icon is sealed again with the new key of the group
    let iconKey: { iv: string; data: string } | undefined;
    if (guild.iconKey && guild.iconImage) {
      const old = this.keys.get(guild.id)?.get(guild.iconKey.keyVersion);
      if (old) {
        const raw = await openBytes(
          old,
          { iv: guild.iconKey.iv, ciphertext: guild.iconKey.data },
          this.iconContext(guild.id, guild.iconKey.keyVersion, guild.iconImage),
        );
        const sealed = await sealBytes(
          key,
          raw,
          this.iconContext(guild.id, version, guild.iconImage),
        );
        iconKey = { iv: sealed.iv, data: sealed.ciphertext };
      }
    }
    // ... and so are the names (somebody who comes later is given only the new key)
    const meta = await this.sealNames(guild, key, version);
    await this.api.post(`/api/guilds/${guild.id}/rotate`, {
      keyVersion: version,
      iconKey,
      meta,
      envelopes,
    });
    this.keys.get(guild.id)?.set(version, key);
    // The server will notify members; load again here so the new version is picked up right away.
    await this.doRefresh();
  }
}
