/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Volume2, Play, Pause, Loader2, FastForward, Sparkles } from 'lucide-react';

interface DispatchAudioPlayerProps {
  title: string;
  excerpt?: string;
  content?: string;
}

export const DispatchAudioPlayer: React.FC<DispatchAudioPlayerProps> = ({
  title,
  excerpt,
  content,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [voice, setVoice] = useState<'Kore' | 'Puck' | 'Zephyr'>('Kore');
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleGenerateAndPlay = async () => {
    if (audioUrl && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    setLoading(true);
    setErrorMessage('');

    // Prepare text for speech narration
    const textToSynthesize = `Dispatch Title: ${title}. ${excerpt || ''} ${
      content ? content.replace(/<[^>]+>/g, '').slice(0, 800) : ''
    }`;

    try {
      const res = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSynthesize,
          voice,
        }),
      });

      const data = await res.json();
      if (res.ok && data.audio) {
        const audioSrc = `data:${data.mimeType || 'audio/wav'};base64,${data.audio}`;
        setAudioUrl(audioSrc);

        const newAudio = new Audio(audioSrc);
        audioRef.current = newAudio;
        newAudio.playbackRate = playbackRate;

        newAudio.onloadedmetadata = () => {
          setDuration(newAudio.duration || 0);
        };

        newAudio.ontimeupdate = () => {
          setCurrentTime(newAudio.currentTime || 0);
        };

        newAudio.onended = () => {
          setIsPlaying(false);
          setCurrentTime(0);
        };

        await newAudio.play();
        setIsPlaying(true);
      } else {
        setErrorMessage(data.error || 'Audio narration generation failed');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error communicating with audio synthesis service');
    } finally {
      setLoading(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackRate(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="bg-stone-900 text-stone-100 rounded-2xl p-4 sm:p-5 shadow-lg border border-stone-800 space-y-3 font-sans my-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="bg-red-700 p-2.5 rounded-xl text-white shadow-xs">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-xs uppercase tracking-wider text-red-400">
                AI Audio Dispatch Narration
              </span>
              <span className="bg-stone-800 text-stone-300 text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center space-x-1">
                <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                <span>Gemini 3.8 TTS</span>
              </span>
            </div>
            <p className="text-xs text-stone-300 font-medium">
              Listen to full journalistic audio report
            </p>
          </div>
        </div>

        {/* Audio Controls & Voice Selector */}
        <div className="flex items-center space-x-2">
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value as any)}
            disabled={loading || isPlaying}
            className="bg-stone-800 text-stone-200 border border-stone-700 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-red-500"
          >
            <option value="Kore">Voice: Kore (Anchor)</option>
            <option value="Puck">Voice: Puck (Baritone)</option>
            <option value="Zephyr">Voice: Zephyr (Crisp)</option>
          </select>

          <button
            onClick={handleGenerateAndPlay}
            disabled={loading}
            className="bg-red-700 hover:bg-red-600 text-white font-semibold text-xs px-4 py-2 rounded-xl flex items-center space-x-2 transition-all shadow-xs"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                <span>Synthesizing...</span>
              </>
            ) : isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play Audio</span>
              </>
            )}
          </button>
        </div>
      </div>

      {errorMessage && (
        <p className="text-xs text-red-400 font-medium bg-red-950/50 p-2 rounded-lg border border-red-900/50">
          {errorMessage}
        </p>
      )}

      {/* Progress Scrubber Bar */}
      {audioUrl && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center space-x-3">
            <span className="text-[10px] font-mono text-stone-400 min-w-[32px]">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-red-600"
            />
            <span className="text-[10px] font-mono text-stone-400 min-w-[32px]">
              {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] text-stone-400 pt-1">
            <div className="flex items-center space-x-1.5">
              <FastForward className="w-3 h-3 text-stone-500" />
              <span>Speed:</span>
              {[0.8, 1, 1.25, 1.5].map((speed) => (
                <button
                  key={speed}
                  onClick={() => handleSpeedChange(speed)}
                  className={`px-2 py-0.5 rounded-md font-mono text-[10px] transition-colors ${
                    playbackRate === speed
                      ? 'bg-stone-700 text-white font-bold'
                      : 'hover:text-stone-200'
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>

            <span className="italic text-[10px] text-stone-500">
              Clear, natural 24kHz audio synthesis
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
