/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/CallServicePlugin.java
 * The only native command the page can call ("ChatterlyCall"): start or stop the service that keeps a call alive.
 *
 * ! Two methods, no arguments: the page cannot choose what the notification says nor run anything else. The service
 *   is started only while the app is on screen (Android 14 refuses a microphone service started from the background)
 *   and only if the microphone permission was granted for the call.
 */
package app.chatterly.renewed;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ChatterlyCall")
public class CallServicePlugin extends Plugin {

    /** Starts the foreground service of the call (once the microphone is allowed). */
    @PluginMethod
    public void start(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("The microphone is not allowed");
            return;
        }
        try {
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), CallForegroundService.class));
            call.resolve();
        } catch (RuntimeException refused) {
            call.reject("Android refused to keep the call in the background");
        }
    }

    /** Stops the foreground service: the call ended. */
    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), CallForegroundService.class));
        call.resolve();
    }
}
