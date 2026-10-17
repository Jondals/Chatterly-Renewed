/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/CallForegroundService.java
 * The one foreground service of the app, with one notification that changes with what the app is doing:
 *   - CALL: a call is on. The notification shows who the call is with (only on an unlocked phone), how long it has
 *     lasted and three buttons: mute, deafen and hang up (layout/notification_call.xml). A tap opens the call.
 *   There is no notification while no call is on: the app does not keep itself connected in the background.
 *
 * * Why: since Android 9 an app in the background cannot use the microphone (it records silence), Android 14 requires a
 *   foreground service of type "microphone" started while the app is on screen to keep it, and an app in the background
 *   without a foreground service is frozen within seconds (its connection drops and no call can ring).
 * ! Not exported: only this app starts it, and the buttons of the notification are PendingIntents of this app. The lock
 *   screen shows only the generic version ("Call in progress"), never a name. Swiping the app away from the recent apps
 *   ends the page that keeps the connection, so the service stops with it (a call cannot ring then: that needs push).
 */
package app.chatterly.renewed;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

public class CallForegroundService extends Service {

    /** What the buttons of the notification send to the page (see CallServicePlugin.Listener). */
    interface Listener {
        void onAction(String action);
    }

    /** The channel of a call in progress (quiet: no sound, no vibration). */
    static final String CHANNEL_ID = "calls";
    /** The channel of the connection kept in the background (the least visible one). */

    /** The id of the notification while the service runs. */
    private static final int NOTIFICATION_ID = 1001;

    static final String ACTION_REFRESH = "app.chatterly.renewed.call.REFRESH";
    static final String ACTION_MUTE = "app.chatterly.renewed.call.MUTE";
    static final String ACTION_DEAFEN = "app.chatterly.renewed.call.DEAFEN";
    static final String ACTION_HANG_UP = "app.chatterly.renewed.call.HANG_UP";

    /** Who hears the buttons (the plugin while the page lives; null otherwise). */
    static volatile Listener listener;
    /** The service while it runs, and whether its notification is the one of a call (the type of the service follows). */
    private static volatile CallForegroundService running;
    private boolean shownAsCall;

    // The state the notification shows, set by the plugin before it asks the service to refresh.
    static volatile boolean inCall;
    static volatile String title = "";
    static volatile long startedAt;
    static volatile boolean muted;
    static volatile boolean deafened;

