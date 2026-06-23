import { useRef, useEffect } from 'react'
import { useAppStore } from '../../store/useAppStore'

export const playerRef = { current: null as HTMLVideoElement | null }

export default function VideoPlayer() {
  const ref = useRef<HTMLVideoElement>(null)
  const skipMode = useAppStore((s) => s.skipMode)
  const keeps = useAppStore((s) => s.keeps)
  const setSkipMode = useAppStore((s) => s.setSkipMode)

  useEffect(() => {
    playerRef.current = ref.current
  }, [])

  useEffect(() => {
    const video = ref.current
    if (!video) return
    const handler = () => {
      if (!skipMode || keeps.length === 0) return
      const t = video.currentTime
      const inKeep = keeps.find((k) => t >= k.in && t < k.out)
      if (!inKeep) {
        const next = keeps.find((k) => k.in > t)
        if (next) video.currentTime = next.in
        else { video.pause(); setSkipMode(false) }
      }
    }
    video.addEventListener('timeupdate', handler)
    return () => video.removeEventListener('timeupdate', handler)
  }, [skipMode, keeps, setSkipMode])

  return (
    <video
      ref={ref}
      id="player"
      controls
      preload="metadata"
      src="/media"
      className="w-full max-h-[360px] bg-black rounded-md block"
    />
  )
}
