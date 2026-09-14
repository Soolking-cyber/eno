package vn.eno.app;

import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.View;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * SYSTEM HAPTICS ON ANDROID — the platform's own tuned feedback, not a hand-timed buzz.
 *
 * Owner, 2026-09-14: "app should have more pleasant haptics on interactions use best industry standards". What ran
 * before was @capacitor/haptics, whose Android `impact` plays a raw waveform — LIGHT is 50 ms at amplitude 110 — so every
 * tap was a small buzz rather than a tick, and it ignored the user's "Touch feedback" setting.
 *
 * Android's guidance (developer.android.com, "Add haptic feedback to events") is View.performHapticFeedback with the
 * semantic HapticFeedbackConstants: the OEM maps each to a waveform tuned for that device's actuator, it is crisp on good
 * hardware and restrained on weak hardware, and it RESPECTS the system touch-feedback switch. Semantic kinds, newest
 * constant where the OS has it, a close older one where it does not:
 *   tap        VIRTUAL_KEY                   a committed tap (save, send, a button that does something) — not
 *                                            KEYBOARD_TAP, which several OEMs map to almost nothing (opus)
 *   selection  SEGMENT_TICK (34+)  · CLOCK_TICK   moving between tabs, segments, picker values
 *   confirm    CONFIRM (30+)       · VIRTUAL_KEY  a completion the user waited on (published, sent)
 *   error      REJECT (30+)        · LONG_PRESS   a submission the app refused
 *   longPress  LONG_PRESS                    a long press that opened something
 *   toggleOn   TOGGLE_ON (34+)     · CLOCK_TICK
 *   toggleOff  TOGGLE_OFF (34+)    · CLOCK_TICK
 * The web layer (src/lib/haptics.ts) uses this plugin when the binary has it and falls back to @capacitor/haptics on an
 * older install, so a site deploy never depends on an app update.
 */
@CapacitorPlugin(name = "EnoHaptics")
public class EnoHapticsPlugin extends Plugin {

    static int constantFor(String kind) {
        final int sdk = Build.VERSION.SDK_INT;
        switch (kind == null ? "tap" : kind) {
            case "selection":
                return sdk >= 34 ? HapticFeedbackConstants.SEGMENT_TICK : HapticFeedbackConstants.CLOCK_TICK;
            case "confirm":
                return sdk >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
            case "error":
                return sdk >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
            case "longPress":
                return HapticFeedbackConstants.LONG_PRESS;
            case "toggleOn":
                return sdk >= 34 ? HapticFeedbackConstants.TOGGLE_ON : HapticFeedbackConstants.CLOCK_TICK;
            case "toggleOff":
                return sdk >= 34 ? HapticFeedbackConstants.TOGGLE_OFF : HapticFeedbackConstants.CLOCK_TICK;
            case "tap":
            default:
                return HapticFeedbackConstants.VIRTUAL_KEY;
        }
    }

    @PluginMethod
    public void perform(PluginCall call) {
        final int constant = constantFor(call.getString("kind", "tap"));
        getActivity().runOnUiThread(() -> {
            View view = getBridge() != null ? getBridge().getWebView() : null;
            boolean performed = view != null && view.performHapticFeedback(constant);
            JSObject result = new JSObject();
            result.put("performed", performed);
            call.resolve(result);
        });
    }
}
