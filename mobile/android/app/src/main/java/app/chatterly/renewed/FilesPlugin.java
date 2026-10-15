/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/FilesPlugin.java
 * The native command the page uses to keep a file of a chat ("ChatterlyFiles"): save it in the Downloads folder.
 *
 * * The WebView cannot download a file the page made itself (the decrypted attachment is a blob of the page), so the page
 *   hands it over here, already decrypted, and Android stores it in Downloads (MediaStore, Android 10+: no storage
 *   permission is needed, and the app only ever writes, never reads, that folder).
 * ! Only what the person asked to save, from a right click or a long press. The name is cleaned (no folders, no control
 *   characters, at most 120 characters), the type must look like a type, and the file is at most 64 MB.
 */
package app.chatterly.renewed;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "ChatterlyFiles")
public class FilesPlugin extends Plugin {

    /** The biggest file the page may hand over. */
    private static final int MAX_BYTES = 64 * 1024 * 1024;

    /** Saves a file (base64) in Downloads and answers the name it got there. */
    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Saving files needs Android 10 or newer", "android-version");
            return;
        }
        String data = call.getString("data", "");
        if (data == null || data.isEmpty() || data.length() > (MAX_BYTES / 3) * 4 + 4) {
            call.reject("The file is empty or too big");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException broken) {
            call.reject("The file could not be read");
            return;
        }
        String name = cleanName(call.getString("name", ""));
        String mime = call.getString("mime", "");
        if (mime == null || !mime.matches("^[\\w.+-]{1,60}/[\\w.+-]{1,80}$")) {
            mime = "application/octet-stream";
        }
        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri item = resolver.insert(collection, values);
        if (item == null) {
            call.reject("The file could not be saved in Downloads");
            return;
        }
        try (OutputStream out = resolver.openOutputStream(item)) {
            if (out == null) {
                throw new IOException("no output");
            }
            out.write(bytes);
        } catch (IOException failed) {
            resolver.delete(item, null, null);
            call.reject("The file could not be saved in Downloads");
            return;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(item, done, null, null);
        JSObject answer = new JSObject();
        answer.put("name", name);
        call.resolve(answer);
    }

    /** A file name without folders or control characters (Android adds " (1)" when the name is taken). */
    private static String cleanName(String raw) {
        String name = raw == null ? "" : raw.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (name.startsWith(".")) {
            name = name.substring(1);
        }
        if (name.isEmpty()) {
            name = "chatterly-file";
        }
        return name.length() > 120 ? name.substring(name.length() - 120) : name;
    }
}
