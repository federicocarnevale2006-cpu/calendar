package app.trofeo.calendario;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * Invio delle modifiche fatte sul telefono anche ad app chiusa.
 *
 * L'app passa qui una copia delle modifiche in attesa (stessa coda dell'app). Un lavoro di Android (JobScheduler) le invia
 * appena c'e' rete, anche se l'app e' stata chiusa dalle finestre recenti o il telefono e' stato riavviato. Si usa la chiave
 * del dispositivo (quella dei widget, abilitata alla scrittura): non serve l'accesso dell'app. Quando l'app si riapre legge
 * cosa e' gia' partito ({@link #takeSent}) e lo toglie dalla sua coda, cosi' non lo rimanda.
 */
public final class CalPush {
    private CalPush() {}

    static final int JOB_ID = 7301;
    static final int RESULT_DONE = 0, RESULT_RETRY = 1;
    private static final Object LOCK = new Object();

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("calpush", Context.MODE_PRIVATE);
    }

    private static JSONObject obj(SharedPreferences p, String k) {
        try { return new JSONObject(p.getString(k, "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** Dall'app: l'elenco completo delle modifiche in attesa (sostituisce il precedente). Elenco vuoto = niente da inviare. */
    static void setPending(Context ctx, JSONArray ops, String url, String anon) {
        int n = 0;
        synchronized (LOCK) {
            JSONObject pend = new JSONObject();
            for (int i = 0; i < ops.length(); i++) {
                JSONObject o = ops.optJSONObject(i);
                if (o == null || o.optJSONObject("row") == null) continue;
                try { pend.put(o.optString("k"), o); n++; } catch (Exception ignored) { }
            }
            SharedPreferences.Editor e = prefs(ctx).edit().putString("pending", pend.toString());
            if (url != null && !url.isEmpty()) e.putString("url", url);
            if (anon != null && !anon.isEmpty()) e.putString("anon", anon);
            e.commit();
        }
        if (n > 0) schedule(ctx, 8000);           // qualche secondo: se l'app e' aperta e c'e' rete, invia prima lei
        else cancel(ctx);
    }

    /** Dall'app: cosa e' gia' stato inviato da qui ({"events:id": seq}) e se la chiave e' stata rifiutata. Poi si azzera. */
    static JSONObject takeSent(Context ctx) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            JSONObject out = new JSONObject();
            try {
                out.put("sent", obj(p, "sent"));
                out.put("keyBad", p.getBoolean("keyBad", false));
            } catch (Exception ignored) { }
            p.edit().putString("sent", "{}").putBoolean("keyBad", false).commit();
            return out;
        }
    }

    /** Annota lo stato (per la riga «Invio ad app chiusa» nelle Impostazioni dell'app). */
    static void note(Context ctx, String k, String v) {
        prefs(ctx).edit().putString(k, v).putLong(k + "_t", System.currentTimeMillis()).apply();
    }

    static void schedule(Context ctx, long delayMs) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) { note(ctx, "sched", "JobScheduler non disponibile"); return; }
        try {
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, PushJob.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)       // parte da solo quando torna la rete
                    .setMinimumLatency(delayMs)
                    .setBackoffCriteria(10000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .setPersisted(true)                                      // resta anche dopo un riavvio del telefono
                    .build();
            int r = js.schedule(job);
            note(ctx, "sched", r == JobScheduler.RESULT_SUCCESS ? "ok" : "rifiutato da Android");
            if (r == JobScheduler.RESULT_SUCCESS) return;
        } catch (Exception e) {
            note(ctx, "sched", "errore: " + e);
        }
        // riserva: senza la condizione "rete presente" (parte comunque e, se manca la rete, riprova da solo piu' tardi)
        try {
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, PushJob.class))
                    .setMinimumLatency(delayMs)
                    .setOverrideDeadline(delayMs + 60000)
                    .setBackoffCriteria(15000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .build();
            js.schedule(job);
            note(ctx, "sched2", "ok");
        } catch (Exception e) {
            note(ctx, "sched2", "errore: " + e);
        }
    }

    /** Stato per l'app: modifiche in attesa, lavoro programmato, ultimo tentativo. */
    static JSONObject status(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            SharedPreferences p = prefs(ctx);
            synchronized (LOCK) { o.put("pending", obj(p, "pending").length()); }
            boolean sched = false;
            if (android.os.Build.VERSION.SDK_INT >= 24) {
                JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
                sched = js != null && js.getPendingJob(JOB_ID) != null;
            }
            o.put("scheduled", sched);
            for (String k : new String[]{"sched", "sched2", "run", "ok"}) {
                o.put(k, p.getString(k, ""));
                o.put(k + "_t", p.getLong(k + "_t", 0));
            }
            o.put("hasKey", !CalWidgets.prefs(ctx).getString("key", "").isEmpty());
        } catch (Exception ignored) { }
        return o;
    }

    static void cancel(Context ctx) {
        try {
            JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js != null) js.cancel(JOB_ID);
        } catch (Exception ignored) { }
    }

    /** Nel lavoro di Android (thread a parte): invia tutto quello che c'e' in attesa. */
    static int pushNow(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String key = CalWidgets.prefs(ctx).getString("key", "");
        String url = p.getString("url", CalWidgets.prefs(ctx).getString("url", ""));
        String anon = p.getString("anon", CalWidgets.prefs(ctx).getString("anon", ""));
        JSONObject pend;
        synchronized (LOCK) { pend = obj(p, "pending"); }
        if (pend.length() == 0) return RESULT_DONE;
        if (key.isEmpty() || url.isEmpty()) {                                // senza chiave: inviera' l'app alla riapertura
            note(ctx, "run", "manca la chiave del telefono");
            return RESULT_DONE;
        }
        if (url.endsWith("/")) url = url.substring(0, url.length() - 1);

        List<JSONObject> ops = new ArrayList<>();
        for (Iterator<String> it = pend.keys(); it.hasNext(); ) {
            JSONObject o = pend.optJSONObject(it.next());
            if (o != null) ops.add(o);
        }
        boolean any = false;
        for (int i = 0; i < ops.size(); i += 200) {
            List<JSONObject> chunk = ops.subList(i, Math.min(ops.size(), i + 200));
            JSONArray cals = new JSONArray(), evs = new JSONArray();
            for (JSONObject o : chunk) {                                     // prima i calendari: gli eventi li citano
                if ("cals".equals(o.optString("t"))) cals.put(o.optJSONObject("row"));
                else evs.put(o.optJSONObject("row"));
            }
            HttpURLConnection con = null;
            try {
                JSONObject body = new JSONObject();
                body.put("p_key", key);
                body.put("p_cals", cals);
                body.put("p_events", evs);
                con = (HttpURLConnection) new URL(url + "/rest/v1/rpc/device_push").openConnection();
                con.setConnectTimeout(15000);
                con.setReadTimeout(20000);
                con.setRequestMethod("POST");
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json");
                con.setRequestProperty("Accept", "application/json");
                con.setRequestProperty("apikey", anon);
                try (OutputStream os = con.getOutputStream()) { os.write(body.toString().getBytes("UTF-8")); }
                int code = con.getResponseCode();
                String txt = read(code < 400 ? con.getInputStream() : con.getErrorStream());
                if (code != 200) {
                    if (txt.contains("chiave non valida")) {                 // chiave tolta o senza permesso: ci pensa l'app
                        synchronized (LOCK) { p.edit().putBoolean("keyBad", true).commit(); }
                        note(ctx, "run", "chiave rifiutata dal server");
                        return RESULT_DONE;
                    }
                    note(ctx, "run", "server: risposta " + code);
                    return RESULT_RETRY;                                     // server non raggiungibile: si riprova
                }
                JSONObject res = new JSONObject(txt);
                // le righe accettate escono dalla coda (solo se nel frattempo non sono cambiate di nuovo) e vanno in "sent";
                // quelle rifiutate escono da qui ma restano nella coda dell'app, che le gestisce alla riapertura
                synchronized (LOCK) {
                    JSONObject cur = obj(p, "pending"), sent = obj(p, "sent");
                    for (String list : new String[]{"ok", "bad"}) {
                        JSONArray a = res.optJSONArray(list);
                        if (a == null) continue;
                        for (int j = 0; j < a.length(); j++) {
                            JSONObject r = a.optJSONObject(j);
                            if (r == null) continue;
                            String k = r.optString("t") + ":" + r.optString("id");
                            JSONObject mine = null;
                            for (JSONObject o : chunk) if (k.equals(o.optString("k"))) { mine = o; break; }
                            if (mine == null) continue;
                            JSONObject now = cur.optJSONObject(k);
                            if (now != null && now.optLong("seq") == mine.optLong("seq")) cur.remove(k);
                            if ("ok".equals(list)) sent.put(k, mine.optLong("seq"));
                        }
                    }
                    p.edit().putString("pending", cur.toString()).putString("sent", sent.toString()).commit();
                }
                any = true;
            } catch (Exception e) {
                note(ctx, "run", "rete: " + e.getClass().getSimpleName());
                return RESULT_RETRY;
            } finally {
                if (con != null) con.disconnect();
            }
        }
        if (any) {
            note(ctx, "run", "inviato");
            note(ctx, "ok", String.valueOf(ops.size()));
            CalWidgets.prefs(ctx).edit().putLong("fetched", 0).apply();     // widget della Home aggiornati dal server
            CalWidgets.maybeFetch(ctx);
            CalWidgets.updateAll(ctx);
        }
        synchronized (LOCK) { return obj(p, "pending").length() > 0 ? RESULT_RETRY : RESULT_DONE; }
    }

    private static String read(InputStream is) throws Exception {
        if (is == null) return "";
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        try (InputStream in = is) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        }
        return bo.toString("UTF-8");
    }
}
