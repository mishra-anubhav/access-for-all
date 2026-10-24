"use client";

import {
  Accessibility, ArrowDownToLine, ArrowRight, BookOpen, Bookmark, Check, ChevronDown,
  CircleHelp, Clock3, Copy, Expand, FileText, Headphones, Languages, LayoutDashboard, LoaderCircle,
  Menu, Mic, MicOff, Minimize2, Moon, PanelRight, Plus, Search, Send, Settings2,
  ShieldCheck, Sparkles, Sun, Waves, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessLogo } from "@/components/access-logo";

type Segment = { id: string; text: string; createdAt: number; translation?: string };
type Trace = { type: string; label: string; status: string };
type Note = { id: string; title: string; createdAt: number; body: string };
type Page = "home" | "live" | "notes" | "explore" | "settings";
type Language = "en" | "hi" | "es" | "fr" | "zh";
const languages: Array<{ code: Language; name: string; native: string }> = [
  { code: "en", name: "English", native: "English" }, { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "es", name: "Spanish", native: "Español" }, { code: "fr", name: "French", native: "Français" },
  { code: "zh", name: "Mandarin Chinese", native: "中文" },
];
const newSessionId = () => crypto.randomUUID().replaceAll("-", "");
const fmtTime = (time: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(time);

export default function AccessApp() {
  const [page, setPage] = useState<Page>("live");
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, setDark] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [language, setLanguage] = useState<Language>("en");
  const [level, setLevel] = useState("beginner");
  const [fontSize, setFontSize] = useState(19);
  const [lineSpacing, setLineSpacing] = useState(1.65);
  const [listening, setListening] = useState(false);
  const [permission, setPermission] = useState("Not requested");
  const [connection, setConnection] = useState("Not connected");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [partial, setPartial] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [trace, setTrace] = useState<Trace[]>([]);
  const [approval, setApproval] = useState<{ key: string; tool: string; args: Record<string, unknown> } | null>(null);
  const [approvalResult, setApprovalResult] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteSearch, setNoteSearch] = useState("");
  const [currentNote, setCurrentNote] = useState("");
  const [interest, setInterest] = useState("");
  const [accommodationText, setAccommodationText] = useState("");
  const [scheduleFile, setScheduleFile] = useState("");
  const [translationLag, setTranslationLag] = useState(false);
  const [privacyNoticeVisible, setPrivacyNoticeVisible] = useState(true);
  const [announce, setAnnounce] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [savedSession, setSavedSession] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserFrame = useRef<number | null>(null);
  const silenceTimer = useRef<number | null>(null);
  const sessionTimeout = useRef<number | null>(null);
  const speechDetected = useRef(false);
  const partials = useRef(new Map<string, string>());
  const activeSessionRef = useRef("");
  const segmentsRef = useRef<Segment[]>([]);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const askButtonRef = useRef<HTMLButtonElement>(null);
  const assistantWasOpen = useRef(false);

  useEffect(() => { activeSessionRef.current = newSessionId(); }, []);
  useEffect(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem("accessforall:prefs") || "{}");
      setDark(Boolean(prefs.dark)); setHighContrast(Boolean(prefs.highContrast)); setLargeText(Boolean(prefs.largeText));
      setReducedMotion(Boolean(prefs.reducedMotion)); setLanguage(prefs.language || "en"); setLevel(prefs.level || "beginner");
      setFontSize(Number(prefs.fontSize) || 19); setLineSpacing(Number(prefs.lineSpacing) || 1.65);
      setNotes(JSON.parse(localStorage.getItem("accessforall:notes") || "[]"));
    } catch { /* use accessible defaults */ }
  }, []);
  useEffect(() => {
    localStorage.setItem("accessforall:prefs", JSON.stringify({ dark, highContrast, largeText, reducedMotion, language, level, fontSize, lineSpacing }));
  }, [dark, highContrast, largeText, reducedMotion, language, level, fontSize, lineSpacing]);
  useEffect(() => { localStorage.setItem("accessforall:notes", JSON.stringify(notes)); }, [notes]);
  useEffect(() => {
    if (!listening) return;
    const interval = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [listening]);
  useEffect(() => {
    if (page === "live") transcriptEnd.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [segments, partial, page, reducedMotion]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setFocusMode(false); setAssistantOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    if (assistantOpen) document.getElementById("ask-question")?.focus();
    else if (assistantWasOpen.current && !focusMode) askButtonRef.current?.focus();
    assistantWasOpen.current = assistantOpen;
  }, [assistantOpen, focusMode]);
  useEffect(() => () => {
    if (analyserFrame.current !== null) cancelAnimationFrame(analyserFrame.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    dcRef.current?.close(); pcRef.current?.close(); contextRef.current?.close().catch(() => undefined);
  }, []);

  const updateContext = useCallback(async (nextSegments: Segment[]) => {
    const id = activeSessionRef.current;
    if (!id) return;
    try {
      await fetch("/api/session-context", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, segments: nextSegments, preferences: { language, level } }) });
    } catch { /* context is temporary and will be retried on the next interaction */ }
  }, [language, level]);

  const translateSegment = useCallback(async (segment: Segment, requestedLanguage: Language = language) => {
    const target = languages.find((item) => item.code === requestedLanguage);
    if (!target || requestedLanguage === "en") return;
    setTranslationLag(true);
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "translate", language: target.name, level, prompt: `Translate this finalized transcript segment into ${target.name}. Preserve its meaning and technical terms. Do not add facts.\n\n${segment.text}` }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Translation unavailable");
      setSegments((current) => {
        const updated = current.map((item) => item.id === segment.id ? { ...item, translation: data.answer } : item);
        segmentsRef.current = updated; void updateContext(updated); return updated;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Translation unavailable. Original captions are still available.");
    } finally { setTranslationLag(false); }
  }, [language, level, updateContext]);

  const stopSession = useCallback(async (announceEnd = true) => {
    if (analyserFrame.current !== null) cancelAnimationFrame(analyserFrame.current);
    if (silenceTimer.current !== null) window.clearTimeout(silenceTimer.current);
    if (sessionTimeout.current !== null) window.clearTimeout(sessionTimeout.current);
    contextRef.current?.close().catch(() => undefined); contextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    dcRef.current?.close(); dcRef.current = null;
    pcRef.current?.close(); pcRef.current = null;
    setListening(false); setAudioLevel(0); setConnection("Not connected");
    if (announceEnd) { setAnnounce("Listening stopped. Your microphone is off."); setPermission("Microphone stopped"); }
  }, []);

  const startSession = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setError("Microphone capture needs a secure browser context such as localhost or HTTPS."); return; }
    setError(""); setAnswer(""); setApproval(null); setApprovalResult(""); setPermission("Requesting microphone permission…"); setConnection("Connecting");
    const id = newSessionId(); activeSessionRef.current = id; segmentsRef.current = []; setSegments([]); setSavedSession(false); setElapsed(0); setPartial(""); partials.current.clear();
    let media: MediaStream | null = null;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      sessionTimeout.current = window.setTimeout(() => {
        void stopSession(); setError("This session reached its 60-minute limit. Start a new session to continue.");
      }, 60 * 60 * 1000);
      streamRef.current = media; setPermission("Microphone allowed");
      const tokenResponse = await fetch("/api/session-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language }) });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenData.error || "Could not prepare the transcription connection.");
      const pc = new RTCPeerConnection(); pcRef.current = pc;
      media.getTracks().forEach((track) => pc.addTrack(track, media!));
      const dc = pc.createDataChannel("oai-events"); dcRef.current = dc;
      dc.onopen = () => { setConnection("Live captions connected"); setListening(true); setAnnounce("Live captions connected. Listening is on."); };
      dc.onclose = () => { if (activeSessionRef.current === id) { setConnection("Connection closed"); void stopSession(); } };
      dc.onerror = () => setError("The live caption connection encountered an error. Try reconnecting.");
      dc.onmessage = (event) => {
        let message: { type?: string; item_id?: string; delta?: string; transcript?: string };
        try { message = JSON.parse(event.data); } catch { return; }
        const itemId = message.item_id;
        if (message.type === "conversation.item.input_audio_transcription.delta" && itemId) {
          const next = (partials.current.get(itemId) || "") + (message.delta || ""); partials.current.set(itemId, next);
          setPartial(next);
        }
        if (message.type === "conversation.item.input_audio_transcription.completed" && itemId) {
          const text = (message.transcript || partials.current.get(itemId) || "").trim(); partials.current.delete(itemId); setPartial("");
          if (!text) return;
          const segment: Segment = { id: itemId, text, createdAt: Date.now() };
          setSegments((current) => {
            if (segmentsRef.current.some((item) => item.id === itemId)) return current;
            const updated = [...segmentsRef.current, segment]; segmentsRef.current = updated; void updateContext(updated);
            setAnnounce(`Caption finalized: ${text.slice(0, 160)}`);
            return updated;
          });
          if (language !== "en") void translateSegment(segment, language);
        }
        if (message.type === "error") setError("OpenAI reported a transcription error. Your microphone remains under your control.");
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setConnection("Connection interrupted"); setError("The live connection was interrupted. Stop and start listening to reconnect.");
        }
      };
      const audioContext = new AudioContext(); contextRef.current = audioContext;
      const analyser = audioContext.createAnalyser(); analyser.fftSize = 512;
      audioContext.createMediaStreamSource(media).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const detectSpeech = () => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        setAudioLevel(Math.min(1, rms * 5));
        if (rms > 0.026) {
          speechDetected.current = true;
          if (silenceTimer.current !== null) window.clearTimeout(silenceTimer.current);
        } else if (speechDetected.current && silenceTimer.current === null) {
          silenceTimer.current = window.setTimeout(() => {
            if (dc.readyState === "open") dc.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            speechDetected.current = false; silenceTimer.current = null;
          }, 1000);
        }
        analyserFrame.current = requestAnimationFrame(detectSpeech);
      };
      detectSpeech();
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST", headers: { Authorization: `Bearer ${tokenData.value}`, "Content-Type": "application/sdp" }, body: offer.sdp,
      });
      if (!response.ok) throw new Error("OpenAI could not establish the live audio connection.");
      await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
    } catch (cause) {
      media?.getTracks().forEach((track) => track.stop());
      await stopSession(false); setPermission(cause instanceof DOMException && cause.name === "NotAllowedError" ? "Microphone permission denied" : "Microphone unavailable");
      setError(cause instanceof Error ? cause.message : "Could not start listening. Check microphone permission and try again.");
    }
  }, [language, stopSession, translateSegment, updateContext]);

  const runAgent = useCallback(async (action: string, prompt: string) => {
    setError(""); setAgentLoading(true); setTrace([]); setAnswer(""); setApproval(null); setApprovalResult("");
    await updateContext(segments);
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, prompt, language: languages.find((item) => item.code === language)?.name, level, contextId: activeSessionRef.current }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The TrueForge agent is unavailable.");
      setAnswer(data.answer || "The agent is waiting for your approval."); setTrace(data.trace || []); setApproval(data.approval || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The TrueForge agent is unavailable.");
      setTrace([{ type: "error", label: "Agent unavailable", status: "error" }]);
    } finally { setAgentLoading(false); }
  }, [language, level, segments, updateContext]);

  const handleApproval = async (decision: "allow" | "deny") => {
    if (!approval) return;
    setAgentLoading(true); setError("");
    try {
      const response = await fetch("/api/agent/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: approval.key, decision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Approval could not be processed.");
      setApproval(null); setAnswer(data.answer || (decision === "allow" ? "Request submitted to the local demo organizer inbox." : "Request declined. Nothing was submitted."));
      setApprovalResult(decision === "allow" ? "DEMO MODE · A request was recorded locally. No email was sent." : "Declined · no action was taken.");
      setTrace((previous) => [...previous, ...(data.trace || []), { type: "approval", label: decision === "allow" ? "Human approval recorded" : "Request declined", status: "complete" }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Approval could not be processed."); }
    finally { setAgentLoading(false); }
  };

  const saveNotes = (bodyOverride?: string) => {
    const body = bodyOverride || currentNote || answer;
    if (!body.trim()) { setError("Generate notes before saving them."); return; }
    const note: Note = { id: crypto.randomUUID(), title: "Live session notes", createdAt: Date.now(), body };
    setNotes((current) => [note, ...current]); setCurrentNote(body); setSavedSession(true); setAnnounce("Notes saved on this device.");
  };
  const downloadNote = (body: string, title = "accessforall-notes") => {
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([body], { type: "text/markdown" })); link.download = `${title}.md`; link.click(); URL.revokeObjectURL(link.href);
  };
  const copyText = async (body: string) => { await navigator.clipboard.writeText(body); setAnnounce("Copied to clipboard."); };
  const openPage = (target: Page) => { setPage(target); setMobileNav(false); };
  const changeLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    if (nextLanguage !== "en") segments.filter((segment) => !segment.translation).forEach((segment) => void translateSegment(segment, nextLanguage));
  };
  const elapsedLabel = `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;

  return <div className={`app-shell ${dark ? "theme-dark" : ""} ${highContrast ? "high-contrast" : ""} ${largeText ? "large-text" : ""} ${reducedMotion ? "reduce-motion" : ""}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <div className={`mobile-scrim ${mobileNav ? "show" : ""}`} onClick={() => setMobileNav(false)} aria-hidden="true" />
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} aria-label="Main navigation">
      <button className="brand" onClick={() => openPage("live")} aria-label="AccessForAll live session"><AccessLogo /></button>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav className="nav-stack">
        <NavButton active={page === "home"} icon={<LayoutDashboard />} label="Home" onClick={() => openPage("home")} />
        <NavButton active={page === "live"} icon={<Waves />} label="Live" onClick={() => openPage("live")} badge={listening ? "LIVE" : undefined} />
        <NavButton active={page === "notes"} icon={<BookOpen />} label="Notes" onClick={() => openPage("notes")} count={notes.length || undefined} />
        <NavButton active={page === "explore"} icon={<Search />} label="Explore" onClick={() => openPage("explore")} />
        <NavButton active={page === "settings"} icon={<Settings2 />} label="Settings" onClick={() => openPage("settings")} />
      </nav>
      <div className="sidebar-user"><div className="avatar">A</div><div className="user-copy"><strong>Attendee</strong><span>{languages.find((item) => item.code === language)?.native} · {level}</span></div><button className="icon-button small" onClick={() => setDark(!dark)} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div>
    </aside>

    <main className="main-shell" id="main-content">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation menu"><Menu size={20} /></button>
        <div className="breadcrumb">Workspace <span>/</span> <strong>{pageLabels[page]}</strong></div>
        <div className="top-actions"><span className="local-badge"><span /> Personal workspace</span><button className="icon-button" onClick={() => openPage("settings")} aria-label="Open accessibility settings"><Accessibility size={19} /></button><div className="avatar small-avatar">A</div></div>
      </header>
      <div className="page-content" key={page}>
        {page === "home" && <section className="dashboard-page home-workspace">
          <div className="home-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR WORKSPACE</div><h1>Good to see you.</h1><p>Pick up where you left off or start listening.</p></div><button className="button button-primary" onClick={() => openPage("live")}><Mic size={17} /> Start listening</button></div>
          <div className="home-session"><div className="home-session-icon"><Waves size={21} /></div><div className="home-session-copy"><span>READY WHEN YOU ARE</span><h2>Bring the room into focus.</h2><p>Live captions, translation, and clear explanations in one place.</p></div><button className="button button-primary" onClick={() => openPage("live")}>Open live session <ArrowRight size={16} /></button></div>
          <div className="home-section-heading"><h2>Pick up a thread</h2><button className="text-link" onClick={() => openPage("notes")}>All notes <ArrowRight size={14} /></button></div>
          {notes.length ? <div className="home-notes-list">{notes.slice(0, 3).map((note) => <button key={note.id} className="home-note-row" onClick={() => { setCurrentNote(note.body); setAnswer(""); openPage("notes"); }}><span className="home-note-time">{fmtTime(note.createdAt)}</span><span className="home-note-title">{note.title}</span><span className="home-note-preview">{note.body.slice(0, 100)}</span><ArrowRight size={16} /></button>)}</div> : <p className="home-empty-line">Your saved session notes will appear here when you choose to save them.</p>}
          <div className="home-bottom-links"><button onClick={() => openPage("explore")}><Search size={17} /><span><strong>Explore sessions</strong><small>Find a talk that fits your interests</small></span><ArrowRight size={15} /></button><button onClick={() => openPage("settings")}><Accessibility size={17} /><span><strong>Your access preferences</strong><small>Language, captions, contrast, and motion</small></span><ArrowRight size={15} /></button></div>
        </section>}

        {page === "live" && <section className={`live-page ${focusMode ? "focus-mode" : ""}`}>
          <div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> LIVE INTERPRETATION</div><h1>Live session</h1><p>Stay with the speaker. We’ll help with the rest.</p></div><div className="title-controls"><label className="select-pill"><Languages size={16} /><span className="sr-only">Caption translation language</span><select value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>{languages.map((item) => <option value={item.code} key={item.code}>{item.native}</option>)}</select><ChevronDown size={14} /></label><button ref={askButtonRef} className="button button-secondary ask-ai-trigger" onClick={() => setAssistantOpen(!assistantOpen)} aria-expanded={assistantOpen} aria-controls="assistant-drawer"><Sparkles size={15} /> {assistantOpen ? "Close AI" : "Ask AI"}</button><button className="icon-button focus-toggle" onClick={() => { const next = !focusMode; setFocusMode(next); if (next) setAssistantOpen(false); }} aria-label={focusMode ? "Exit distraction-free captions" : "Enter distraction-free captions"}>{focusMode ? <Minimize2 size={18} /> : <Expand size={18} />}</button><button className="icon-button theme-toggle" onClick={() => setDark(!dark)} aria-label={dark ? "Use light theme" : "Use dark theme"}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button></div></div>
          {privacyNoticeVisible && <div className="notice-bar"><ShieldCheck size={16} /><span>Audio is sent securely to OpenAI for live transcription. AccessForAll does not store raw audio. Ask the speaker for consent before recording their words.</span><button className="icon-button tiny" onClick={() => setPrivacyNoticeVisible(false)} aria-label="Dismiss privacy notice"><X size={14} /></button></div>}
          <div className="live-toolbar"><div className="session-status"><span className={`status-dot ${listening ? "on" : ""}`} /><div><strong>{listening ? "Listening live" : "Ready to listen"}</strong><span>{listening ? "Microphone active · " + (connection === "Live captions connected" ? "Connected" : connection) : permission}</span></div></div><div className="toolbar-divider" /><div className="timer"><Clock3 size={16} /><span>{elapsedLabel}</span></div><div className="audio-meter" aria-label={listening ? "Microphone activity" : "Microphone inactive"} role="img">{Array.from({ length: 17 }, (_, index) => <i key={index} style={{ height: `${6 + (listening ? audioLevel * (9 + (index % 5) * 4) : 4)}px` }} />)}</div>{listening ? <button className="button button-stop" onClick={() => void stopSession()}><MicOff size={16} /> Stop listening</button> : <button className="button button-primary compact" onClick={() => void startSession()}><Mic size={16} /> Start listening</button>}{focusMode && <button className="focus-exit" onClick={() => setFocusMode(false)}>Exit focus view <Minimize2 size={15} /></button>}</div>
          {assistantOpen && <button type="button" className="assistant-scrim" tabIndex={-1} aria-hidden="true" onClick={() => setAssistantOpen(false)} />}
          <div className="live-layout"><div className="transcript-column"><div className="panel transcript-panel"><div className="transcript-head"><div><span className="live-label"><span className={listening ? "pulse-dot" : "idle-dot"} /> {listening ? "LIVE CAPTIONS" : "SESSION TRANSCRIPT"}</span><h2>Follow the conversation</h2></div><button className="more-button" onClick={() => setSavedSession(!savedSession)} aria-label={savedSession ? "Session marked saved" : "Save this session"}><Bookmark size={18} className={savedSession ? "saved-bookmark" : ""} /></button></div>
            <div className="caption-options"><span>ORIGINAL CAPTIONS <b>·</b> {languages.find((item) => item.code === "en")?.native}</span>{language !== "en" && <span className="caption-tag">{translationLag ? "Translation catching up…" : `TRANSLATION · ${languages.find((item) => item.code === language)?.native}`}</span>}</div>
            <div className="transcript-body" style={{ "--caption-size": `${fontSize}px`, "--caption-leading": lineSpacing } as React.CSSProperties} aria-label="Live transcript">
              {!segments.length && !partial && <div className="transcript-empty"><div className="empty-wave"><Waves size={25} /></div><strong>Your captions will appear here</strong><p>Start listening to follow the speaker in real time.</p><span>Finalized captions stay in this session until you leave.</span></div>}
              {segments.map((segment) => <article className="caption-block" key={segment.id}><div className="caption-meta"><time>{fmtTime(segment.createdAt)}</time><span>Speaker</span></div><p>{segment.text}</p>{language !== "en" && <div className="translation-line" lang={language}><span>{languages.find((item) => item.code === language)?.native}</span><p className="translated-caption">{segment.translation || <span className="translation-pending"><LoaderCircle size={13} /> Translation catching up</span>}</p></div>}</article>)}
              {partial && <article className="caption-block partial-block"><div className="caption-meta"><time>{fmtTime(Date.now())}</time><span className="partial-label">In progress</span></div><p>{partial}<span className="cursor-dot" /></p></article>}
              <div ref={transcriptEnd} />
            </div>
            <div className="transcript-foot"><span><span className={`status-dot ${listening ? "on" : ""}`} />{listening ? "Live transcription · may contain errors" : "No audio is being captured"}</span><span className="live-language-note">{language === "en" ? "English source" : `Translation may lag · ${languages.find((item) => item.code === language)?.name}`}</span></div>
          </div>
          <div className="transcript-actions"><button className="action-card" onClick={() => { const last = segments.at(-1); if (last) void runAgent("simplify", `Explain this transcript segment in ${languages.find((item) => item.code === language)?.name}, at ${level} level.\n\n${last.text}`); else setError("A finalized caption is needed before an explanation can be generated."); }}><span className="action-icon simplify-icon"><Sparkles size={17} /></span><span><strong>Simplify this</strong><small>Explain the latest idea clearly</small></span><ArrowRight size={16} /></button><button className="action-card" onClick={() => { if (!segments.length) { setError("Capture some speech before generating session notes."); return; } openPage("notes"); void runAgent("notes", `Create structured notes from these finalized transcript segments. Keep speaker claims distinct from AI suggestions.\n\n${segments.map((item) => `[${fmtTime(item.createdAt)}] ${item.text}`).join("\n")}`); }}><span className="action-icon notes-icon"><FileText size={17} /></span><span><strong>Generate notes</strong><small>Keep the ideas that matter</small></span><ArrowRight size={16} /></button></div>
          </div>
          {assistantOpen && <aside id="assistant-drawer" className="assistant-column" role="dialog" aria-modal="true" aria-labelledby="assistant-title" onKeyDown={(event) => { if (event.key !== "Tab") return; const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])')); const first = items[0]; const last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}><div className="panel assistant-panel"><div className="assistant-heading"><span className="assistant-avatar"><Sparkles size={17} /></span><div><h2 id="assistant-title">Ask AccessForAll</h2><p>Grounded in this conversation</p></div><span className="agent-badge">TrueForge</span><button className="icon-button drawer-close" onClick={() => setAssistantOpen(false)} aria-label="Close AI assistant"><X size={17} /></button></div><div className="grounding-note"><span className="grounding-mark"><ShieldCheck size={13} /></span><span>Answers use retrieved transcript context and call out what the speaker did not cover.</span></div><div className="suggested-label">TRY ASKING</div><div className="suggested-questions">{["What is the main idea so far?", "Explain the latest point simply", "What should I remember?"].map((item) => <button key={item} onClick={() => setQuestion(item)}>{item}<ArrowRight size={13} /></button>)}</div><div className="assistant-response" aria-live="polite" aria-atomic="true">{agentLoading ? <div className="thinking"><LoaderCircle size={17} /><span>AccessForAll is working…</span></div> : answer ? <div className="answer-content"><span className="answer-label"><Sparkles size={13} /> AGENT RESPONSE</span><p>{answer}</p>{trace.length > 0 && <details className="trace-details"><summary><PanelRight size={14} /> Agent activity <span>{trace.length} steps</span></summary><ul>{trace.map((item, index) => <li key={`${item.type}-${index}`}><span className={item.status === "error" ? "trace-error" : "trace-check"}>{item.status === "error" ? <X size={12} /> : <Check size={12} />}</span>{item.label}</li>)}</ul></details>}</div> : <div className="assistant-placeholder"><span className="question-bubble"><CircleHelp size={20} /></span><p>Your questions are answered with context from the live session.</p><span>Start listening to give your assistant something to work with.</span></div>}</div>
          {approval && <div className="approval-card"><div className="approval-title"><ShieldCheck size={17} /><strong>Organizer action needs your approval</strong></div><p>TrueForge paused before this demo submission. Review the request details before allowing it.</p><pre>{JSON.stringify(approval.args, null, 2)}</pre><div className="approval-warning">DEMO INTEGRATION · No real organizer contact is configured.</div><div className="approval-actions"><button className="button button-secondary" disabled={agentLoading} onClick={() => void handleApproval("deny")}>Decline</button><button className="button button-primary" disabled={agentLoading} onClick={() => void handleApproval("allow")}><Check size={15} /> Approve demo submission</button></div></div>}
          {approvalResult && <div className="approval-result"><Check size={15} />{approvalResult}</div>}
          {error && <div className="inline-error" role="alert"><CircleHelp size={16} />{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button></div>}
          <form className="ask-form" onSubmit={(event) => { event.preventDefault(); if (!question.trim()) return; void runAgent("qa", question.trim()); setQuestion(""); }}><label className="sr-only" htmlFor="ask-question">Ask a question about the live session</label><textarea id="ask-question" placeholder="Ask about the session…" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={2} /><div className="ask-form-foot"><span><span className="key-hint">↵</span> Ask with transcript context</span><button className="send-button" type="submit" disabled={agentLoading || !question.trim()} aria-label="Send question"><Send size={16} /></button></div></form><p className="ai-disclosure"><ShieldCheck size={12} /> Your transcript is sent to AI when you ask a question.</p></div></aside>}</div>
          <section className="accommodation-strip"><div className="accommodation-icon"><Accessibility size={18} /></div><div className="support-copy"><strong>Need an accommodation?</strong><p>Describe what would help. AccessForAll prepares a request and waits for your approval before any action.</p><label className="sr-only" htmlFor="accommodation-request">Describe the accommodation you need</label><textarea id="accommodation-request" value={accommodationText} onChange={(event) => setAccommodationText(event.target.value)} placeholder="For example, live captioning or accessible seating…" rows={2} maxLength={1000} /></div><button className="button button-secondary" disabled={agentLoading || accommodationText.trim().length < 5} onClick={() => void runAgent("accommodation", `Prepare an accommodation request for the attendee: ${accommodationText.trim()}. This is a demo. Do not claim organizer details are verified.`)}>Request support <ArrowRight size={15} /></button></section>
        </section>}

        {page === "notes" && <section className="notes-page"><div className="page-title-row"><div><div className="eyebrow">YOUR TAKEAWAYS</div><h1>Notebook</h1><p>Session summaries, ideas, and questions worth keeping.</p></div><button className="button button-primary" onClick={() => { if (!segments.length) { setError("Start a live session and capture some speech before generating notes."); return; } void runAgent("notes", `Create structured notes from these finalized transcript segments. Keep speaker claims distinct from AI suggestions.\n\n${segments.map((item) => `[${fmtTime(item.createdAt)}] ${item.text}`).join("\n")}`); }}><Sparkles size={16} /> Generate notes</button></div>
          {error && <div className="inline-error" role="alert"><CircleHelp size={16} />{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button></div>}
          <div className="notes-toolbar"><div className="search-field"><Search size={16} /><label className="sr-only" htmlFor="note-search">Search notes</label><input id="note-search" placeholder="Search your notes" value={noteSearch} onChange={(event) => setNoteSearch(event.target.value)} /></div><span className="notes-count">{notes.length} saved {notes.length === 1 ? "session" : "sessions"}</span></div>
          {agentLoading && <div className="panel note-loading"><LoaderCircle size={17} /> AccessForAll is organizing your notes…</div>}
          {answer && <div className="panel generated-note"><div className="generated-note-head"><div><span className="live-label"><Sparkles size={13} /> GENERATED WITH TRUEFORGE</span><h2>Session summary</h2></div><div className="note-buttons"><button className="icon-button" onClick={() => void copyText(answer)} aria-label="Copy notes"><Copy size={16} /></button><button className="icon-button" onClick={() => downloadNote(answer)} aria-label="Download Markdown"><ArrowDownToLine size={16} /></button></div></div><NoteBody content={answer} /><div className="generated-note-foot"><span>Review before sharing · AI may miss or misstate details</span><button className="button button-secondary compact" onClick={() => { setCurrentNote(answer); saveNotes(); }}><Bookmark size={14} /> Save to this device</button></div></div>}
          <div className="saved-notes-grid">{notes.filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(noteSearch.toLowerCase())).map((note) => <article className="panel saved-note-card" key={note.id}><div className="saved-note-head"><span className="recent-icon"><FileText size={18} /></span><button className="icon-button" aria-label="Download note" onClick={() => downloadNote(note.body, note.title.toLowerCase().replaceAll(" ", "-"))}><ArrowDownToLine size={16} /></button></div><span className="note-date">{new Date(note.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</span><h3>{note.title}</h3><p>{note.body.slice(0, 180)}{note.body.length > 180 ? "…" : ""}</p><button className="text-link" onClick={() => { setCurrentNote(note.body); setAnswer(""); }}>Open notes <ArrowRight size={14} /></button></article>)}</div>
          {!notes.length && !answer && !agentLoading && <div className="notes-empty"><div className="notes-empty-icon"><BookOpen size={25} /></div><h2>Keep what changes how you think.</h2><p>When a session gives you an idea worth returning to, create a clear summary and save it here. Nothing is kept until you choose.</p><button className="button button-secondary" onClick={() => openPage("live")}><Mic size={15} /> Start a live session</button></div>}
          {currentNote && !answer && <div className="panel generated-note"><div className="generated-note-head"><div><span className="live-label">SAVED ON THIS DEVICE</span><h2>Session notes</h2></div><button className="icon-button" onClick={() => setCurrentNote("")} aria-label="Close note"><X size={16} /></button></div><NoteBody content={currentNote} /><div className="generated-note-foot"><span>Stored only in this browser</span><button className="button button-secondary compact" onClick={() => downloadNote(currentNote)}><ArrowDownToLine size={14} /> Download</button></div></div>}
        </section>}

        {page === "explore" && <section className="explore-page"><div className="page-title-row"><div><div className="eyebrow">FIND YOUR NEXT IDEA</div><h1>Explore sessions</h1><p>Find talks that fit your interests, schedule, and access needs.</p></div><div className="sample-agenda-chip"><span className="sample-dot" /> SAMPLE AGENDA</div></div><div className="explore-grid"><div className="panel explore-form"><div className="explore-form-head"><span className="explore-icon"><Search size={19} /></span><div><h2>What would you like to explore?</h2><p>Share a little about what helps you learn.</p></div></div><label htmlFor="interests">Your interests and goals</label><textarea id="interests" value={interest} onChange={(event) => setInterest(event.target.value)} placeholder="I'm new to AI, interested in healthcare startups, and prefer beginner-friendly explanations…" rows={5} /><div className="explore-prefs"><div><span>Preferred language</span><strong>{languages.find((item) => item.code === language)?.native}</strong></div><div><span>Explanation level</span><strong>{level}</strong></div><div><span>Available time</span><select aria-label="Available time"><option>Any time</option><option>Morning</option><option>Afternoon</option></select></div></div><button className="button button-primary full-button" disabled={agentLoading || !interest.trim()} onClick={() => void runAgent("recommend", `Recommend schedule items for this attendee: ${interest.trim()}. Preferred language: ${languages.find((item) => item.code === language)?.name}. Explanation level: ${level}. Use only the sample schedule tool and clearly label all data as sample, not verified.`)}>{agentLoading ? <LoaderCircle size={16} /> : <Sparkles size={16} />} Build my session plan <ArrowRight size={15} /></button><div className="agenda-upload"><label className="upload-label" htmlFor="agenda-upload"><Plus size={15} /> Add an agenda text or CSV</label><input className="sr-only" id="agenda-upload" type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 1_000_000) { setError("Please choose an agenda under 1 MB."); return; } setScheduleFile(file.name); void file.text().then((text) => setInterest((value) => `${value}${value ? "\n\n" : ""}Agenda text (unverified upload):\n${text.slice(0, 10000)}`)); }} /><span>PDF agenda parsing is not included in this MVP. Uploaded text is sent to the agent only when you request recommendations.</span>{scheduleFile && <small>Added: {scheduleFile}</small>}</div></div><div className="explore-side"><div className="agenda-label"><span>AGENDA PREVIEW</span><span className="sample-label">Sample demo data · not verified</span></div>{[["10:00 AM", "AI Agents in the Real World", "Room A", "Tool use · human oversight"], ["11:15 AM", "Building Inclusive Healthcare Startups", "Room C", "Healthcare · product access"], ["1:00 PM", "RAG, Clearly Explained", "Room B", "Beginner friendly · sample captions listed"]].map(([time, title, room, theme]) => <div className="agenda-card" key={title}><div className="agenda-time">{time}</div><div className="agenda-card-content"><strong>{title}</strong><span>{room} <span>·</span> {theme}</span></div><Bookmark size={16} /></div>)}</div></div>{agentLoading && <div className="panel note-loading"><LoaderCircle size={17} /> Looking for a good fit…</div>}{answer && page === "explore" && <div className="panel generated-note"><div className="generated-note-head"><h2>Your personalized plan</h2><span className="sample-label">Sample data only</span></div><div className="note-markdown"><pre>{answer}</pre></div></div>}{error && <div className="inline-error" role="alert"><CircleHelp size={16} />{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button></div>}</section>}

        {page === "settings" && <section className="settings-page"><div className="page-title-row"><div><div className="eyebrow">MAKE IT WORK FOR YOU</div><h1>Accessibility settings</h1><p>Your preferences are saved on this device.</p></div><span className="settings-shield"><ShieldCheck size={18} /> Private by default</span></div><div className="settings-layout"><div className="settings-main"><div className="panel setting-section"><div className="setting-head"><span className="setting-icon language-setting"><Languages size={18} /></span><div><h2>Language & understanding</h2><p>Choose how AccessForAll communicates.</p></div></div><div className="setting-row"><div><strong>Preferred language</strong><span>Used for translation and AI explanations.</span></div><select value={language} onChange={(event) => changeLanguage(event.target.value as Language)} aria-label="Preferred language">{languages.map((item) => <option key={item.code} value={item.code}>{item.name} · {item.native}</option>)}</select></div><div className="setting-row"><div><strong>Explanation level</strong><span>Choose the amount of technical detail.</span></div><select value={level} onChange={(event) => setLevel(event.target.value)} aria-label="Explanation level"><option value="beginner">Beginner · plain language</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced · more technical</option></select></div></div>
          <div className="panel setting-section"><div className="setting-head"><span className="setting-icon captions-setting"><Headphones size={18} /></span><div><h2>Caption display</h2><p>Adjust readability to suit you.</p></div></div><div className="setting-row range-row"><div><strong>Caption text size</strong><span>{fontSize}px</span></div><input type="range" min="16" max="30" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} aria-label="Caption text size" /></div><div className="setting-row range-row"><div><strong>Line spacing</strong><span>{lineSpacing.toFixed(1)}×</span></div><input type="range" min="1.3" max="2.2" step="0.1" value={lineSpacing} onChange={(event) => setLineSpacing(Number(event.target.value))} aria-label="Caption line spacing" /></div><div className="caption-preview" style={{ "--caption-size": `${fontSize}px`, "--caption-leading": lineSpacing } as React.CSSProperties}><span>CAPTION PREVIEW</span><p>Every voice understood.<br />Every idea within reach.</p></div></div>
          <div className="panel setting-section"><div className="setting-head"><span className="setting-icon access-setting"><Accessibility size={18} /></span><div><h2>Visual & motion preferences</h2><p>Change contrast, theme, and motion.</p></div></div><ToggleRow title="High contrast" text="Increase edge and text contrast across the interface." checked={highContrast} onChange={setHighContrast} /><ToggleRow title="Larger interface text" text="Increase the size of interface labels and controls." checked={largeText} onChange={setLargeText} /><ToggleRow title="Reduce motion" text="Limit nonessential movement and smooth scrolling." checked={reducedMotion} onChange={setReducedMotion} /><ToggleRow title="Dark appearance" text="Use a low-light theme for the workspace." checked={dark} onChange={setDark} /></div></div>
        <aside className="settings-aside"><div className="panel settings-note"><span className="note-shield"><ShieldCheck size={20} /></span><h3>Designed to be yours</h3><p>Preferences and saved notes stay in your browser. Transcript context is temporary and expires after 30 minutes.</p><div className="settings-divider" /><p>Microphone access is only requested when you start a live session. AccessForAll does not retain raw audio.</p></div><div className="panel setting-shortcut"><span className="shortcut-icon"><CircleHelp size={18} /></span><strong>Need another way to access?</strong><p>Use Tab to move through controls. Focus rings remain visible as you navigate.</p><button className="text-link" onClick={() => openPage("live")}>Open live session <ArrowRight size={14} /></button></div></aside></div></section>}
      </div>
    </main>
    <div className="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>
  </div>;
}

