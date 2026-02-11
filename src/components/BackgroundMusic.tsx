'use client';

// ============================================================
// Background Music Component - MP3 Player
// Plays moltlets-town-music.mp3 on loop
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';

interface BackgroundMusicProps {
    initiallyPlaying?: boolean;
}

export default function BackgroundMusic({ initiallyPlaying = false }: BackgroundMusicProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(0.3);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Initialize audio element
    useEffect(() => {
        const audio = new Audio('/moltlets-town-music.mp3');
        audio.loop = true;
        audio.volume = volume;
        audioRef.current = audio;

        return () => {
            audio.pause();
            audio.src = '';
            audioRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Volume control
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
        }
    }, [volume]);

    const startMusic = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.play().then(() => {
                setIsPlaying(true);
            }).catch(() => {
                // Browser blocked autoplay, will retry on next click
            });
        }
    }, []);

    const stopMusic = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            setIsPlaying(false);
        }
    }, []);

    const toggleMusic = useCallback(() => {
        if (isPlaying) {
            stopMusic();
        } else {
            startMusic();
        }
    }, [isPlaying, startMusic, stopMusic]);

    // Auto-start if enabled (requires user interaction first)
    useEffect(() => {
        if (initiallyPlaying && !isPlaying) {
            const handleFirstInteraction = () => {
                startMusic();
                document.removeEventListener('click', handleFirstInteraction);
            };
            document.addEventListener('click', handleFirstInteraction);
            return () => document.removeEventListener('click', handleFirstInteraction);
        }
    }, [initiallyPlaying, isPlaying, startMusic]);

    return (
        <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2">
            <button
                onClick={toggleMusic}
                className="text-white/70 hover:text-white transition-colors flex items-center gap-1.5"
                title={isPlaying ? 'Pause Music' : 'Play Music'}
            >
                {isPlaying ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                )}
                <span className="text-xs">🎵</span>
            </button>

            {isPlaying && (
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-3
                     [&::-webkit-slider-thumb]:h-3
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-white"
                    title={`Volume: ${Math.round(volume * 100)}%`}
                />
            )}
        </div>
    );
}
