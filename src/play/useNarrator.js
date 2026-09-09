import React, { useState, useEffect, useRef, useCallback } from "react";

export function useNarrator(enabled, voiceURI, rate) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [voices, setVoices] = useState([]);
  const chosenRef = useRef(null);
  const rateRef = useRef(rate);
  rateRef.current = rate;

  /* Our own busy flag rather than speechSynthesis.speaking. The native flag
     is false for a window between speak() being called and the utterance
     actually starting, and anything checking it in that gap concludes the
     narrator is idle and talks over the top. Setting this synchronously in
     speak() closes the gap. */
  const speakingRef = useRef(false);

  // Chrome populates the voice list asynchronously, so the first read is
  // often empty and the event is the only reliable signal.
  useEffect(() => {
    if (!supported) return;
    const read = () => {
      const all = speechSynthesis.getVoices();
      if (all.length) setVoices(all);
    };
    read();
    speechSynthesis.addEventListener("voiceschanged", read);
    return () => speechSynthesis.removeEventListener("voiceschanged", read);
  }, [supported]);

  /* An explicit choice wins. Without one we set nothing at all and let the
     browser use the system default for the language, which is what most
     people already recognise as "the computer voice" on their machine.
     Picking the first English voice in the list instead sounds arbitrary,
     because list order is not preference order. */
  useEffect(() => {
    chosenRef.current = voiceURI ? voices.find((v) => v.voiceURI === voiceURI) ?? null : null;
  }, [voices, voiceURI]);

  useEffect(() => {
    if (!supported) return;
    return () => { speakingRef.current = false; speechSynthesis.cancel(); };
  }, [supported]);

  useEffect(() => {
    if (supported && !enabled) { speakingRef.current = false; speechSynthesis.cancel(); }
  }, [enabled, supported]);

  const speak = useCallback((text) => {
    if (!supported || !enabled || !text) return;
    const clean = String(text)
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")   // emoji are read as their names
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return;

    // Cancel first, or a fast typist builds a backlog three turns deep.
    speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(clean);
    if (chosenRef.current) u.voice = chosenRef.current;
    u.lang = chosenRef.current?.lang ?? "en-US";
    u.rate = rateRef.current ?? 1;
    u.pitch = 1;
    u.volume = 1;

    speakingRef.current = true;                  // before speak(), not after
    u.onend = () => { speakingRef.current = false; };
    u.onerror = () => { speakingRef.current = false; };

    speechSynthesis.speak(u);
  }, [supported, enabled]);

  const stop = useCallback(() => {
    speakingRef.current = false;
    if (supported) speechSynthesis.cancel();
  }, [supported]);

  const isSpeaking = useCallback(
    () => supported && enabled &&
      (speakingRef.current || speechSynthesis.speaking || speechSynthesis.pending),
    [supported, enabled],
  );

  return { supported, speak, stop, isSpeaking, voices };
}

/** Fetches world_data, then hands it to Play. Keeps loading and error
    states out of the game itself. */
