/**
 * test/security/database.mts
 * An older database is migrated safely and repeatably; a newer one is not touched.
 */
import path from 'node:path';
import { openDatabase, SCHEMA_VERSION } from '../../backend/src/db';
import { check, step, until, Database, TMP } from './support.mts';

/** An older database is migrated safely and repeatably; a newer one is not touched. */
export async function checkDatabase(): Promise<void> {
  step('database: migrations');
  const file = path.join(TMP, 'legacy.db');
  const old = new Database(file);
  old.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
      auth_hash TEXT NOT NULL, kdf_salt TEXT NOT NULL, kdf_iterations INTEGER NOT NULL, pub_ecdh TEXT NOT NULL,
      pub_ecdsa TEXT NOT NULL, wrapped_ecdh TEXT NOT NULL, wrapped_ecdsa TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '', status_text TEXT NOT NULL DEFAULT '', accent TEXT NOT NULL DEFAULT 'mint',
      aura TEXT NOT NULL DEFAULT 'prism', avatar_emoji TEXT NOT NULL DEFAULT '', avatar_color TEXT NOT NULL DEFAULT '#2ef2b0',
      created_at INTEGER NOT NULL);
    CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key_version INTEGER NOT NULL DEFAULT 1,
      needs_rotation INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE guild_keys (guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key_version INTEGER NOT NULL,
      wrapper_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, iv TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id, key_version));
    INSERT INTO users (id, username, display_name, auth_hash, kdf_salt, kdf_iterations, pub_ecdh, pub_ecdsa, wrapped_ecdh, wrapped_ecdsa, created_at)
      VALUES ('u1','old_user','Old','h','s',1,'e','d','w','w',1);
    INSERT INTO guilds (id, name, owner_id, created_at) VALUES ('g1','Old group','u1',1);
    INSERT INTO guild_keys VALUES ('g1','u1',1,'u1','iv','data');
  `);
  old.close();
  const db = openDatabase(file);
  const columns = db.prepare('PRAGMA table_info(users)').all() as {
    name: string;
  }[];
  check(
    ['pronouns', 'avatar_image', 'deleted_at'].every(function present(name) {
      return columns.some(function has(c) {
        return c.name === name;
      });
    }),
    'columns added after the first version appear',
  );
  check(
    (db.prepare('SELECT username FROM users').get() as { username: string }).username ===
      'old_user',
    'the old rows are kept',
  );
  check(
    !(db.prepare('PRAGMA table_info(guilds)').all() as { name: string }[]).some(function icon(c) {
      return c.name === 'icon';
    }),
    'the emoji of a group (never shown, in clear) is gone from an old database',
  );
  check(
    (
      db.prepare("SELECT name FROM guilds WHERE id = 'g1'").get() as {
        name: string;
      }
    ).name === 'Old group',
    'an old group keeps its name until its owner seals it',
  );
  const ties = db.prepare('PRAGMA foreign_key_list(guild_keys)').all() as {
    from: string;
  }[];
  check(
    !ties.some(function onWrapper(tie) {
      return tie.from === 'wrapper_id';
    }),
    'key envelopes no longer die with the person who wrapped them',
  );
  check(
    (db.prepare('SELECT COUNT(*) AS n FROM guild_keys').get() as { n: number }).n === 1,
    'and none was lost in the rebuild',
  );
  check(
    db.pragma('user_version', { simple: true }) === SCHEMA_VERSION,
    'the schema version is recorded',
  );
  check(
    db.pragma('secure_delete', { simple: true }) === 1,
    'deleted content is overwritten (secure_delete)',
  );
  check(db.pragma('foreign_keys', { simple: true }) === 1, 'foreign keys are enforced');
  db.close();
  const again = openDatabase(file);
  check(
    (again.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 1,
    'opening it again is harmless',
  );
  again.close();
  // The table of images learns a fourth kind (the font file of a name) without losing a picture or a key.
  const imagesFile = path.join(TMP, 'images-three-kinds.db');
  const three = new Database(imagesFile);
  three.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
      auth_hash TEXT NOT NULL, kdf_salt TEXT NOT NULL, kdf_iterations INTEGER NOT NULL, pub_ecdh TEXT NOT NULL,
      pub_ecdsa TEXT NOT NULL, wrapped_ecdh TEXT NOT NULL, wrapped_ecdsa TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE images (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('avatar','banner','group')), mime TEXT NOT NULL, size INTEGER NOT NULL,
      created_at INTEGER NOT NULL);
    CREATE TABLE image_keys (image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, iv TEXT NOT NULL, ciphertext TEXT NOT NULL,
      PRIMARY KEY (image_id, viewer_id));
    INSERT INTO users (id, username, display_name, auth_hash, kdf_salt, kdf_iterations, pub_ecdh, pub_ecdsa, wrapped_ecdh, wrapped_ecdsa, created_at)
      VALUES ('u1','pic_user','Pic','h','s',1,'e','d','w','w',1);
    INSERT INTO images VALUES ('i1','u1','avatar','application/octet-stream',64,5);
    INSERT INTO image_keys VALUES ('i1','u1','iv','sealed');
  `);
  three.close();
  const wider = openDatabase(imagesFile);
  check(
    (
      wider.prepare("SELECT kind, encrypted FROM images WHERE id = 'i1'").get() as {
        kind: string;
        encrypted: number;
      }
    ).kind === 'avatar',
    'a picture of the old table is kept (with the columns that came later)',
  );
  check(
    (wider.prepare('SELECT COUNT(*) AS n FROM image_keys').get() as { n: number }).n === 1,
    'and so is the sealed key of that picture',
  );
  wider
    .prepare(
      "INSERT INTO images (id, owner_id, kind, mime, size, created_at, encrypted) VALUES ('f1','u1','font','application/octet-stream',64,6,1)",
    )
    .run();
  check(
    (wider.prepare("SELECT COUNT(*) AS n FROM images WHERE kind = 'font'").get() as { n: number })
      .n === 1,
    'the table now accepts the font file of a name',
  );
  let refusedKind = false;
  try {
    wider
      .prepare(
        "INSERT INTO images (id, owner_id, kind, mime, size, created_at) VALUES ('x1','u1','wallpaper','a',1,1)",
      )
      .run();
  } catch {
    refusedKind = true;
  }
  check(refusedKind, 'but still refuses a kind that does not exist');
  check(
    (wider.prepare('PRAGMA foreign_key_check').all() as unknown[]).length === 0,
    'every link between pictures, keys and people is still valid',
  );
  wider.close();
  const future = new Database(path.join(TMP, 'future.db'));
  future.pragma('user_version = 99');
  future.close();
  let refused = false;
  try {
    openDatabase(path.join(TMP, 'future.db'));
  } catch {
    refused = true;
  }
  check(refused, 'a database from a newer version is refused, not changed');
}
