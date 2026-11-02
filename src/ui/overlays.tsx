import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { addDays, cap, DAYS_SHORT, hm, localDateToUtcIso, parseYmd, startOfDay, utcDateToLocal, ymd } from "../date";
import { describeRule, expand, parseRule, ruleToString, uuid, type Ev, type Occ, type Rule } from "../model";
import { PALETTE } from "../config";
import { calById, isHoliday, deleteEvent, evColor, events, evMap, saveCal, saveEvent, setSettings, settings, visibleCals } from "../store";
import { cursor, now, pop, push, replaceTop, selDay, showToast, closeAll } from "./state";
import { Icon } from "./icons";
import { MiniMonth } from "./views";

import { Choice, DTChip, DatePick, Page, Switch, TimeWheel, remLabel, whenText } from "./common";

// ------------------------------------------------------------------------------------------------------ dettaglio
export function Detail({ occ }: { occ: Occ }) {
  const ev = evMap.value.get(occ.ev.id) ?? occ.ev;
  if (ev.deleted) { setTimeout(pop, 0); return null; }
  const o = { ...occ, ev, color: evColor(ev) };
  const cal = calById.value.get(ev.calendar_id || "");
  const doEdit = () => (ev.rrule ? replaceTop({ t: "scope", occ: o, action: "edit" }) : replaceTop({ t: "editor", ev, isNew: false }));
  const doDel = () => {
    if (ev.rrule) { replaceTop({ t: "scope", occ: o, action: "delete" }); return; }
    void deleteEvent(ev.id);
    pop();
    showToast("Evento eliminato", { label: "Annulla", run: () => void saveEvent({ ...ev, deleted: false }) });
  };
  const dup = () => replaceTop({ t: "editor", ev: { ...ev, id: uuid(), rrule: ev.rrule, exdates: [] }, isNew: true });
  return (
    <>
      <div class="scrim" onClick={pop} />
      <div class="sheet detail">
        <div class="acts">
          <button class="iconbtn" aria-label="Chiudi" onClick={pop}><Icon n="close" /></button>
        </div>
        <div class="head">
          <div class="bar" style={{ background: o.color }} />
          <div>
            <h2>{ev.title || "(senza titolo)"}</h2>
            <div class="when">{whenText(o)}</div>
          </div>
        </div>
        <div style={{ overflow: "auto", paddingBottom: "10px" }}>
          {ev.rrule && <div class="row"><Icon n="repeat" /><div class="grow lab">{describeRule(ev.rrule, o.start)}</div></div>}
          {ev.reminders.length > 0 && <div class="row"><Icon n="bell" /><div class="grow lab">{ev.reminders.slice().sort((a, b) => a - b).map((m) => remLabel(m, ev.all_day)).join(", ")}</div></div>}
          {ev.location && <div class="row"><Icon n="place" /><div class="grow lab">{ev.location}</div></div>}
          {ev.notes && <div class="row" style={{ alignItems: "flex-start" }}><Icon n="notes" /><div class="grow lab" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{ev.notes}</div></div>}
          {cal && <div class="row"><Icon n="cal" /><div class="grow lab">{cal.name}</div><span class="cdot" style={{ background: cal.color }} /></div>}
          {isHoliday(ev) && <div class="row"><Icon n="cal" /><div class="grow lab">Festività nazionale</div><span class="cdot" style={{ background: o.color }} /></div>}
          <div class="row"><Icon n="clock" /><div class="grow lab">{dday(o.start)}</div></div>
        </div>
        {!isHoliday(ev) && (
          <div class="dbar">
            <button onClick={doEdit}><Icon n="edit" /><span>Modifica</span></button>
            <button onClick={() => share(o)}><Icon n="share" /><span>Condividi</span></button>
            <button onClick={dup}><Icon n="copy" /><span>Duplica</span></button>
            <button class="del" onClick={doDel}><Icon n="trash" /><span>Elimina</span></button>
          </div>
        )}
      </div>
    </>
  );
}

