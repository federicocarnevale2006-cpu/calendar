package app.trofeo.calendario;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Eventi e ripetizioni per i widget della schermata Home. Solo Java standard (nessuna classe Android), cosi' si prova anche
 * fuori dal telefono. Stesso algoritmo dell'app (src/model.ts, funzione expand) e di Trofeo LCD (calsync.py).
 */
public final class CalData {
    private CalData() {}

    public static final class Event {
        public String id = "", title = "", location = "", rrule = null;
        public boolean allDay;
        public long startUtc, endUtc;          // istanti (ms); per «tutto il giorno» mezzanotte UTC del primo e dell'ultimo giorno
        public int color = 0xFF3B82F6;
        public Set<String> exdates = new HashSet<>();
        public int[] reminders = new int[0];   // minuti prima dell'inizio (per «tutto il giorno»: prima delle 9:00)
    }

    public static final class Occ implements Comparable<Occ> {
        public final Event ev;
        public final long start, end;          // ora locale del telefono, fine esclusa
        public final boolean allDay;
        Occ(Event ev, long start, long end) { this.ev = ev; this.start = start; this.end = end; this.allDay = ev.allDay; }
        @Override public int compareTo(Occ o) {
            int a = Boolean.compare(!allDay, !o.allDay);
            if (a != 0) return a;
            int b = Long.compare(start, o.start);
            if (b != 0) return b;
            return ev.title.compareTo(o.ev.title);
        }
    }

    // ------------------------------------------------------------------------------------------------- date
    private static final Pattern ISO = Pattern.compile(
        "^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?)?\\s*(Z|[+-]\\d{2}(?::?\\d{2})?)?$");

