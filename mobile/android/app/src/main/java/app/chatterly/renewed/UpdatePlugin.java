/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/UpdatePlugin.java
 * Downloads a new version of the app and hands it to the installer of Android ("ChatterlyUpdate": download, install).
 * Changing to an OLDER version (a beta that goes back to the release, or the other way round) cannot be done over the installed
 * app: Android refuses a lower version code. Then the checked APK is kept in the Downloads folder (keepInDownloads), the
 * person uninstalls the app (uninstall: the dialog of Android) and installs that file from Downloads.
 *
 * ! What may be downloaded is closed: only an APK of the beta server of this app (https://<API host>/api/beta/dl/Chatterly-*.apk,
 *   with the beta token of the account in a header) or an APK of a release of this repository in GitHub (and the storage
 *   GitHub redirects to; the token never goes there). Nothing else, whatever the page asks.
 * ! Nothing is trusted because of where it came from. Before the installer opens, the APK must be this same app (package
 *   name), NEWER than the installed one (no downgrade) and signed with exactly the same certificate as the installed app.
 *   Android checks the certificate again when it installs; the person always confirms in the installer of the system.
 * ! An older version is only downloaded on request (allowOlder) and never given to the installer: it only goes to Downloads,
 *   after the same checks (this app, signed with the same certificate).
 */
package app.chatterly.renewed;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "ChatterlyUpdate")
public class UpdatePlugin extends Plugin {

    /** The biggest APK accepted. */
    private static final long MAX_BYTES = 300L * 1024 * 1024;

    /** An APK of the beta server of this app. */
    private static final Pattern BETA_PATH = Pattern.compile("^/api/beta/dl/Chatterly-[0-9A-Za-z.-]{1,60}\\.apk$");

    /** An APK of a release of this repository in GitHub. */
    private static final Pattern RELEASE_PATH = Pattern.compile(
        "^/Jondals/ChatterlyRenewed/releases/download/v[0-9A-Za-z.-]{1,60}/Chatterly-[0-9A-Za-z.-]{1,60}\\.apk$"
    );

    /** Where GitHub sends the download of a release file. */
    private static final Set<String> GITHUB_STORAGE = new HashSet<>(
        Arrays.asList("objects.githubusercontent.com", "release-assets.githubusercontent.com")
    );

    /** A download is in progress (only one at a time). */
    private volatile boolean busy = false;

    /** The type of an APK. */
    private static final String APK_TYPE = "application/vnd.android.package-archive";

    /**
     * Downloads and checks an APK (url, optional beta token, optional SHA-256); answers its version. With allowOlder the APK
     * may be an older version (to keep in Downloads, never to install over the app).
     */
    @PluginMethod
    public void download(PluginCall call) {
        if (busy) {
            call.reject("A download is already in progress");
            return;
        }
        String url = call.getString("url", "");
        String token = call.getString("token", null);
        String sha256 = call.getString("sha256", null);
        boolean allowOlder = Boolean.TRUE.equals(call.getBoolean("allowOlder", false));
        if (!allowed(url, token)) {
            call.reject("This address is not a download of the app");
            return;
        }
        busy = true;
        new Thread(new DownloadJob(this, call, url, token, sha256, allowOlder), "chatterly-update").start();
    }

