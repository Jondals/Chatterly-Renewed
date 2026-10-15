/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/CallForegroundService.java
 * Keeps the microphone of a call working while the screen is off or the app is in the background.
 *
 * * Why: since Android 9 an app in the background cannot use the microphone (it records silence), and Android 14
 *   requires a foreground service of type "microphone", started while the app is on screen, to keep it.
 * ! Only during a call (started by the page when the call connects, stopped when it ends), never to keep a connection
 *   open. Not exported: no other app can start or stop it. Its notification is generic: no names of people, groups or
 *   channels, so the lock screen shows nothing about the call.
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
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

public class CallForegroundService extends Service {

    /** The channel of the notification of a call in progress (quiet: no sound, no vibration). */
    static final String CHANNEL_ID = "calls";

    /** The id of the notification while the service runs. */
    private static final int NOTIFICATION_ID = 1001;

    /** Nothing binds to this service: it only runs. */
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** Goes to the foreground with the generic notification; if Android refuses (no microphone permission), stops. */
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel(this);
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0
            );
        } catch (RuntimeException refused) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // ! If the system kills the app, the call is over: the service is not brought back by itself.
        return START_NOT_STICKY;
    }

    /** The notification: the name of the app and "Call in progress", and a tap opens the app. */
    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.call_in_progress))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(tap)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    /** Creates the quiet channel of calls once (Android 8 and later need a channel for every notification). */
    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.call_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setShowBadge(false);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }
}