    /** «2026-10-31T19:00:00.000Z», «2026-10-31T19:00:00+00:00», «2026-10-31» -> ms UTC. */
    public static long parseIso(String s) {
        Matcher m = ISO.matcher(s.trim());
        if (!m.matches()) throw new IllegalArgumentException("data non valida: " + s);
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
        c.clear();
        c.set(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)) - 1, Integer.parseInt(m.group(3)),
              m.group(4) != null ? Integer.parseInt(m.group(4)) : 0, m.group(5) != null ? Integer.parseInt(m.group(5)) : 0,
              m.group(6) != null ? Integer.parseInt(m.group(6)) : 0);
        long t = c.getTimeInMillis();
        if (m.group(7) != null) {
            String f = (m.group(7) + "000").substring(0, 3);
            t += Integer.parseInt(f);
        }
        String z = m.group(8);
        if (z != null && !z.equals("Z")) {
            int sign = z.charAt(0) == '-' ? -1 : 1;
            String d = z.substring(1).replace(":", "");
            int hh = Integer.parseInt(d.substring(0, 2)), mm = d.length() >= 4 ? Integer.parseInt(d.substring(2, 4)) : 0;
            t -= sign * (hh * 3600000L + mm * 60000L);
        }
        return t;
    }

    static Calendar local(long t) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(t);
        return c;
    }

    /** Mezzanotte UTC di un giorno «tutto il giorno» -> stesso giorno a mezzanotte, ora locale. */
    static Calendar utcDateToLocal(long t) {
        Calendar u = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
        u.setTimeInMillis(t);
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(u.get(Calendar.YEAR), u.get(Calendar.MONTH), u.get(Calendar.DAY_OF_MONTH), 0, 0, 0);
        return c;
    }

    static Calendar addDays(Calendar d, int n) {            // stessa ora locale (come addDays dell'app)
        Calendar c = (Calendar) d.clone();
        c.add(Calendar.DAY_OF_MONTH, n);
        return c;
    }

    static int dayDiff(Calendar a, Calendar b) {             // giorni di calendario (ignora l'ora legale)
        long ua = Date3.utc(a), ub = Date3.utc(b);
        return (int) Math.round((ub - ua) / 86400000.0);
    }

    static String ymd(Calendar c) {
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    static final class Date3 {
        static long utc(Calendar c) {
            Calendar u = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
            u.clear();
            u.set(c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH));
            return u.getTimeInMillis();
        }
    }

    /** Giorno y-m-d (mese anche fuori 0..11) alla stessa ora di src; null se il giorno non esiste (31 aprile, 29 febbraio). */
    static Calendar at(int y, int m, int d, Calendar src) {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.setLenient(true);
        c.set(y, m, d, src.get(Calendar.HOUR_OF_DAY), src.get(Calendar.MINUTE), src.get(Calendar.SECOND));
        c.getTimeInMillis();
        int mm = ((m % 12) + 12) % 12;
        return (c.get(Calendar.DAY_OF_MONTH) == d && c.get(Calendar.MONTH) == mm) ? c : null;
    }

    // ----------------------------------------------------------------------------------------- ripetizioni
    static final String[] RR_DAYS = {"SU", "MO", "TU", "WE", "TH", "FR", "SA"};

    static final class Rule {
        String freq = "DAILY";
        int interval = 1;
        List<Integer> byday = new ArrayList<>();     // 0 = domenica
        Calendar until = null;                        // primo giorno NON incluso (mezzanotte locale)
        int count = 0;
    }

    static Rule parseRule(String s) {
        if (s == null || s.trim().isEmpty()) return null;
        Rule r = new Rule();
        String body = s.contains(":") ? s.substring(s.lastIndexOf(':') + 1) : s;
        for (String part : body.split(";")) {
            int eq = part.indexOf('=');
            if (eq < 0) continue;
            String k = part.substring(0, eq).trim().toUpperCase(Locale.ROOT), v = part.substring(eq + 1).trim();
            if (v.isEmpty()) continue;
            try {
                switch (k) {
                    case "FREQ":
                        String f = v.toUpperCase(Locale.ROOT);
                        if (f.equals("DAILY") || f.equals("WEEKLY") || f.equals("MONTHLY") || f.equals("YEARLY")) r.freq = f;
                        break;
                    case "INTERVAL": r.interval = Math.max(1, Integer.parseInt(v)); break;
                    case "COUNT": r.count = Math.max(1, Integer.parseInt(v)); break;
                    case "BYDAY":
                        for (String x : v.toUpperCase(Locale.ROOT).split(",")) {
                            String dd = x.length() >= 2 ? x.substring(x.length() - 2) : x;
                            for (int i = 0; i < 7; i++) if (RR_DAYS[i].equals(dd)) r.byday.add(i);
                        }
                        break;
                    case "UNTIL":
                        if (v.length() >= 8) {
                            Calendar u = Calendar.getInstance();
                            u.clear();
                            u.set(Integer.parseInt(v.substring(0, 4)), Integer.parseInt(v.substring(4, 6)) - 1, Integer.parseInt(v.substring(6, 8)), 0, 0, 0);
                            u.add(Calendar.DAY_OF_MONTH, 1);
                            r.until = u;
                        }
                        break;
                    default: break;
                }
            } catch (NumberFormatException ignored) { }
        }
        return r;
    }

    /** Tutte le volte in cui l'evento cade fra from (incluso) e to (escluso), ora locale. */
    public static List<Occ> expand(Event ev, long from, long to) {
        List<Occ> out = new ArrayList<>();
        Calendar s0;
        long durMs = 0;
        int days = 0;
        if (ev.allDay) {
            s0 = utcDateToLocal(ev.startUtc);
            Calendar e = utcDateToLocal(ev.endUtc);
            days = Math.max(0, dayDiff(s0, e)) + 1;
        } else {
            s0 = local(ev.startUtc);
            durMs = Math.max(0, ev.endUtc - ev.startUtc);
        }
        Rule r = parseRule(ev.rrule);
        if (r == null) {
            add(out, ev, s0, durMs, days, from, to);
            return out;
        }
        long fromT = from;
        Calendar fromC = local(from);
        int lookback = ev.allDay ? days + 1 : (int) Math.ceil(durMs / 86400000.0) + 1;
        int k = 0;
        if (r.count == 0) {
            Calendar ref = addDays(fromC, -lookback);
            if (ref.after(s0)) {
                int span;
                switch (r.freq) {
                    case "DAILY": span = dayDiff(s0, ref); break;
                    case "WEEKLY": span = (int) Math.floor(dayDiff(s0, ref) / 7.0); break;
                    case "MONTHLY": span = (ref.get(Calendar.YEAR) - s0.get(Calendar.YEAR)) * 12 + ref.get(Calendar.MONTH) - s0.get(Calendar.MONTH); break;
                    default: span = ref.get(Calendar.YEAR) - s0.get(Calendar.YEAR); break;
                }
                k = Math.max(0, (int) Math.floor(span / (double) r.interval) - 1);
            }
        }
        int n = 0;
        int back = (s0.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY + 6) % 7;       // giorni dal lunedi'
        Calendar weekStart0 = addDays(s0, -back);
        List<Integer> offs = new ArrayList<>();
        for (int d : r.byday) offs.add((d + 6) % 7);
        Collections.sort(offs);
        for (int guard = 0; guard < 20000; guard++, k++) {
            List<Calendar> cands = new ArrayList<>();
            switch (r.freq) {
                case "DAILY": cands.add(addDays(s0, k * r.interval)); break;
                case "WEEKLY":
                    if (!offs.isEmpty()) {
                        Calendar ws = addDays(weekStart0, k * 7 * r.interval);
                        for (int off : offs) cands.add(addDays(ws, off));
                    } else cands.add(addDays(s0, k * 7 * r.interval));
                    break;
                case "MONTHLY": cands.add(at(s0.get(Calendar.YEAR), s0.get(Calendar.MONTH) + k * r.interval, s0.get(Calendar.DAY_OF_MONTH), s0)); break;
                default: cands.add(at(s0.get(Calendar.YEAR) + k * r.interval, s0.get(Calendar.MONTH), s0.get(Calendar.DAY_OF_MONTH), s0)); break;
            }
            boolean stop = false;
            for (Calendar c : cands) {
                if (c == null || c.before(s0)) continue;
                if (r.until != null && !c.before(r.until)) { stop = true; break; }
                if (c.getTimeInMillis() >= to) { stop = true; break; }
                n++;
                if (!ev.exdates.contains(ymd(c))) add(out, ev, c, durMs, days, fromT, to);
                if (r.count > 0 && n >= r.count) { stop = true; break; }
            }
            if (stop) break;
        }
        return out;
    }

    private static void add(List<Occ> out, Event ev, Calendar s, long durMs, int days, long from, long to) {
        long st = s.getTimeInMillis();
        long en = ev.allDay ? addDays(s, days).getTimeInMillis() : st + durMs;
        if (st < to && (en > from || (en == st && st >= from))) out.add(new Occ(ev, st, en));
    }

    public static List<Occ> occurrences(List<Event> events, long from, long to) {
        List<Occ> out = new ArrayList<>();
        for (Event e : events) {
            try { out.addAll(expand(e, from, to)); } catch (RuntimeException ignored) { }
        }
        Collections.sort(out);
        return out;
    }
}
