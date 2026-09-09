/* Measurements of the browser, not of the app. */

import React, { useState, useEffect, useRef } from "react";

export function useNarrow(px = 700) {
  const [narrow, setNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < px : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px - 1}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return narrow;
}

export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
}

export function useVisualViewport() {
  const [box, setBox] = useState(null);
  /* The tallest the viewport has ever been is the no-keyboard baseline.
     Comparing against window.innerHeight does not work: the viewport meta
     asks for interactive-widget=resizes-content, which shrinks both
     together and leaves nothing to measure. */
  const tallest = useRef(0);
  const lastWidth = useRef(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const update = () => {
      // A rotation changes what "full height" means, so the baseline resets.
      if (vv.width !== lastWidth.current) {
        lastWidth.current = vv.width;
        tallest.current = 0;
      }
      if (vv.height > tallest.current) tallest.current = vv.height;

      setBox({
        height: vv.height,
        top: vv.offsetTop,
        // Something is covering part of the screen: a keyboard, usually.
        shrunk: vv.height < tallest.current - 100,
      });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return box;
}

/* Narration read aloud, using the browser's own speech synthesis. No key,
   no cost, no network. Quality is whatever voices the operating system
   ships, which on desktop is decent and on mobile varies.

   Two details borrowed from any terminal that does this well: cancel before
   every utterance so a fast typist does not build a backlog three turns
   deep, and stop everything on unmount so leaving a game does not leave a
   voice talking over the catalog. */
/* What gets read aloud. Narration, character presence and ambient lines are
   prose. The ruled engine lines — "Taken: brass key", "−3 health" — are
   already visually separate precisely because they are not part of the
   story, and hearing them read out is grating. */
