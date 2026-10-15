/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/MainActivity.java
 * The only screen of the Android app: Capacitor's WebView with the web app that is packed inside the APK.
 *
 * ! FLAG_SECURE is on from the first frame: no screenshots or screen recordings of the app. The page lifts it only while
 *   it shows a chat or a call with contacts the person verified (CallServicePlugin.setSecure). The screen of recent apps
 *   never shows the app (setRecentsScreenshotEnabled, Android 13+), screenshots allowed or not.
 * * The back key first asks the page to close what is open (a window, a menu, a section of Settings back to the list:
 *   window.chatterlyBack in the page). Only when the page has nothing to close does it go back in the history of the app,
 *   and on its first page Android sends the app to the background. Capacitor itself (without its App plugin, which this
 *   app does not carry) does not handle the back key.
 * * A notification of a call opens this screen with what to do (answer, show the ringing call, show the call); when the
 *   phone is locked the call is shown over the lock screen, as a phone call is.
 * * A page that stops answering (its renderer is stuck for about 10 s) is ended and the screen starts again, and a renderer
 *   that dies takes the screen with it instead of the whole app: the app reloads instead of staying frozen.
 */
package app.chatterly.renewed;

import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebViewRenderProcess;
import android.webkit.WebViewRenderProcessClient;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    /** What a notification of a call asks: "answer", "ringing" or "show". */
    static final String EXTRA_CALL_ACTION = "chatterlyCallAction";
    /** The call it is about. */
    static final String EXTRA_ROOM = "chatterlyRoom";

    /**
     * Protects the window before anything is drawn, registers the native plugins, lets Capacitor start the WebView and
     * then puts the stricter client in place (only the app may ask for the microphone and the camera; see
     * SecureWebChromeClient) and the back key of the app.
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false);
        }
        // The native plugins of the app: calls, sharing the screen, saving a file of a chat, and updates.
        registerPlugin(CallServicePlugin.class);
        registerPlugin(UpdatePlugin.class);
        registerPlugin(ScreenSharePlugin.class);
        registerPlugin(FilesPlugin.class);
        super.onCreate(savedInstanceState);
        WebView view = getBridge().getWebView();
        view.setWebChromeClient(new SecureWebChromeClient(getBridge()));
        // The WebView multiplies every text by the font scale of the system, on top of the text size of the app itself
        // (Settings > Appearance): the app keeps its own size, like in the browser and the desktop app.
        view.getSettings().setTextZoom(100);
        // ! Narrower than Capacitor's defaults: the page never needs the location, new windows opened by script, or
        //   file:// addresses (it is served from https://chatterly.internal by Capacitor itself).
        view.getSettings().setGeolocationEnabled(false);
        view.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        view.getSettings().setAllowFileAccess(false);
        // The page keeps its connection while the app is in the background (a call must still ring): its renderer keeps
        // the priority of the app instead of being the first thing Android stops.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        getOnBackPressedDispatcher().addCallback(this, new WebHistoryBack());
        watchRenderer(view);
        handleCallIntent(getIntent());
    }

    /** Times in a row the renderer was reported stuck (Android asks again about every 5 seconds while it is). */
    private int unresponsive;

    /** Ends a stuck renderer and starts the screen again when the renderer goes away, instead of freezing or closing. */
    private void watchRenderer(WebView view) {
        getBridge().addWebViewListener(new RendererGone());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            view.setWebViewRenderProcessClient(
                new WebViewRenderProcessClient() {
                    @Override
                    public void onRenderProcessUnresponsive(WebView stuck, WebViewRenderProcess renderer) {
                        unresponsive++;
                        if (unresponsive >= 2 && renderer != null) {
                            renderer.terminate();
                        }
                    }

                    @Override
                    public void onRenderProcessResponsive(WebView alive, WebViewRenderProcess renderer) {
                        unresponsive = 0;
                    }
                }
            );
        }
    }

    /** The renderer of the page went away (it crashed, or it was ended because it was stuck): the screen starts again. */
    private final class RendererGone extends WebViewListener {

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            unresponsive = 0;
            runOnUiThread(
                new Runnable() {
                    @Override
                    public void run() {
                        recreate();
                    }
                }
            );
            return true;
        }
    }

    /** A notification of a call opened the app while it was already running. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleCallIntent(intent);
    }

    /** Hands what a notification of a call asked to the page, and shows a ringing or answered call over the lock screen. */
    private void handleCallIntent(Intent intent) {
        String action = intent == null ? null : intent.getStringExtra(EXTRA_CALL_ACTION);
        if (action == null) {
            return;
        }
        String roomId = intent.getStringExtra(EXTRA_ROOM);
        intent.removeExtra(EXTRA_CALL_ACTION);
        if ("answer".equals(action) || "ringing".equals(action)) {
            showOverLockScreen(true);
            if ("answer".equals(action)) {
                IncomingCallNotifier.cancel(this);
                KeyguardManager keyguard = getSystemService(KeyguardManager.class);
                if (keyguard != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    keyguard.requestDismissKeyguard(this, null);
                }
            }
        }
        CallServicePlugin.deliver(action, roomId);
    }

    /** Lets this screen appear over the lock screen and turn the screen on (only for a call), or not. */
    @SuppressWarnings("deprecation")
    void showOverLockScreen(boolean on) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(on);
            setTurnScreenOn(on);
        } else if (on) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }

    /** Leaving the screen ends the permission to show over the lock screen: the next time the lock screen is normal. */
    @Override
    public void onStop() {
        showOverLockScreen(false);
        super.onStop();
    }

    /** The back key: the page closes what is open; otherwise one step back in the history, or out of the app. */
    private final class WebHistoryBack extends OnBackPressedCallback {

        /** Starts enabled: it decides every press of the back key. */
        WebHistoryBack() {
            super(true);
        }

        /** Asks the page first (it answers "true" when it closed something). */
        @Override
        public void handleOnBackPressed() {
            WebView view = getBridge().getWebView();
            if (view == null) {
                leave();
                return;
            }
            view.evaluateJavascript(
                "(function(){try{return !!(window.chatterlyBack && window.chatterlyBack());}catch(e){return false;}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String handled) {
                        if (!"true".equals(handled)) {
                            historyBack();
                        }
                    }
                }
            );
        }

        /** One step back in the history of the app, or out of the app on its first page. */
        private void historyBack() {
            WebView view = getBridge().getWebView();
            if (view != null && view.canGoBack()) {
                view.goBack();
                return;
            }
            leave();
        }

        /** Lets Android do its default (to the background). */
        private void leave() {
            setEnabled(false);
            getOnBackPressedDispatcher().onBackPressed();
            setEnabled(true);
        }
    }
}
