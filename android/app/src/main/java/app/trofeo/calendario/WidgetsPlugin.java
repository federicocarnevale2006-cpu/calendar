package app.trofeo.calendario;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

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

    /** Copia delle modifiche in attesa: le invia Android anche ad app chiusa (vedi CalPush). */
    @PluginMethod
    public void setPending(PluginCall call) {
        final Context ctx = getContext().getApplicationContext();
        JSONArray ops = call.getArray("ops");
        if (ops == null) ops = new JSONArray();
        CalPush.setPending(ctx, ops, call.getString("url", ""), call.getString("anon", ""));
        call.resolve();
    }

    /** Stato dell'invio ad app chiusa (per le Impostazioni). */
    @PluginMethod
    public void pushStatus(PluginCall call) {
        try {
            call.resolve(JSObject.fromJSONObject(CalPush.status(getContext().getApplicationContext())));
        } catch (Exception e) {
            call.resolve(new JSObject());
        }
    }

    /** Cosa e' gia' partito da Android ad app chiusa (l'app lo toglie dalla sua coda). */
    @PluginMethod
    public void takeSent(PluginCall call) {
        final Context ctx = getContext().getApplicationContext();
        JSONObject r = CalPush.takeSent(ctx);
        JSObject out = new JSObject();
        try {
            out.put("sent", r.optJSONObject("sent") != null ? JSObject.fromJSONObject(r.getJSONObject("sent")) : new JSObject());
            out.put("keyBad", r.optBoolean("keyBad", false));
        } catch (Exception ignored) { }
        call.resolve(out);
    }
}
