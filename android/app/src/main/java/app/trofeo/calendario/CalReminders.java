package app.trofeo.calendario;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;

/**
 * Promemoria sul telefono programmati dalla parte nativa: arrivano anche per gli eventi aggiunti dal PC o dalla mail dei
 * turni senza aprire l'app. Gli eventi sono quelli dei widget (passati dall'app a ogni modifica e riletti dal server ogni
 * 30 minuti da {@link FetchJob}). Una sola sveglia, sul prossimo promemoria: quando suona mostra la notifica e programma
 * il successivo. Stesso calcolo dell'app (src/platform.ts, remindersFor): per «tutto il giorno» si parte dalle 9:00.
 */
public final class CalReminders {
    private CalReminders() {}

    static final String CHANNEL = "promemoria";
    static final int FETCH_JOB_ID = 7302;
    private static final Object LOCK = new Object();

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("calreminders", Context.MODE_PRIVATE);
    }

    static final class Rem implements Comparable<Rem> {
        String key, title, body;
        long at;
        @Override public int compareTo(Rem o) { return Long.compare(at, o.at); }
    }

    /** Stesso numero dell'app (hash di «idEvento_data_minuti»): una notifica per promemoria. */
    static int notifId(String key) {
        int h = key.hashCode();
        if (h == Integer.MIN_VALUE) h = 0;
        return Math.abs(h) % 2000000000;
    }

    static String two(int n) { return n < 10 ? "0" + n : String.valueOf(n); }
    static String hm(long t) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(t);
        return two(c.get(Calendar.HOUR_OF_DAY)) + ":" + two(c.get(Calendar.MINUTE));
    }
    static String ymd(long t) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(t);
        return c.get(Calendar.YEAR) + "-" + two(c.get(Calendar.MONTH) + 1) + "-" + two(c.get(Calendar.DAY_OF_MONTH));
    }
    /** «Oggi», «Domani» o «lun 3 nov» (il giorno dell'evento visto dal momento dell'avviso). */
    static String dayWord(long occ, long at) {
        Calendar a = CalData.local(at), b = CalData.local(occ);
        int d = CalData.dayDiff(a, b);
        if (d == 0) return "Oggi";
        if (d == 1) return "Domani";
        return CalWidgets.DAYS_SHORT[b.get(Calendar.DAY_OF_WEEK) - 1] + " " + b.get(Calendar.DAY_OF_MONTH) + " "
                + CalWidgets.MON_SHORT[b.get(Calendar.MONTH)];
    }
    static String ahead(int m) {
        if (m >= 1440 && m % 1440 == 0) return m == 1440 ? "1 giorno" : (m / 1440) + " giorni";
        if (m >= 60) return m % 60 == 0 ? (m / 60) + " h" : (m / 60) + " h " + (m % 60) + " min";
        return m + " min";
    }

    /** Promemoria futuri (prossimi 15 giorni), in ordine di tempo. */
    static List<Rem> upcoming(List<CalData.Event> events, long now) {
        List<Rem> out = new ArrayList<>();
        Calendar from = Calendar.getInstance();
        from.setTimeInMillis(now);
        from.set(Calendar.HOUR_OF_DAY, 0);
        from.set(Calendar.MINUTE, 0);
        from.set(Calendar.SECOND, 0);
        from.set(Calendar.MILLISECOND, 0);
        from.add(Calendar.DAY_OF_MONTH, -1);
        long to = now + 15L * 86400000L + 8L * 86400000L;            // anche gli eventi fra 3 settimane con avviso 1 settimana prima
        for (CalData.Event ev : events) {
            if (ev.reminders == null || ev.reminders.length == 0) continue;
            List<CalData.Occ> occs;
            try { occs = CalData.expand(ev, from.getTimeInMillis(), to); } catch (Exception e) { continue; }
            for (CalData.Occ o : occs) {
                for (int m : ev.reminders) {
                    long base = o.start;
                    if (o.allDay) {
                        Calendar c = Calendar.getInstance();
                        c.setTimeInMillis(o.start);
                        c.set(Calendar.HOUR_OF_DAY, 9);
                        c.set(Calendar.MINUTE, 0);
                        c.set(Calendar.SECOND, 0);
                        c.set(Calendar.MILLISECOND, 0);
                        base = c.getTimeInMillis();
                    }
                    long at = base - m * 60000L;
                    if (at <= now - 60000L || at > now + 15L * 86400000L) continue;
                    Rem r = new Rem();
                    r.key = ev.id + "_" + ymd(o.start) + "_" + m;
                    r.at = at;
                    r.title = ev.title == null || ev.title.isEmpty() ? "(senza titolo)" : ev.title;
                    String when;
                    String day = dayWord(o.start, at);
                    if (o.allDay) when = day + " · Tutto il giorno";
                    else if (m <= 0) when = "Adesso · " + hm(o.start);
                    else if (!"Oggi".equals(day)) when = day + " alle " + hm(o.start);
                    else when = hm(o.start) + " (fra " + ahead(m) + ")";
                    r.body = ev.location == null || ev.location.isEmpty() ? when : when + " · " + ev.location;
                    out.add(r);
                }
            }
        }
        Collections.sort(out);
        return out;
    }

    /** Ricalcola i promemoria e programma la sveglia sul prossimo. */
    static void reschedule(Context ctx) {
        try {
            long now = System.currentTimeMillis();
            List<Rem> list = upcoming(CalWidgets.events(ctx), now);
            JSONArray a = new JSONArray();
            for (int i = 0; i < list.size() && i < 120; i++) {
                Rem r = list.get(i);
                JSONObject o = new JSONObject();
                o.put("k", r.key);
                o.put("at", r.at);
                o.put("t", r.title);
                o.put("b", r.body);
                a.put(o);
            }
            synchronized (LOCK) { prefs(ctx).edit().putString("list", a.toString()).apply(); }
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 7303, new Intent(ctx, ReminderReceiver.class),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Rem next = null;
            for (Rem r : list) if (!wasFired(ctx, r.key)) { next = r; break; }
            if (next == null) { am.cancel(pi); return; }
            long at = Math.max(next.at, now + 1000);
            boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (Exception ignored) { }
    }

    static boolean wasFired(Context ctx, String key) {
        synchronized (LOCK) { return prefs(ctx).getString("fired", "").contains("|" + key + "|"); }
    }
    private static void markFired(Context ctx, String key) {
        synchronized (LOCK) {
            String f = prefs(ctx).getString("fired", "|");
            if (f.length() > 20000) f = "|" + f.substring(f.length() - 10000).replaceFirst("^[^|]*\\|", "");
            prefs(ctx).edit().putString("fired", f + key + "|").apply();
        }
    }

    /** Dalla sveglia: mostra i promemoria arrivati e programma il prossimo. */
    static void fire(Context ctx) {
        long now = System.currentTimeMillis();
        try {
            JSONArray a;
            synchronized (LOCK) { a = new JSONArray(prefs(ctx).getString("list", "[]")); }
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                long at = o.optLong("at");
                String k = o.optString("k");
                if (at > now + 30000L) break;
                if (at < now - 15L * 60000L || wasFired(ctx, k)) continue;   // troppo vecchio (telefono spento): niente
                notify(ctx, k, o.optString("t"), o.optString("b"));
                markFired(ctx, k);
            }
        } catch (Exception ignored) { }
        reschedule(ctx);
    }

    static void notify(Context ctx, String key, String title, String body) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 24 && !nm.areNotificationsEnabled()) return;
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            if (nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Promemoria", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Promemoria degli eventi del calendario");
                nm.createNotificationChannel(ch);
            }
            b = new Notification.Builder(ctx, CHANNEL);
        } else {
            b = new Notification.Builder(ctx);
            b.setPriority(Notification.PRIORITY_HIGH);
            b.setDefaults(Notification.DEFAULT_ALL);
        }
        b.setSmallIcon(R.drawable.ic_stat_cal)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setContentIntent(CalWidgets.openApp(ctx, null, 300));
        // privacy: sulla schermata di blocco, se in Android e' scelto «nascondi contenuti sensibili», si vede solo «Promemoria»
        // (niente titolo dell'evento); a telefono sbloccato la notifica e' completa
        b.setVisibility(Notification.VISIBILITY_PRIVATE);
        Notification.Builder pub = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        pub.setSmallIcon(R.drawable.ic_stat_cal).setContentTitle("Promemoria").setContentText("Calendario")
                .setCategory(Notification.CATEGORY_REMINDER);
        b.setPublicVersion(pub.build());
        try { nm.notify(notifId(key), b.build()); } catch (SecurityException ignored) { }
    }

    /** Lettura periodica dal server (ogni 30 minuti con la rete): eventi nuovi dal PC o dalla mail anche ad app chiusa. */
    static void ensureFetchJob(Context ctx) {
        try {
            JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            if (Build.VERSION.SDK_INT >= 24 && js.getPendingJob(FETCH_JOB_ID) != null) return;
            JobInfo job = new JobInfo.Builder(FETCH_JOB_ID, new ComponentName(ctx, FetchJob.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(30L * 60000L)
                    .setPersisted(true)
                    .build();
            js.schedule(job);
        } catch (Exception ignored) { }
    }
}
