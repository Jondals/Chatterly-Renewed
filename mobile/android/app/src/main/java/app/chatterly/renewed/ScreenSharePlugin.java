/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/ScreenSharePlugin.java
 * The native command the page uses to share the screen ("ChatterlyScreen"): start, acknowledge a picture, stop.
 *
 * * The Android WebView cannot capture the screen, so the system captures it (ScreenForegroundService) and the page
 *   gets the pictures as "frame" events (a JPEG in base64 and its size), draws them on a canvas and sends the canvas to
 *   the call as a video. A "stopped" event tells the page that the capture ended (the person tapped stop in the
 *   status bar, or the system ended it).
 * ! The page chooses only the size and the pace of the pictures, inside fixed limits (checked again in the service);
 *   the system always asks the person first with its own dialog, every time. This app's own window is blocked from
 *   capture (FLAG_SECURE), so sharing shows the other apps, never the conversations of Chatterly.
 */
package app.chatterly.renewed;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.media.projection.MediaProjectionManager;
import android.content.Context;

@CapacitorPlugin(name = "ChatterlyScreen")
public class ScreenSharePlugin extends Plugin {

    /** Passes the pictures of the service to the page. */
    private final ScreenForegroundService.Listener toPage = new ScreenForegroundService.Listener() {
        @Override
        public void onFrame(String jpegBase64, int width, int height) {
            JSObject frame = new JSObject();
            frame.put("data", jpegBase64);
            frame.put("width", width);
            frame.put("height", height);
            notifyListeners("frame", frame);
        }

        @Override
        public void onStopped() {
            notifyListeners("stopped", new JSObject());
        }
    };

    /** Asks the person (system dialog) to allow capturing the screen; the capture starts when they accept. */
    @PluginMethod
    public void start(PluginCall call) {
        if (ScreenForegroundService.isRunning()) {
            call.reject("The screen is already being shared");
            return;
        }
        MediaProjectionManager manager = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            call.reject("This phone cannot share the screen");
            return;
        }
        startActivityForResult(call, manager.createScreenCaptureIntent(), "projectionResult");
    }

    /** The answer of the system dialog: on accept, the service takes over; on cancel, the page is told. */
    @ActivityCallback
    private void projectionResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Intent service = new Intent(getContext(), ScreenForegroundService.class);
        service.putExtra(ScreenForegroundService.EXTRA_RESULT_CODE, result.getResultCode());
        service.putExtra(ScreenForegroundService.EXTRA_PROJECTION, result.getData());
        service.putExtra(ScreenForegroundService.EXTRA_LONG_SIDE, clamp(call.getInt("longSide", 1280), 480, 1920));
        service.putExtra(ScreenForegroundService.EXTRA_FPS, clamp(call.getInt("fps", 12), 1, 30));
        service.putExtra(ScreenForegroundService.EXTRA_QUALITY, clamp(call.getInt("quality", 60), 30, 90));
        ScreenForegroundService.listener = toPage;
        try {
            ContextCompat.startForegroundService(getContext(), service);
            call.resolve();
        } catch (RuntimeException refused) {
            ScreenForegroundService.listener = null;
            call.reject("Android refused to share the screen");
        }
    }

    /** The page drew the last picture: the next one may come. */
    @PluginMethod
    public void ack(PluginCall call) {
        ScreenForegroundService.acknowledge();
        call.resolve();
    }

    /** Stops sharing. */
    @PluginMethod
    public void stop(PluginCall call) {
        ScreenForegroundService.stopCapture(getContext());
        call.resolve();
    }

    /** The page is gone: the capture goes with it. */
    @Override
    protected void handleOnDestroy() {
        ScreenForegroundService.listener = null;
        ScreenForegroundService.stopCapture(getContext());
        super.handleOnDestroy();
    }

    private static int clamp(Integer value, int low, int high) {
        return Math.max(low, Math.min(high, value == null ? low : value));
    }
}
