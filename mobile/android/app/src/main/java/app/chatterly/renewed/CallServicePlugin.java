/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/CallServicePlugin.java
 * The native commands of calls the page can use ("ChatterlyCall"):
 *   - call / update / end: the notification of the call in progress (who, how long, mute, deafen, hang up) and the
 *     foreground service that keeps the microphone alive with the screen off;
 *   - listen: stay connected in the background so calls ring with the app minimized (a quiet notification);
 *   - ring / cancelRing: the notification of a call that rings while the app is not on screen;
 *   - audioRoutes / setAudioRoute: where the voice of the call sounds (earpiece, speaker, headset, Bluetooth);
 *   - setSecure: whether screenshots of the app are blocked (FLAG_SECURE);
 *   - notifications: asks Android 13+ for permission to show notifications;
 *   - fullScreen / fullScreenSettings: whether a ringing call may fill the screen, and the page of Android to allow it;
 *   - takePendingAction: what a button of a notification asked while the page was not listening.
 * The buttons of the notifications reach the page as "action" events: mute, deafen, hangup, answer, decline, show.
 *
 * ! The page chooses only short texts (cut to 80 characters) and yes/no values; it cannot choose the buttons, the
 *   channels or what the lock screen shows (always the generic version). The microphone service starts only with the
 *   microphone permission granted and while the app is on screen (Android 14 refuses it from the background).
 */
package app.chatterly.renewed;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.view.WindowManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;

