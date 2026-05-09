// Spritesheet: 1536x1872, cell 192x208, 8 cols x 9 rows
// Row map: 0=idle 1=run-right 2=run-left 3=waving 4=jumping 5=failed 6=waiting 7=running 8=review
const CW = 192, CH = 208;

function row(r, n) {
  return Array.from({ length: n }, (_, c) => ({ sx: c * CW, sy: r * CH, sw: CW, sh: CH }));
}

const FRAMES = {
  idle:    row(0, 6),
  peek:    row(8, 6),   // review — focused/watching
  angry:   row(5, 8),   // failed — frustrated/upset
  cry:     row(5, 8),   // failed — sad (pending dedicated state)
  eat:     row(3, 4),   // waving — placeholder until eat is generated
  shocked: row(4, 5),   // jumping — sudden reaction
};

if (typeof module !== 'undefined') module.exports = { FRAMES };
