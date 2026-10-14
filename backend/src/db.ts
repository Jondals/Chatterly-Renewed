/**
 * src/db.ts
 * SQLite schema of the application and opening of the database (with simple column migrations).
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT NOT NULL,
  auth_hash       TEXT NOT NULL,
  kdf_salt        TEXT NOT NULL,
  kdf_iterations  INTEGER NOT NULL,
  pub_ecdh        TEXT NOT NULL,
  pub_ecdsa       TEXT NOT NULL,
  wrapped_ecdh    TEXT NOT NULL,
  wrapped_ecdsa   TEXT NOT NULL,
  bio             TEXT NOT NULL DEFAULT '',
  status_text     TEXT NOT NULL DEFAULT '',
  accent          TEXT NOT NULL DEFAULT 'mint',
  aura            TEXT NOT NULL DEFAULT 'prism',
  avatar_emoji    TEXT NOT NULL DEFAULT '',
  avatar_color    TEXT NOT NULL DEFAULT '#2ef2b0',
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Tokens de refresco ya usados: si alguien vuelve a presentar uno, se asume robo y se cierran todas las sesiones.
CREATE TABLE IF NOT EXISTS spent_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

-- user_a < user_b always, so each pair has exactly one row.
CREATE TABLE IF NOT EXISTS friendships (
  user_a        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS guilds (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_version     INTEGER NOT NULL DEFAULT 1,
  needs_rotation  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','member')),
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_guild_members_user ON guild_members(user_id);

-- Tags of a group: only its owner creates them and gives them to the members.
CREATE TABLE IF NOT EXISTS guild_tags (
  id          TEXT PRIMARY KEY,
  guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guild_tags_guild ON guild_tags(guild_id);
CREATE TABLE IF NOT EXISTS guild_member_tags (
  guild_id  TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id    TEXT NOT NULL REFERENCES guild_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (guild_id, user_id, tag_id)
);

-- The guild key is never stored in clear: each member holds an envelope wrapped for their key pair.
CREATE TABLE IF NOT EXISTS guild_keys (
  guild_id     TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_version  INTEGER NOT NULL,
  wrapper_id   TEXT NOT NULL,
  -- Public key of whoever wrapped it, written when that person erases their account (their row goes with them).
  wrapper_pub  TEXT,
  iv           TEXT NOT NULL,
  data         TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, key_version)
);

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  guild_id    TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('text','voice','dm')),
  name        TEXT NOT NULL,
  dm_key      TEXT UNIQUE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channels_guild ON channels(guild_id);

CREATE TABLE IF NOT EXISTS dm_members (
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_dm_members_user ON dm_members(user_id);

-- Only ciphertext is persisted. iv / ciphertext / signature are base64.
CREATE TABLE IF NOT EXISTS messages (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  iv           TEXT NOT NULL,
  ciphertext   TEXT NOT NULL,
  key_version  INTEGER NOT NULL,
  signature    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  edited_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, seq);

-- Delivery and read marks: the highest message number each person has received and read in a channel.
CREATE TABLE IF NOT EXISTS channel_receipts (
  channel_id     TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_seq  INTEGER NOT NULL DEFAULT 0,
  read_seq       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS reactions (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  iv          TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  signature   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

CREATE TABLE IF NOT EXISTS images (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('avatar','banner','group','font')),
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_owner ON images(owner_id);

-- The key of an encrypted profile picture or banner, sealed for ONE person who may see it (the server cannot open it).
CREATE TABLE IF NOT EXISTS image_keys (
  image_id    TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  viewer_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  iv          TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  PRIMARY KEY (image_id, viewer_id)
);

-- The settings of a person, sealed in their browser (the server cannot read them): see routes/settings-sync.ts.
CREATE TABLE IF NOT EXISTS settings_blobs (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  iv          TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- The personal library of a person (see routes/vault.ts): every column but the id, the size and the time is ciphertext.
CREATE TABLE IF NOT EXISTS vault_items (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  key_iv      TEXT NOT NULL,
  key_ct      TEXT NOT NULL,
  meta_iv     TEXT NOT NULL,
  meta_ct     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_owner ON vault_items(owner_id);

-- The administrators added from inside the app (the ones of ADMIN_USERS are fixed and are not here): see routes/beta.ts.
CREATE TABLE IF NOT EXISTS admins (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  added_at  INTEGER NOT NULL
);

-- The people the administrator lets try the beta versions of the desktop app (see routes/beta.ts).
CREATE TABLE IF NOT EXISTS beta_testers (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id           TEXT PRIMARY KEY,
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  uploader_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size         INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
`;

/** Columns added after 1.0.0; applied to databases created by older versions. */
const MIGRATIONS: [table: string, column: string, definition: string][] = [
  ['users', 'pronouns', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'avatar_image', 'TEXT'],
  ['users', 'banner_image', 'TEXT'],
  // The font file of the name (encrypted like a picture): what lets friends see a font the person uploaded.
  ['users', 'name_font_image', 'TEXT'],
  ['users', 'banner_color', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'profile_color', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'name_font', "TEXT NOT NULL DEFAULT 'default'"],
  // The animation of the name (see NAME_FX in routes/auth.ts).
  ['users', 'name_fx', "TEXT NOT NULL DEFAULT 'none'"],
  ['users', 'aura_color', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'deleted_at', 'INTEGER'],
  ['guild_keys', 'wrapper_pub', 'TEXT'],
  ['guilds', 'icon_image', 'TEXT'],
  ['guild_members', 'sort_order', 'INTEGER'],
  ['guild_tags', 'position', 'INTEGER NOT NULL DEFAULT 0'],
  // Privacy choices of the person (see routes/auth.ts): who sees them online, who may ask for their friendship, search.
  ['users', 'presence_visibility', "TEXT NOT NULL DEFAULT 'everyone'"],
  ['users', 'friend_requests', "TEXT NOT NULL DEFAULT 'everyone'"],
  ['users', 'searchable', 'INTEGER NOT NULL DEFAULT 1'],
  // 1 when the bytes of the picture are ciphertext made in the browser (profile pictures and banners); 0 for group icons.
  ['images', 'encrypted', 'INTEGER NOT NULL DEFAULT 0'],
  // The tag of a group (see server-tag.ts): the owner makes it, each member chooses whether to show it.
  // The group a group icon belongs to: only its members are given the picture (set when the owner puts it as the icon).
  ['images', 'guild_id', 'TEXT'],
  ['guilds', 'tag_text', "TEXT NOT NULL DEFAULT ''"],
  ['guilds', 'tag_color', "TEXT NOT NULL DEFAULT '#7c8cff'"],
  ['guilds', 'tag_icon', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'tag_guild', 'TEXT'],
  // The key of the encrypted icon of a group, sealed in the browser of the owner with the key of the group (see routes/guilds.ts).
  ['guilds', 'icon_key_version', 'INTEGER NOT NULL DEFAULT 0'],
  ['guilds', 'icon_key_iv', "TEXT NOT NULL DEFAULT ''"],
  ['guilds', 'icon_key_data', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'server_tag', "TEXT NOT NULL DEFAULT ''"],
];