@CapacitorPlugin(
    name = "ChatterlyCall",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class CallServicePlugin extends Plugin {

    /** The plugin while its page lives (the notifications and the receiver reach the page through it). */
    private static volatile CallServicePlugin current;
    /** A button pressed while no page was listening: given to the page when it asks (takePendingAction). */
    private static volatile JSObject pending;

    /** The longest text the page may put in a notification. */
    private static final int MAX_TEXT = 80;

    /** The plugin starts with its page: the buttons of the call notification go to it from now on. */
    @Override
    public void load() {
        current = this;
        CallForegroundService.listener = new CallForegroundService.Listener() {
            @Override
            public void onAction(String action) {
                deliver(action, null);
            }
        };
    }

    /** The page is gone: nothing listens to the buttons any more, and nothing is kept connected for it. */
    @Override
    protected void handleOnDestroy() {
        if (current == this) {
            current = null;
            CallForegroundService.listener = null;
            CallForegroundService.listening = false;
            CallForegroundService.inCall = false;
            CallForegroundService.refresh(getContext());
        }
        super.handleOnDestroy();
    }

    /** Tells the page that a button was pressed (or keeps it until the page asks for it). */
    static void deliver(String action, String roomId) {
        JSObject event = new JSObject();
        event.put("action", action);
        if (roomId != null) {
            event.put("roomId", clip(roomId));
        }
        CallServicePlugin plugin = current;
        if (plugin != null && plugin.hasListeners("action")) {
            plugin.notifyListeners("action", event, true);
        } else {
            pending = event;
        }
    }

    /** The button pressed while the page was not listening, once (empty when there is none). */
    @PluginMethod
    public void takePendingAction(PluginCall call) {
        JSObject event = pending;
        pending = null;
        call.resolve(event == null ? new JSObject() : event);
    }

    /** A call started: the notification with its buttons and the service that keeps the microphone. */
    @PluginMethod
    public void call(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("The microphone is not allowed");
            return;
        }
        CallForegroundService.title = clip(call.getString("title", ""));
        Long started = call.getLong("startedAt");
        CallForegroundService.startedAt = started == null ? System.currentTimeMillis() : started;
        CallForegroundService.muted = Boolean.TRUE.equals(call.getBoolean("muted", false));
        CallForegroundService.deafened = Boolean.TRUE.equals(call.getBoolean("deafened", false));
        CallForegroundService.inCall = true;
        IncomingCallNotifier.cancel(getContext());
        AudioManager audio = audioManager();
        if (audio != null) {
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        }
        try {
            CallForegroundService.refresh(getContext());
            call.resolve();
        } catch (RuntimeException refused) {
            CallForegroundService.inCall = false;
            call.reject("Android refused to keep the call in the background");
        }
    }

    /** The state of the call changed (muted, deafened, or its name): the notification follows. */
    @PluginMethod
    public void update(PluginCall call) {
        if (call.getString("title") != null) {
            CallForegroundService.title = clip(call.getString("title"));
        }
        if (call.getBoolean("muted") != null) {
            CallForegroundService.muted = Boolean.TRUE.equals(call.getBoolean("muted"));
        }
        if (call.getBoolean("deafened") != null) {
            CallForegroundService.deafened = Boolean.TRUE.equals(call.getBoolean("deafened"));
        }
        if (CallForegroundService.inCall) {
            CallForegroundService.refresh(getContext());
        }
        call.resolve();
    }

    /** The call ended: the notification goes (or goes back to "connected"), and the sound goes back to normal. */
    @PluginMethod
    public void end(PluginCall call) {
        CallForegroundService.inCall = false;
        CallForegroundService.refresh(getContext());
        AudioManager audio = audioManager();
        if (audio != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audio.clearCommunicationDevice();
            } else {
                setSpeakerLegacy(audio, false);
            }
            audio.setMode(AudioManager.MODE_NORMAL);
        }
        call.resolve();
    }

    /** Stays connected in the background (on) so calls ring, or stops (off). Must be asked while the app is on screen. */
    @PluginMethod
    public void listen(PluginCall call) {
        CallForegroundService.listening = Boolean.TRUE.equals(call.getBoolean("on", false));
        try {
            CallForegroundService.refresh(getContext());
            call.resolve();
        } catch (RuntimeException refused) {
            CallForegroundService.listening = false;
            call.reject("Android refused to stay connected in the background");
        }
    }

    /** A call rings while the app is not on screen: the notification with Answer and Decline. */
    @PluginMethod
    public void ring(PluginCall call) {
        String roomId = call.getString("roomId", "");
        if (roomId == null || roomId.isEmpty() || roomId.length() > 64) {
            call.reject("No call");
            return;
        }
        IncomingCallNotifier.show(getContext(), roomId, clip(call.getString("caller", "")));
        call.resolve();
    }

    /** The call stopped ringing (answered somewhere, declined, or it ended). */
    @PluginMethod
    public void cancelRing(PluginCall call) {
        IncomingCallNotifier.cancel(getContext());
        call.resolve();
    }

    /** Blocks screenshots and recordings of the app (secure) or allows them (only for verified contacts, decided by the page). */
    @PluginMethod
    public void setSecure(PluginCall call) {
        boolean secure = !Boolean.FALSE.equals(call.getBoolean("secure", true));
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(
            new Runnable() {
                @Override
                public void run() {
                    if (secure) {
                        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                    } else {
                        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                    }
                }
            }
        );
        call.resolve();
    }

    /** Whether the app may show notifications (asking Android 13+ the first time). */
    @PluginMethod
    public void notifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject answer = new JSObject();
            answer.put("granted", true);
            call.resolve(answer);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsAnswered");
    }

    /** The answer of the person to the question of notifications. */
    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(answer);
    }

    /**
     * Whether a ringing call may fill the screen over the lock screen. Android 14+ grants it by default only to apps of
     * the Play store that are phone apps; an app installed from its APK must be allowed by the person (fullScreenSettings).
     */
    @PluginMethod
    public void fullScreen(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            NotificationManager manager = getContext().getSystemService(NotificationManager.class);
            allowed = manager != null && manager.canUseFullScreenIntent();
        }
        JSObject answer = new JSObject();
        answer.put("allowed", allowed);
        call.resolve(answer);
    }

    /** Opens the page of Android where the person allows calls to fill the screen (Android 14+). */
    @PluginMethod
    public void fullScreenSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                .setData(Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (RuntimeException missing) {
            call.reject("This phone has no such setting");
        }
    }

    /** Where the voice of a call can sound now, and where it sounds. */
    @PluginMethod
    public void audioRoutes(PluginCall call) {
        AudioManager audio = audioManager();
        JSArray routes = new JSArray();
        String now = "speaker";
        if (audio != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            List<AudioDeviceInfo> devices = audio.getAvailableCommunicationDevices();
            AudioDeviceInfo active = audio.getCommunicationDevice();
            for (AudioDeviceInfo device : devices) {
                String kind = kindOf(device.getType());
                if (kind == null) {
                    continue;
                }
                JSObject route = new JSObject();
                route.put("id", String.valueOf(device.getId()));
                route.put("kind", kind);
                route.put("name", clip(String.valueOf(device.getProductName())));
                routes.put(route);
                if (active != null && active.getId() == device.getId()) {
                    now = String.valueOf(device.getId());
                }
            }
        } else if (audio != null) {
            routes.put(legacyRoute("earpiece"));
            routes.put(legacyRoute("speaker"));
            now = audio.isSpeakerphoneOn() ? "speaker" : "earpiece";
        }
        JSObject answer = new JSObject();
        answer.put("routes", routes);
        answer.put("current", now);
        call.resolve(answer);
    }

    /** Sends the voice of the call to a route (its id from audioRoutes). */
    @PluginMethod
    public void setAudioRoute(PluginCall call) {
        String id = call.getString("id", "");
        AudioManager audio = audioManager();
        if (audio == null || id == null) {
            call.reject("No audio");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
                if (String.valueOf(device.getId()).equals(id) && kindOf(device.getType()) != null) {
                    if (audio.setCommunicationDevice(device)) {
                        call.resolve();
                    } else {
                        call.reject("Android refused that route");
                    }
                    return;
                }
            }
            call.reject("That route is not available");
            return;
        }
        if ("speaker".equals(id) || "earpiece".equals(id)) {
            setSpeakerLegacy(audio, "speaker".equals(id));
            call.resolve();
            return;
        }
        call.reject("That route is not available");
    }

    /** The kind of an audio device the page understands, or null for the ones a call does not use. */
    private static String kindOf(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
                return "earpiece";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                return "speaker";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
                return "wired";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
                return "bluetooth";
            default:
                return null;
        }
    }

    /** A route of the phones before Android 12 (only the earpiece and the speaker can be chosen there). */
    private static JSObject legacyRoute(String kind) {
        JSObject route = new JSObject();
        route.put("id", kind);
        route.put("kind", kind);
        route.put("name", "");
        return route;
    }

    /** Before Android 12: the speaker on or off. */
    @SuppressWarnings("deprecation")
    private static void setSpeakerLegacy(AudioManager audio, boolean on) {
        audio.setSpeakerphoneOn(on);
    }

    /** The audio manager of the system. */
    private AudioManager audioManager() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /** A text of the page, cut to the most a notification shows (and never null). */
    private static String clip(String text) {
        if (text == null) {
            return "";
        }
        String clean = text.replaceAll("[\\p{Cntrl}]", " ").trim();
        return clean.length() > MAX_TEXT ? clean.substring(0, MAX_TEXT) : clean;
    }
}