    /** Draws the notification again every minute while the call lasts, so the color of its time follows how long it is. */
    private final Handler ticker = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (inCall) {
                repost();
            }
        }
    };

    /** Nothing binds to this service: it only runs. */
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /**
     * Asks the service to show the current state (starting it if needed), or stops it when there is nothing to show.
     * ! When it already runs with the same kind of notification only the notification is drawn again: Android refuses to
     *   start a foreground service from the background, and a press on "mute" in the notification happens exactly there.
     */
    static void refresh(Context context) {
        if (!inCall) {
            // A page kept only for the call is not needed any more.
            CallKeeper.release();
            context.stopService(new Intent(context, CallForegroundService.class));
            return;
        }
        CallForegroundService service = running;
        if (service != null && service.shownAsCall == inCall) {
            service.repost();
            return;
        }
        try {
            Intent intent = new Intent(context, CallForegroundService.class).setAction(ACTION_REFRESH);
            ContextCompat.startForegroundService(context, intent);
        } catch (RuntimeException refused) {
            // From the background Android may refuse; the notification stays as it was.
        }
    }

    /** Draws the notification again with the current state (the kind of notification did not change). */
    private void repost() {
        ticker.removeCallbacks(tick);
        if (inCall) {
            ticker.postDelayed(tick, 60_000);
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, callNotification());
        }
    }

    /** A refresh shows the state; a button of the notification goes to the page (hang up works even without it). */
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_REFRESH : intent.getAction();
        if (ACTION_MUTE.equals(action) || ACTION_DEAFEN.equals(action) || ACTION_HANG_UP.equals(action)) {
            Listener target = listener;
            if (target != null) {
                target.onAction(ACTION_MUTE.equals(action) ? "mute" : ACTION_DEAFEN.equals(action) ? "deafen" : "hangup");
            } else if (ACTION_HANG_UP.equals(action)) {
                // No page to end the call: the service at least stops keeping the microphone.
                inCall = false;
            }
        }
        if (!inCall) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        createChannels(this);
        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
        }
        if (inCall && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, callNotification(), type);
            running = this;
            shownAsCall = inCall;
            ticker.removeCallbacks(tick);
            ticker.postDelayed(tick, 60_000);
        } catch (RuntimeException refused) {
            // Android refused (no microphone permission, or started from the background): nothing is kept alive.
            inCall = false;
            stopSelf();
        }
        // ! If the system kills the app, its page is gone: the service is not brought back by itself.
        return START_NOT_STICKY;
    }

    /** Forgets this service when it ends. */
    @Override
    public void onDestroy() {
        ticker.removeCallbacks(tick);
        if (running == this) {
            running = null;
        }
        super.onDestroy();
    }

    /**
     * The person swiped the app away. ! During a call the call goes on, like in Discord: its page is kept (CallKeeper) and this
     * service keeps the app alive with the notification of the call. Without a call there is nothing left to keep alive.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (inCall && CallKeeper.has()) {
            super.onTaskRemoved(rootIntent);
            return;
        }
        inCall = false;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    /** Opens the app (the page shows the call when there is one). */
    private PendingIntent openApp() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (inCall) {
            open.putExtra(MainActivity.EXTRA_CALL_ACTION, "show");
        }
        return PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** A button of the notification: an intent to this service itself (not exported, so only this app can send it). */
    private PendingIntent button(String action, int code) {
        Intent intent = new Intent(this, CallForegroundService.class).setAction(action);
        return PendingIntent.getService(this, code, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /**
     * The notification of a call: who, how long, and mute / deafen / hang up.
     * ? A view of our own instead of the call style of Android: the buttons that style draws can be given neither colors
     *   nor corners, and they looked white on a dark phone. The texts use the notification styles of the system, so they
     *   follow the light or dark phone, and the buttons use colors/*.xml (values-night for a dark phone).
     */
    private Notification callNotification() {
        String state = deafened ? getString(R.string.state_deafened) : muted ? getString(R.string.state_muted) : "";
        String name = title == null || title.isEmpty() ? getString(R.string.call_in_progress) : title;
        long since = startedAt > 0 ? startedAt : System.currentTimeMillis();
        // The lock screen gets this one: no name.
        Notification generic = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.call_in_progress))
            .setSmallIcon(R.drawable.ic_stat_chatterly)
            .setUsesChronometer(true)
            .setWhen(since)
            .setShowWhen(true)
            .build();
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            // The plain texts are for the accessibility services and the places that do not draw the view.
            .setContentTitle(name)
            .setContentText(state.isEmpty() ? getString(R.string.call_in_progress) : state)
            .setSmallIcon(R.drawable.ic_stat_chatterly)
            .setColor(0xFF2EF2B0)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(generic)
            .setContentIntent(openApp())
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(callView(name, state, since, false))
            .setCustomBigContentView(callView(name, state, since, true))
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    /** The color of the time of the call: green at first, then yellow, orange and red as it gets longer. */
    static int timerColor(long elapsedMs) {
        long minutes = elapsedMs / 60000;
        if (minutes < 15) return 0xFF2EF2B0;
        if (minutes < 60) return 0xFFFACC15;
        if (minutes < 120) return 0xFFFB923C;
        return 0xFFF87171;
    }

    /**
     * The inside of the call notification with the current state: folded (layout/notification_call.xml, small buttons) or
     * open (layout/notification_call_big.xml, wide buttons with their names).
     */
    private RemoteViews callView(String name, String state, long since, boolean open) {
        RemoteViews view = new RemoteViews(
            getPackageName(),
            open ? R.layout.notification_call_big : R.layout.notification_call
        );
        view.setTextViewText(R.id.call_name, name);
        // The chronometer counts from a moment of the clock since boot: the start of the call moved to that clock.
        long base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - since);
        view.setChronometer(R.id.call_timer, base, null, true);
        // The time of the call changes color the longer it lasts (the same steps as the indicator inside the app).
        view.setTextColor(R.id.call_timer, timerColor(System.currentTimeMillis() - since));
        view.setTextViewText(R.id.call_state, state.isEmpty() ? "" : " · " + state);
        int muteIcon = muted ? R.drawable.ic_call_mic_off : R.drawable.ic_call_mic;
        int deafenIcon = deafened ? R.drawable.ic_call_headphones_off : R.drawable.ic_call_headphones;
        String muteText = getString(muted ? R.string.action_unmute : R.string.action_mute);
        String deafenText = getString(deafened ? R.string.action_undeafen : R.string.action_deafen);
        if (open) {
            view.setImageViewResource(R.id.call_mute_icon, muteIcon);
            view.setTextViewText(R.id.call_mute_label, muteText);
            view.setImageViewResource(R.id.call_deafen_icon, deafenIcon);
            view.setTextViewText(R.id.call_deafen_label, deafenText);
        } else {
            view.setImageViewResource(R.id.call_mute, muteIcon);
            view.setImageViewResource(R.id.call_deafen, deafenIcon);
        }
        view.setInt(R.id.call_mute, "setBackgroundResource", muted ? R.drawable.notification_button_on : R.drawable.notification_button);
        view.setInt(
            R.id.call_deafen,
            "setBackgroundResource",
            deafened ? R.drawable.notification_button_on : R.drawable.notification_button
        );
        view.setContentDescription(R.id.call_mute, muteText);
        view.setContentDescription(R.id.call_deafen, deafenText);
        view.setContentDescription(R.id.call_hang_up, getString(R.string.action_hang_up));
        view.setOnClickPendingIntent(R.id.call_mute, button(ACTION_MUTE, 11));
        view.setOnClickPendingIntent(R.id.call_deafen, button(ACTION_DEAFEN, 12));
        view.setOnClickPendingIntent(R.id.call_hang_up, button(ACTION_HANG_UP, 13));
        return view;
    }

    /** Creates the channels once (Android 8 and later need a channel for every notification). */
    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel calls = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.call_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        calls.setShowBadge(false);
        manager.createNotificationChannel(calls);
    }
}
