import React, { useState, useEffect, useRef } from "react";
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Sparkles, 
  Music, 
  Volume2, 
  Radio, 
  Cpu, 
  Sliders, 
  Info, 
  Flame, 
  Zap, 
  Heart,
  Layers,
  ChevronRight,
  TrendingUp,
  SlidersHorizontal,
  Workflow
} from "lucide-react";
import { AlsFileStats, MidiNote } from "../types";
import { computeJitterMetrics } from "../medientechnikAnalysis";

interface CreativeVisualizerProps {
  loadedFiles: AlsFileStats[];
  initialSelectedFileIdx: number | null;
}

export const CreativeVisualizer: React.FC<CreativeVisualizerProps> = ({ 
  loadedFiles, 
  initialSelectedFileIdx 
}) => {
  // --- STATE ---
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [waveform, setWaveform] = useState<OscillatorType>("triangle");
  const [playbackMode, setPlaybackMode] = useState<"human" | "grid">("human");
  const [visualMode, setVisualMode] = useState<"orbit" | "wave" | "waterfall">("orbit");
  const [cutoffFreq, setCutoffFreq] = useState<number>(2500);
  const [delayTime, setDelayTime] = useState<number>(0.25);
  const [delayFeedback, setDelayFeedback] = useState<number>(0.3);
  const [playheadBeats, setPlayheadBeats] = useState<number>(0);
  const [activeFrequencies, setActiveFrequencies] = useState<{ freq: number; velocity: number; id: string }[]>([]);
  const [canvasFps, setCanvasFps] = useState<number>(60);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [statsSummary, setStatsSummary] = useState({ maxDrift: 0, stdDev: 0, jitter: 0 });

  // --- REFS ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const biquadFilterRef = useRef<BiquadFilterNode | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const delayGainRef = useRef<GainNode | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const triggeredNotesRef = useRef<Set<string>>(new Set());

  // --- REFS FOR ANIMATION LOOP (PREVENT RECREATING LOOP AT 60 FPS) ---
  const isPlayingRef = useRef<boolean>(isPlaying);
  const playheadRef = useRef<number>(playheadBeats);
  const visualModeRef = useRef<"orbit" | "wave" | "waterfall">(visualMode);
  const waveformRef = useRef<OscillatorType>(waveform);
  const playbackModeRef = useRef<"human" | "grid">(playbackMode);
  const activeFrequenciesRef = useRef<{ freq: number; velocity: number; id: string }[]>(activeFrequencies);
  const cutoffFreqRef = useRef<number>(cutoffFreq);
  const delayTimeRef = useRef<number>(delayTime);
  const delayFeedbackRef = useRef<number>(delayFeedback);
  const activeFileRef = useRef<AlsFileStats | null>(null);
  const playheadSpanRef = useRef<HTMLSpanElement | null>(null);
  const playbackSpeedRef = useRef<number>(playbackSpeed);

  // Sync refs with state changes
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { playheadRef.current = playheadBeats; }, [playheadBeats]);
  useEffect(() => { visualModeRef.current = visualMode; }, [visualMode]);
  useEffect(() => { waveformRef.current = waveform; }, [waveform]);
  useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);
  useEffect(() => { activeFrequenciesRef.current = activeFrequencies; }, [activeFrequencies]);
  useEffect(() => { cutoffFreqRef.current = cutoffFreq; }, [cutoffFreq]);
  useEffect(() => { delayTimeRef.current = delayTime; }, [delayTime]);
  useEffect(() => { delayFeedbackRef.current = delayFeedback; }, [delayFeedback]);
  useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);

  // Safe file selection index
  const activeFile = loadedFiles[selectedIdx] || loadedFiles[0];

  useEffect(() => { activeFileRef.current = activeFile || null; }, [activeFile]);

  useEffect(() => {
    if (initialSelectedFileIdx !== null && initialSelectedFileIdx < loadedFiles.length) {
      setSelectedIdx(initialSelectedFileIdx);
    }
  }, [initialSelectedFileIdx, loadedFiles]);

  // Calculate detailed stats on file switch
  useEffect(() => {
    if (!activeFile || !activeFile.notes || activeFile.notes.length === 0) return;
    const metrics = computeJitterMetrics(activeFile.notes);
    setStatsSummary({
      maxDrift: metrics.maxDrift,
      stdDev: metrics.stdDev,
      jitter: metrics.jitter,
    });
  }, [activeFile]);

  // Handle manual selection
  const handleFileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedIdx(parseInt(e.target.value));
    setIsPlaying(false);
    setPlayheadBeats(0);
    triggeredNotesRef.current.clear();
  };

  // --- AUDIO SYNTHESIS ENGINE ---
  const initAudio = () => {
    if (audioContextRef.current) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      // Create Web Audio nodes
      const filterNode = audioCtx.createBiquadFilter();
      filterNode.type = "lowpass";
      filterNode.frequency.value = cutoffFreq;
      biquadFilterRef.current = filterNode;

      const mainGain = audioCtx.createGain();
      mainGain.gain.value = 0.4; // Keep volume gentle
      masterGainRef.current = mainGain;

      // Creative Stereo Delay Line
      const delayNode = audioCtx.createDelay(1.0);
      delayNode.delayTime.value = delayTime;
      delayNodeRef.current = delayNode;

      const delayFeedbackGain = audioCtx.createGain();
      delayFeedbackGain.gain.value = delayFeedback;
      delayGainRef.current = delayFeedbackGain;

      // Routing
      // Filter -> MasterGain -> Destination
      filterNode.connect(mainGain);
      mainGain.connect(audioCtx.destination);

      // Delay route (MasterGain -> Delay -> FeedbackGain -> Delay)
      mainGain.connect(delayNode);
      delayNode.connect(delayFeedbackGain);
      delayFeedbackGain.connect(delayNode);
      // Connect delay back to output with slight reduction
      delayNode.connect(audioCtx.destination);
    } catch (err) {
      console.error("Web Audio API konnte nicht initialisiert werden:", err);
    }
  };

  // Update audio node parameters dynamically
  useEffect(() => {
    if (biquadFilterRef.current) {
      biquadFilterRef.current.frequency.setValueAtTime(cutoffFreq, audioContextRef.current?.currentTime || 0);
    }
  }, [cutoffFreq]);

  useEffect(() => {
    if (delayNodeRef.current) {
      delayNodeRef.current.delayTime.setValueAtTime(delayTime, audioContextRef.current?.currentTime || 0);
    }
  }, [delayTime]);

  useEffect(() => {
    if (delayGainRef.current) {
      delayGainRef.current.gain.setValueAtTime(delayFeedback, audioContextRef.current?.currentTime || 0);
    }
  }, [delayFeedback]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Convert MIDI note number to frequency (Hz)
  const midiToFreq = (key: number): number => {
    return 440 * Math.pow(2, (key - 69) / 12);
  };

  // Trigger synth note with ADS Envelope
  const triggerSynthNote = (note: MidiNote) => {
    if (!audioContextRef.current || !biquadFilterRef.current) return;

    const ctx = audioContextRef.current;
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const now = ctx.currentTime;
    const freq = midiToFreq(note.key);

    // Dynamic ID for visualization tracking
    const activeNoteId = `${note.id}-${now}`;
    setActiveFrequencies(prev => {
      const next = [...prev.slice(-9), { freq, velocity: note.velocity, id: activeNoteId }];
      activeFrequenciesRef.current = next;
      return next;
    });
    setTimeout(() => {
      setActiveFrequencies(prev => {
        const next = prev.filter(p => p.id !== activeNoteId);
        activeFrequenciesRef.current = next;
        return next;
      });
    }, 400);

    // Create Oscillator
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = waveformRef.current;
    osc.frequency.setValueAtTime(freq, now);

    // Apply ADS (Attack-Decay-Sustain) volume envelope
    const velocityScale = note.velocity / 127;
    const peakGain = 0.3 * velocityScale;
    
    gainNode.gain.setValueAtTime(0, now);
    // Attack
    gainNode.gain.linearRampToValueAtTime(peakGain, now + 0.02);
    // Decay to sustain level
    gainNode.gain.exponentialRampToValueAtTime(peakGain * 0.4, now + 0.15);

    // Connect to filter
    osc.connect(gainNode);
    gainNode.connect(biquadFilterRef.current);

    osc.start(now);
    
    // Release note after duration (scaled by BPM)
    const tempo = activeFileRef.current?.tempo || 120;
    const beatsPerSec = tempo / 60;
    const noteDurationSecs = Math.max(0.1, note.duration / beatsPerSec);

    // Dynamic release ramp
    gainNode.gain.setValueAtTime(peakGain * 0.4, now + noteDurationSecs - 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + noteDurationSecs + 0.15);
    
    osc.stop(now + noteDurationSecs + 0.2);
  };

  // Play / Pause toggler
  const handlePlayToggle = () => {
    initAudio();
    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
    }
    setIsPlaying(!isPlaying);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setPlayheadBeats(0);
    playheadRef.current = 0;
    if (playheadSpanRef.current) {
      playheadSpanRef.current.textContent = "0.00 Beats";
    }
    triggeredNotesRef.current.clear();
  };

  // --- GENERATIVE CANVAS PARTICLE ENGINE ---
  interface VisualParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    color: string;
    alpha: number;
    life: number;
    maxLife: number;
  }

  const particlesRef = useRef<VisualParticle[]>([]);

  const createSparkExplosion = (x: number, y: number, driftMs: number, velocity: number) => {
    const numParticles = Math.floor(10 + (velocity / 12));
    let color = "#10b981"; // tight
    if (Math.abs(driftMs) > 25) {
      color = "#f43f5e"; // high drift / loose
    } else if (Math.abs(driftMs) > 10) {
      color = "#3b82f6"; // medium / human groove
    }

    for (let i = 0; i < numParticles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5, // slightly upward buoyancy
        radius: 1 + Math.random() * 3,
        color,
        alpha: 1.0,
        life: 0,
        maxLife: 30 + Math.floor(Math.random() * 30)
      });
    }
  };

  // Animation Loop inside requestAnimationFrame
  useEffect(() => {
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsInterval = lastTime;

    const render = (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animationFrameId.current = requestAnimationFrame(render);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animationFrameId.current = requestAnimationFrame(render);
        return;
      }

      // Calculate frame rate and time delta
      const deltaMs = time - lastTime;
      lastTime = time;
      const dt = deltaMs / 1000;

      // Handle FPS display counter
      frameCount++;
      if (time - fpsInterval >= 1000) {
        setCanvasFps(Math.round((frameCount * 1000) / (time - fpsInterval)));
        frameCount = 0;
        fpsInterval = time;
      }

      const currentIsPlaying = isPlayingRef.current;
      const currentActiveFile = activeFileRef.current;
      const currentPlayheadBeats = playheadRef.current;
      const currentPlaybackMode = playbackModeRef.current;
      const currentVisualMode = visualModeRef.current;
      const currentActiveFrequencies = activeFrequenciesRef.current;

      // Update playhead sequencer if playing
      if (currentIsPlaying && currentActiveFile) {
        const bpm = currentActiveFile.tempo || 120;
        const beatsPerSecond = (bpm / 60) * playbackSpeedRef.current;
        let newPlayhead = currentPlayheadBeats + (dt * beatsPerSecond);
        
        // Loop range: 16 beats loop window
        const loopWindowBeats = 16;
        
        if (newPlayhead >= loopWindowBeats) {
          newPlayhead = newPlayhead % loopWindowBeats;
          triggeredNotesRef.current.clear(); // Reset trigger checklist
        }

        // MIDI trigger look-ahead window
        // Scan notes inside activeFile that fit our beat window
        if (currentActiveFile.notes) {
          currentActiveFile.notes.forEach((note) => {
            // Map original notes to the 16 beats loop visual window
            const noteBeatInWindow = note.time % loopWindowBeats;
            
            // Check playhead trigger overlap
            let shouldTrigger = false;
            if (currentPlaybackMode === "grid") {
              const perfectGridBeat = note.nearestGrid % loopWindowBeats;
              shouldTrigger = 
                perfectGridBeat >= currentPlayheadBeats && 
                perfectGridBeat < newPlayhead && 
                !triggeredNotesRef.current.has(note.id);
            } else {
              // Human live trigger including drift
              // Drift beats: gridOffsetMs / 1000 * beatsPerSecond
              const driftBeats = (note.gridOffsetMs / 1000) * beatsPerSecond;
              const humanBeatInWindow = (noteBeatInWindow + driftBeats + loopWindowBeats) % loopWindowBeats;
              shouldTrigger = 
                humanBeatInWindow >= currentPlayheadBeats && 
                humanBeatInWindow < newPlayhead && 
                !triggeredNotesRef.current.has(note.id);
            }

            if (shouldTrigger) {
              triggeredNotesRef.current.add(note.id);
              triggerSynthNote(note);

              // Spark explosion positioning triggers inside active visualization coordinate maps
              // Coordinates calculated inside the view state loops
            }
          });
        }

        playheadRef.current = newPlayhead;
        if (playheadSpanRef.current) {
          playheadSpanRef.current.textContent = `${newPlayhead.toFixed(2)} Beats`;
        }
      }

      // --- CANVAS BACKGROUND & DECORATIVE GRID ---
      // Premium futuristic space / dark cockpit style
      ctx.fillStyle = "#090d16"; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Web Audio reactive ambient spectrum pulse
      if (currentActiveFrequencies.length > 0) {
        const totalEnergy = currentActiveFrequencies.reduce((sum, item) => sum + item.velocity, 0);
        const radiusGlow = 10 + (totalEnergy / 10);
        const grad = ctx.createRadialGradient(
          canvas.width / 2, 
          canvas.height / 2, 
          0, 
          canvas.width / 2, 
          canvas.height / 2, 
          radiusGlow * 3
        );
        grad.addColorStop(0, "rgba(99, 102, 241, 0.08)");
        grad.addColorStop(1, "rgba(99, 102, 241, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Drawing geometric grid accents
      ctx.strokeStyle = "rgba(30, 41, 59, 0.35)";
      ctx.lineWidth = 1;
      const gridGap = 40;
      for (let x = 0; x < canvas.width; x += gridGap) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridGap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // --- DRAW VISUALIZERS ---
      if (currentActiveFile && currentActiveFile.notes && currentActiveFile.notes.length > 0) {
        const notes = currentActiveFile.notes;
        const loopWindowBeats = 16;

        if (currentVisualMode === "orbit") {
          // --- VIEW 1: COSMIC ORBIT PLANETARY RING ---
          // Circular clock representing the 16-beat sequencer loop.
          // Center core
          const cx = canvas.width / 2;
          const cy = canvas.height / 2;
          const baseRadius = Math.min(canvas.width, canvas.height) * 0.32;

          // Draw baseline circular orbit
          ctx.strokeStyle = "rgba(71, 85, 105, 0.4)";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 10]);
          ctx.beginPath();
          ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw ticks for the 16 beats (bars)
          for (let b = 0; b < loopWindowBeats; b++) {
            const tickAngle = (b / loopWindowBeats) * Math.PI * 2 - Math.PI / 2;
            const isBarStart = b % 4 === 0;
            const startR = baseRadius - (isBarStart ? 12 : 6);
            const endR = baseRadius + (isBarStart ? 12 : 6);

            ctx.strokeStyle = isBarStart ? "rgba(99, 102, 241, 0.7)" : "rgba(148, 163, 184, 0.3)";
            ctx.lineWidth = isBarStart ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(tickAngle) * startR, cy + Math.sin(tickAngle) * startR);
            ctx.lineTo(cx + Math.cos(tickAngle) * endR, cy + Math.sin(tickAngle) * endR);
            ctx.stroke();

            if (isBarStart) {
              ctx.fillStyle = "rgba(99, 102, 241, 0.9)";
              ctx.font = "bold 9px monospace";
              ctx.fillText(`T${(b / 4) + 1}`, cx + Math.cos(tickAngle) * (endR + 14) - 8, cy + Math.sin(tickAngle) * (endR + 14) + 3);
            }
          }

          // Draw the sweeping playhead line
          const playheadAngle = (currentPlayheadBeats / loopWindowBeats) * Math.PI * 2 - Math.PI / 2;
          const playheadX = cx + Math.cos(playheadAngle) * (baseRadius + 25);
          const playheadY = cy + Math.sin(playheadAngle) * (baseRadius + 25);

          ctx.strokeStyle = "#818cf8";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(playheadX, playheadY);
          ctx.stroke();

          // Glowing point at playhead tip
          ctx.fillStyle = "#a5b4fc";
          ctx.shadowBlur = 15;
          ctx.shadowColor = "#818cf8";
          ctx.beginPath();
          ctx.arc(playheadX, playheadY, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0; // reset glow

          // Draw Midi Notes orbiting
          notes.forEach((note) => {
            const beatInWindow = note.time % loopWindowBeats;
            const angle = (beatInWindow / loopWindowBeats) * Math.PI * 2 - Math.PI / 2;
            
            // TIMING DRIFT determines the radial shift (deviation from circular perfect baseline)
            // Perfect baseline is baseRadius. We shift it outwards/inwards based on gridOffsetMs!
            // Scale: 1ms = 1px shift (max offset is around 50ms = 50px shift)
            const driftMs = note.gridOffsetMs;
            const shiftedRadius = baseRadius + (driftMs * 1.5); // Amplified for beautiful visibility!

            const noteX = cx + Math.cos(angle) * shiftedRadius;
            const noteY = cy + Math.sin(angle) * shiftedRadius;

            // Note velocity controls size
            const size = 3 + (note.velocity / 30);
            
            // Note accuracy color mapping
            let color = "rgba(16, 185, 129, 0.8)"; // tight: Green
            let glow = "#10b981";
            if (Math.abs(driftMs) > 25) {
              color = "rgba(244, 63, 94, 0.85)"; // drifty: Rose
              glow = "#f43f5e";
            } else if (Math.abs(driftMs) > 10) {
              color = "rgba(59, 130, 246, 0.85)"; // human: Blue
              glow = "#3b82f6";
            }

            // Draw line from perfect baseline to shifted real position (Micro-Timing Jitter Vector)
            ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * baseRadius, cy + Math.sin(angle) * baseRadius);
            ctx.lineTo(noteX, noteY);
            ctx.stroke();

            // Draw note core node
            ctx.fillStyle = color;
            ctx.shadowBlur = size * 1.8;
            ctx.shadowColor = glow;
            ctx.beginPath();
            ctx.arc(noteX, noteY, size, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0; // reset

            // Spark explosion trigger on real-time playback hit
            if (currentIsPlaying && triggeredNotesRef.current.has(note.id)) {
              const currentAngleInWindow = (currentPlayheadBeats / loopWindowBeats) * Math.PI * 2 - Math.PI / 2;
              const angleDifference = Math.abs(angle - currentAngleInWindow);
              // Trigger a small burst on playhead intersection
              if (angleDifference < 0.05 && Math.random() < 0.15) {
                createSparkExplosion(noteX, noteY, driftMs, note.velocity);
              }
            }
          });

          // Draw HUD overlay in the center of the orbit
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 13px monospace";
          ctx.textAlign = "center";
          ctx.fillText("COSMIC_ORBIT_ENGINE", cx, cy - 25);
          
          ctx.font = "9px monospace";
          ctx.fillStyle = "rgba(148, 163, 184, 0.85)";
          ctx.fillText(`DAW BPM: ${currentActiveFile.tempo}`, cx, cy - 10);
          ctx.fillText(`Active Notes: ${notes.length}`, cx, cy + 5);

          // Render active rating in center
          let accuracyRating = "HOCHPRÄZISE (TIGHT) 👍";
          let ratingCol = "#10b981";
          if (currentActiveFile.avgDriftMs > 18) {
            accuracyRating = "LOCKERER OFF-BEAT GROOVE 🎵";
            ratingCol = "#f43f5e";
          } else if (currentActiveFile.avgDriftMs > 9) {
            accuracyRating = "MENSCHLICHER MIKRO-GROOVE ✨";
            ratingCol = "#3b82f6";
          }
          ctx.fillStyle = ratingCol;
          ctx.font = "9px monospace";
          ctx.fillText(`Rating: ${accuracyRating}`, cx, cy + 22);

          ctx.font = "bold 12px monospace";
          ctx.fillStyle = "#818cf8";
          ctx.fillText(`SWING: ${currentActiveFile.swingFactor16th}%`, cx, cy + 38);

        } else if (currentVisualMode === "wave") {
          // --- VIEW 2: OSCILLOSCOPE MICRO-TIMING JITTER GRID ---
          // Horizontal timeline stream representing notes mapping timing drift vs grid beat.
          const paddingLeft = 50;
          const paddingRight = 50;
          const drawWidth = canvas.width - paddingLeft - paddingRight;
          const centerY = canvas.height / 2;
          const maxDriftScale = 45; // 45ms is maximum height scale

          // Draw the perfect time baseline grid line
          ctx.strokeStyle = "rgba(226, 232, 240, 0.18)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(paddingLeft, centerY);
          ctx.lineTo(paddingLeft + drawWidth, centerY);
          ctx.stroke();

          // Draw standard threshold limits (+-9ms machine tight limits)
          ctx.strokeStyle = "rgba(16, 185, 129, 0.18)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(paddingLeft, centerY - 9 * 3);
          ctx.lineTo(paddingLeft + drawWidth, centerY - 9 * 3);
          ctx.moveTo(paddingLeft, centerY + 9 * 3);
          ctx.lineTo(paddingLeft + drawWidth, centerY + 9 * 3);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(16, 185, 129, 0.4)";
          ctx.font = "8px monospace";
          ctx.fillText("Grid Perfect (+-9ms)", paddingLeft + 10, centerY - 9 * 3 - 4);

          // Swing Wave bend line representation (Generative visual based on swing factor)
          ctx.strokeStyle = "rgba(99, 102, 241, 0.22)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i <= 100; i++) {
            const x = paddingLeft + (i / 100) * drawWidth;
            // Swing factors pull the sine wave phase offsets
            const swingOffset = Math.sin((i / 100) * Math.PI * 4 + (currentActiveFile.swingFactor16th / 20)) * 25;
            if (i === 0) ctx.moveTo(x, centerY + swingOffset);
            else ctx.lineTo(x, centerY + swingOffset);
          }
          ctx.stroke();

          // Draw Playhead scrubber line
          const playheadX = paddingLeft + (currentPlayheadBeats / loopWindowBeats) * drawWidth;
          ctx.strokeStyle = "#818cf8";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(playheadX, 30);
          ctx.lineTo(playheadX, canvas.height - 30);
          ctx.stroke();

          // Draw note coordinates
          notes.forEach((note) => {
            const beatInWindow = note.time % loopWindowBeats;
            const noteX = paddingLeft + (beatInWindow / loopWindowBeats) * drawWidth;
            
            // Vertical position corresponds to Timing Drift (+ values are late, - values are early)
            const driftMs = note.gridOffsetMs;
            const noteY = centerY + (driftMs * 3); // Scaled coordinate height

            const size = 3.5 + (note.velocity / 30);

            let color = "rgba(16, 185, 129, 0.85)"; // Green tight
            let glow = "#10b981";
            if (Math.abs(driftMs) > 25) {
              color = "rgba(244, 63, 94, 0.9)"; // Rose drifty
              glow = "#f43f5e";
            } else if (Math.abs(driftMs) > 10) {
              color = "rgba(59, 130, 246, 0.9)"; // Blue human
              glow = "#3b82f6";
            }

            // Draw vector connection to baseline
            ctx.strokeStyle = "rgba(226, 232, 240, 0.1)";
            ctx.beginPath();
            ctx.moveTo(noteX, centerY);
            ctx.lineTo(noteX, noteY);
            ctx.stroke();

            // Note circle Node
            ctx.fillStyle = color;
            ctx.shadowBlur = size * 1.5;
            ctx.shadowColor = glow;
            ctx.beginPath();
            ctx.arc(noteX, noteY, size, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Trigger burst sparkles
            if (currentIsPlaying && triggeredNotesRef.current.has(note.id)) {
              const currentPlayheadX = paddingLeft + (currentPlayheadBeats / loopWindowBeats) * drawWidth;
              if (Math.abs(noteX - currentPlayheadX) < 4 && Math.random() < 0.2) {
                createSparkExplosion(noteX, noteY, driftMs, note.velocity);
              }
            }
          });

          // Text labels
          ctx.fillStyle = "#ffffff";
          ctx.font = "9px monospace";
          ctx.textAlign = "left";
          ctx.fillText("MICRO_TIMING_DRIFT (Y-Axis) vs SEQUENCER BEAT TIME (X-Axis)", paddingLeft, 22);

        } else if (currentVisualMode === "waterfall") {
          // --- VIEW 3: WATERFALL MIDI SPARKLER (Piano Roll cascade) ---
          // Top to bottom MIDI note track waterfall flow.
          const topMargin = 40;
          const botMargin = 50;
          const drawHeight = canvas.height - topMargin - botMargin;
          const keyMin = 36; // C1 Kick
          const keyMax = 84; // C5 Keys range
          const keyRange = keyMax - keyMin;

          // Drawing Horizontal keyboard keys grid
          ctx.fillStyle = "rgba(30, 41, 59, 0.25)";
          ctx.fillRect(0, canvas.height - botMargin, canvas.width, botMargin);

          // Render active sweep piano line representing trigger points
          ctx.strokeStyle = "rgba(129, 140, 248, 0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, canvas.height - botMargin);
          ctx.lineTo(canvas.width, canvas.height - botMargin);
          ctx.stroke();

          // Render note paths cascade
          notes.forEach((note) => {
            const beatInWindow = note.time % loopWindowBeats;
            
            // X coordinate corresponds to MIDI Key mapping
            const keyFactor = (note.key - keyMin) / keyRange;
            const noteX = 40 + keyFactor * (canvas.width - 80);

            // Playhead sweep triggers vertical scroll
            // Note's vertical distance from base trigger line
            const sweepDiff = (beatInWindow - currentPlayheadBeats + loopWindowBeats) % loopWindowBeats;
            const scrollPercent = 1.0 - (sweepDiff / loopWindowBeats);
            const noteY = topMargin + scrollPercent * drawHeight;

            const size = 3 + (note.velocity / 25);
            const driftMs = note.gridOffsetMs;

            let color = "rgba(16, 185, 129, 0.8)"; // tight
            let glow = "#10b981";
            if (Math.abs(driftMs) > 25) {
              color = "rgba(244, 63, 94, 0.85)"; // drifty
              glow = "#f43f5e";
            } else if (Math.abs(driftMs) > 10) {
              color = "rgba(59, 130, 246, 0.85)"; // human
              glow = "#3b82f6";
            }

            // Draw scrolling trace block
            ctx.fillStyle = color.replace("0.8", "0.15");
            ctx.fillRect(noteX - 2, noteY - 15, 4, 15);

            // Draw note core node
            ctx.fillStyle = color;
            ctx.shadowBlur = size * 1.5;
            ctx.shadowColor = glow;
            ctx.beginPath();
            ctx.arc(noteX, noteY, size, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Trigger burst when hit base key
            if (currentIsPlaying && triggeredNotesRef.current.has(note.id)) {
              if (Math.abs(noteY - (canvas.height - botMargin)) < 5 && Math.random() < 0.25) {
                createSparkExplosion(noteX, canvas.height - botMargin, driftMs, note.velocity);
              }
            }
          });

          // Print Keyboard baseline notes labels (C1, C2, C3, C4)
          ctx.fillStyle = "rgba(148, 163, 184, 0.65)";
          ctx.font = "8px monospace";
          const octaves = [
            { key: 36, label: "C1 (Kick)" },
            { key: 48, label: "C2 (Bass)" },
            { key: 60, label: "C3 (Mid)" },
            { key: 72, label: "C4 (Lead)" },
            { key: 84, label: "C5 (High)" }
          ];
          octaves.forEach((oct) => {
            const factor = (oct.key - keyMin) / keyRange;
            const x = 40 + factor * (canvas.width - 80);
            ctx.beginPath();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
            ctx.moveTo(x, topMargin);
            ctx.lineTo(x, canvas.height - botMargin);
            ctx.stroke();
            ctx.fillText(oct.label, x - 15, canvas.height - 20);
          });
        }
      }

      // --- RENDER SPARKS PARTICLE LIST ---
      particlesRef.current.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08; // gravity drift pull
        p.life++;
        p.alpha = 1.0 - (p.life / p.maxLife);

        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0; // reset

      // Filter dead particles
      particlesRef.current = particlesRef.current.filter(p => p.life < p.maxLife);

      animationFrameId.current = requestAnimationFrame(render);
    };

    animationFrameId.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, []);

  // Handle Resize of canvas to maintain responsive layout coordinates
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = Math.max(340, parent.clientHeight || 400);
      }
    };

    window.addEventListener("resize", handleResize);
    // Initial size trigger
    setTimeout(handleResize, 150);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="bg-slate-950 text-slate-100 rounded-xl border border-slate-800 shadow-2xl p-6 flex flex-col md:flex-row gap-6" id="creative-visualizer-card">
      
      {/* LEFT SECTION: HIGH TECH CONTROLLER AND SPECS SIDEBAR */}
      <div className="w-full md:w-80 space-y-6 flex flex-col shrink-0">
        
        {/* Header Block */}
        <div className="border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 text-white p-1.5 rounded text-xs font-mono font-bold animate-pulse">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black tracking-tight text-white uppercase font-mono flex items-center gap-1.5">
                MEDIEN_VISUALIZER_v2
              </h3>
              <p className="text-[10px] text-indigo-400 font-mono tracking-wider uppercase">
                WEB AUDIO & CANVAS ENGINE
              </p>
            </div>
          </div>
        </div>

        {/* Input Selector */}
        <div className="space-y-1.5 font-mono text-xs">
          <label className="text-slate-400 font-bold block uppercase tracking-wider text-[10px]">
            📁 Sitzung für Performance wählen:
          </label>
          <select
            value={selectedIdx}
            onChange={handleFileChange}
            className="w-full bg-slate-900 border border-slate-850 hover:border-indigo-500 rounded px-3 py-2 text-xs text-white focus:outline-none transition-colors"
          >
            {loadedFiles.map((file, idx) => (
              <option key={idx} value={idx}>
                #{idx + 1} // {file.fileName} ({file.tempo} BPM)
              </option>
            ))}
          </select>
        </div>

        {/* Synth Options Panel */}
        <div className="bg-slate-900/80 border border-slate-850 rounded p-4 space-y-4">
          <div className="flex items-center gap-1.5 border-b border-slate-850 pb-2 text-indigo-400 font-mono text-[10px] font-bold uppercase tracking-widest">
            <Sliders className="w-3.5 h-3.5" />
            <span>Audio & Synthesizer</span>
          </div>

          {/* Waveform Selector */}
          <div className="space-y-1.5 text-[11px] font-mono">
            <span className="text-slate-400 block font-semibold uppercase text-[9px] tracking-wider">Oszillator-Wellenform:</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(["triangle", "sine", "sawtooth", "square"] as OscillatorType[]).map((wave) => (
                <button
                  key={wave}
                  onClick={() => setWaveform(wave)}
                  className={`py-1 px-2 text-[10px] font-bold rounded capitalize border transition-all ${waveform === wave ? "bg-indigo-600/30 text-indigo-300 border-indigo-500" : "bg-slate-950 text-slate-400 border-slate-850 hover:text-white"}`}
                >
                  {wave}
                </button>
              ))}
            </div>
          </div>

          {/* Playback Mode (Quantized vs. Human timing) */}
          <div className="space-y-1.5 text-[11px] font-mono">
            <span className="text-slate-400 block font-semibold uppercase text-[9px] tracking-wider">Wiedergabe-Modus (Timing-Drift):</span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setPlaybackMode("human")}
                className={`py-1 px-1.5 text-[10px] font-bold rounded border transition-all flex items-center justify-center gap-1 ${playbackMode === "human" ? "bg-amber-600/30 text-amber-300 border-amber-500" : "bg-slate-950 text-slate-400 border-slate-850 hover:text-white"}`}
              >
                <Zap className="w-3 h-3" />
                <span>Menschlich (Drift)</span>
              </button>
              <button
                onClick={() => setPlaybackMode("grid")}
                className={`py-1 px-1.5 text-[10px] font-bold rounded border transition-all flex items-center justify-center gap-1 ${playbackMode === "grid" ? "bg-emerald-600/30 text-emerald-300 border-emerald-500" : "bg-slate-950 text-slate-400 border-slate-850 hover:text-white"}`}
              >
                <Cpu className="w-3 h-3" />
                <span>Perfektes Grid</span>
              </button>
            </div>
            <p className="text-[9px] text-slate-500 leading-normal pt-1 font-sans">
              * Schalten Sie um, um den echten Timing-Drift im Vergleich zu absolut präziser Maschinen-Wiedergabe akustisch zu hören!
            </p>
          </div>

          {/* Playback Speed */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
              <span>Geschwindigkeit:</span>
              <span className="text-white font-black">{playbackSpeed.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="3.0"
              step="0.1"
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              className="w-full accent-indigo-500 h-1 bg-slate-950 rounded cursor-pointer"
            />
            <div className="flex justify-between text-[8px] text-slate-600">
              <span>0.1x</span>
              <span>1.0x</span>
              <span>3.0x</span>
            </div>
          </div>

          {/* Synth Sliders */}
          <div className="space-y-3 pt-1">
            {/* Cutoff Filter */}
            <div className="space-y-1">
              <div className="flex justify-between text-[9px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
                <span>Resonanz-Filter:</span>
                <span className="text-white font-black">{cutoffFreq} Hz</span>
              </div>
              <input
                type="range"
                min="150"
                max="8000"
                step="50"
                value={cutoffFreq}
                onChange={(e) => setCutoffFreq(parseInt(e.target.value))}
                className="w-full accent-indigo-500 h-1 bg-slate-950 rounded cursor-pointer"
              />
            </div>

            {/* Delay Time */}
            <div className="space-y-1">
              <div className="flex justify-between text-[9px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
                <span>Delay Feedbackzeit:</span>
                <span className="text-white font-black">{delayTime.toFixed(2)}s</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.8"
                step="0.05"
                value={delayTime}
                onChange={(e) => setDelayTime(parseFloat(e.target.value))}
                className="w-full accent-indigo-500 h-1 bg-slate-950 rounded cursor-pointer"
              />
            </div>

            {/* Delay Feedback level */}
            <div className="space-y-1">
              <div className="flex justify-between text-[9px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
                <span>Delay Feedbackstärke:</span>
                <span className="text-white font-black">{Math.round(delayFeedback * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="0.75"
                step="0.05"
                value={delayFeedback}
                onChange={(e) => setDelayFeedback(parseFloat(e.target.value))}
                className="w-full accent-indigo-500 h-1 bg-slate-950 rounded cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Detailed Media Tech KPI Specs */}
        <div className="bg-slate-900/50 border border-slate-850 rounded p-4 font-mono text-[10px] space-y-2.5">
          <div className="text-indigo-400 font-bold uppercase tracking-widest text-[9px] flex items-center gap-1 pb-1 border-b border-slate-850">
            <Radio className="w-3.5 h-3.5" />
            <span>Kriterien Medientechnik</span>
          </div>

          <div className="flex justify-between">
            <span className="text-slate-400">Audio-Latenz:</span>
            <span className="text-white font-bold">~0.02s (Web Audio Buffer)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Jitter-Varianz:</span>
            <span className="text-amber-400 font-bold">{statsSummary.jitter.toFixed(2)} ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Standardabweichung:</span>
            <span className="text-indigo-300 font-bold">{statsSummary.stdDev.toFixed(2)} ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Max. Abweichung:</span>
            <span className="text-rose-400 font-bold">{statsSummary.maxDrift.toFixed(1)} ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Phasen-Swing:</span>
            <span className="text-emerald-400 font-bold">{activeFile.swingFactor16th}%</span>
          </div>
        </div>

      </div>

      {/* RIGHT SECTION: MAIN INTERACTIVE GENERATIVE CANVAS PANEL */}
      <div className="flex-1 flex flex-col gap-4 relative min-h-[420px]">
        
        {/* Canvas Controller Header bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 px-4 py-2.5 rounded-lg border border-slate-850">
          
          {/* Main Action Controllers */}
          <div className="flex items-center gap-2 font-mono">
            <button
              onClick={handlePlayToggle}
              className={`py-2 px-4 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm ${isPlaying ? "bg-amber-600 text-white hover:bg-amber-500" : "bg-indigo-600 text-white hover:bg-indigo-500 animate-pulse"}`}
              id="btn-play-synth"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isPlaying ? "PAUSIEREN" : "LIVE-SEQUENCER SYNTH STARTEN"}</span>
            </button>

            <button
              onClick={handleReset}
              className="bg-slate-800 text-slate-300 hover:text-white py-2 px-3 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1 border border-slate-750"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>ZURÜCKSETZEN</span>
            </button>
          </div>

          {/* Visual Mode Tabs */}
          <div className="flex bg-slate-950 p-1 rounded border border-slate-850 font-mono text-[10px]">
            <button
              onClick={() => setVisualMode("orbit")}
              className={`px-3 py-1.5 rounded transition-all cursor-pointer ${visualMode === "orbit" ? "bg-indigo-600/30 text-white border border-indigo-500 font-bold" : "text-slate-400 hover:text-slate-200"}`}
            >
              🪐 Cosmic Orbit
            </button>
            <button
              onClick={() => setVisualMode("wave")}
              className={`px-3 py-1.5 rounded transition-all cursor-pointer ${visualMode === "wave" ? "bg-indigo-600/30 text-white border border-indigo-500 font-bold" : "text-slate-400 hover:text-slate-200"}`}
            >
              〰️ Oscilloscope Jitter
            </button>
            <button
              onClick={() => setVisualMode("waterfall")}
              className={`px-3 py-1.5 rounded transition-all cursor-pointer ${visualMode === "waterfall" ? "bg-indigo-600/30 text-white border border-indigo-500 font-bold" : "text-slate-400 hover:text-slate-200"}`}
            >
              🌧️ MIDI Cascade
            </button>
          </div>

        </div>

        {/* Visualizer Canvas box container */}
        <div className="flex-grow bg-slate-950 rounded-lg border border-slate-850 overflow-hidden relative flex flex-col items-stretch">
          
          <canvas
            ref={canvasRef}
            className="w-full h-full block cursor-crosshair min-h-[380px]"
            id="creative-media-canvas"
          />

          {/* Small FPS, Trigger Indicators on canvas bottom overlay */}
          <div className="absolute bottom-3 left-4 right-4 flex justify-between items-center text-[9px] font-mono text-slate-500 pointer-events-none">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              RENDER_ENGINE: <span className="text-slate-300 font-bold">{canvasFps} FPS</span>
            </span>
            <span className="text-right">
              PLAYHEAD: <span ref={playheadSpanRef} className="text-white font-bold">0.00 Beats</span> // LOOP_WINDOW: 16 BEATS
            </span>
          </div>

        </div>

        {/* Explanatory Educational Box for Master Application */}
        <div className="bg-slate-900 border border-slate-850 rounded-lg p-4 font-mono text-xs text-slate-400 leading-relaxed space-y-2">
          <div className="flex items-center gap-1.5 text-white font-bold uppercase tracking-wide text-[10px]">
            <Info className="w-4 h-4 text-indigo-400" />
            <span>Medientechnische Erläuterung (Master Thesis Relevanz)</span>
          </div>
          <p className="text-[11px] text-slate-300">
            Diese interaktive Komponente nutzt die <strong>Web Audio API</strong> zur Synthese der aus der Ableton XML decodierten MIDI-Notenwerte in Echtzeit. 
            Durch die Gegenüberstellung von <strong>Perfektem DAW-Grid</strong> und <strong>Menschlicher Live-Performance</strong> können Sie 
            den zeitlichen Timing-Drift (Microtiming) nicht nur numerisch analysieren, sondern <strong>akustisch hören</strong> und <strong>visuell erleben</strong>.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1.5 text-[10px]">
            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-850">
              <strong className="text-indigo-300 block mb-0.5">🪐 Cosmic Orbit</strong>
              Stellt die Drift als Abstand von der Kreisbahn dar. Ein perfektes Grid bildet einen exakten Kreis; Jitter wird als chaotische Kreisbahnabweichung sichtbar.
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-850">
              <strong className="text-amber-300 block mb-0.5">〰️ Oscilloscope Jitter</strong>
              Zeigt die Drift als Amplitudenausschlag auf einer horizontalen Zeitachse im Stil eines Oszilloskops. Ideal für die Analyse von Phasenschwankungen.
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-850">
              <strong className="text-emerald-300 block mb-0.5">🌧️ MIDI Cascade</strong>
              Ein dynamischer Piano-Roll-Wasserfall, bei dem die Noten passend zu ihrer MIDI-Tonhöhe herabregnen und beim Aufprall Audio-synchrone Lichtfunken erzeugen.
            </div>
          </div>
        </div>

        {/* --- DYNAMIC MEDIENTECHNIK ANALYTICS PANEL --- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
          
          {/* Section 1: Fourier Sliding Tempo Graph */}
          <div className="bg-slate-900 border border-slate-850 rounded-lg p-5 flex flex-col justify-between" id="visualizer-fourier-tempo-card">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-slate-400 font-bold tracking-widest uppercase font-mono flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-pink-500" />
                  ⚡ GLEITENDES TEMPO (FOURIER-TRANSFORMATION)
                </span>
                <span className="text-[9px] bg-pink-500/10 border border-pink-500/20 text-pink-400 font-mono px-2 py-0.5 rounded uppercase font-bold">
                  Comb Filter DFT
                </span>
              </div>
              <p className="text-[11px] text-slate-400 italic font-serif leading-relaxed mb-4">
                Wir teilen die Performance in Onset-Fenster und bestimmen über ein harmonisches Fourier-Dichte-Spektrum das exakte, gleitende Spieltempo (BPM) der Abschnitte. Perfekt zum Aufdecken von bewussten Beschleunigungen (Rubato).
              </p>
            </div>

            {/* Custom SVG Sparkline Graph */}
            <div className="bg-slate-950 rounded border border-slate-850 p-3 h-36 flex flex-col justify-between relative overflow-hidden">
              {(() => {
                const slidingPoints = activeFile.slidingTempo || [];
                const bpms = slidingPoints.map(p => p.bpm);
                if (bpms.length === 0) {
                  return <div className="text-slate-500 text-xs font-mono text-center m-auto">Warte auf Signal-Input...</div>;
                }
                const minB = Math.max(50, bpms.reduce((a, b) => Math.min(a, b), Infinity) - 4);
                const maxB = Math.min(200, bpms.reduce((a, b) => Math.max(a, b), -Infinity) + 4);
                const diffB = maxB - minB || 10;
                
                const w = 450;
                const h = 100;
                const pad = 12;
                
                const pts = slidingPoints.map((p, i) => {
                  const x = pad + (i / (slidingPoints.length - 1 || 1)) * (w - 2 * pad);
                  const y = h - pad - ((p.bpm - minB) / diffB) * (h - 2 * pad);
                  return { x, y, ...p };
                });
                
                const dPath = pts.length > 1 
                  ? `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
                  : `M ${pad} ${h/2} L ${w-pad} ${h/2}`;

                return (
                  <>
                    <svg className="w-full h-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="fourierGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ec4899" stopOpacity={0.15} />
                          <stop offset="100%" stopColor="#ec4899" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      
                      {/* Gridlines */}
                      <line x1={pad} y1={pad} x2={w-pad} y2={pad} stroke="#1e293b" strokeDasharray="3 3" />
                      <line x1={pad} y1={h-pad} x2={w-pad} y2={h-pad} stroke="#1e293b" strokeDasharray="3 3" />
                      
                      {/* Area Fill */}
                      {pts.length > 1 && (
                        <path
                          d={`${dPath} L ${pts[pts.length-1].x} ${h-pad} L ${pts[0].x} ${h-pad} Z`}
                          fill="url(#fourierGradient)"
                        />
                      )}
                      
                      {/* Stroke */}
                      <path
                        d={dPath}
                        fill="none"
                        stroke="#ec4899"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      
                      {/* Peak Dots */}
                      {pts.map((p, i) => (
                        <circle
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r="3"
                          fill="#ffffff"
                          stroke="#ec4899"
                          strokeWidth="1.5"
                        />
                      ))}
                    </svg>
                    
                    {/* Y-Axis Label overlays */}
                    <div className="absolute top-2 left-2 text-[8px] font-mono text-pink-400 font-bold bg-slate-900/80 px-1 py-0.5 rounded">
                      MAX: {maxB.toFixed(0)} BPM
                    </div>
                    <div className="absolute bottom-2 left-2 text-[8px] font-mono text-slate-500 bg-slate-900/80 px-1 py-0.5 rounded">
                      MIN: {minB.toFixed(0)} BPM
                    </div>
                    <div className="absolute top-2 right-2 text-[8px] font-mono text-slate-400">
                      Zentrum-Puls: <span className="text-white font-bold">{activeFile.tempo} BPM</span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Section 2: Sustain Pedal (CC 64) Legato Timeline */}
          <div className="bg-slate-900 border border-slate-850 rounded-lg p-5 flex flex-col justify-between" id="visualizer-sustain-pedal-card">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-slate-400 font-bold tracking-widest uppercase font-mono flex items-center gap-1.5">
                  <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
                  👣 SUSTAIN-PEDAL NUTZUNG & TIMING (CC 64)
                </span>
                <span className="text-[9px] bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-mono px-2 py-0.5 rounded uppercase font-bold">
                  Legato-Pedal
                </span>
              </div>
              <p className="text-[11px] text-slate-400 italic font-serif leading-relaxed mb-4">
                Misst die Fußkoordination des Klavierspielers beim Lösen und Treten des Haltepedals direkt nach Akkordwechseln. Perfektes Timing vermeidet sowohl Löcher als auch verwaschene, matschige Klänge.
              </p>
            </div>

            {/* Custom SVG Pedal Square Wave Timeline */}
            <div className="bg-slate-950 rounded border border-slate-850 p-3 h-36 flex flex-col justify-between relative overflow-hidden">
              {(() => {
                const analysis = activeFile.pedalAnalysis;
                const pedalEvts = analysis?.pedalEvents || [];
                if (pedalEvts.length === 0) {
                  return <div className="text-slate-500 text-xs font-mono text-center m-auto">Keine CC-Events detektiert.</div>;
                }
                
                const w = 450;
                const h = 100;
                const pad = 12;
                
                // Show the first 12 beats
                const limitBeats = 12;
                const stepX = (w - 2 * pad) / limitBeats;
                
                // Draw square wave path
                let pedalPath = `M ${pad} ${h - pad - 10}`; // start low
                let lastPedalVal = 0;
                
                pedalEvts.filter(p => p.time <= limitBeats).forEach(p => {
                  const x = pad + (p.time / limitBeats) * (w - 2 * pad);
                  const y = p.value > 0 ? pad + 20 : h - pad - 10;
                  
                  // Horizontal step then vertical transition to avoid slope (perfect square wave!)
                  pedalPath += ` L ${x} ${lastPedalVal > 0 ? pad + 20 : h - pad - 10}`;
                  pedalPath += ` L ${x} ${y}`;
                  lastPedalVal = p.value;
                });
                // Line to end of graph
                pedalPath += ` L ${w - pad} ${lastPedalVal > 0 ? pad + 20 : h - pad - 10}`;

                // Filter notes in first 12 beats to show as blocks above the pedal wave
                const firstNotes = (activeFile.notes || [])
                  .filter(n => n.time < limitBeats)
                  .slice(0, 10);

                return (
                  <>
                    <svg className="w-full h-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
                      {/* Beat vertical divisions */}
                      {Array.from({ length: limitBeats + 1 }).map((_, b) => {
                        const bx = pad + b * stepX;
                        return (
                          <g key={b}>
                            <line x1={bx} y1={pad} x2={bx} y2={h-pad} stroke="#1e293b" strokeWidth="1" strokeDasharray="2 2" />
                            {b % 4 === 0 && (
                              <text x={bx + 3} y={h - 2} fill="#475569" fontSize="6" fontFamily="monospace">Takt {Math.floor(b/4) + 1}</text>
                            )}
                          </g>
                        );
                      })}

                      {/* Render note blocks above */}
                      {firstNotes.map((note, idx) => {
                        const nx = pad + (note.time / limitBeats) * (w - 2 * pad);
                        const nWidth = Math.max(8, (note.duration / limitBeats) * (w - 2 * pad));
                        const ny = pad + 5 + (idx % 3) * 6; // stagger vertically
                        return (
                          <rect
                            key={idx}
                            x={nx}
                            y={ny}
                            width={nWidth}
                            height="4"
                            rx="1"
                            fill="#f59e0b"
                            opacity="0.85"
                          />
                        );
                      })}
                      
                      {/* Pedal Waveform Fill */}
                      <path
                        d={`${pedalPath} L ${w-pad} ${h-pad} L ${pad} ${h-pad} Z`}
                        fill="rgba(6, 182, 212, 0.08)"
                      />

                      {/* Pedal Square Wave Line */}
                      <path
                        d={pedalPath}
                        fill="none"
                        stroke="#06b6d4"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    
                    {/* Overlay telemetry metrics */}
                    <div className="absolute top-2 left-2 text-[8px] font-mono text-cyan-400 font-bold bg-slate-900/80 px-1 py-0.5 rounded">
                      PEDAL: gedrückt (CC64=127)
                    </div>
                    <div className="absolute bottom-2 left-2 text-[8px] font-mono text-slate-500 bg-slate-900/80 px-1 py-0.5 rounded">
                      PEDAL: gelöst (CC64=0)
                    </div>
                    <div className="absolute top-2 right-2 text-[8px] font-mono text-slate-300 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">
                      Score: <span className="text-cyan-400 font-extrabold">{analysis?.accuracyScore || 0}%</span> ({analysis?.errorClassification})
                    </div>
                    <div className="absolute bottom-2 right-2 text-[8px] font-mono text-slate-400">
                      Wechsel-Verzögerung: <span className="text-white font-bold">{analysis?.avgDelayMs || 0} ms</span> (Optimum: 70ms)
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};

