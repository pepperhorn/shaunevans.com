import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause } from "lucide-react";

type Props = {
  audioUrl: string;
  headline?: string;
  tagline?: string;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AudioPlayer({ audioUrl, headline, tagline }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const isDark =
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark");

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 80,
      waveColor: isDark ? "#475569" : "#cbd5e1",
      progressColor: isDark ? "#f1f5f9" : "#0f172a",
      cursorColor: "transparent",
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      url: audioUrl,
    });

    wavesurferRef.current = ws;

    ws.on("ready", () => {
      setReady(true);
      setDuration(ws.getDuration());
    });
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    ws.on("timeupdate", (t) => setCurrent(t));

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [audioUrl]);

  function toggle() {
    wavesurferRef.current?.playPause();
  }

  return (
    <div className="cms-audio mx-auto max-w-4xl px-4 py-8">
      {tagline && (
        <p className="cms-tagline font-overpass-mono uppercase text-sm text-gray-500 dark:text-gray-400 mb-2 text-center">
          {tagline}
        </p>
      )}
      {headline && (
        <h2 className="cms-headline font-overpass-mono text-3xl sm:text-4xl mb-4 text-center">
          {headline}
        </h2>
      )}
      <div className="audio-player flex items-center gap-3 rounded-lg border bg-background p-4 shadow-sm">
        <button
          type="button"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
          className="btn-audio-toggle flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:opacity-40"
        >
          {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <div className="audio-waveform flex-1">
          <div ref={containerRef} className="waveform-container" />
        </div>
        <div className="audio-time font-mono text-xs tabular-nums text-muted-foreground w-20 text-right">
          {ready ? `${formatTime(current)} / ${formatTime(duration)}` : "…"}
        </div>
      </div>
    </div>
  );
}
