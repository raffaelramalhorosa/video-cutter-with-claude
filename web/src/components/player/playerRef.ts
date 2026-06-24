// Módulo estável para o playerRef — separado do VideoPlayer.tsx para evitar
// que o HMR do Vite recrie o objeto ao editar o componente, quebrando as
// referências já capturadas por Timeline, CaptionTimeline, TranscriptPanel etc.
// A classe PlayerAdapter também mora aqui pelo mesmo motivo: VideoPlayer.tsx
// deve exportar só o componente (mantém o Fast Refresh do Vite funcionando).
import type { PlayerRef } from '@remotion/player'

/**
 * Adaptador: expõe a mesma interface que o resto do app já usava no <video>
 * cru (currentTime em SEGUNDOS, play, pause), mas por baixo fala com o
 * <Player> do Remotion, que trabalha em FRAMES. Lê o ref do Player AO VIVO
 * (no momento da chamada) — assim funciona mesmo que o ref só fique pronto
 * depois do efeito de montagem.
 */
export class PlayerAdapter {
  constructor(private getRef: () => PlayerRef | null, private getFps: () => number) {}
  get currentTime(): number {
    const r = this.getRef()
    return r ? r.getCurrentFrame() / this.getFps() : 0
  }
  set currentTime(sec: number) {
    const r = this.getRef()
    if (r) r.seekTo(Math.round(sec * this.getFps()))
  }
  play() {
    const r = this.getRef()
    if (r) { try { r.play() } catch { /* play pode exigir gesto do usuário */ } }
  }
  pause() {
    const r = this.getRef()
    if (r) r.pause()
  }
}

export const playerRef = { current: null as PlayerAdapter | null }
