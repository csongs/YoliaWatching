// 預設動畫表(isomorphic,單一源頭)。CLAUDE.md 鐵律 5 曾警告這張表有三份手抄副本
// (main.js、index.html、character.js 內建 fallback)——這裡收成一份,main.js/index.html
// 直接用,character.js 的內建 fallback 改用 frames() 從這份資料衍生(見 character.js)。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.DefaultAnimations = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const DEFAULT_ANIMATIONS = {
    idle:          { folder: 'idle',           frames: [0,2,4,5,4,2,0,0,1,0],        ms: 150, loop: false },
    peek:          { folder: 'review',         frames: [2,2,2,2,4,2,2,2,3,3,3],      ms: 250, loop: false },
    cheer:         { folder: 'cheer',          frames: [0,2,3,5,0,5],                ms: 150, loop: false },
    cry:           { folder: 'cry',            frames: [0,7,7,7,0,1,1,1,0,0],        ms: 150, loop: false },
    eat:           { folder: 'cilantro',       frames: [0,1,2,3,4,5,6,7,7],          ms: 250, loop: false },
    jump:          { folder: 'jumping',        frames: [0,1,2,3],                    ms: 250, loop: false },
    run_left:      { folder: 'running-left',   frames: [0,3,4,5,7],                  ms: 150, loop: true  },
    run_right:     { folder: 'running-right',  frames: [0,3,4,5,7],                  ms: 150, loop: true  },
    wave:          { folder: 'waving',         frames: [0,1,2,3,2,1,0],              ms: 200, loop: false },
    watch_excited: { folder: 'watch-excited',  frames: [0,0,0,1,2,1,2,1,2,3,3,3,3],  ms: 300, loop: false },
  };

  return { DEFAULT_ANIMATIONS };
});
