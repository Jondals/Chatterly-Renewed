/**
 * src/app/store/guild.store.ts
 * State of the groups: channels, members, keys and key rotation.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { generateGuildKey, unwrapGuildKey, wrapGuildKey } from '../core/crypto/guild-keys';
import { openBytes, sealBytes } from '../core/crypto/pairwise';
import type { ChannelRef, Guild, GuildChannel, User } from '../core/models';
import { ApiService } from '../core/services/api.service';
import { AuthService } from '../core/services/auth.service';
import { DirectoryService } from '../core/services/directory.service';
import { ImageService } from '../core/services/image.service';
import { SocketService, type ServerEvent } from '../core/services/socket.service';

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
  /** The groups whose old icon (not encrypted) this browser is already encrypting. */
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
    for (const guild of res.guilds) {
      await this.openIconKey(guild);
    }
    this.guilds.set(res.guilds);
    this.loaded.set(true);
    const active = this.activeGuildId();
    if (
      !active ||
      !res.guilds.some(function (g) {
        return g.id === active;
      })
    ) {
      if (res.guilds[0]) this.setActive(res.guilds[0].id);
    }
    // An old icon that is not encrypted: its owner encrypts it now.
    for (const guild of res.guilds) {
      if (guild.ownerId === me.id && guild.iconImage && !guild.iconKey) {
        void this.encryptOldIcon(guild);
      }
    }
    // Someone left or was removed: replace the key so they can't read what is written next.
    for (const guild of res.guilds) {
      if (guild.needsRotation && guild.ownerId === me.id)
        await this.rotate(guild).catch(function () {
          return undefined;
        });
    }
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

  async create(name: string, icon: string): Promise<Guild> {
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
    const res = await this.api.post<{ guild: Guild }>('/api/guilds', {
      id: guildId,
      name,
      icon,
      envelope: bound,
    });
    this.keys.set(res.guild.id, new Map([[1, key]]));
    await this.refresh();
    this.setActive(res.guild.id);
    return res.guild;
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
      icon?: string;
      iconImage?: string | null;
      iconKey?: { version: number; iv: string; data: string };
      tag?: string;
      tagColor?: string;
      tagIcon?: string;
    },
  ): Promise<void> {
    await this.api.patch(`/api/guilds/${guildId}`, patch);
    await this.refresh();
  }

  /** Adds a text or voice channel (only the owner). */
  async addChannel(guildId: string, name: string, type: 'text' | 'voice'): Promise<GuildChannel> {
    const res = await this.api.post<{ channel: GuildChannel }>(`/api/guilds/${guildId}/channels`, {
      name,
      type,
    });
    await this.refresh();
    return res.channel;
  }

  /** Changes the name of a channel (group owner only). */
  async renameChannel(guildId: string, channelId: string, name: string): Promise<void> {
    await this.api.patch(`/api/guilds/${guildId}/channels/${channelId}`, { name });
    await this.refresh();
  }

  /** Creates a tag in the group (owner only). */
  async createTag(guildId: string, name: string, color: string): Promise<string> {
    const created = await this.api.post<{ id: string }>('/api/guilds/' + guildId + '/tags', {
      name,
      color,
    });
    await this.refresh();
    return created.id;
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
    await this.api.post(`/api/guilds/${guild.id}/rotate`, {
      keyVersion: version,
      iconKey,
      envelopes,
    });
    this.keys.get(guild.id)?.set(version, key);
    // The server will notify members; refresh locally so we pick up the new version right away.
    const res = await this.api.get<{ guilds: Guild[] }>('/api/guilds');
    this.guilds.set(res.guilds);
  }
}
