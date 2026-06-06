class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.5;
  }

  // Initialize Web Audio Context lazily on first player click
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.init();
    this.muted = !this.muted;
    
    // Update mute button icon on any page
    const btn = document.getElementById('btn-mute');
    if (btn) {
      btn.innerText = this.muted ? '🔇' : '🔊';
    }
    
    app.showToast('info', this.muted ? 'Audio Muted' : 'Audio Unmuted');
  }

  // Synthesize Card Placement slap
  playPlace() {
    if (this.muted) return;
    try {
      this.init();
      const now = this.ctx.currentTime;
      
      // Node 1: Slap click
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
      
      gain.gain.setValueAtTime(this.volume * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {
      console.warn('Audio play failed', e);
    }
  }

  // Synthesize Card Draw swoosh
  playDraw() {
    if (this.muted) return;
    try {
      this.init();
      const now = this.ctx.currentTime;
      
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(650, now);
      osc.frequency.linearRampToValueAtTime(180, now + 0.12);
      
      gain.gain.setValueAtTime(this.volume * 0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.12);
    } catch (e) {
      console.warn('Audio play failed', e);
    }
  }

  // Synthesize double chime chime for notification/turn alerts
  playNotify() {
    if (this.muted) return;
    try {
      this.init();
      const now = this.ctx.currentTime;
      
      // Chime 1
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(660, now);
      gain1.gain.setValueAtTime(this.volume * 0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.005, now + 0.15);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);
      
      // Chime 2
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.08);
      gain2.gain.setValueAtTime(0, now + 0.08);
      gain2.gain.linearRampToValueAtTime(this.volume * 0.2, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.005, now + 0.25);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.25);
    } catch (e) {
      console.warn('Audio play failed', e);
    }
  }

  // Synthesize Retro synth chord for UNO shouts
  playUno() {
    if (this.muted) return;
    try {
      this.init();
      const now = this.ctx.currentTime;
      
      const freqs = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5
      
      freqs.forEach(f => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now);
        
        gain.gain.setValueAtTime(this.volume * 0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.3);
      });
    } catch (e) {
      console.warn('Audio play failed', e);
    }
  }

  // Synthesize C Major arpeggiated Victory fanfare
  playVictory() {
    if (this.muted) return;
    try {
      this.init();
      const now = this.ctx.currentTime;
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // C4, E4, G4, C5, E5, G5, C6
      
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);
        
        gain.gain.setValueAtTime(0, now + idx * 0.1);
        gain.gain.linearRampToValueAtTime(this.volume * 0.2, now + idx * 0.1 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.005, now + idx * 0.1 + 0.4);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.4);
      });
    } catch (e) {
      console.warn('Audio play failed', e);
    }
  }
}

// Global exposure
const audio = new AudioEngine();
window.audio = audio;