/** Conto alla rovescia come il «D-Day» del calendario Samsung. */
function dday(d: Date): string {
  const n = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000);
  if (n === 0) return "Oggi · D-Day";
  if (n === 1) return "Domani · D-1";
  if (n > 0) return `Fra ${n} giorni · D-${n}`;
  if (n === -1) return "Ieri · D+1";
  return `${-n} giorni fa · D+${-n}`;
}

async function share(o: Occ) {
  const text = [o.ev.title || "(senza titolo)", whenText(o), o.ev.location, o.ev.notes].filter(Boolean).join("\n");
  try {
    if ((navigator as any).share) { await (navigator as any).share({ title: o.ev.title, text }); return; }
  } catch { return; }                                    // annullato dall'utente
  try { await navigator.clipboard.writeText(text); showToast("Evento copiato: incollalo dove vuoi"); } catch { showToast("Condivisione non disponibile"); }
}

// ------------------------------------------------------------------------------------- inserimento rapido
/** Come il «+» del calendario Samsung: un pannello in basso con titolo, orari e calendario; «Dettagli» apre tutto. */
export function QuickSheet({ ev }: { ev: Ev }) {
  const s0 = ev.all_day ? utcDateToLocal(ev.start_at) : new Date(ev.start_at);
  const e0 = ev.all_day ? utcDateToLocal(ev.end_at) : new Date(ev.end_at);
  const [title, setTitle] = useState(ev.title);
  const [allDay, setAllDay] = useState(ev.all_day);
  const [sd, setSd] = useState(toLocalInput(s0));
  const [ed, setEd] = useState(toLocalInput(e0));
  const [calId, setCalId] = useState(ev.calendar_id);
  const [pick, setPick] = useState<null | "sd" | "st" | "ed" | "et" | "cal">(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 200); }, []);
  const start = allDay ? parseYmd(sd.date) : new Date(`${sd.date}T${sd.time || "00:00"}`);
  const end = allDay ? parseYmd(ed.date) : new Date(`${ed.date}T${ed.time || "00:00"}`);
  const bad = !(end >= start) || isNaN(start.getTime()) || isNaN(end.getTime());
  const cal = calById.value.get(calId || "");
  const setStart = (v: { date: string; time: string }) => {
    const ns = allDay ? parseYmd(v.date) : new Date(`${v.date}T${v.time || "00:00"}`);
    if (!isNaN(ns.getTime()) && !bad) setEd(toLocalInput(new Date(ns.getTime() + (end.getTime() - start.getTime()))));
    setSd(v);
  };
  const row = (): Ev => ({
    ...ev, title: title.trim(), all_day: allDay, calendar_id: calId,
    start_at: allDay ? localDateToUtcIso(start) : start.toISOString(), end_at: allDay ? localDateToUtcIso(end) : end.toISOString(),
  });
  const save = async () => {
    if (bad) return;
    await saveEvent(row());
    closeAll();
    if (settings.value.view === "month") selDay.value = startOfDay(start);
    cursor.value = startOfDay(start);
    showToast("Evento salvato");
  };
  const tog = (k: NonNullable<typeof pick>) => setPick(pick === k ? null : k);
  return (
    <>
      <div class="scrim" onClick={pop} />
      <div class="sheet quick">
        <div class="grip" />
        <div class="qtitle">
          <input ref={ref} class="inp" placeholder="Titolo" value={title} maxLength={300} onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
          <button type="button" class="qcal" onClick={() => tog("cal")}><span class="cdot" style={{ background: cal?.color || "#3b82f6" }} />{cal?.name || "Calendario"}</button>
        </div>
        {pick === "cal" && (
          <div class="qcals">{visibleCals.value.map((c) => (
            <button type="button" class={c.id === calId ? "on" : ""} onClick={() => { setCalId(c.id); setPick(null); }}><span class="cdot" style={{ background: c.color }} />{c.name}</button>
          ))}</div>
        )}
        <div class="qrow">
          <span class="lab">Tutto il giorno</span>
          <Switch on={allDay} label="Tutto il giorno" onChange={setAllDay} />
        </div>
        <div class="qrow">
          <span class="lab">Inizio</span>
          <div class="dt"><DTChip type="date" value={sd.date} on={pick === "sd"} onClick={() => tog("sd")} />
            {!allDay && <DTChip type="time" value={sd.time} on={pick === "st"} onClick={() => tog("st")} />}</div>
        </div>
        {pick === "sd" && <div class="picker q"><DatePick value={sd.date} onChange={(v) => { setStart({ ...sd, date: v }); setPick(null); }} /></div>}
        {pick === "st" && !allDay && <div class="picker q"><TimeWheel value={sd.time} onChange={(v) => setStart({ ...sd, time: v })} /></div>}
        <div class="qrow">
          <span class="lab" style={{ color: bad ? "var(--danger)" : undefined }}>Fine</span>
          <div class="dt"><DTChip type="date" value={ed.date} on={pick === "ed"} bad={bad} onClick={() => tog("ed")} />
            {!allDay && <DTChip type="time" value={ed.time} on={pick === "et"} bad={bad} onClick={() => tog("et")} />}</div>
        </div>
        {pick === "ed" && <div class="picker q"><DatePick value={ed.date} onChange={(v) => { setEd({ ...ed, date: v }); setPick(null); }} /></div>}
        {pick === "et" && !allDay && <div class="picker q"><TimeWheel value={ed.time} onChange={(v) => setEd({ ...ed, time: v })} /></div>}
        <div class="qbtns">
          <button type="button" class="btn text" onClick={() => replaceTop({ t: "editor", ev: row(), isNew: true })}>Dettagli</button>
          <div style={{ flex: 1 }} />
          <button type="button" class="btn" onClick={pop}>Annulla</button>
          <button type="button" class="btn primary" disabled={bad} onClick={save}>Salva</button>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------- ripetizioni: quale parte
export function Scope({ occ, action }: { occ: Occ; action: "edit" | "delete" }) {
  const ev = evMap.value.get(occ.ev.id) ?? occ.ev;
  const first = expand(ev, utcOrLocalStart(ev), addDays(occ.start, 1), "")[0];
  const isFirst = !first || first.key === occ.key;
  const go = (scope: "one" | "after" | "all") => {
    if (action === "edit") {
      if (scope === "all") replaceTop({ t: "editor", ev, isNew: false, occ, scope });
      else {
        const s = occ.start, e = occ.end;
        const draft: Ev = {
          ...ev, id: uuid(), exdates: [],
          start_at: ev.all_day ? localDateToUtcIso(s) : s.toISOString(),
          end_at: ev.all_day ? localDateToUtcIso(addDays(e, -1)) : e.toISOString(),
          rrule: scope === "one" ? null : ev.rrule,
        };
        replaceTop({ t: "editor", ev: draft, isNew: false, occ, scope });
      }
      return;
    }
    if (scope === "all" || (scope === "after" && isFirst)) void deleteEvent(ev.id);
    else if (scope === "one") void saveEvent({ ...ev, exdates: [...new Set([...(ev.exdates || []), ymd(occ.start)])] });
    else void saveEvent({ ...ev, rrule: endRuleBefore(ev, occ.start) });
    pop();
    showToast("Eliminato", { label: "Annulla", run: () => void saveEvent({ ...ev }) });
  };
  return (
    <>
      <div class="scrim" onClick={pop} />
      <div class="sheet">
        <div style={{ padding: "22px 22px 6px", fontWeight: 700, fontSize: "18px" }}>{action === "edit" ? "Modifica evento ricorrente" : "Elimina evento ricorrente"}</div>
        <div class="card" style={{ margin: "8px 12px" }}>
          <button class="row click" onClick={() => go("one")}><div class="grow lab">Solo questo evento</div></button>
          {!isFirst && <button class="row click" onClick={() => go("after")}><div class="grow lab">Questo e i successivi</div></button>}
          <button class="row click" onClick={() => go("all")}><div class="grow lab">Tutti gli eventi</div></button>
        </div>
        <div style={{ textAlign: "right", padding: "0 14px 14px" }}><button class="btn text" onClick={pop}>Annulla</button></div>
      </div>
    </>
  );
}
function utcOrLocalStart(ev: Ev): Date {
  return ev.all_day ? utcDateToLocal(ev.start_at) : new Date(ev.start_at);
}
function endRuleBefore(ev: Ev, occStart: Date): string | null {
  const r = parseRule(ev.rrule);
  if (!r) return null;
  r.until = ymd(addDays(occStart, -1));
  r.count = null;
  return ruleToString(r);
}

// ------------------------------------------------------------------------------------------------------- editor
const toLocalInput = (d: Date) => ({ date: ymd(d), time: hm(d) });

export function Editor({ ev, isNew, occ, scope }: { ev: Ev; isNew: boolean; occ?: Occ; scope?: "one" | "after" | "all" }) {
  const s0 = ev.all_day ? utcDateToLocal(ev.start_at) : new Date(ev.start_at);
  const e0 = ev.all_day ? utcDateToLocal(ev.end_at) : new Date(ev.end_at);
  const [title, setTitle] = useState(ev.title);
  const [allDay, setAllDay] = useState(ev.all_day);
  const [sd, setSd] = useState(toLocalInput(s0));
  const [ed, setEd] = useState(toLocalInput(e0));
  const [calId, setCalId] = useState(ev.calendar_id);
  const [color, setColor] = useState<string | null>(ev.color);
  const [rule, setRule] = useState<Rule | null>(parseRule(ev.rrule));
  const [rem, setRem] = useState<number[]>(ev.reminders);
  const [loc, setLoc] = useState(ev.location);
  const [notes, setNotes] = useState(ev.notes);
  const [showColors, setShowColors] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
  const [showCals, setShowCals] = useState(false);
  const [pick, setPick] = useState<null | "sd" | "st" | "ed" | "et">(null);   // selettore aperto (data/ora di inizio/fine)
  const tog = (k: "sd" | "st" | "ed" | "et") => setPick(pick === k ? null : k);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (isNew) setTimeout(() => titleRef.current?.focus(), 250); }, []);
  const cal = calById.value.get(calId || "");
  const shown = color || cal?.color || "#3b82f6";
  const start = allDay ? parseYmd(sd.date) : new Date(`${sd.date}T${sd.time || "00:00"}`);
  const end = allDay ? parseYmd(ed.date) : new Date(`${ed.date}T${ed.time || "00:00"}`);
  const bad = !(end >= start) || isNaN(start.getTime()) || isNaN(end.getTime());

  const setStart = (v: { date: string; time: string }) => {           // l'inizio sposta anche la fine, mantenendo la durata
    const ns = allDay ? parseYmd(v.date) : new Date(`${v.date}T${v.time || "00:00"}`);
    if (!isNaN(ns.getTime()) && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
      const ne = allDay ? addDays(ns, Math.round((end.getTime() - start.getTime()) / 86400000)) : new Date(ns.getTime() + (end.getTime() - start.getTime()));
      setEd(toLocalInput(ne));
    }
    setSd(v);
  };
  const save = async () => {
    if (bad) return;
    const row: Ev = {
      ...ev, title: title.trim(), all_day: allDay, calendar_id: calId, color, location: loc.trim(), notes: notes.trim(),
      rrule: rule ? ruleToString(rule) : null, reminders: [...new Set(rem)].sort((a, b) => a - b),
      start_at: allDay ? localDateToUtcIso(start) : start.toISOString(),
      end_at: allDay ? localDateToUtcIso(end) : end.toISOString(),
    };
    if (occ && scope && scope !== "all") {
      const master = evMap.value.get(occ.ev.id) ?? occ.ev;
      if (scope === "one") await saveEvent({ ...master, exdates: [...new Set([...(master.exdates || []), ymd(occ.start)])] });
      else {
        const r = parseRule(master.rrule);
        if (r?.count && rule) {                                          // «dopo N volte»: alla nuova serie restano quelle mancanti
          const before = expand({ ...master, exdates: [] }, utcOrLocalStart(master), occ.start, "").length;
          rule.count = Math.max(1, r.count - before);
          row.rrule = ruleToString(rule);
        }
        await saveEvent({ ...master, rrule: endRuleBefore(master, occ.start) });
      }
    }
    await saveEvent(row);
    closeAll();
    if (!selDay.value || startOfDay(selDay.value).getTime() !== startOfDay(start).getTime()) {
      if (settings.value.view === "month") selDay.value = startOfDay(start);
    }
    cursor.value = startOfDay(start);
    showToast(isNew ? "Evento salvato" : "Modifiche salvate");
  };
  const repeatOpts: [string, Rule | null][] = [
    ["Non si ripete", null],
    ["Ogni giorno", { freq: "DAILY", interval: 1, byday: [], until: null, count: null }],
    [`Ogni settimana (${DAYS_SHORT[start.getDay() || 0]})`, { freq: "WEEKLY", interval: 1, byday: [], until: null, count: null }],
    ["Ogni giorno feriale (lun–ven)", { freq: "WEEKLY", interval: 1, byday: [1, 2, 3, 4, 5], until: null, count: null }],
    [`Ogni mese il giorno ${start.getDate() || 1}`, { freq: "MONTHLY", interval: 1, byday: [], until: null, count: null }],
    ["Ogni anno", { freq: "YEARLY", interval: 1, byday: [], until: null, count: null }],
  ];
  return (
    <Page title={isNew ? "Nuovo evento" : "Modifica evento"} dialog actions={<button class="btn primary" style={{ height: "40px", marginRight: "6px" }} disabled={bad} onClick={save}>Salva</button>}>
      <div class="card">
        <div class="row">
          <button class="cdot" aria-label="Colore" style={{ width: "22px", height: "22px", background: shown }} onClick={() => setShowColors(!showColors)} />
          <input ref={titleRef} class="inp bigtitle grow" placeholder="Titolo" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} maxLength={300} />
        </div>
        {showColors && (
          <div class="palette">
            <button aria-label="Colore del calendario" class={!color ? "on" : ""} style={{ background: cal?.color || "#3b82f6", color: cal?.color }} onClick={() => { setColor(null); setShowColors(false); }}>{!color && <Icon n="check" s />}</button>
            {PALETTE.map((p) => <button aria-label={p} class={color === p ? "on" : ""} style={{ background: p, color: p }} onClick={() => { setColor(p); setShowColors(false); }}>{color === p && <Icon n="check" s />}</button>)}
          </div>
        )}
      </div>
      <div class="card">
        <div class="row"><Icon n="clock" /><div class="grow lab">Tutto il giorno</div><Switch on={allDay} label="Tutto il giorno" onChange={setAllDay} /></div>
        <div class="row">
          <div style={{ width: "24px" }} />
          <div class="grow"><div class="val" style={{ marginBottom: "6px" }}>Inizio</div>
            <div class="dt">
              <DTChip type="date" value={sd.date} on={pick === "sd"} onClick={() => tog("sd")} />
              {!allDay && <DTChip type="time" value={sd.time} on={pick === "st"} onClick={() => tog("st")} />}
            </div>
          </div>
        </div>
        {pick === "sd" && <div class="picker"><DatePick value={sd.date} onChange={(v) => { setStart({ ...sd, date: v }); setPick(null); }} /></div>}
        {pick === "st" && !allDay && <div class="picker"><TimeWheel value={sd.time} onChange={(v) => setStart({ ...sd, time: v })} /></div>}
        <div class="row">
          <div style={{ width: "24px" }} />
          <div class="grow"><div class="val" style={{ marginBottom: "6px", color: bad ? "var(--danger)" : undefined }}>{bad ? "La fine deve venire dopo l'inizio" : "Fine"}</div>
            <div class="dt">
              <DTChip type="date" value={ed.date} on={pick === "ed"} bad={bad} onClick={() => tog("ed")} />
              {!allDay && <DTChip type="time" value={ed.time} on={pick === "et"} bad={bad} onClick={() => tog("et")} />}
            </div>
          </div>
        </div>
        {pick === "ed" && <div class="picker"><DatePick value={ed.date} onChange={(v) => { setEd({ ...ed, date: v }); setPick(null); }} /></div>}
        {pick === "et" && !allDay && <div class="picker"><TimeWheel value={ed.time} onChange={(v) => setEd({ ...ed, time: v })} /></div>}
      </div>
      <div class="card">
        {scope !== "one" && (
          <button class="row click" onClick={() => setShowRepeat(!showRepeat)}>
            <Icon n="repeat" /><div class="grow"><div class="lab">Ripeti</div><div class="val">{rule ? describeRule(ruleToString(rule), start) : "Non si ripete"}</div></div>
          </button>
        )}
        {showRepeat && <RepeatEditor rule={rule} setRule={setRule} start={start} opts={repeatOpts} />}
        <div class="row" style={{ alignItems: "flex-start" }}>
          <Icon n="bell" />
          <div class="grow">
            <div class="lab" style={{ marginBottom: "8px" }}>Promemoria</div>
            {rem.slice().sort((a, b) => a - b).map((m) => (
              <span class="pill on rempill">
                <button type="button" class="remedit" onClick={() => push({ t: "rem", allDay, start, value: m, onPick: (v) => { if (v != null) setRem((r) => [...new Set(r.map((x) => (x === m ? v : x)))]); } })}>{remLabel(m, allDay)}</button>
                <button type="button" class="x" aria-label="Togli promemoria" onClick={() => setRem((r) => r.filter((x) => x !== m))}>✕</button>
              </span>
            ))}
            <button type="button" class="pill addrem" onClick={() => push({ t: "rem", allDay, start, value: null, onPick: (v) => { if (v != null) setRem((r) => [...new Set([...r, v])]); } })}><Icon n="plus" s /> Aggiungi</button>
          </div>
        </div>
      </div>
      <div class="card">
        <button type="button" class="row click" onClick={() => setShowCals(!showCals)}><Icon n="cal" />
          <div class="grow lab">{cal?.name || "Calendario"}</div>
          <span class="cdot" style={{ background: cal?.color || "#999" }} />
        </button>
        {showCals && (
          <div class="qcals ed">{visibleCals.value.map((c) => (
            <button type="button" class={c.id === calId ? "on" : ""} onClick={() => { setCalId(c.id); setShowCals(false); }}><span class="cdot" style={{ background: c.color }} />{c.name}</button>
          ))}</div>
        )}
        <div class="row"><Icon n="place" /><input class="inp grow" placeholder="Luogo" value={loc} onInput={(e) => setLoc((e.target as HTMLInputElement).value)} maxLength={300} /></div>
        <div class="row" style={{ alignItems: "flex-start" }}><Icon n="notes" />
          <textarea class="inp grow" rows={3} placeholder="Note" value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} maxLength={5000} style={{ resize: "vertical" }} />
        </div>
      </div>
      {!isNew && !occ && (
        <div style={{ textAlign: "center" }}>
          <button class="btn danger" onClick={() => { void deleteEvent(ev.id); closeAll(); showToast("Evento eliminato", { label: "Annulla", run: () => void saveEvent({ ...ev, deleted: false }) }); }}>Elimina evento</button>
        </div>
      )}
    </Page>
  );
}