/**
 * Older databases tied the person who wrapped a key envelope to the row of that person (so erasing an account would have
 * erased the envelopes of other people). The tie is cut by building the table again without it.
 */
function untieWrappers(db: Database.Database): void {
  const ties = db.prepare('PRAGMA foreign_key_list(guild_keys)').all() as {
    from: string;
  }[];
  if (
    !ties.some(function onWrapper(tie) {
      return tie.from === 'wrapper_id';
    })
  ) {
    return;
  }
  db.pragma('foreign_keys = OFF');
  db.transaction(function rebuild() {
    db.exec(`
      CREATE TABLE guild_keys_new (
        guild_id     TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key_version  INTEGER NOT NULL,
        wrapper_id   TEXT NOT NULL,
        wrapper_pub  TEXT,
        iv           TEXT NOT NULL,
        data         TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id, key_version)
      );
      INSERT INTO guild_keys_new (guild_id, user_id, key_version, wrapper_id, wrapper_pub, iv, data)
        SELECT guild_id, user_id, key_version, wrapper_id, wrapper_pub, iv, data FROM guild_keys;
      DROP TABLE guild_keys;
      ALTER TABLE guild_keys_new RENAME TO guild_keys;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

/**
 * The table of images only accepted three kinds. A fourth, the font file of a name (encrypted like a picture), needs the rule
 * to change, and SQLite cannot change a CHECK in place: the table is rebuilt (once) with every row and index it had.
 */
function allowFonts(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'images'")
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'font'")) {
    return;
  }
  db.pragma('foreign_keys = OFF');
  db.transaction(function rebuild() {
    db.exec(`
      CREATE TABLE images_new (
        id          TEXT PRIMARY KEY,
        owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('avatar','banner','group','font')),
        mime        TEXT NOT NULL,
        size        INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        encrypted   INTEGER NOT NULL DEFAULT 0,
        guild_id    TEXT
      );
      INSERT INTO images_new (id, owner_id, kind, mime, size, created_at, encrypted, guild_id)
        SELECT id, owner_id, kind, mime, size, created_at, encrypted, guild_id FROM images;
      DROP TABLE images;
      ALTER TABLE images_new RENAME TO images;
      CREATE INDEX IF NOT EXISTS idx_images_owner ON images(owner_id);
    `);
  })();
  db.pragma('foreign_keys = ON');
}

/** Adds the columns that older databases do not have, so an update never needs a manual step. */
function migrate(db: Database.Database): void {
  for (const [table, column, definition] of MIGRATIONS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    if (
      !columns.some(function (c) {
        return c.name === column;
      })
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  // The emoji that a group once had was never shown and was kept in clear: the column goes away.
  if (
    (db.prepare('PRAGMA table_info(guilds)').all() as { name: string }[]).some(function isIcon(c) {
      return c.name === 'icon';
    })
  ) {
    db.exec('ALTER TABLE guilds DROP COLUMN icon');
  }
  // The icons that were already in use belong to the group that shows them.
  db.exec(
    "UPDATE images SET guild_id = (SELECT g.id FROM guilds g WHERE g.icon_image = images.id) WHERE kind = 'group' AND guild_id IS NULL",
  );
}

/** Version of the schema, kept in `PRAGMA user_version`: it only grows, and a database from the future is refused. */
export const SCHEMA_VERSION = 6;

/**
 * Opens the database (creating the folder and the tables) with foreign keys on and the journal that allows reading while writing.
 * * `secure_delete` makes SQLite overwrite deleted content with zeros, so erased messages, accounts and sessions do not
 * stay readable in the free pages of the file (nor in the write-ahead log once it is checkpointed).
 *
 * Opening is repeatable: the tables are created only when missing, the columns of older versions are added, and a
 * second open of the same file changes nothing.
 * ! A database written by a newer version of the app is not touched.
 */
export function openDatabase(dbPath: string): Db {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const current = Number(db.pragma('user_version', { simple: true }));
  if (current > SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `The database has schema version ${current}, newer than this app (${SCHEMA_VERSION}); update the app instead of opening it`,
    );
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  migrate(db);
  untieWrappers(db);
  allowFonts(db);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return db;
}
