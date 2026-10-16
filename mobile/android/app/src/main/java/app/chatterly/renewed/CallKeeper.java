/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/CallKeeper.java
 * Keeps a call going when the person swipes the app away from the recent apps (or "close all"), like Discord does.
 *
 * * Before, removing the app from the recent apps destroyed its screen, and the page (the WebView, where the call lives) went
 *   with it: the person was out of the call. Now, while there is a call, the screen goes but its page is KEPT: the WebView is
 *   not destroyed, the call goes on (voice in and out, the notification with its buttons), and the foreground service of the
 *   call keeps the app alive.
 * * When the person opens the app again, a new screen with a new page starts. The kept page HANDS OVER: it stops renewing the
 *   session (the new page owns it from now on) and gives the id of its call, which the new page joins at once; the server moves
 *   the place of the person to the new page without taking them out of the call (call.transferred), and the kept page is then
 *   destroyed. When the call ends while nobody opened the app, the kept page is destroyed too.
 * ! Only the page of this app is kept, only during a call, and it keeps no more rights than it had: no Node, no new channel.
 *   Everything here runs on the main thread.
 */
package app.chatterly.renewed;

import android.os.Handler;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import com.getcapacitor.Bridge;

final class CallKeeper {

    /** How long the kept page waits for the new page to join before it is destroyed anyway. */
    private static final long HAND_OVER_MS = 45_000;
    /** How long it stays after the new page joined (so the voice does not cut while the place moves). */
    private static final long AFTER_JOIN_MS = 3_000;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static Bridge bridge;
    /** The call the new page must join (null: none, or not known yet). */
    private static volatile String rejoinRoom;
    /** True between the start of a hand-over and the answer of the kept page. */
    private static volatile boolean waiting;

    private CallKeeper() {}

    /** Keeps the page of a screen that is going away during a call. True when it is kept. */
    static boolean keep(Bridge page) {
        if (page == null || page.getWebView() == null) {
            return false;
        }
        release();
        bridge = page;
        return true;
    }

    /** True while a page is kept. */
    static boolean has() {
        return bridge != null;
    }

    /**
     * A new screen started: the kept page stops renewing the session and says which call it is in (the new page joins it).
     * It is destroyed once the new page joined (rejoined) or after HAND_OVER_MS.
     */
    static void handOver() {
        final Bridge kept = bridge;
        if (kept == null) {
            return;
        }
        waiting = true;
        rejoinRoom = null;
        kept
            .getWebView()
            .evaluateJavascript(
                "(function(){try{return window.chatterlyHandOver?window.chatterlyHandOver():'';}catch(e){return '';}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String answer) {
                        String room = answer == null ? "" : answer.replace("\"", "");
                        rejoinRoom = room.matches("^[A-Za-z0-9_-]{1,64}$") ? room : null;
                        waiting = false;
                    }
                }
            );
        MAIN.postDelayed(
            new Runnable() {
                @Override
                public void run() {
                    if (bridge == kept) {
                        release();
                    }
                }
            },
            HAND_OVER_MS
        );
    }

    /** True while the kept page has not answered yet. */
    static boolean isWaiting() {
        return waiting;
    }

    /** The call the new page must join, once (null when there is none). */
    static String takeRoom() {
        String room = rejoinRoom;
        rejoinRoom = null;
        return room;
    }

    /** The new page joined the call: the kept page goes a moment later. */
    static void rejoined() {
        final Bridge kept = bridge;
        MAIN.postDelayed(
            new Runnable() {
                @Override
                public void run() {
                    if (bridge == kept) {
                        release();
                    }
                }
            },
            AFTER_JOIN_MS
        );
    }

    /** Destroys the kept page (the call ended, or it was handed over). */
    static void release() {
        final Bridge kept = bridge;
        bridge = null;
        if (kept == null) {
            return;
        }
        MAIN.post(
            new Runnable() {
                @Override
                public void run() {
                    try {
                        kept.onDestroy();
                    } catch (RuntimeException ignored) {
                        // Its plugins were already gone.
                    }
                    WebView view = kept.getWebView();
                    if (view != null) {
                        view.removeAllViews();
                        view.destroy();
                    }
                }
            }
        );
    }
}