function RepeatEditor({ rule, setRule, start, opts }: { rule: Rule | null; setRule: (r: Rule | null) => void; start: Date; opts: [string, Rule | null][] }) {
  const key = (r: Rule | null) => (r ? ruleToString({ ...r, until: null, count: null }) : "");
  const cur = key(rule);
  const custom = rule && !opts.some(([, r]) => key(r) === cur);
  const [adv, setAdv] = useState(!!custom || !!rule?.until || !!rule?.count || (rule?.interval ?? 1) > 1);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div style={{ padding: "0 18px 12px 56px" }}>
      {opts.map(([l, r]) => <button class={"pill" + (key(r) === cur ? " on" : "")} onClick={() => setRule(r ? { ...r, until: rule?.until ?? null, count: rule?.count ?? null } : null)}>{l}</button>)}
      <button class={"pill" + (adv ? " on" : "")} onClick={() => { setAdv(!adv); if (!rule) setRule({ freq: "WEEKLY", interval: 1, byday: [], until: null, count: null }); }}>Personalizza…</button>
      {adv && rule && (
        <div style={{ marginTop: "8px", display: "grid", gap: "10px" }}>
          <div class="dt">Ogni
            <input type="number" min={1} max={99} value={rule.interval} style={{ width: "70px" }} onInput={(e) => setRule({ ...rule, interval: Math.max(1, Math.min(99, parseInt((e.target as HTMLInputElement).value) || 1)) })} />
            <Choice cls="pill" title="Ripeti ogni" value={rule.freq} onPick={(v) => setRule({ ...rule, freq: v as Rule["freq"], byday: [] })}
              options={[["DAILY", rule.interval > 1 ? "giorni" : "giorno"], ["WEEKLY", rule.interval > 1 ? "settimane" : "settimana"], ["MONTHLY", rule.interval > 1 ? "mesi" : "mese"], ["YEARLY", rule.interval > 1 ? "anni" : "anno"]]} />
          </div>
          {rule.freq === "WEEKLY" && (
            <div>{order.map((d) => {
              const on = rule.byday.length ? rule.byday.includes(d) : d === start.getDay();
              return <button class={"pill" + (on ? " on" : "")} style={{ minWidth: "44px", justifyContent: "center" }} onClick={() => {
                const base = rule.byday.length ? rule.byday : [start.getDay()];
                const nb = on ? base.filter((x) => x !== d) : [...base, d];
                setRule({ ...rule, byday: nb.length ? nb : [start.getDay()] });
              }}>{cap(DAYS_SHORT[d])}</button>;
            })}</div>
          )}
          <div class="dt">Termina
            <Choice cls="pill" title="Termina" value={rule.until ? "u" : rule.count ? "c" : "n"}
              onPick={(v) => setRule({ ...rule, until: v === "u" ? ymd(addDays(start, 30)) : null, count: v === "c" ? 10 : null })}
              options={[["n", "mai"], ["u", "il giorno…"], ["c", "dopo un numero di volte"]]} />
            {rule.until && <input type="date" value={rule.until} onInput={(e) => setRule({ ...rule, until: (e.target as HTMLInputElement).value || null })} />}
            {rule.count && <><input type="number" min={1} max={999} value={rule.count} style={{ width: "80px" }} onInput={(e) => setRule({ ...rule, count: Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1) })} /> volte</>}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------- ricerca
function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
export function Search() {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 100); }, []);
  const res = useMemo(() => {
    const n = norm(q.trim());
    if (n.length < 2) return [];
    const t = now.value, far = addDays(t, 730);
    const out: Occ[] = [];
    for (const e of events.value) {
      if (!norm(`${e.title} ${e.location} ${e.notes}`).includes(n)) continue;
      const next = expand(e, startOfDay(t), far, evColor(e))[0];
      const o = next ?? expand(e, new Date(0), far, evColor(e)).slice(-1)[0];
      if (o) out.push(o);
    }
    return out.sort((a, b) => {
      const fa = a.end >= t, fb = b.end >= t;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? a.start.getTime() - b.start.getTime() : b.start.getTime() - a.start.getTime();
    }).slice(0, 80);
  }, [q, evMap.value]);
  return (
    <div class="page">
      <div class="search">
        <button class="iconbtn" aria-label="Indietro" onClick={pop}><Icon n="back" /></button>
        <input ref={ref} placeholder="Cerca eventi" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </div>
      <div class="pbody">
        {q.trim().length >= 2 && !res.length && <div class="empty">Nessun risultato</div>}
        {res.length > 0 && (
          <div class="card" style={{ padding: "6px" }}>
            {res.map((o) => (
              <button class={"evrow" + (o.end < now.value ? " past" : "")} onClick={() => push({ t: "detail", occ: o })}>
                <div class="time" style={{ width: "62px" }}><b>{o.start.getDate()} {["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"][o.start.getMonth()]}</b>{o.start.getFullYear() !== now.value.getFullYear() ? o.start.getFullYear() : o.allDay ? "giorno" : hm(o.start)}</div>
                <div class="bar" style={{ background: o.color }} />
                <div class="t"><div class="tt">{o.ev.title || "(senza titolo)"}</div>{o.ev.location && <div class="sub">{o.ev.location}</div>}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- menu laterale (tel.)
export function Drawer() {
  const st = settings.value;
  const views: [Settings_View, string, string][] = [["year", "Anno", "year"], ["month", "Mese", "month"], ["week", "Settimana", "week"], ["day", "Giorno", "day"], ["agenda", "Elenco", "list"]];
  return (
    <>
      <div class="scrim" onClick={pop} />
      <div class="drawer">
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 12px 16px" }}><div class="logo" style={{ width: "40px", height: "40px", fontSize: "17px", borderRadius: "13px" }}>{now.value.getDate()}</div><b style={{ fontSize: "19px" }}>Calendario</b></div>
        {views.map(([v, l, ic]) => <button class={"navitem" + (st.view === v ? " on" : "")} onClick={() => { setSettings({ view: v }); selDay.value = null; pop(); }}><Icon n={ic} />{l}</button>)}
        <div class="sect">Calendari</div>
        <CalToggles />
        <button class="calitem addcal" onClick={() => replaceTop({ t: "calendars", add: true })}><span class="box"><Icon n="plus" /></span><span>Nuovo calendario</span></button>
        <div style={{ flex: 1 }} />
        <button class="navitem" onClick={() => replaceTop({ t: "calendars" })}><Icon n="folder" />Gestisci calendari</button>
        <button class="navitem" onClick={() => replaceTop({ t: "settings" })}><Icon n="settings" />Impostazioni</button>
      </div>
    </>
  );
}
type Settings_View = "year" | "month" | "week" | "day" | "agenda";

export function CalToggles() {
  return (
    <>
      {visibleCals.value.map((c) => (
        <button class="calitem" onClick={() => void saveCal({ ...c, visible: !c.visible })}>
          <span class="box" style={{ borderColor: c.color, background: c.visible ? c.color : "transparent" }}>{c.visible && <Icon n="check" />}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
        </button>
      ))}
    </>
  );
}

export function SideMini() {
  const c = cursor.value;
  const [m, setM] = useState(new Date(c.getFullYear(), c.getMonth(), 1));
  useEffect(() => setM(new Date(c.getFullYear(), c.getMonth(), 1)), [c.getFullYear(), c.getMonth()]);
  return (
    <div class="minical">
      <header>
        <b>{cap(["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"][m.getMonth()])} {m.getFullYear()}</b>
        <button class="iconbtn" aria-label="Mese precedente" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))}><Icon n="left" s /></button>
        <button class="iconbtn" aria-label="Mese successivo" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))}><Icon n="right" s /></button>
      </header>
      <MiniMonth y={m.getFullYear()} m={m.getMonth()} compact sel={selDay.value ?? c} onPick={(d) => { cursor.value = d; selDay.value = d; }} />
    </div>
  );
}
