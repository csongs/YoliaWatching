const { THRESHOLDS } = require('./config');

const TICK_RISE   = 5;
const TICK_FALL   = 2;
const PUNISH_DROP = 20;
const PUNISH_MS   = 2000;

function createStateMachine() {
  return {
    yuushi: 0,
    state: 'idle',
    _punishedUntil: 0,

    tick(streamDetected) {
      if (streamDetected) {
        this.yuushi = Math.min(100, this.yuushi + TICK_RISE);
      } else {
        this.yuushi = Math.max(0, this.yuushi - TICK_FALL);
      }
      if (Date.now() > this._punishedUntil) {
        this.state = this.computeState();
      }
    },

    punish() {
      this.yuushi = Math.max(0, this.yuushi - PUNISH_DROP);
      this.state = 'cry';
      this._punishedUntil = Date.now() + PUNISH_MS;
    },

    computeState() {
      if (this.yuushi >= THRESHOLDS.ANGRY) return 'cheer';
      if (this.yuushi >= THRESHOLDS.PEEK)  return 'peek';
      return 'idle';
    },
  };
}

module.exports = { createStateMachine };
