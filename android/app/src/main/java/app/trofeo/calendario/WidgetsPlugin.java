package app.trofeo.calendario;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Dall'app ai widget: eventi, festivita', chiave di lettura e primo giorno della settimana. */
@CapacitorPlugin(name = "CalWidgets")
public class WidgetsPlugin extends Plugin {
    @PluginMethod
    public void setData(PluginCall call) {
        final Context ctx = getContext().getApplicationContext();
        SharedPreferences.Editor e = CalWidgets.prefs(ctx).edit();
        if (call.hasOption("events")) {
            e.putString("events", call.getString("events", "[]"));
            e.putLong("fetched", System.currentTimeMillis());
        }
        if (call.hasOption("holidays")) e.putString("holidays", call.getString("holidays", "{}"));
        if (call.hasOption("key")) e.putString("key", call.getString("key", ""));
        if (call.hasOption("url")) e.putString("url", call.getString("url", ""));
        if (call.hasOption("anon")) e.putString("anon", call.getString("anon", ""));
        if (call.hasOption("weekStart")) {
            Integer ws = call.getInt("weekStart", 1);
            e.putInt("weekStart", ws == null ? 1 : ws);
        }
        e.apply();
        CalWidgets.refreshAsync(ctx, null, false);
        call.resolve();
    }
}