const pageLabels: Record<Page, string> = { home: "Home", live: "Live session", notes: "Notebook", explore: "Explore sessions", settings: "Settings" };

function NavButton({ active, icon, label, badge, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; badge?: string; count?: number; onClick: () => void }) {
  return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><span className="nav-icon">{icon}</span><span className="nav-label">{label}</span>{badge && <span className="nav-badge">{badge}</span>}{count && <span className="nav-count">{count}</span>}</button>;
}
function NoteBody({ content }: { content: string }) {
  return <div className="note-document">{content.split(/\r?\n/).map((line, index) => {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    const timestamp = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (!line.trim()) return <div className="note-space" key={index} aria-hidden="true" />;
    if (heading) return <h3 key={index}>{heading[1].replaceAll("**", "")}</h3>;
    if (timestamp) return <div className="note-timestamp" key={index}><time>{timestamp[1]}</time><p>{timestamp[2]}</p></div>;
    if (bullet) return <div className="note-takeaway" key={index}><span aria-hidden="true">↳</span><p>{bullet[1].replaceAll("**", "")}</p></div>;
    return <p className="note-paragraph" key={index}>{line.replaceAll("**", "")}</p>;
  })}</div>;
}
function ToggleRow({ title, text, checked, onChange }: { title: string; text: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="setting-row toggle-row"><div><strong>{title}</strong><span>{text}</span></div><button type="button" className={`switch ${checked ? "switch-on" : ""}`} role="switch" aria-checked={checked} aria-label={title} onClick={() => onChange(!checked)}><span /></button></div>;
}
