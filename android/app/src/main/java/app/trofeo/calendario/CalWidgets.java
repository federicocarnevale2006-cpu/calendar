package app.trofeo.calendario;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * Widget della schermata Home (mese, elenco, oggi). Disegnati come immagine, nello stile del calendario Samsung.
 * Gli eventi arrivano dall'app (subito, a ogni modifica) e, ad app chiusa, da internet ogni 30 minuti con una chiave di sola
 * lettura (come Trofeo LCD): cosi' compaiono anche quelli aggiunti dal PC.
 */
public final class CalWidgets {
    private CalWidgets() {}

    static final int MONTH = 0, AGENDA = 1, TODAY = 2;
    static final String[] MONTHS = {"gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"};
    static final String[] MON_SHORT = {"gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"};
    static final String[] DAYS = {"domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"};
    static final String[] DAYS_SHORT = {"dom", "lun", "mar", "mer", "gio", "ven", "sab"};
    static final String[] LETTER = {"D", "L", "M", "M", "G", "V", "S"};

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("calwidgets", Context.MODE_PRIVATE);
    }

    // ------------------------------------------------------------------------------------------------ dati
    static List<CalData.Event> events(Context ctx) {
        List<CalData.Event> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs(ctx).getString("events", "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                try {
                    CalData.Event e = new CalData.Event();
                    e.id = o.optString("id", "");
                    e.title = o.optString("title", "");
                    if (e.title.isEmpty()) e.title = "(senza titolo)";
                    e.location = o.isNull("location") ? "" : o.optString("location", "");
                    e.allDay = o.optBoolean("all_day", false);
                    e.startUtc = CalData.parseIso(o.getString("start_at"));
                    e.endUtc = CalData.parseIso(o.getString("end_at"));
                    e.rrule = o.isNull("rrule") ? null : o.optString("rrule", null);
                    String col = o.isNull("color") ? "" : o.optString("color", "");
                    try { if (!col.isEmpty()) e.color = Color.parseColor(col); } catch (IllegalArgumentException ignored) { }
                    JSONArray ex = o.optJSONArray("exdates");
                    if (ex != null) for (int j = 0; j < ex.length(); j++) e.exdates.add(ex.optString(j));
                    out.add(e);
                } catch (Exception ignored) { }
            }
        } catch (Exception ignored) { }
        return out;
    }

    static Map<String, String> holidays(Context ctx) {
        Map<String, String> m = new HashMap<>();
        try {
            JSONObject o = new JSONObject(prefs(ctx).getString("holidays", "{}"));
            JSONArray names = o.names();
            if (names != null) for (int i = 0; i < names.length(); i++) m.put(names.getString(i), o.optString(names.getString(i)));
        } catch (Exception ignored) { }
        return m;
    }

    /** Ad app chiusa: rilegge gli eventi da internet (al massimo ogni 20 minuti). */
    static void maybeFetch(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String key = p.getString("key", "");
        if (key.isEmpty() || System.currentTimeMillis() - p.getLong("fetched", 0) < 20 * 60000L) return;
        HttpURLConnection con = null;
        try {
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            long now = System.currentTimeMillis();
            JSONObject body = new JSONObject();
            body.put("p_key", key);
            body.put("p_from", iso.format(new Date(now - 45L * 86400000L)));
            body.put("p_to", iso.format(new Date(now + 400L * 86400000L)));
            String base = p.getString("url", "");
            if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
            con = (HttpURLConnection) new URL(base + "/rest/v1/rpc/trofeo_events").openConnection();
            con.setConnectTimeout(8000);
            con.setReadTimeout(8000);
            con.setRequestMethod("POST");
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            con.setRequestProperty("Accept", "application/json");
            con.setRequestProperty("apikey", p.getString("anon", ""));
            try (OutputStream os = con.getOutputStream()) { os.write(body.toString().getBytes("UTF-8")); }
            if (con.getResponseCode() != 200) return;
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try (InputStream is = con.getInputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            }
            String txt = bo.toString("UTF-8");
            new JSONArray(txt);                                          // controllo: deve essere un elenco
            p.edit().putString("events", txt).putLong("fetched", System.currentTimeMillis()).apply();
        } catch (Exception ignored) {
        } finally {
            if (con != null) con.disconnect();
        }
    }

    // --------------------------------------------------------------------------------------- aggiornamento
    static final Class<?>[] PROVIDERS = {MonthWidget.class, AgendaWidget.class, TodayWidget.class};

    /** Da un widget o dalla sveglia di mezzanotte: lettura da internet (se serve) e ridisegno, in un thread a parte. */
    static void refreshAsync(final Context ctx, final BroadcastReceiver.PendingResult pr, final boolean fetch) {
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                if (fetch) maybeFetch(app);
                updateAll(app);
                scheduleMidnight(app);
            } catch (Exception ignored) {
            } finally {
                if (pr != null) pr.finish();
            }
        }).start();
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int t = 0; t < PROVIDERS.length; t++) {
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, PROVIDERS[t]));
            for (int id : ids) updateOne(ctx, mgr, id, t);
        }
    }

    static void updateOne(Context ctx, AppWidgetManager mgr, int id, int type) {
        try {
            Bundle o = mgr.getAppWidgetOptions(id);
            int wdp = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) : 0;
            int hdp = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0) : 0;
            if (wdp <= 0) wdp = type == TODAY ? 170 : 320;
            if (hdp <= 0) hdp = type == MONTH ? 330 : (type == AGENDA ? 220 : 170);
            float d = ctx.getResources().getDisplayMetrics().density;
            float w = wdp * d, h = hdp * d;
            float k = (float) Math.min(1.0, Math.sqrt(5_500_000.0 / (w * h * 4)));   // limite di memoria delle immagini dei widget
            Bitmap bmp = Bitmap.createBitmap(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), Bitmap.Config.ARGB_8888);
            Canvas cv = new Canvas(bmp);
            Painter pt = new Painter(ctx, cv, bmp.getWidth(), bmp.getHeight(), d * k);
            if (type == MONTH) pt.month();
            else if (type == AGENDA) pt.agenda();
            else pt.today();
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_image);
            rv.setImageViewBitmap(R.id.widget_img, bmp);
            rv.setOnClickPendingIntent(R.id.widget_img, openApp(ctx, null, 100 + type));
            if (type == TODAY) rv.setViewVisibility(R.id.widget_add, View.GONE);
            else rv.setOnClickPendingIntent(R.id.widget_add, openApp(ctx, "calendario://nuovo", 200 + type));
            mgr.updateAppWidget(id, rv);
        } catch (Exception ignored) { }
    }

    static PendingIntent openApp(Context ctx, String uri, int req) {
        Intent i = new Intent(ctx, MainActivity.class);
        if (uri != null) {
            i.setAction(Intent.ACTION_VIEW);
            i.setData(Uri.parse(uri));
        } else {
            i.setAction(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Subito dopo mezzanotte il widget passa al giorno nuovo (sveglia non esatta: nessun permesso speciale). */
    static void scheduleMidnight(Context ctx) {
        try {
            Calendar c = Calendar.getInstance();
            c.add(Calendar.DAY_OF_MONTH, 1);
            c.set(Calendar.HOUR_OF_DAY, 0);
            c.set(Calendar.MINUTE, 1);
            c.set(Calendar.SECOND, 0);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            Intent i = new Intent(ctx, WidgetTick.class);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 7, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (am != null) am.set(AlarmManager.RTC, c.getTimeInMillis(), pi);
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------------------------------- disegno
    static final class Painter {
        final Context ctx;
        final Canvas cv;
        final float W, H, d, sp;
        final boolean dark;
        final int bg, text, muted, faint, line, accent, sun, sat;
        final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Calendar now = Calendar.getInstance();
        final int weekStart;

        Painter(Context ctx, Canvas cv, int w, int h, float d) {
            this.ctx = ctx;
            this.cv = cv;
            this.W = w;
            this.H = h;
            this.d = d;
            this.sp = d * Math.min(1.3f, ctx.getResources().getConfiguration().fontScale);
            dark = (ctx.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
            bg = dark ? 0xF21C1C1E : 0xF5FFFFFF;
            text = dark ? 0xFFF2F2F5 : 0xFF1B1B1F;
            muted = dark ? 0xFF9A9AA3 : 0xFF7C7C85;
            faint = dark ? 0xFF55555C : 0xFFC4C4CA;
            line = dark ? 0x1FFFFFFF : 0x14000000;
            accent = dark ? 0xFF5B8FFF : 0xFF3E7BFA;
            sun = dark ? 0xFFFF6369 : 0xFFE5484D;
            sat = accent;
            weekStart = prefs(ctx).getInt("weekStart", 1);
        }

        void background() {
            p.setStyle(Paint.Style.FILL);
            p.setColor(bg);
            float r = 22 * d;
            cv.drawRoundRect(new RectF(0, 0, W, H), r, r, p);
        }

        void font(float size, boolean bold, int color) {
            p.setStyle(Paint.Style.FILL);
            p.setTextSize(size * sp);
            p.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            p.setColor(color);
            p.setTextAlign(Paint.Align.LEFT);
        }

        String fit(String s, float maxw) {
            if (maxw <= 0) return "";
            return TextUtils.ellipsize(s, new android.text.TextPaint(p), maxw, TextUtils.TruncateAt.END).toString();
        }

        void plus(float cx, float cy) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(2.2f * d);
            p.setStrokeCap(Paint.Cap.ROUND);
            p.setColor(text);
            float a = 7.5f * d;
            cv.drawLine(cx - a, cy, cx + a, cy, p);
            cv.drawLine(cx, cy - a, cx, cy + a, p);
            p.setStyle(Paint.Style.FILL);
        }

        int dayColor(Calendar c) {
            int wd = c.get(Calendar.DAY_OF_WEEK);
            return wd == Calendar.SUNDAY ? sun : (wd == Calendar.SATURDAY ? sat : text);
        }

        static Calendar day0(Calendar c) {
            Calendar x = (Calendar) c.clone();
            x.set(Calendar.HOUR_OF_DAY, 0);
            x.set(Calendar.MINUTE, 0);
            x.set(Calendar.SECOND, 0);
            x.set(Calendar.MILLISECOND, 0);
            return x;
        }

        static int white(int col) {                                   // testo leggibile sopra il colore dell'evento
            int r = Color.red(col), g = Color.green(col), b = Color.blue(col);
            return (r * 299 + g * 587 + b * 114) / 1000 > 175 ? 0xFF111111 : 0xFFFFFFFF;
        }

        // ------------------------------------------------------------------------------------ mese
        void month() {
            background();
            float pad = 12 * d;
            Calendar first = day0(now);
            first.set(Calendar.DAY_OF_MONTH, 1);
            int month = first.get(Calendar.MONTH);
            // titolo
            font(17, true, text);
            String mname = MONTHS[month].substring(0, 1).toUpperCase(Locale.ITALIAN) + MONTHS[month].substring(1);
            float ty = pad + 22 * d;
            cv.drawText(mname, pad + 6 * d, ty, p);
            float mw = p.measureText(mname);
            font(13, false, muted);
            cv.drawText(String.valueOf(first.get(Calendar.YEAR)), pad + 6 * d + mw + 7 * d, ty, p);
            plus(W - 24 * d, pad + 16 * d);
            // nomi dei giorni
            float top = pad + 38 * d;
            float cw = (W - pad * 2) / 7f;
            font(11, true, muted);
            p.setTextAlign(Paint.Align.CENTER);
            for (int i = 0; i < 7; i++) {
                int jd = (weekStart + i) % 7;                         // 0 = domenica
                p.setColor(jd == 0 ? sun : (jd == 6 ? sat : muted));
                cv.drawText(LETTER[jd], pad + cw * (i + 0.5f), top + 11 * d, p);
            }
            top += 18 * d;
            // settimane
            Calendar start = (Calendar) first.clone();
            int back = (first.get(Calendar.DAY_OF_WEEK) - 1 - weekStart + 7) % 7;
            start.add(Calendar.DAY_OF_MONTH, -back);
            int weeks = 0;
            Calendar t = (Calendar) start.clone();
            while (weeks < 6) {
                weeks++;
                t.add(Calendar.DAY_OF_MONTH, 7);
                if (t.get(Calendar.MONTH) != month && t.after(first)) break;
            }
            float rh = (H - top - pad * 0.6f) / weeks;
            Calendar end = (Calendar) start.clone();
            end.add(Calendar.DAY_OF_MONTH, weeks * 7);
            List<CalData.Occ> occ = CalData.occurrences(events(ctx), start.getTimeInMillis(), end.getTimeInMillis());
            Map<String, String> hol = holidays(ctx);
            float numH = 22 * d, lineH = 13.5f * d;
            int maxLines = (int) Math.floor((rh - numH - 2 * d) / lineH);
            for (int w = 0; w < weeks; w++) {
                float y0 = top + rh * w;
                p.setColor(line);
                p.setStrokeWidth(Math.max(1, d * 0.7f));
                cv.drawLine(pad, y0, W - pad, y0, p);
                Calendar ws = (Calendar) start.clone();
                ws.add(Calendar.DAY_OF_MONTH, w * 7);
                Calendar we = (Calendar) ws.clone();
                we.add(Calendar.DAY_OF_MONTH, 7);
                weekRow(ws, we, occ, hol, pad, y0, cw, rh, numH, lineH, maxLines, month);
            }
        }

        void weekRow(Calendar ws, Calendar we, List<CalData.Occ> occ, Map<String, String> hol, float pad, float y0, float cw,
                     float rh, float numH, float lineH, int maxLines, int month) {
            // corsie: prima le festivita' e gli eventi di piu' giorni (barre continue), poi quelli di un giorno solo
            List<Bar> bars = new ArrayList<>();
            boolean[][] taken = new boolean[24][7];
            List<List<CalData.Occ>> singles = new ArrayList<>();
            for (int i = 0; i < 7; i++) singles.add(new ArrayList<>());
            long a = ws.getTimeInMillis(), b = we.getTimeInMillis();
            List<Object[]> spans = new ArrayList<>();
            for (int i = 0; i < 7; i++) {
                Calendar dd = (Calendar) ws.clone();
                dd.add(Calendar.DAY_OF_MONTH, i);
                String hn = hol.get(CalData.ymd(dd));
                if (hn != null) spans.add(new Object[]{i, i, sun, hn});
            }
            for (CalData.Occ o : occ) {
                boolean in = (o.start < b && o.end > a) || (o.start == o.end && o.start >= a && o.start < b);
                if (!in) continue;
                Calendar s = CalData.local(Math.max(o.start, a));
                Calendar last = CalData.local(Math.max(o.start, o.end - 1));
                int c0 = Math.max(0, CalData.dayDiff(ws, s));
                int c1 = Math.min(6, CalData.dayDiff(ws, last));
                boolean multi = o.allDay || c1 > CalData.dayDiff(ws, CalData.local(o.start));
                if (multi) spans.add(new Object[]{c0, Math.max(c0, c1), o.ev.color, o.ev.title});
                else if (c0 >= 0 && c0 < 7) singles.get(c0).add(o);
            }
            for (Object[] s : spans) {
                int c0 = (Integer) s[0], c1 = (Integer) s[1], lane = 0;
                while (lane < 23) {
                    boolean ok = true;
                    for (int x = c0; x <= c1; x++) if (taken[lane][x]) { ok = false; break; }
                    if (ok) break;
                    lane++;
                }
                for (int x = c0; x <= c1; x++) taken[lane][x] = true;
                bars.add(new Bar(c0, c1, lane, (Integer) s[2], (String) s[3]));
            }
            float ny = y0 + 15 * d;
            for (int i = 0; i < 7; i++) {
                Calendar dd = (Calendar) ws.clone();
                dd.add(Calendar.DAY_OF_MONTH, i);
                float cx = pad + cw * (i + 0.5f);
                boolean today = dd.get(Calendar.YEAR) == now.get(Calendar.YEAR) && dd.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR);
                boolean out = dd.get(Calendar.MONTH) != month;
                if (today) {
                    p.setColor(accent);
                    p.setStyle(Paint.Style.FILL);
                    cv.drawCircle(cx, ny - 4.3f * d, 10.5f * d, p);
                }
                int col = today ? 0xFFFFFFFF : (hol.containsKey(CalData.ymd(dd)) ? sun : dayColor(dd));
                font(12.5f, today, col);
                if (out && !today) p.setColor(faint);
                p.setTextAlign(Paint.Align.CENTER);
                cv.drawText(String.valueOf(dd.get(Calendar.DAY_OF_MONTH)), cx, ny, p);
            }
            float ey = y0 + numH;
            if (maxLines < 1) {                                          // poco spazio: puntini colorati
                for (int i = 0; i < 7; i++) {
                    List<Integer> cols = new ArrayList<>();
                    for (Bar br : bars) if (br.c0 <= i && br.c1 >= i && !cols.contains(br.color)) cols.add(br.color);
                    for (CalData.Occ o : singles.get(i)) if (!cols.contains(o.ev.color)) cols.add(o.ev.color);
                    int n = Math.min(3, cols.size());
                    float cx = pad + cw * (i + 0.5f), r = 2.3f * d, gap = 6 * d;
                    for (int j = 0; j < n; j++) {
                        p.setColor(cols.get(j));
                        cv.drawCircle(cx + (j - (n - 1) / 2f) * gap, ey + 2 * d, r, p);
                    }
                }
                return;
            }
            float ins = 1.5f * d, rad = 3 * d;
            // barre di piu' giorni
            for (Bar br : bars) {
                if (br.lane >= maxLines) continue;
                float x0 = pad + cw * br.c0 + ins, x1 = pad + cw * (br.c1 + 1) - ins;
                float yy = ey + br.lane * lineH;
                p.setColor(br.color);
                cv.drawRoundRect(new RectF(x0, yy, x1, yy + lineH - 2 * d), rad, rad, p);
                font(9.5f, true, white(br.color));
                cv.drawText(fit(br.title, x1 - x0 - 4 * d), x0 + 2.5f * d, yy + lineH - 5.2f * d, p);
            }
            // eventi di un giorno
            for (int i = 0; i < 7; i++) {
                List<CalData.Occ> list = singles.get(i);
                boolean[] lanes = new boolean[Math.max(24, maxLines + 1)];
                for (Bar br : bars) if (br.c0 <= i && br.c1 >= i && br.lane < lanes.length) lanes[br.lane] = true;
                int hidden = 0;
                for (int j = 0; j < list.size(); j++) {
                    int lane = 0;
                    while (lane < lanes.length && lanes[lane]) lane++;
                    if (lane < lanes.length) lanes[lane] = true;
                    boolean lastSlot = lane == maxLines - 1 && j < list.size() - 1;
                    if (lane >= maxLines || lastSlot) { hidden = list.size() - j; break; }
                    CalData.Occ o = list.get(j);
                    float x0 = pad + cw * i + ins, x1 = pad + cw * (i + 1) - ins, yy = ey + lane * lineH;
                    p.setColor(o.ev.color);
                    cv.drawRoundRect(new RectF(x0, yy, x1, yy + lineH - 2 * d), rad, rad, p);
                    font(9.5f, true, white(o.ev.color));
                    cv.drawText(fit(o.ev.title, x1 - x0 - 4 * d), x0 + 2.5f * d, yy + lineH - 5.2f * d, p);
                }
                if (hidden > 0) {
                    font(9.5f, true, muted);
                    p.setTextAlign(Paint.Align.CENTER);
                    cv.drawText("+" + hidden, pad + cw * (i + 0.5f), ey + (maxLines - 1) * lineH + lineH - 5.2f * d, p);
                }
            }
        }

        static final class Bar {
            final int c0, c1, lane, color;
            final String title;
            Bar(int c0, int c1, int lane, int color, String title) { this.c0 = c0; this.c1 = c1; this.lane = lane; this.color = color; this.title = title; }
        }

        // ---------------------------------------------------------------------------------- elenco
        String hm(long t) {
            Calendar c = CalData.local(t);
            return String.format(Locale.ROOT, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
        }

        String dayLabel(Calendar dd, Calendar today0) {
            int diff = CalData.dayDiff(today0, dd);
            String base = DAYS_SHORT[dd.get(Calendar.DAY_OF_WEEK) - 1] + " " + dd.get(Calendar.DAY_OF_MONTH) + " " + MON_SHORT[dd.get(Calendar.MONTH)];
            if (diff == 0) return "Oggi · " + base;
            if (diff == 1) return "Domani · " + base;
            return base.substring(0, 1).toUpperCase(Locale.ITALIAN) + base.substring(1);
        }

        void agenda() {
            background();
            float pad = 14 * d;
            Calendar today0 = day0(now);
            font(13, true, accent);
            String wd = DAYS[now.get(Calendar.DAY_OF_WEEK) - 1].toUpperCase(Locale.ITALIAN);
            cv.drawText(wd, pad + 2 * d, pad + 13 * d, p);
            font(20, true, text);
            String title = now.get(Calendar.DAY_OF_MONTH) + " " + MONTHS[now.get(Calendar.MONTH)];
            cv.drawText(title, pad + 2 * d, pad + 37 * d, p);
            plus(W - 24 * d, pad + 14 * d);
            float y = pad + 52 * d;
            Calendar endC = (Calendar) today0.clone();
            endC.add(Calendar.DAY_OF_MONTH, 45);
            List<CalData.Occ> occ = CalData.occurrences(events(ctx), today0.getTimeInMillis(), endC.getTimeInMillis());
            Map<String, String> hol = holidays(ctx);
            long nowT = now.getTimeInMillis();
            float rowH = 34 * d, headH = 22 * d;
            boolean any = false;
            for (int di = 0; di < 45 && y < H - pad - 16 * d; di++) {
                Calendar dd = (Calendar) today0.clone();
                dd.add(Calendar.DAY_OF_MONTH, di);
                long ds = dd.getTimeInMillis();
                Calendar nx = (Calendar) dd.clone();
                nx.add(Calendar.DAY_OF_MONTH, 1);
                long de = nx.getTimeInMillis();
                List<CalData.Occ> list = new ArrayList<>();
                for (CalData.Occ o : occ) {
                    boolean in = (o.start < de && o.end > ds) || (o.start == o.end && o.start >= ds && o.start < de);
                    if (!in) continue;
                    if (di == 0 && !o.allDay && o.end <= nowT) continue;             // oggi: solo quelli non ancora finiti
                    list.add(o);
                }
                String hn = hol.get(CalData.ymd(dd));
                if (list.isEmpty() && hn == null) continue;
                if (y + headH > H - pad) break;
                any = true;
                font(11.5f, true, di == 0 ? accent : muted);
                cv.drawText(dayLabel(dd, today0).toUpperCase(Locale.ITALIAN), pad + 2 * d, y + 15 * d, p);
                if (hn != null) {
                    float lw = p.measureText(dayLabel(dd, today0).toUpperCase(Locale.ITALIAN));
                    font(11.5f, true, sun);
                    cv.drawText(fit("  " + hn, W - pad * 2 - lw), pad + 2 * d + lw, y + 15 * d, p);
                }
                y += headH;
                for (CalData.Occ o : list) {
                    if (y + rowH > H - pad + 4 * d) break;
                    p.setColor(o.ev.color);
                    cv.drawRoundRect(new RectF(pad + 2 * d, y + 4 * d, pad + 5.5f * d, y + rowH - 4 * d), 2 * d, 2 * d, p);
                    float tx = pad + 14 * d;
                    String when;
                    if (o.allDay || (o.start < ds && o.end > de)) when = "Tutto il giorno";
                    else if (o.start < ds) when = "fino alle " + hm(o.end);
                    else when = hm(o.start) + " – " + hm(o.end);
                    font(14.5f, false, text);
                    String loc = o.ev.location == null ? "" : o.ev.location;
                    cv.drawText(fit(o.ev.title, W - tx - pad), tx, y + 15.5f * d, p);
                    font(11.5f, false, muted);
                    cv.drawText(fit(when + (loc.isEmpty() ? "" : " · " + loc), W - tx - pad), tx, y + 29.5f * d, p);
                    y += rowH;
                }
                y += 4 * d;
            }
            if (!any) {
                font(14, false, muted);
                p.setTextAlign(Paint.Align.CENTER);
                cv.drawText("Nessun evento in programma", W / 2, Math.max(pad + 80 * d, (H + pad + 40 * d) / 2), p);
            }
        }

        // ------------------------------------------------------------------------------------- oggi
        void today() {
            background();
            float pad = 14 * d;
            font(12, true, accent);
            cv.drawText(DAYS[now.get(Calendar.DAY_OF_WEEK) - 1].toUpperCase(Locale.ITALIAN), pad + 2 * d, pad + 13 * d, p);
            font(40, true, text);
            String num = String.valueOf(now.get(Calendar.DAY_OF_MONTH));
            cv.drawText(num, pad, pad + 54 * d, p);
            float nw = p.measureText(num);
            font(14, false, muted);
            cv.drawText(MONTHS[now.get(Calendar.MONTH)], pad + nw + 6 * d, pad + 54 * d, p);
            Calendar today0 = day0(now);
            Calendar endC = (Calendar) today0.clone();
            endC.add(Calendar.DAY_OF_MONTH, 2);
            long nowT = now.getTimeInMillis();
            CalData.Occ next = null, allDay = null;
            for (CalData.Occ o : CalData.occurrences(events(ctx), today0.getTimeInMillis(), endC.getTimeInMillis())) {
                if (o.allDay) { if (allDay == null && o.start <= nowT && o.end > nowT) allDay = o; continue; }
                if (o.end > nowT && (next == null || o.start < next.start)) next = o;
            }
            CalData.Occ show = next != null ? next : allDay;
            Map<String, String> hol = holidays(ctx);
            String hn = hol.get(CalData.ymd(now));
            float y = pad + 70 * d;
            if (hn != null && y + 16 * d < H) {
                font(12, true, sun);
                cv.drawText(fit(hn, W - pad * 2), pad + 2 * d, y + 4 * d, p);
                y += 18 * d;
            }
            if (show == null) {
                font(13, false, muted);
                cv.drawText(fit("Nessun altro evento oggi", W - pad * 2), pad + 2 * d, y + 14 * d, p);
                return;
            }
            float bh = Math.min(H - y - pad, 40 * d);
            if (bh < 20 * d) return;
            p.setColor(show.ev.color);
            cv.drawRoundRect(new RectF(pad + 2 * d, y + 2 * d, pad + 5.5f * d, y + bh), 2 * d, 2 * d, p);
            float tx = pad + 13 * d;
            font(14, true, text);
            cv.drawText(fit(show.ev.title, W - tx - pad), tx, y + 15 * d, p);
            String when;
            boolean tomorrow = CalData.dayDiff(today0, CalData.local(show.start)) == 1;
            if (show.allDay) when = "Tutto il giorno";
            else if (show.start <= nowT) when = "In corso · fino alle " + hm(show.end);
            else when = (tomorrow ? "Domani " : "") + hm(show.start) + " – " + hm(show.end);
            font(12, false, muted);
            cv.drawText(fit(when, W - tx - pad), tx, y + 32 * d, p);
        }
    }
}
