const PUNISH_DROP = 20;
const PUNISH_MS   = 2000;

const DEFAULT_STATES = [
  { min: 80, state: 'cheer' },
  { min: 40, state: 'peek'  },
  { min: 0,  state: 'idle'  },
];

function createStateMachine(config = {}) {
  const states = [...(config.yoliaStates ?? DEFAULT_STATES)]
    .sort((a, b) => b.min - a.min);

  return {
    yolia_see: 0,
    state: 'idle',
    _punishedUntil: 0,

    punish() {
      this.yolia_see = Math.max(0, this.yolia_see - PUNISH_DROP);
      this.state = 'cry';
      this._punishedUntil = Date.now() + PUNISH_MS;
    },

    computeState() {
      for (const s of states) {
        if (this.yolia_see >= s.min) return s.state;
      }
      return 'idle';
    },

    updateStates(newArr) {
      states.splice(0, states.length, ...[...newArr].sort((a, b) => b.min - a.min));
    },
  };
}

module.exports = { createStateMachine };
