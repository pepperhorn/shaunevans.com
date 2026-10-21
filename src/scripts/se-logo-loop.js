/*!
 * <se-logo-loop> — Shaun Evans animated brandmark (circle, 1:1, seamless loop)
 * Dark → white → dark, two-turn coin spin on each change.
 *
 * Usage:
 *   <script src="/se-logo-loop.js" defer></script>
 *   <se-logo-loop style="width:120px"></se-logo-loop>
 *
 * Attributes:
 *   duration="8"     loop length in seconds (default 8)
 *   paused           hold still (remove the attribute to play)
 *   start="0"        loop position to start from / show when paused (0–duration)
 *   label="…"        accessible name (default "Shaun Evans")
 *
 * Behaviour: sizes to its CSS width (always square), transparent outside the circle,
 * pauses when off-screen or in a background tab, and shows a still frame for
 * visitors who prefer reduced motion.
 */
(() => {
  if (customElements.get('se-logo-loop')) return;

  const RING = "M 421.2 672.31 C 350.14 672.31 292.32 614.49 292.32 543.43 C 292.32 472.36 350.14 414.54 421.2 414.54 C 492.27 414.54 550.09 472.36 550.09 543.43 C 550.09 614.49 492.27 672.31 421.2 672.31 M 421.2 403.21 C 343.89 403.21 280.99 466.11 280.99 543.43 C 280.99 620.74 343.89 683.64 421.2 683.64 C 498.52 683.64 561.42 620.74 561.42 543.43 C 561.42 466.11 498.52 403.21 421.2 403.21 ", S = "M 444.44 537.76 L 397.97 537.76 C 382.38 537.76 369.69 525.07 369.69 509.48 C 369.69 493.89 382.38 481.2 397.97 481.2 L 471.09 481.2 C 474.22 481.2 476.76 478.67 476.76 475.54 C 476.76 472.41 474.22 469.87 471.09 469.87 L 397.97 469.87 C 376.12 469.87 358.36 487.64 358.36 509.48 C 358.36 531.32 376.12 549.09 397.97 549.09 L 444.44 549.09 C 460.03 549.09 472.72 561.78 472.72 577.37 C 472.72 592.96 460.03 605.65 444.44 605.65 L 370.04 605.65 C 366.91 605.65 364.38 608.18 364.38 611.32 C 364.38 614.45 366.91 616.98 370.04 616.98 L 444.44 616.98 C 466.28 616.98 484.05 599.21 484.05 577.37 C 484.05 555.53 466.28 537.76 444.44 537.76 ", B1 = "M 411.13 503.81 C 408 503.81 405.46 506.35 405.46 509.48 C 405.46 512.61 408 515.15 411.13 515.15 L 460.12 515.15 C 463.25 515.15 465.79 512.61 465.79 509.48 C 465.79 506.35 463.25 503.81 460.12 503.81 Z M 411.13 503.81 ", B2 = "M 434.02 583.04 C 437.14 583.04 439.68 580.5 439.68 577.37 C 439.68 574.24 437.14 571.7 434.02 571.7 L 383.14 571.7 C 380 571.7 377.47 574.24 377.47 577.37 C 377.47 580.5 380 583.04 383.14 583.04 Z M 434.02 583.04 ", WAVES = "<path d=\"M793.67,626.09h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><path d=\"M860.19,549.78h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"815.26\" y1=\"575.22\" x2=\"851.97\" y2=\"575.22\"/><line x1=\"794.28\" y1=\"626.09\" x2=\"832.41\" y2=\"626.09\"/><path d=\"M920.45,473.47h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"854.54\" y1=\"549.78\" x2=\"892.67\" y2=\"549.78\"/><path d=\"M446.6,342.68h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"401.67\" y1=\"368.12\" x2=\"438.38\" y2=\"368.12\"/><line x1=\"380.69\" y1=\"418.99\" x2=\"418.82\" y2=\"418.99\"/><path d=\"M506.86,266.37h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"461.93\" y1=\"291.8\" x2=\"498.64\" y2=\"291.8\"/><line x1=\"440.95\" y1=\"342.68\" x2=\"479.08\" y2=\"342.68\"/><path d=\"M573.39,190.06h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"528.45\" y1=\"215.49\" x2=\"565.17\" y2=\"215.49\"/><line x1=\"507.48\" y1=\"266.37\" x2=\"545.6\" y2=\"266.37\"/><path d=\"M635.03,113.84h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92H605h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"569.12\" y1=\"190.15\" x2=\"607.25\" y2=\"190.15\"/><path d=\"M692.38,574.83h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"647.45\" y1=\"600.26\" x2=\"684.16\" y2=\"600.26\"/><path d=\"M752.64,498.51h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"707.71\" y1=\"523.95\" x2=\"744.42\" y2=\"523.95\"/><line x1=\"686.73\" y1=\"574.83\" x2=\"724.86\" y2=\"574.83\"/><path d=\"M819.16,422.2h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"774.23\" y1=\"447.64\" x2=\"810.94\" y2=\"447.64\"/><line x1=\"753.25\" y1=\"498.51\" x2=\"791.38\" y2=\"498.51\"/><path d=\"M876.42,345.89h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"831.48\" y1=\"371.33\" x2=\"868.2\" y2=\"371.33\"/><line x1=\"810.51\" y1=\"422.2\" x2=\"848.63\" y2=\"422.2\"/><path d=\"M776.65,295.02h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"731.71\" y1=\"320.45\" x2=\"768.42\" y2=\"320.45\"/><line x1=\"710.73\" y1=\"371.33\" x2=\"748.86\" y2=\"371.33\"/><path d=\"M836.91,218.71h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"791.97\" y1=\"244.14\" x2=\"828.69\" y2=\"244.14\"/><line x1=\"771\" y1=\"295.02\" x2=\"809.12\" y2=\"295.02\"/><path d=\"M903.43,142.4h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"858.5\" y1=\"167.83\" x2=\"895.21\" y2=\"167.83\"/><line x1=\"837.52\" y1=\"218.71\" x2=\"875.65\" y2=\"218.71\"/><path d=\"M523.31,600.26h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"478.38\" y1=\"625.7\" x2=\"515.09\" y2=\"625.7\"/><path d=\"M588.16,523.95h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"543.22\" y1=\"549.39\" x2=\"579.93\" y2=\"549.39\"/><line x1=\"522.24\" y1=\"600.26\" x2=\"560.37\" y2=\"600.26\"/><path d=\"M648.42,447.64h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"603.48\" y1=\"473.08\" x2=\"640.2\" y2=\"473.08\"/><line x1=\"582.51\" y1=\"523.95\" x2=\"620.63\" y2=\"523.95\"/><path d=\"M714.94,371.33h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"670.01\" y1=\"396.77\" x2=\"706.72\" y2=\"396.77\"/><line x1=\"649.03\" y1=\"447.64\" x2=\"687.16\" y2=\"447.64\"/><path d=\"M417.21,547.61h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"372.28\" y1=\"573.05\" x2=\"408.99\" y2=\"573.05\"/><path d=\"M483.74,471.3h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"438.8\" y1=\"496.74\" x2=\"475.51\" y2=\"496.74\"/><line x1=\"417.82\" y1=\"547.61\" x2=\"455.95\" y2=\"547.61\"/><path d=\"M548.58,394.99h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"503.65\" y1=\"420.42\" x2=\"540.36\" y2=\"420.42\"/><line x1=\"482.67\" y1=\"471.3\" x2=\"520.79\" y2=\"471.3\"/><path d=\"M608.84,318.68h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"563.91\" y1=\"344.11\" x2=\"600.62\" y2=\"344.11\"/><line x1=\"542.93\" y1=\"394.99\" x2=\"581.06\" y2=\"394.99\"/><path d=\"M675.37,242.36h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"630.43\" y1=\"267.8\" x2=\"667.14\" y2=\"267.8\"/><line x1=\"609.45\" y1=\"318.68\" x2=\"647.58\" y2=\"318.68\"/><path d=\"M737.07,166.04h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"692.14\" y1=\"191.48\" x2=\"728.85\" y2=\"191.48\"/><line x1=\"671.16\" y1=\"242.35\" x2=\"709.28\" y2=\"242.35\"/><path d=\"M797.33,89.73h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44c0,14.05-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"731.42\" y1=\"166.04\" x2=\"769.55\" y2=\"166.04\"/><path d=\"M399.54,215.85h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><path d=\"M466.06,139.54h-54.8c-14.05,0-25.44,11.39-25.44,25.44c0,14.05,11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/><line x1=\"421.13\" y1=\"164.97\" x2=\"457.84\" y2=\"164.97\"/><line x1=\"400.15\" y1=\"215.85\" x2=\"438.28\" y2=\"215.85\"/><path d=\"M530.91,63.23h-54.8c-14.05,0-25.44,11.39-25.44,25.44s11.39,25.44,25.44,25.44h17.92h6.84h10.06 c14.05,0,25.44,11.39,25.44,25.44s-11.39,25.44-25.44,25.44h-55.75\"/>";
  const CX0 = 421.203125, CY0 = 543.425781;

  const INK = '#231f20', TILE = '#393536', PAPER = '#ffffff', WAVE = '#e6e7e8';
  const C = 540, K = 2.71, CUT = 379.6;           // ring outer radius ≈ 380 in a 1080 frame
  const K_TILE = 0.62, PX = 209, PY = 199;
  const MAXR = CUT + 30;
  const WV = { x: 600, y: 430, stepX: 60.26, stepY: -76.31 };

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const inOutCubic = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const inQuad = p => p * p;
  const smooth = p => p * p * (3 - 2 * p);
  const bloom = th => 150 * smooth(seg(th, 245, 292)) + (MAXR - 150) * inQuad(seg(th, 292, 720));

  let tiles = '';
  for (let r = -3; r <= 3; r++) for (let c = -4; c <= 5; c++) {
    const x = C + c * PX + (Math.abs(r) % 2 ? PX / 2 : 0), y = C + r * PY;
    tiles += `<g transform="translate(${x} ${y}) scale(${K_TILE})"><use href="#r"/><use href="#s"/></g>`;
  }

  const TEMPLATE = `
<style>
  :host { display: inline-block; width: 160px; aspect-ratio: 1 / 1; line-height: 0; vertical-align: middle; }
  :host([hidden]) { display: none; }
  svg { display: block; width: 100%; height: 100%; overflow: hidden; }
</style>
<svg viewBox="${C - CUT} ${C - CUT} ${CUT * 2} ${CUT * 2}" role="img">
  <title></title>
  <defs>
    <g id="r"><path transform="translate(${-CX0},${-CY0})" d="${RING}"/></g>
    <g id="s" transform="translate(${-CX0},${-CY0})"><path d="${S}"/><path d="${B1}"/><path d="${B2}"/></g>
    <clipPath id="cut"><circle cx="${C}" cy="${C}" r="${CUT}"/></clipPath>
    <clipPath id="d1"><circle id="c1" cx="${C}" cy="${C}" r="0"/></clipPath>
    <clipPath id="d2"><circle id="c2" cx="${C}" cy="${C}" r="0"/></clipPath>
  </defs>
  <g clip-path="url(#cut)">
    <g id="dark">
      <rect width="1080" height="1080" fill="${INK}"/>
      <g id="pat" fill="${TILE}">${tiles}</g>
    </g>
    <g clip-path="url(#d1)">
      <rect width="1080" height="1080" fill="${PAPER}"/>
      <g id="w" fill="none" stroke="${WAVE}" stroke-width="8.4947" stroke-linecap="round">${WAVES}</g>
    </g>
    <g clip-path="url(#d2)"><use href="#dark"/></g>
    <g id="h" fill="${PAPER}"><use href="#r"/><use href="#s"/></g>
  </g>
</svg>`;

  const reduceMQ = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  class SELogoLoop extends HTMLElement {
    static get observedAttributes() { return ['paused', 'duration', 'start', 'label']; }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = TEMPLATE;
      const q = id => root.getElementById(id);
      this._el = { h: q('h'), c1: q('c1'), c2: q('c2'), w: q('w'), pat: q('pat'), title: root.querySelector('title') };
      this._t = 0; this._raf = 0; this._last = 0; this._visible = true;
      this._tick = this._tick.bind(this);
      this._sync = this._sync.bind(this);
    }

    get duration() { return Math.max(2, parseFloat(this.getAttribute('duration')) || 8); }

    connectedCallback() {
      this._t = (parseFloat(this.getAttribute('start')) || 0) % this.duration;
      this._el.title.textContent = this.getAttribute('label') || 'Shaun Evans';
      this._render(this._t);
      if ('IntersectionObserver' in window) {
        this._io = new IntersectionObserver(es => { this._visible = es[0].isIntersecting; this._sync(); });
        this._io.observe(this);
      }
      document.addEventListener('visibilitychange', this._sync);
      reduceMQ && reduceMQ.addEventListener && reduceMQ.addEventListener('change', this._sync);
      this._sync();
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf); this._raf = 0;
      this._io && this._io.disconnect();
      document.removeEventListener('visibilitychange', this._sync);
      reduceMQ && reduceMQ.removeEventListener && reduceMQ.removeEventListener('change', this._sync);
    }

    attributeChangedCallback(name) {
      if (!this.isConnected) return;
      if (name === 'label') this._el.title.textContent = this.getAttribute('label') || 'Shaun Evans';
      if (name === 'start') { this._t = (parseFloat(this.getAttribute('start')) || 0) % this.duration; this._render(this._t); }
      this._sync();
    }

    _sync() {
      const run = !this.hasAttribute('paused') && this._visible && !document.hidden && !(reduceMQ && reduceMQ.matches);
      if (run && !this._raf) { this._last = performance.now(); this._raf = requestAnimationFrame(this._tick); }
      if (!run && this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    }

    _tick(now) {
      const dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
      this._t = (this._t + dt) % this.duration;
      this._render(this._t);
      this._raf = requestAnimationFrame(this._tick);
    }

    /** Draw the loop at time t (seconds). Timing scales with `duration`. */
    _render(t) {
      const D = this.duration, u = (t / D) * 8;     // normalise to the 8 s design timeline
      const e = this._el;
      e.pat.setAttribute('transform', `translate(${(-PX * u / 8).toFixed(2)} 0)`);

      const p1 = seg(u, 1.0, 2.9), p2 = seg(u, 5.0, 6.9);
      const th1 = 720 * inOutCubic(p1), th2 = 720 * inOutCubic(p2);
      const first = u < 4;
      const th = first ? th1 : th2, p = first ? p1 : p2;
      const flip = Math.max(0.012, Math.abs(Math.cos(th * Math.PI / 180)));
      const k = K * (1 - 0.07 * Math.sin(Math.PI * p));
      e.h.setAttribute('transform', `translate(${C} ${C}) scale(${(k * flip).toFixed(4)} ${k.toFixed(4)})`);
      e.h.setAttribute('fill', th1 >= 270 && !(th2 >= 270) ? INK : PAPER);

      e.c1.setAttribute('r', bloom(th1).toFixed(1));
      e.c2.setAttribute('r', bloom(th2).toFixed(1));

      const drift = seg(u, 1.6, 7.0) * 0.9;
      e.w.setAttribute('transform', `translate(${C} ${C}) scale(2.35) translate(${-(WV.x + WV.stepX * drift)} ${-(WV.y + WV.stepY * drift)})`);
    }
  }

  customElements.define('se-logo-loop', SELogoLoop);
})();
