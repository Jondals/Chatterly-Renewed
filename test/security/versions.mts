/**
 * test/security/versions.mts
 * The order of the versions that the updates of the Android app use: a new version is offered only when it is really
 * newer (no downgrade, also not with a label that cannot be read), and a release is above all its betas.
 */
import { isNewerVersion, versionParts } from '../../frontend/src/app/core/version-compare';
import { check, step } from './support.mts';

/** The order of the versions. */
export async function checkVersions(): Promise<void> {
  step('updates: only a newer version is offered (no downgrade)');
  check(
    isNewerVersion('2.34.0', '2.33.0') && isNewerVersion('2.33.1', '2.33.0'),
    'a higher number is newer',
  );
  check(
    !isNewerVersion('2.33.0', '2.33.0') && !isNewerVersion('2.32.9', '2.33.0'),
    'the same version or an older one is never offered',
  );
  check(
    isNewerVersion('2.33.0', '2.33.0-b9') && !isNewerVersion('2.33.0-b9', '2.33.0'),
    'a release is above all its betas, and a beta never replaces its release',
  );
  check(
    isNewerVersion('2.33.0-b4', '2.33.0-b3') && isNewerVersion('2.33.0-b10', '2.33.0-b9'),
    'the betas of a version go up in order (b10 after b9, not as text)',
  );
  check(
    isNewerVersion('2.34.0-b1', '2.33.0'),
    'the first beta of the next version is above the current release',
  );
  check(
    !isNewerVersion('9.9.9-evil', '2.33.0') &&
      !isNewerVersion('', '2.33.0') &&
      !isNewerVersion('2.34', '2.33.0') &&
      !isNewerVersion('2.34.0', 'not a version') &&
      versionParts('v2.34.0') === null,
    'a label that is not a version of the app is never taken as newer',
  );
}