    /**
     * Copies the downloaded APK (checked again: this app, same certificate, another version) to the Downloads folder, where it
     * stays after the app is uninstalled. Answers the name of the file. Android 10 or newer (no storage permission needed).
     */
    @PluginMethod
    public void keepInDownloads(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Changing to an older version needs Android 10 or newer", "android-version");
            return;
        }
        Context context = getContext();
        File apk = apkFile();
        String problem = apk.exists() ? check(context, apk, true) : "There is no downloaded version";
        if (problem != null) {
            call.reject(problem);
            return;
        }
        PackageInfo info = context.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        String version = info != null && info.versionName != null ? info.versionName.replaceAll("[^0-9A-Za-z.-]", "") : "";
        String name = "Chatterly-" + (version.isEmpty() ? "update" : version) + ".apk";
        ContentResolver resolver = context.getContentResolver();
        Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        // A copy left by an earlier try (the app only sees its own files there) is replaced, not doubled as "(1)".
        resolver.delete(collection, MediaStore.MediaColumns.DISPLAY_NAME + "=?", new String[] { name });
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, APK_TYPE);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri item = resolver.insert(collection, values);
        if (item == null) {
            call.reject("The file could not be kept in Downloads");
            return;
        }
        byte[] buffer = new byte[64 * 1024];
        try (InputStream in = new java.io.FileInputStream(apk); OutputStream out = resolver.openOutputStream(item)) {
            if (out == null) {
                throw new IOException("The file could not be kept in Downloads");
            }
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        } catch (IOException failed) {
            resolver.delete(item, null, null);
            call.reject("The file could not be kept in Downloads");
            return;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(item, done, null, null);
        apk.delete();
        JSObject answer = new JSObject();
        answer.put("name", name);
        call.resolve(answer);
    }

    /** Opens the dialog of Android that uninstalls this app (the person confirms there; nothing is removed without it). */
    @PluginMethod
    public void uninstall(PluginCall call) {
        Context context = getContext();
        Intent remove = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + context.getPackageName()));
        remove.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(remove);
        call.resolve();
    }

    /** Opens the installer of Android with the APK that was downloaded and checked (asks for the permission the first time). */
    @PluginMethod
    public void install(PluginCall call) {
        Context context = getContext();
        File apk = apkFile();
        String problem = apk.exists() ? check(context, apk, false) : "There is no downloaded version";
        if (problem != null) {
            call.reject(problem);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.getPackageManager().canRequestPackageInstalls()) {
            // The person allows "install unknown apps" for Chatterly once, in the settings of Android, and then tries again.
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
            allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(allow);
            call.reject("Allow Chatterly to install apps, then try again", "permission");
            return;
        }
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent open = new Intent(Intent.ACTION_VIEW);
        open.setDataAndType(uri, APK_TYPE);
        open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(open);
        call.resolve();
    }

    /** Where the downloaded APK is kept: the private cache of the app (the installer reads it through the FileProvider). */
    File apkFile() {
        return new File(new File(getContext().getCacheDir(), "updates"), "update.apk");
    }

    /** True when the address is one of the two kinds of download of the app (the token only for the beta server). */
    static boolean allowed(String url, String token) {
        try {
            URL parsed = new URL(url);
            if (!"https".equals(parsed.getProtocol()) || parsed.getQuery() != null || parsed.getRef() != null) {
                return false;
            }
            String host = parsed.getHost().toLowerCase(Locale.ROOT);
            if (host.equals(BuildConfig.CHATTERLY_API_HOST) && parsed.getPort() == -1) {
                return BETA_PATH.matcher(parsed.getPath()).matches();
            }
            return host.equals("github.com") && parsed.getPort() == -1 && token == null
                && RELEASE_PATH.matcher(parsed.getPath()).matches();
        } catch (IOException wrong) {
            return false;
        }
    }

    /**
     * Why an APK must not be installed, or null when it may: it has to be this app, newer than the installed version and
     * signed with exactly the same certificates as the installed app. With allowOlder it may be any OTHER version (it is
     * only kept in Downloads, never installed over the app).
     */
    static String check(Context context, File apk, boolean allowOlder) {
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo update = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (update == null) {
            return "The file is not an app";
        }
        if (!context.getPackageName().equals(update.packageName)) {
            return "The file is another app";
        }
        PackageInfo installed;
        try {
            installed = manager.getPackageInfo(context.getPackageName(), flags);
        } catch (PackageManager.NameNotFoundException impossible) {
            return "The installed app cannot be read";
        }
        if (allowOlder ? versionCode(update) == versionCode(installed) : versionCode(update) <= versionCode(installed)) {
            return allowOlder ? "The file is the installed version" : "The file is not newer than the installed version";
        }
        Set<String> wanted = certificates(installed);
        if (wanted.isEmpty() || !wanted.equals(certificates(update))) {
            return "The file is not signed by the author of the app";
        }
        return null;
    }

    /** The version code of a package (the number that must always grow). */
    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    /** The SHA-256 of every signing certificate of a package. */
    @SuppressWarnings("deprecation")
    private static Set<String> certificates(PackageInfo info) {
        Signature[] signatures = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo signing = info.signingInfo;
            if (signing != null) {
                signatures = signing.hasMultipleSigners() ? signing.getApkContentsSigners() : signing.getSigningCertificateHistory();
            }
        } else {
            signatures = info.signatures;
        }
        Set<String> found = new HashSet<>();
        if (signatures == null) {
            return found;
        }
        for (Signature signature : signatures) {
            found.add(hex(sha256(signature.toByteArray())));
        }
        return found;
    }

    /** The SHA-256 of some bytes. */
    private static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** Bytes as lowercase hexadecimal. */
    static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder();
        for (byte b : bytes) {
            text.append(String.format(Locale.ROOT, "%02x", b));
        }
        return text.toString();
    }

    /** The download itself, on its own thread (never on the thread of the screen). */
    private static final class DownloadJob implements Runnable {

        private final UpdatePlugin plugin;
        private final PluginCall call;
        private final String url;
        private final String token;
        private final String sha256;
        private final boolean allowOlder;

        /** Keeps what the download needs. */
        DownloadJob(UpdatePlugin plugin, PluginCall call, String url, String token, String sha256, boolean allowOlder) {
            this.plugin = plugin;
            this.call = call;
            this.url = url;
            this.token = token;
            this.sha256 = sha256;
            this.allowOlder = allowOlder;
        }

        /** Downloads to a temporary file, checks it and keeps it as the update; any problem deletes it. */
        @Override
        public void run() {
            File target = plugin.apkFile();
            File part = new File(target.getParentFile(), "update.part");
            try {
                target.getParentFile().mkdirs();
                target.delete();
                String digest = fetch(part);
                if (sha256 != null && !sha256.equalsIgnoreCase(digest)) {
                    throw new IOException("The download is damaged (its SHA-256 is not the expected one)");
                }
                String problem = check(plugin.getContext(), part, allowOlder);
                if (problem != null) {
                    throw new IOException(problem);
                }
                if (!part.renameTo(target)) {
                    throw new IOException("The download could not be kept");
                }
                PackageInfo info = plugin.getContext().getPackageManager().getPackageArchiveInfo(target.getAbsolutePath(), 0);
                JSObject answer = new JSObject();
                answer.put("version", info != null ? info.versionName : "");
                answer.put("sha256", digest);
                call.resolve(answer);
            } catch (IOException | RuntimeException failed) {
                part.delete();
                target.delete();
                call.reject(failed.getMessage() != null ? failed.getMessage() : "The download failed");
            } finally {
                plugin.busy = false;
            }
        }

        /** Follows at most five redirects (only from GitHub to its storage, and never with the token) and saves the body. */
        private String fetch(File part) throws IOException {
            String next = url;
            for (int hop = 0; hop < 6; hop++) {
                URL address = new URL(next);
                HttpURLConnection connection = (HttpURLConnection) address.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(60000);
                if (hop == 0 && token != null) {
                    connection.setRequestProperty("Authorization", "Bearer " + token);
                }
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    URL moved = location == null ? null : new URL(address, location);
                    if (
                        moved == null || !"https".equals(moved.getProtocol()) || !"github.com".equals(new URL(url).getHost())
                        || !GITHUB_STORAGE.contains(moved.getHost().toLowerCase(Locale.ROOT))
                    ) {
                        throw new IOException("The download was sent somewhere else");
                    }
                    next = moved.toString();
                    continue;
                }
                if (status != 200) {
                    connection.disconnect();
                    throw new IOException("The download is not available (" + status + ")");
                }
                return save(connection, part);
            }
            throw new IOException("Too many redirects");
        }

        /** Writes the body to the file, with a size limit, and answers its SHA-256. */
        private String save(HttpURLConnection connection, File part) throws IOException {
            MessageDigest digest;
            try {
                digest = MessageDigest.getInstance("SHA-256");
            } catch (java.security.NoSuchAlgorithmException impossible) {
                throw new IOException(impossible);
            }
            long total = 0;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_BYTES) {
                        throw new IOException("The download is too big");
                    }
                    digest.update(buffer, 0, read);
                    out.write(buffer, 0, read);
                }
            } finally {
                connection.disconnect();
            }
            return hex(digest.digest());
        }
    }
}
