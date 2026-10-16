/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/ScreenSharePlugin.java
 * The native command the page uses to share the screen ("ChatterlyScreen"): start, acknowledge a picture, stop.
 *
 * * The Android WebView cannot capture the screen, so the system captures it (ScreenForegroundService) and the page gets the
 *   pictures (JPEG) and the sound (PCM), draws them on a canvas and plays them into a track: the call sends that as a video.
 * * How they reach the page: a BINARY channel straight into the page (a WebMessage listener of androidx.webkit,
 *   window.chatterlyScreen), without base64 and without the queue of the Capacitor bridge. Before, every picture was turned
 *   into base64 text and run as JavaScript on the main thread: that capped the sharing at about 15 pictures per second and made
 *   the whole phone stutter while it lasted. A WebView too old for binary messages still gets the old "frame" and "audio" events.
 *   A message on the channel is one byte of kind (1 picture, 2 sound), then for a picture its width and height (two bytes
 *   each, big end first) and the JPEG; for a sound the 16-bit PCM, mono, 48 kHz.
 * ! The channel answers only the main frame of the app's own origin (the origins Capacitor serves), and the pictures go only to
 *   the page that attached itself last. The page chooses only the size and the pace of the pictures, inside fixed limits
 *   (checked again in the service); the system always asks the person first with its own dialog, every time. This app's own
 *   window is blocked from capture (FLAG_SECURE), so sharing shows the other apps, never the conversations of Chatterly.
 * * A "silent" event says that the sound of the other apps comes as silence (an app can forbid capturing its sound, and some
 *   phones do it for every app): the page tells the person instead of letting them believe the others hear it.
 */
package app.chatterly.renewed;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ChatterlyScreen")
public class ScreenSharePlugin extends Plugin {

    /** The kinds of message of the binary channel. */
    private static final byte KIND_FRAME = 1;
    private static final byte KIND_SOUND = 2;

    private final Handler main = new Handler(Looper.getMainLooper());
    /** The page that listens on the binary channel (null: the old events are used). */
    private volatile JavaScriptReplyProxy page;
    private boolean binary;

    /** Opens the binary channel to the page, if this WebView can carry binary messages. */
    @Override
    public void load() {
        WebView view = getBridge().getWebView();
        binary =
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER);
        if (!binary || view == null) {
            binary = false;
            return;
        }
        try {
            WebViewCompat.addWebMessageListener(
                view,
                "chatterlyScreen",
                getBridge().getAllowedOriginRules(),
                new WebViewCompat.WebMessageListener() {
                    @Override
                    public void onPostMessage(
                        @NonNull WebView webView,
                        @NonNull WebMessageCompat message,
                        @NonNull Uri sourceOrigin,
                        boolean isMainFrame,
                        @NonNull JavaScriptReplyProxy replyProxy
                    ) {
                        if (!isMainFrame) {
                            return;
                        }
                        String text = message.getType() == WebMessageCompat.TYPE_STRING ? message.getData() : null;
                        if ("attach".equals(text)) {
                            page = replyProxy;
                        } else if ("ack".equals(text) && replyProxy == page) {
                            ScreenForegroundService.acknowledge();
                        }
                    }
                }
            );
        } catch (RuntimeException unsupported) {
            binary = false;
        }
    }

    /** Sends one message of the binary channel to the page (on the main thread, where the WebView lives). */
    private void post(final byte[] bytes) {
        final JavaScriptReplyProxy target = page;
        if (target == null) {
            return;
        }
        main.post(
            new Runnable() {
                @Override
                public void run() {
                    try {
                        target.postMessage(bytes);
                    } catch (RuntimeException gone) {
                        // The page went away: the capture is stopped by handleOnDestroy.
                    }
                }
            }
        );
    }

    /** Passes the pictures and the sound of the service to the page. */
    private final ScreenForegroundService.Listener toPage = new ScreenForegroundService.Listener() {
        @Override
        public void onFrame(byte[] jpeg, int width, int height) {
            if (binary && page != null) {
                byte[] bytes = new byte[5 + jpeg.length];
                bytes[0] = KIND_FRAME;
                bytes[1] = (byte) (width >> 8);
                bytes[2] = (byte) width;
                bytes[3] = (byte) (height >> 8);
                bytes[4] = (byte) height;
                System.arraycopy(jpeg, 0, bytes, 5, jpeg.length);
                post(bytes);
                return;
            }
            JSObject frame = new JSObject();
            frame.put("data", Base64.encodeToString(jpeg, Base64.NO_WRAP));
            frame.put("width", width);
            frame.put("height", height);
            notifyListeners("frame", frame);
        }

        @Override
        public void onStopped() {
            notifyListeners("stopped", new JSObject());
        }

        @Override
        public void onAudio(byte[] pcm) {
            if (binary && page != null) {
                byte[] bytes = new byte[1 + pcm.length];
                bytes[0] = KIND_SOUND;
                System.arraycopy(pcm, 0, bytes, 1, pcm.length);
                post(bytes);
                return;
            }
            JSObject piece = new JSObject();
            piece.put("data", Base64.encodeToString(pcm, Base64.NO_WRAP));
            notifyListeners("audio", piece);
        }

        @Override
        public void onSilent() {
            notifyListeners("silent", new JSObject());
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
        service.putExtra(ScreenForegroundService.EXTRA_FPS, clamp(call.getInt("fps", 30), 1, 60));
        service.putExtra(ScreenForegroundService.EXTRA_QUALITY, clamp(call.getInt("quality", 60), 30, 90));
        service.putExtra(ScreenForegroundService.EXTRA_AUDIO, Boolean.TRUE.equals(call.getBoolean("audio", false)));
        ScreenForegroundService.listener = toPage;
        try {
            ContextCompat.startForegroundService(getContext(), service);
            JSObject answer = new JSObject();
            answer.put("binary", binary && page != null);
            call.resolve(answer);
        } catch (RuntimeException refused) {
            ScreenForegroundService.listener = null;
            call.reject("Android refused to share the screen");
        }
    }

    /** The page drew the last picture: the next one may come (the old path; the binary channel acknowledges by itself). */
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
        page = null;
        ScreenForegroundService.stopCapture(getContext());
        super.handleOnDestroy();
    }

    private static int clamp(Integer value, int low, int high) {
        return Math.max(low, Math.min(high, value == null ? low : value));
    }
}
