// ── Firebase ───────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyDw8mLJ6MhSSgyFJaW1tGvpn0bi7P9DtOk",
  authDomain: "mallcops.firebaseapp.com",
  projectId: "mallcops",
  storageBucket: "mallcops.firebasestorage.app",
  messagingSenderId: "257434166770",
  appId: "1:257434166770:web:8e4f066b20261a0e34b76b"
};

firebase.initializeApp(firebaseConfig);
const db   = firebase.firestore();
const auth = firebase.auth();

let currentUser = '';

// ── Constants ──────────────────────────────────────────────────────────────

const TYPES = [
  { id: 'easy',      label: 'Easy Run',    color: '#2E7D5B' },
  { id: 'long',      label: 'Long Run',    color: '#1E5A9E' },
  { id: 'tempo',     label: 'Tempo',       color: '#C8511A' },
  { id: 'intervals', label: 'Intervals',   color: '#A82A1E' },
  { id: 'recovery',  label: 'Recovery',    color: '#5E3C9A' },
  { id: 'cross',     label: 'Cross Train', color: '#1E6E6E' },
  { id: 'rest',      label: 'Rest Day',    color: '#7A6E5E' },
  { id: 'race',      label: 'Race',        color: '#9E6318' },
];

const DOW    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── State ──────────────────────────────────────────────────────────────────

let workouts = {};          // { 'YYYY-MM-DD': [{id, type, distance, duration, effort, notes, completed},...] }
let viewYear, viewMonth;
let viewWeekStart = null;
let selDate = null, selId = null;
let selType = 'easy', selEffort = null, completedOn = false;
let selSubtype  = 'easy';   // for long run: 'easy' | 'workout'
let builderData = null;     // current builder state (null = not a structured workout)
let viewingAs = '';            // whose plan is on screen (self or assigned athlete)
let isCoach   = false;
let myCoachName = '';          // coach of currentUser (populated on load)
let templates         = [];     // [{ id, name, type, subtype, structure, isPublic }]
let publicTemplates   = [];     // public templates from OTHER runners
let templateMode      = false;  // true when modal is creating/editing a template
let editingTemplateId = null;   // id of template being edited (null = new)

// ── Header ─────────────────────────────────────────────────────────────────

function updateHeaderTitle() {
  document.getElementById('headerName').textContent = viewingAs.toUpperCase() + "'S";
}

// ── Save status helper ─────────────────────────────────────────────────────

function setSaveStatus(msg) {
  const el = document.getElementById('saveStatus');
  if (el) el.textContent = msg;
}

// ── Firestore load/save ────────────────────────────────────────────────────

async function loadWorkoutsFor(name) {
  workouts  = {};
  templates = [];
  document.getElementById('raceDateInput').value = '';
  document.getElementById('raceCountdownText').textContent = '';
  try {
    const doc = await db.collection('workouts').doc(name).get();
    if (doc.exists) {
      const d = doc.data();
      workouts  = d.data      || {};
      templates = d.templates || [];
      if (d.raceDate) {
        document.getElementById('raceDateInput').value = d.raceDate;
        updateRaceCountdown(d.raceDate);
      }
    }
  } catch (e) {
    setSaveStatus('⚠ Load failed');
    console.error('Load error:', e);
    throw e;
  }
  renderTemplatesCard();
}

async function load() {
  setSaveStatus('Loading…');
  try {
    // Check if this user is a coach
    const memberDoc = await db.collection('members').doc(currentUser).get();
    if (memberDoc.exists) {
      const md = memberDoc.data();
      if (md.isCoach) {
        isCoach = true;
        const athletes = md.athletes || [];
        const sel = document.getElementById('athleteSelect');
        sel.innerHTML = '<option value="__self__">MY PLAN</option>';
        athletes.forEach(name => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name.toUpperCase();
          sel.appendChild(opt);
        });
        document.getElementById('coachBar').classList.add('visible');
        document.body.classList.add('coach-mode');
      } else {
        // Athlete: find who coaches them
        try {
          const coachSnap = await db.collection('members')
            .where('athletes', 'array-contains', currentUser)
            .limit(1).get();
          if (!coachSnap.empty) myCoachName = coachSnap.docs[0].id;
        } catch(e) { /* index may not exist, ignore */ }
      }
    }
    await loadWorkoutsFor(viewingAs);
    setSaveStatus('');
  } catch (e) {
    setSaveStatus('⚠ Load failed');
    console.error('Load error:', e);
  }
}

function save() {
  setSaveStatus('Saving…');
  const raceDate = document.getElementById('raceDateInput').value || null;
  db.collection('workouts').doc(viewingAs).set({
    data: workouts,
    raceDate,
    templates,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  })
  .then(() => {
    setSaveStatus('Saved ✓');
    setTimeout(() => setSaveStatus(''), 2500);
  })
  .catch(e => {
    setSaveStatus('⚠ Error');
    console.error('Save error:', e);
  });
}

// ── Template persistence ───────────────────────────────────────────────────

function saveTemplates() {
  setSaveStatus('Saving…');
  db.collection('workouts').doc(viewingAs).set({ templates }, { merge: true })
    .then(() => { setSaveStatus('Saved ✓'); setTimeout(() => setSaveStatus(''), 2000); })
    .catch(e => { setSaveStatus('⚠ Error'); console.error('saveTemplates error:', e); });
}

// ── Load public templates from other runners ───────────────────────────────

async function loadPublicTemplates() {
  try {
    const snap = await db.collection('public_templates').get();
    publicTemplates = snap.docs
      .map(d => d.data())
      .filter(t => t.createdBy !== currentUser);
  } catch(e) { console.error('loadPublicTemplates:', e); }
  renderTemplatesCard();
}

// ── Templates sidebar card ─────────────────────────────────────────────────

function renderTemplatesCard() {
  const list = document.getElementById('templatesList');
  if (!list) return;
  list.innerHTML = '';

  const hasOwn    = templates.length > 0;
  const hasShared = publicTemplates.length > 0;

  if (!hasOwn && !hasShared) {
    list.innerHTML = '<div class="empty-msg">No templates yet</div>';
    return;
  }

  // ── MY TEMPLATES ──
  if (hasOwn) {
    if (hasShared) {
      const lbl = document.createElement('div');
      lbl.className = 'tpl-section-label'; lbl.textContent = 'MY TEMPLATES';
      list.appendChild(lbl);
    }
    templates.forEach(tpl => {
      list.appendChild(makeTplItem(tpl, false));
    });
  }

  // ── SHARED (others' public templates) ──
  if (hasShared) {
    const lbl = document.createElement('div');
    lbl.className = 'tpl-section-label'; lbl.textContent = 'SHARED';
    list.appendChild(lbl);
    publicTemplates.forEach(tpl => {
      list.appendChild(makeTplItem(tpl, true));
    });
  }
}

function makeTplItem(tpl, isShared) {
  const ti   = typeInfo(tpl.type);
  const item = document.createElement('div'); item.className = 'template-item';
  const dot  = document.createElement('div'); dot.className = 'template-dot'; dot.style.background = ti.color;
  const name = document.createElement('div'); name.className = 'template-item-name';
  // Shared items show "(Creator)" suffix
  name.textContent = isShared ? `${tpl.name || 'Untitled'} (${tpl.createdBy})` : (tpl.name || 'Untitled');
  const type = document.createElement('div'); type.className = 'template-item-type'; type.textContent = ti.label;
  item.appendChild(dot); item.appendChild(name); item.appendChild(type);
  if (isShared) {
    const lock = document.createElement('span');
    lock.className = 'template-item-lock'; lock.textContent = '🔒';
    item.appendChild(lock);
  }

  // Delete button — own templates only
  if (!isShared) {
    const del = document.createElement('button');
    del.className = 'template-del'; del.textContent = '✕'; del.type = 'button'; del.title = 'Delete template';
    del.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete template "${tpl.name || 'Untitled'}"?`)) {
        // If it was public, remove from public_templates collection too
        if (tpl.isPublic) {
          db.collection('public_templates').doc(tpl.id).delete().catch(e => console.error('delete public_templates:', e));
        }
        templates = templates.filter(t => t.id !== tpl.id);
        saveTemplates(); renderTemplatesCard();
      }
    });
    item.appendChild(del);
    item.addEventListener('click', () => openModalForTemplate(tpl.id));
  } else {
    // Shared template: click to schedule as a workout (not edit the template)
    item.title = 'Click to schedule for today';
    item.addEventListener('click', () => scheduleSharedTemplate(tpl));
  }
  return item;
}

// ── Open modal in template-editing mode ───────────────────────────────────

function openModalForTemplate(templateId) {
  templateMode      = true;
  editingTemplateId = templateId;
  const tpl = templateId ? templates.find(t => t.id === templateId) : null;

  selDate = null; selId = null;
  document.getElementById('modalTitle').textContent   = tpl ? 'Edit Template' : 'New Template';
  document.getElementById('modalDateStr').textContent = 'Saved as reusable template';
  document.getElementById('deleteBtn').style.display  = tpl ? '' : 'none';

  selType     = tpl ? tpl.type              : 'intervals';
  selSubtype  = tpl ? (tpl.subtype || 'easy') : 'easy';
  selEffort   = null;
  completedOn = false;
  builderData = tpl?.structure ? JSON.parse(JSON.stringify(tpl.structure)) : null;

  document.getElementById('distInput').value         = tpl?.dist     || '';
  document.getElementById('paceInput').value         = tpl?.pace     || '';
  document.getElementById('durInput').value          = tpl?.duration || '';
  document.getElementById('notesInput').value        = '';
  document.getElementById('templateNameInput').value = tpl?.name || '';

  // Show name + visibility fields, hide workout-specific fields
  document.getElementById('templateNameField').style.display       = '';
  document.getElementById('templateVisibilityField').style.display = '';
  document.getElementById('effortField').style.display             = 'none';
  document.getElementById('notesField').style.display              = 'none';
  document.getElementById('completedField').style.display          = 'none';
  document.getElementById('saveBtn').textContent                   = tpl ? 'Update Template' : 'Save Template';

  // Set visibility toggle state
  const tplTrack = document.getElementById('tplToggleTrack');
  const tplLabel = document.getElementById('tplToggleLabel');
  if (tpl?.isPublic) {
    tplTrack.classList.add('on');
    tplLabel.textContent = 'Public – visible to all runners';
  } else {
    tplTrack.classList.remove('on');
    tplLabel.textContent = 'Private – only visible to you';
  }

  renderTypePills(); syncToggle();
  document.getElementById('overlay').classList.add('open');
}

// ── Schedule a shared template as a workout (read-only — does not edit the template) ──

function scheduleSharedTemplate(tpl) {
  // Open the workout scheduling modal for today, pre-filled with the template data.
  // The runner can adjust details before saving — Lorenzo's original template is never touched.
  const now = new Date();
  const key = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  openModal(key, null);   // standard workout modal, new entry for today

  // Override defaults with template data
  selType     = tpl.type    || 'easy';
  selSubtype  = tpl.subtype || 'easy';
  builderData = tpl.structure ? JSON.parse(JSON.stringify(tpl.structure)) : null;
  document.getElementById('distInput').value  = tpl.dist     || '';
  document.getElementById('paceInput').value  = tpl.pace     || '';
  document.getElementById('durInput').value   = tpl.duration || '';

  // Title shows who created the template
  document.getElementById('modalTitle').textContent = (tpl.name || 'Workout') + ' (' + tpl.createdBy + ')';
  renderTypePills(); syncToggle();
}

// ── Save / update template from modal ─────────────────────────────────────

async function saveTemplateFromModal() {
  const nameEl = document.getElementById('templateNameInput');
  const name   = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }

  const struct = isStructured();
  if (struct && !builderData) {
    alert('Please build the workout structure first.');
    return;
  }

  const isPublic  = document.getElementById('tplToggleTrack').classList.contains('on');
  const wasPublic = editingTemplateId
    ? (templates.find(t => t.id === editingTemplateId)?.isPublic || false)
    : false;
  const tplId = editingTemplateId || genId();

  const obj = {
    id:        tplId,
    name,
    type:      selType,
    subtype:   selType === 'long' ? selSubtype : null,
    structure: struct ? JSON.parse(JSON.stringify(builderData)) : null,
    dist:      !struct ? (document.getElementById('distInput').value  || null) : null,
    pace:      !struct ? (document.getElementById('paceInput').value  || null) : null,
    duration:  !struct ? (document.getElementById('durInput').value   || null) : null,
    isPublic,
  };

  if (editingTemplateId) {
    const idx = templates.findIndex(t => t.id === editingTemplateId);
    if (idx !== -1) templates[idx] = obj; else templates.push(obj);
  } else {
    templates.push(obj);
  }

  // Sync with public_templates collection
  try {
    if (isPublic) {
      // Publish (or update) the public copy
      await db.collection('public_templates').doc(tplId).set({ ...obj, createdBy: currentUser });
    } else if (wasPublic) {
      // Was public, now private → remove from public collection
      await db.collection('public_templates').doc(tplId).delete();
    }
  } catch(e) { console.error('sync public_templates:', e); }

  saveTemplates(); renderTemplatesCard(); closeModal();
}

// ── Load-template select row in modal ─────────────────────────────────────

function renderLoadTemplateRow() {
  const row = document.getElementById('loadTemplateRow');
  const sel = document.getElementById('templateSelect');
  if (!row || !sel) return;

  const matchOwn = templates.filter(t => {
    if (t.type !== selType) return false;
    if (selType === 'long' && t.subtype !== selSubtype) return false;
    return true;
  });
  const matchShared = publicTemplates.filter(t => {
    if (t.type !== selType) return false;
    if (selType === 'long' && t.subtype !== selSubtype) return false;
    return true;
  });

  if (!matchOwn.length && !matchShared.length) { row.style.display = 'none'; return; }

  sel.innerHTML = '<option value="">↓ load a template…</option>';
  if (matchOwn.length) {
    const grp = document.createElement('optgroup'); grp.label = 'My Templates';
    matchOwn.forEach(t => {
      const o = document.createElement('option'); o.value = t.id; o.textContent = t.name;
      grp.appendChild(o);
    });
    sel.appendChild(grp);
  }
  if (matchShared.length) {
    const grp = document.createElement('optgroup'); grp.label = 'Shared';
    matchShared.forEach(t => {
      const o = document.createElement('option');
      o.value = 'shared:' + t.id;
      o.textContent = `${t.name} (${t.createdBy})`;
      grp.appendChild(o);
    });
    sel.appendChild(grp);
  }
  row.style.display = '';
}

// ── Builder summary helpers ────────────────────────────────────────────────

function formatDistDisplay(val, unit) {
  const n = parseFloat(val);
  if (!n) return '';
  if (unit === 'm')  return `${Math.round(n)}m`;
  return `${n % 1 === 0 ? n : parseFloat(n.toFixed(2))}mi`;
}

function updateBuilderSummary() {
  const sumEl = document.getElementById('builderSummary');
  if (!sumEl || !builderData) { if (sumEl) sumEl.style.display = 'none'; return; }
  const lines = [];

  // Warmup
  const wu = builderData.warmup;
  if (wu && (wu.dist || wu.time)) {
    const d = formatDistDisplay(wu.dist, wu.unit || 'mi');
    const t = wu.time ? `(${wu.time})` : '';
    const p = wu.pace ? `@ ${wu.pace}/mi` : '';
    lines.push(`<span class="bs-line"><strong>WU:</strong> <span class="bs-easy">${[d, p, t].filter(Boolean).join(' ')}</span></span>`);
  }

  const usesBlocks = selType === 'intervals' || (selType === 'long' && selSubtype === 'workout');
  if (usesBlocks) {
    (builderData.blocks || []).forEach((block, bi) => {
      const sets   = parseInt(block.sets) || 1;
      const pieces = block.pieces || [];
      const pieceDescs = pieces.map(p => {
        let d = '';
        if (p.unit === 'time') {
          d = p.time || '—';
          if (p.pace) d += ` @ ${p.pace}/mi`;
        } else {
          d = formatDistDisplay(p.dist, p.unit || 'm') || '—';
          if (p.pace) d += ` @ ${p.pace}/mi`;
        }
        const cls  = p.effort === 'hard' ? 'bs-hard' : 'bs-easy';
        const rest = (p.restAfter?.kind && p.restAfter.kind !== 'none' && p.restAfter?.val)
          ? ` + ${p.restAfter.kind === 'jog'
              ? formatDistDisplay(p.restAfter.val, p.restAfter.restUnit || 'm') + ' jog'
              : p.restAfter.val + ' rest'}`
          : '';
        return `<span class="${cls}">${d}</span>${rest}`;
      });
      let setRest = '';
      const rbs = block.restBetweenSets;
      if (rbs?.kind && rbs.kind !== 'none' && rbs.val) {
        setRest = ` | ${rbs.kind === 'jog'
          ? formatDistDisplay(rbs.val, rbs.restUnit || 'm') + ' jog btw sets'
          : rbs.val + ' btw sets'}`;
      }
      lines.push(`<span class="bs-line"><strong>Block ${bi + 1}:</strong> ${sets}×(${pieceDescs.join(' / ')})${setRest}</span>`);
    });
  } else if (builderData.hard) {
    const h   = builderData.hard;
    const d   = formatDistDisplay(h.dist, h.unit || 'mi');
    const t   = h.time ? `(${h.time})` : '';
    const p   = h.pace ? `@ ${h.pace}/mi` : '';
    const lbl = selType === 'tempo' ? 'Tempo' : 'MP Block';
    lines.push(`<span class="bs-line"><strong>${lbl}:</strong> <span class="bs-hard">${[d, p, t].filter(Boolean).join(' ') || '—'}</span></span>`);
  }

  // Cooldown
  const cd = builderData.cooldown;
  if (cd && (cd.dist || cd.time)) {
    const d = formatDistDisplay(cd.dist, cd.unit || 'mi');
    const t = cd.time ? `(${cd.time})` : '';
    const p = cd.pace ? `@ ${cd.pace}/mi` : '';
    lines.push(`<span class="bs-line"><strong>CD:</strong> <span class="bs-easy">${[d, p, t].filter(Boolean).join(' ')}</span></span>`);
  }

  if (lines.length) {
    sumEl.innerHTML = lines.join('');
    sumEl.style.display = '';
  } else {
    sumEl.style.display = 'none';
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function genId()          { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function dateKey(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function parseKey(k)      { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); }
function typeInfo(id)     { return TYPES.find(t => t.id === id) || TYPES[0]; }

function fmtDateShort(k) { return parseKey(k).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }); }
function fmtDateLong(k)  { return parseKey(k).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }); }

function monthWorkouts() {
  return Object.entries(workouts)
    .filter(([k]) => { const [y,m] = k.split('-').map(Number); return y === viewYear && m === viewMonth + 1; })
    .flatMap(([k, ws]) => ws.map(w => ({ ...w, key: k })));
}

// ── Builder helpers ────────────────────────────────────────────────────────

function toMiles(val, unit) {
  if (!val || isNaN(parseFloat(val))) return 0;
  return unit === 'm' ? parseFloat(val) / 1609.344 : parseFloat(val);
}

function isStructured() {
  return selType === 'tempo' || selType === 'intervals' ||
         (selType === 'long' && selSubtype === 'workout');
}

function defaultBuilderData() {
  const base = {
    warmup:   { dist: '', unit: 'mi', pace: '', time: '' },
    cooldown: { dist: '', unit: 'mi', pace: '', time: '' }
  };
  // Intervals AND long-workout both use the full dynamic block builder
  if (selType === 'intervals' || (selType === 'long' && selSubtype === 'workout'))
    return { ...base, blocks: [defaultBlock()] };
  // Tempo: single hard segment
  return { ...base, hard: { dist: '', unit: 'mi', pace: '', time: '' } };
}

function defaultBlock() {
  return { sets: 4, restBetweenSets: { kind: 'none', val: '', restUnit: 'm' }, pieces: [defaultPiece('hard')] };
}

function defaultPiece(effort) {
  return { dist: '', unit: 'm', time: '', effort: effort || 'hard', pace: '',
           restAfter: { kind: 'none', val: '', restUnit: 'm' } };
}

// ── Time / pace helpers ────────────────────────────────────────────────────

// Parse "m:ss" or "mm:ss" → total seconds  (used for pace AND piece/segment time)
function parsePaceSec(str) {
  if (!str || !str.trim()) return 0;
  const p = str.trim().split(':').map(s => parseFloat(s) || 0);
  if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
  if (p.length === 2) return p[0]*60 + p[1];
  return p[0]*60;
}

// Parse "h:mm" workout duration → total seconds  (used for simple-form duration)
function parseDurationSec(str) {
  if (!str || !str.trim()) return 0;
  const p = str.trim().split(':').map(s => parseFloat(s) || 0);
  if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
  if (p.length === 2) return p[0]*3600 + p[1]*60;   // "h:mm" – first part is hours
  return p[0]*60;
}

// Format seconds → "m:ss"  (pace & segment time display)
function formatPaceMS(sec) {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

// Format seconds → "h:mm"  (simple-form duration display)
function formatDurationHM(sec) {
  if (!sec || sec <= 0) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2,'0')}`;
}

// Distance in miles from piece time (m:ss) and pace (m:ss/mi)
function calcDistFromTimePace(timeStr, paceStr) {
  const t = parsePaceSec(timeStr), p = parsePaceSec(paceStr);
  return (!t || !p) ? 0 : t / p;
}

// Show/hide modal sections based on current selType + selSubtype
function renderModalForm() {
  const lrField   = document.getElementById('lrSubtypeField');
  const simpleFld = document.getElementById('simpleFields');
  const bldrEl    = document.getElementById('builderSection');
  const sumEl     = document.getElementById('builderSummary');
  if (!lrField || !simpleFld || !bldrEl) return;

  // Widen modal for structured workouts
  document.querySelector('.modal').classList.toggle('wide', isStructured());

  if (selType === 'long') {
    lrField.style.display = '';
    renderLrSubtype();
  } else {
    lrField.style.display = 'none';
  }

  if (isStructured()) {
    simpleFld.style.display = 'none';
    bldrEl.style.display    = '';
    if (!builderData) builderData = defaultBuilderData();
    renderBuilder(bldrEl);
  } else {
    simpleFld.style.display = '';
    bldrEl.style.display    = 'none';
    if (sumEl) sumEl.style.display = 'none';
    builderData = null;
    renderLoadTemplateRow();  // show/hide dropdown for matching simple templates
  }

  // In template mode: keep effort / notes / completed hidden regardless of type
  if (templateMode) {
    document.getElementById('effortField').style.display    = 'none';
    document.getElementById('notesField').style.display     = 'none';
    document.getElementById('completedField').style.display = 'none';
  }
}

function renderLrSubtype() {
  const row = document.getElementById('lrSubtypeRow');
  if (!row) return;
  row.innerHTML = '';
  ['easy', 'workout'].forEach(sub => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lr-sub-btn' + (selSubtype === sub ? ' active' : '');
    btn.textContent = sub === 'easy' ? 'Easy Long Run' : 'Workout Long Run';
    btn.addEventListener('click', () => {
      if (selSubtype === sub) return;
      selSubtype  = sub;
      builderData = null;
      renderLrSubtype();
      renderModalForm();
    });
    row.appendChild(btn);
  });
}

function renderBuilder(container) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'builder-section';

  // Warmup
  wrap.appendChild(makeSegment('warmup', 'WARMUP', builderData.warmup));

  if (selType === 'intervals' || (selType === 'long' && selSubtype === 'workout')) {
    // Dynamic interval blocks
    const bWrap = document.createElement('div');
    bWrap.style.cssText = 'padding:10px 14px;border-bottom:1px solid var(--border)';
    const bLbl = document.createElement('div');
    bLbl.className = 'builder-seg-title';
    bLbl.style.marginBottom = '8px';
    bLbl.textContent = (selType === 'long' && selSubtype === 'workout') ? 'WORKOUT BLOCKS' : 'INTERVAL BLOCKS';
    bWrap.appendChild(bLbl);
    if (!builderData.blocks || !builderData.blocks.length) builderData.blocks = [defaultBlock()];
    builderData.blocks.forEach((b, bi) => bWrap.appendChild(makeBlock(b, bi, container)));
    const addBtn = document.createElement('button');
    addBtn.type = 'button'; addBtn.className = 'bldr-add'; addBtn.textContent = '+ ADD BLOCK';
    addBtn.addEventListener('click', () => { builderData.blocks.push(defaultBlock()); renderBuilder(container); });
    bWrap.appendChild(addBtn);
    wrap.appendChild(bWrap);
  } else {
    // Tempo / Long-workout: single hard segment
    const hardLbl = selType === 'tempo' ? 'TEMPO BLOCK' : 'MARATHON PACE BLOCK';
    if (!builderData.hard) builderData.hard = { dist: '', unit: 'mi', pace: '' };
    wrap.appendChild(makeSegment('hard', hardLbl, builderData.hard));
  }

  // Cooldown
  wrap.appendChild(makeSegment('cooldown', 'COOLDOWN', builderData.cooldown));

  // Totals bar
  const totDiv = document.createElement('div');
  totDiv.className = 'builder-total'; totDiv.id = 'builderTotal';
  wrap.appendChild(totDiv);

  container.appendChild(wrap);
  updateBuilderTotal();
  renderLoadTemplateRow();
}

function makeSegment(key, title, data) {
  const seg = document.createElement('div'); seg.className = 'builder-seg';
  const lbl = document.createElement('div'); lbl.className = 'builder-seg-title'; lbl.textContent = title;
  seg.appendChild(lbl);
  const fields = document.createElement('div'); fields.className = 'seg-fields';

  // Distance
  const dF = document.createElement('div'); dF.className = 'seg-field';
  const dL = document.createElement('div'); dL.className = 'seg-field-lbl'; dL.textContent = 'DIST';
  const dI = document.createElement('input');
  dI.type = 'number'; dI.step = '0.1'; dI.min = '0';
  dI.className = 'seg-input seg-input-dist'; dI.placeholder = '0'; dI.value = data.dist || '';
  dF.appendChild(dL); dF.appendChild(dI); fields.appendChild(dF);

  // Unit
  const uF = document.createElement('div'); uF.className = 'seg-field';
  const uL = document.createElement('div'); uL.className = 'seg-field-lbl'; uL.textContent = 'UNIT';
  const uS = document.createElement('select'); uS.className = 'seg-input seg-input-unit';
  ['mi', 'm'].forEach(u => {
    const o = document.createElement('option'); o.value = u; o.textContent = u;
    if ((data.unit || 'mi') === u) o.selected = true; uS.appendChild(o);
  });
  uF.appendChild(uL); uF.appendChild(uS); fields.appendChild(uF);

  // Pace
  const pF = document.createElement('div'); pF.className = 'seg-field';
  const pL = document.createElement('div'); pL.className = 'seg-field-lbl'; pL.textContent = 'PACE /mi';
  const pI = document.createElement('input');
  pI.type = 'text'; pI.className = 'seg-input seg-input-pace'; pI.placeholder = '9:00'; pI.value = data.pace || '';
  pF.appendChild(pL); pF.appendChild(pI); fields.appendChild(pF);

  // Time (auto-calc or manual)
  const tF = document.createElement('div'); tF.className = 'seg-field';
  const tL = document.createElement('div'); tL.className = 'seg-field-lbl'; tL.textContent = 'TIME';
  const tI = document.createElement('input');
  tI.type = 'text'; tI.className = 'seg-input seg-input-time'; tI.placeholder = '0:00'; tI.value = data.time || '';
  tF.appendChild(tL); tF.appendChild(tI); fields.appendChild(tF);

  // Auto-calc between dist, pace, time (all in their own units/formats)
  let segAC = false;
  const recalcSeg = (trigger) => {
    if (segAC) return; segAC = true;
    const distMi  = toMiles(dI.value, data.unit || 'mi');
    const paceSec = parsePaceSec(pI.value);
    const timeSec = parsePaceSec(tI.value);
    if (trigger !== tI) {
      if (distMi > 0 && paceSec > 0) { tI.value = formatPaceMS(Math.round(distMi * paceSec)); data.time = tI.value; }
    } else {
      if (distMi > 0 && timeSec > 0)  { pI.value = formatPaceMS(timeSec / distMi); data.pace = pI.value; }
      else if (paceSec > 0 && timeSec > 0) { dI.value = (timeSec / paceSec).toFixed(2); data.dist = dI.value; updateBuilderTotal(); }
    }
    segAC = false;
  };

  dI.addEventListener('input', () => { data.dist = dI.value; updateBuilderTotal(); recalcSeg(dI); });
  uS.addEventListener('change', () => { data.unit = uS.value; updateBuilderTotal(); recalcSeg(dI); });
  pI.addEventListener('input', () => { data.pace = pI.value; recalcSeg(pI); });
  tI.addEventListener('input', () => { data.time = tI.value; recalcSeg(tI); });

  seg.appendChild(fields);
  return seg;
}

function makeBlock(block, blockIdx, container) {
  const el = document.createElement('div'); el.className = 'interval-block';

  // Head row
  const head = document.createElement('div'); head.className = 'block-head';

  const sL = document.createElement('span'); sL.className = 'block-head-lbl'; sL.textContent = 'SETS:';
  const sI = document.createElement('input');
  sI.type = 'number'; sI.min = '1'; sI.className = 'block-sets-inp'; sI.value = block.sets || 1;
  sI.addEventListener('input', () => { block.sets = parseInt(sI.value) || 1; updateBuilderTotal(); });

  const rL = document.createElement('span'); rL.className = 'block-head-lbl'; rL.textContent = 'REST BTW SETS:';
  const rK = document.createElement('select'); rK.className = 'block-rest-kind';
  [['none', 'None'], ['time', 'Time'], ['jog', 'Jog']].forEach(([v, l]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    if ((block.restBetweenSets?.kind || 'none') === v) o.selected = true;
    rK.appendChild(o);
  });
  const rV = document.createElement('input');
  rV.type = 'text'; rV.className = 'block-rest-inp'; rV.value = block.restBetweenSets?.val || '';
  // Unit select for jog rest (m / mi)
  const rUS = document.createElement('select'); rUS.className = 'block-rest-kind';
  ['m', 'mi'].forEach(u => {
    const o = document.createElement('option'); o.value = u; o.textContent = u;
    if ((block.restBetweenSets?.restUnit || 'm') === u) o.selected = true; rUS.appendChild(o);
  });
  const showRV = () => {
    const isNone = rK.value === 'none', isJog = rK.value === 'jog';
    rV.style.display  = isNone ? 'none' : '';
    rUS.style.display = isJog  ? '' : 'none';
    rV.placeholder    = rK.value === 'time' ? '3:00' : '200';
  };
  showRV();
  rK.addEventListener('change', () => {
    if (!block.restBetweenSets) block.restBetweenSets = {};
    block.restBetweenSets.kind = rK.value; showRV(); updateBuilderTotal();
  });
  rV.addEventListener('input', () => {
    if (!block.restBetweenSets) block.restBetweenSets = {};
    block.restBetweenSets.val = rV.value; updateBuilderTotal();
  });
  rUS.addEventListener('change', () => {
    if (!block.restBetweenSets) block.restBetweenSets = {};
    block.restBetweenSets.restUnit = rUS.value; updateBuilderTotal();
  });

  const rmB = document.createElement('button');
  rmB.type = 'button'; rmB.className = 'block-remove'; rmB.textContent = '✕';
  rmB.addEventListener('click', () => {
    if (builderData.blocks.length > 1) {
      builderData.blocks.splice(blockIdx, 1); renderBuilder(container);
    }
  });

  head.appendChild(sL); head.appendChild(sI);
  head.appendChild(rL); head.appendChild(rK); head.appendChild(rV); head.appendChild(rUS);
  head.appendChild(rmB);
  el.appendChild(head);

  // Pieces
  const pWrap = document.createElement('div'); pWrap.className = 'pieces-wrap';
  if (!block.pieces || !block.pieces.length) block.pieces = [defaultPiece('hard')];
  block.pieces.forEach((p, pi) => pWrap.appendChild(makePiece(p, pi, block, container)));

  const addPBtn = document.createElement('button');
  addPBtn.type = 'button'; addPBtn.className = 'bldr-add';
  addPBtn.style.cssText = 'margin:4px 8px 6px;width:calc(100% - 16px)';
  addPBtn.textContent = '+ ADD PIECE';
  addPBtn.addEventListener('click', () => { block.pieces.push(defaultPiece('jog')); renderBuilder(container); });

  el.appendChild(pWrap); el.appendChild(addPBtn);
  return el;
}

function makePiece(piece, pieceIdx, block, container) {
  const card = document.createElement('div');
  card.className = 'piece-card ' + (piece.effort === 'jog' ? 'jog' : 'hard');

  // ── Row 1: dist / time + unit + effort + remove ──
  const row1 = document.createElement('div'); row1.className = 'piece-row-1';

  // Distance input (shown when unit = m or mi)
  const dI = document.createElement('input');
  dI.type = 'number'; dI.step = '1'; dI.min = '0';
  dI.className = 'piece-inp piece-dist'; dI.placeholder = '400'; dI.value = piece.dist || '';
  dI.addEventListener('input', () => { piece.dist = dI.value; updateBuilderTotal(); });

  // Time input (shown when unit = time)
  const tI = document.createElement('input');
  tI.type = 'text'; tI.className = 'piece-inp piece-time';
  tI.placeholder = '2:00'; tI.value = piece.time || '';
  tI.addEventListener('input', () => { piece.time = tI.value; updateBuilderTotal(); });

  // Unit select: m / mi / time
  const uS = document.createElement('select'); uS.className = 'piece-sel piece-unit';
  ['m', 'mi', 'time'].forEach(u => {
    const o = document.createElement('option'); o.value = u; o.textContent = u;
    if ((piece.unit || 'm') === u) o.selected = true; uS.appendChild(o);
  });

  // Effort select
  const eS = document.createElement('select'); eS.className = 'piece-sel piece-effort';
  [['hard', 'Hard'], ['jog', 'Jog']].forEach(([v, l]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    if ((piece.effort || 'hard') === v) o.selected = true; eS.appendChild(o);
  });
  eS.addEventListener('change', () => {
    piece.effort = eS.value;
    card.className = 'piece-card ' + (eS.value === 'jog' ? 'jog' : 'hard');
    updateBuilderTotal();
  });

  // Remove button (top-right)
  const rmB = document.createElement('button');
  rmB.type = 'button'; rmB.className = 'piece-remove'; rmB.textContent = '✕';
  rmB.addEventListener('click', () => {
    block.pieces.splice(pieceIdx, 1);
    if (!block.pieces.length) block.pieces.push(defaultPiece('hard'));
    renderBuilder(container);
  });

  row1.appendChild(dI); row1.appendChild(tI); row1.appendChild(uS);
  row1.appendChild(eS); row1.appendChild(rmB);

  // ── Row 2: pace + rest ──
  const row2 = document.createElement('div'); row2.className = 'piece-row-2';

  // Pace label + input (always visible; required when unit=time, optional for m/mi)
  const pLbl = document.createElement('span'); pLbl.className = 'piece-lbl'; pLbl.textContent = 'PACE:';
  const pI = document.createElement('input');
  pI.type = 'text'; pI.className = 'piece-inp piece-pace';
  pI.placeholder = '6:30'; pI.value = piece.pace || '';
  pI.addEventListener('input', () => { piece.pace = pI.value; updateBuilderTotal(); });

  // Rest: kind + value + unit (for jog)
  const rSep = document.createElement('span'); rSep.className = 'piece-lbl'; rSep.textContent = 'REST:';
  const rK = document.createElement('select'); rK.className = 'piece-sel piece-rkind';
  [['none', 'None'], ['time', 'Time'], ['jog', 'Jog']].forEach(([v, l]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    if ((piece.restAfter?.kind || 'none') === v) o.selected = true; rK.appendChild(o);
  });
  const rV = document.createElement('input');
  rV.type = 'text'; rV.className = 'piece-inp piece-rval'; rV.value = piece.restAfter?.val || '';
  const rUS = document.createElement('select'); rUS.className = 'piece-sel piece-runit';
  ['m', 'mi'].forEach(u => {
    const o = document.createElement('option'); o.value = u; o.textContent = u;
    if ((piece.restAfter?.restUnit || 'm') === u) o.selected = true; rUS.appendChild(o);
  });

  const syncRest = () => {
    const isNone = rK.value === 'none', isJog = rK.value === 'jog';
    rV.style.display  = isNone ? 'none' : '';
    rUS.style.display = isJog  ? ''     : 'none';
    rV.placeholder    = rK.value === 'time' ? '2:00' : '200';
  };
  syncRest();
  rK.addEventListener('change',  () => { if (!piece.restAfter) piece.restAfter = {}; piece.restAfter.kind     = rK.value;  syncRest(); updateBuilderTotal(); });
  rV.addEventListener('input',   () => { if (!piece.restAfter) piece.restAfter = {}; piece.restAfter.val      = rV.value;  updateBuilderTotal(); });
  rUS.addEventListener('change', () => { if (!piece.restAfter) piece.restAfter = {}; piece.restAfter.restUnit = rUS.value; updateBuilderTotal(); });

  row2.appendChild(pLbl); row2.appendChild(pI);
  row2.appendChild(rSep); row2.appendChild(rK); row2.appendChild(rV); row2.appendChild(rUS);

  // ── Toggle dist/time + pace hint based on unit ──
  const syncUnit = () => {
    const isTime = uS.value === 'time';
    dI.style.display   = isTime ? 'none' : '';
    tI.style.display   = isTime ? ''     : 'none';
    pLbl.textContent   = isTime ? 'PACE /mi (req):' : 'PACE:';
    piece.unit = uS.value;
    updateBuilderTotal();
  };
  uS.addEventListener('change', syncUnit);
  syncUnit();

  card.appendChild(row1); card.appendChild(row2);
  return card;
}

function calcBuilderMiles() {
  if (!builderData) return { easy: 0, hard: 0 };
  let easy = 0, hard = 0;
  easy += toMiles(builderData.warmup?.dist,   builderData.warmup?.unit   || 'mi');
  easy += toMiles(builderData.cooldown?.dist, builderData.cooldown?.unit || 'mi');
  const usesBlocks = selType === 'intervals' || (selType === 'long' && selSubtype === 'workout');
  if (usesBlocks) {
    (builderData.blocks || []).forEach(block => {
      const sets = parseInt(block.sets) || 1;
      (block.pieces || []).forEach(p => {
        // Distance: from time+pace if unit='time', otherwise from dist+unit
        const mi = p.unit === 'time'
          ? calcDistFromTimePace(p.time, p.pace)
          : toMiles(p.dist, p.unit || 'm');
        if (p.effort === 'hard') hard += mi * sets; else easy += mi * sets;
        // Jog rest after piece = easy miles (use restUnit, default m)
        if (p.restAfter?.kind === 'jog' && p.restAfter.val)
          easy += toMiles(p.restAfter.val, p.restAfter.restUnit || 'm') * sets;
      });
      // Jog rest between sets = easy miles × (sets − 1)
      if (block.restBetweenSets?.kind === 'jog' && block.restBetweenSets.val)
        easy += toMiles(block.restBetweenSets.val, block.restBetweenSets.restUnit || 'm') * Math.max(0, sets - 1);
    });
  } else {
    hard += toMiles(builderData.hard?.dist, builderData.hard?.unit || 'mi');
  }
  return { easy, hard };
}

function updateBuilderTotal() {
  const totDiv = document.getElementById('builderTotal');
  if (!totDiv || !builderData) return;
  const { easy, hard } = calcBuilderMiles();
  const total = easy + hard;
  totDiv.innerHTML = `
    <span class="btot-item"><strong>${total.toFixed(2)}</strong> total mi</span>
    <span class="btot-item"><strong>${easy.toFixed(2)}</strong> easy mi</span>
    <span class="btot-item hard"><strong>${hard.toFixed(2)}</strong> hard mi</span>`;
  updateBuilderSummary();
}

// ── Calendar ───────────────────────────────────────────────────────────────

function renderCalendar() {
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  DOW.forEach(d => { const el = document.createElement('div'); el.className = 'dow-header'; el.textContent = d; grid.appendChild(el); });

  const today    = new Date();
  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay  = new Date(viewYear, viewMonth + 1, 0);
  let startOffset = firstDay.getDay();
  startOffset = startOffset === 0 ? 6 : startOffset - 1;

  for (let i = 0; i < startOffset; i++) {
    const d = new Date(viewYear, viewMonth, -(startOffset - i - 1));
    grid.appendChild(makeCell(d.getFullYear(), d.getMonth(), d.getDate(), true));
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && d === today.getDate();
    grid.appendChild(makeCell(viewYear, viewMonth, d, false, isToday));
  }
  const total = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;
  for (let i = 1; i <= total - startOffset - lastDay.getDate(); i++) {
    const d = new Date(viewYear, viewMonth + 1, i);
    grid.appendChild(makeCell(d.getFullYear(), d.getMonth(), d.getDate(), true));
  }
  document.getElementById('monthTitle').textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  updateSidebar();
}

function makeCell(year, month, day, otherMonth, isToday = false) {
  const key = dateKey(year, month, day);
  const ws  = workouts[key] || [];
  const cell = document.createElement('div');
  cell.className = 'day-cell' + (otherMonth ? ' other-month' : '') + (isToday ? ' today' : '');

  const num = document.createElement('div'); num.className = 'day-num'; num.textContent = day;
  cell.appendChild(num);

  if (ws.length) {
    const wrap = document.createElement('div'); wrap.className = 'chips-wrap';
    ws.forEach(w => {
      const ti   = typeInfo(w.type);
      const chip = document.createElement('div');
      chip.className = 'workout-chip'; chip.style.background = ti.color;
      const trow = document.createElement('div'); trow.className = 'chip-type'; trow.textContent = ti.label + (w.completed ? ' ✓' : '');
      chip.appendChild(trow);
      if (w.distance && w.type !== 'rest') {
        const dist = document.createElement('div'); dist.className = 'chip-dist';
        let dtxt = `${parseFloat(w.distance).toFixed(1)} mi`;
        if (w.hardMiles > 0) dtxt += ` · ${w.hardMiles.toFixed(1)} hard`;
        else if (w.pace)     dtxt += ` @ ${w.pace}`;
        dist.textContent = dtxt; chip.appendChild(dist);
      }
      if (w.duration && w.type !== 'rest') { const dur  = document.createElement('div'); dur.className  = 'chip-duration'; dur.textContent  = w.duration; chip.appendChild(dur); }
      chip.addEventListener('click', e => { e.stopPropagation(); openModal(key, w.id); });
      wrap.appendChild(chip);
    });
    cell.appendChild(wrap);
  }

  if (!otherMonth) {
    const hint = document.createElement('div'); hint.className = 'add-hint';
    hint.innerHTML = '<span class="add-hint-icon">+</span> ADD WORKOUT';
    cell.appendChild(hint);
    cell.addEventListener('click', () => openModal(key, null));
  }
  return cell;
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function updateSidebar() { updateStats(); updateWeekBars(); updateUpcoming(); }

function updateStats() {
  const all = monthWorkouts();
  let total = 0, count = 0, done = 0;
  all.forEach(w => {
    if (w.type !== 'rest') count++;
    if (w.completed) done++;
    if (w.distance) total += parseFloat(w.distance);
  });
  document.getElementById('statDist').textContent = total.toFixed(1);
  document.getElementById('statRuns').textContent = count;
  document.getElementById('statDone').textContent = done;
}

function updateWeekBars() {
  const bars = document.getElementById('weekBars'); bars.innerHTML = '';
  const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
  const weekTotals = {}, allWeeks = new Set();
  for (let d = 1; d <= lastDay; d++) {
    const wk = getWeekOfMonth(new Date(viewYear, viewMonth, d));
    allWeeks.add(wk);
    (workouts[dateKey(viewYear, viewMonth, d)] || []).forEach(w => {
      if (w.distance) weekTotals[wk] = (weekTotals[wk] || 0) + parseFloat(w.distance);
    });
  }
  const keys = [...allWeeks].sort((a,b) => a-b);
  const max  = Math.max(...Object.values(weekTotals), 1);
  keys.forEach((wk, i) => {
    const dist = weekTotals[wk] || 0;
    const bar  = document.createElement('div'); bar.className = 'wbar';
    const fill = document.createElement('div'); fill.className = 'wbar-fill';
    fill.style.height  = dist > 0 ? `${Math.max((dist/max)*42,3)}px` : '3px';
    fill.style.opacity = dist > 0 ? '1' : '0.2';
    fill.title = `Week ${i+1}: ${dist.toFixed(1)} mi`;
    const lbl  = document.createElement('div'); lbl.className = 'wbar-label'; lbl.textContent = dist.toFixed(0);
    bar.appendChild(fill); bar.appendChild(lbl); bars.appendChild(bar);
  });
}

function getWeekOfMonth(d) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const dow = first.getDay(), offset = dow <= 1 ? 1 - dow : 8 - dow;
  const monday = new Date(first); monday.setDate(first.getDate() + offset - 7);
  return Math.ceil((d - monday) / (7 * 86400000));
}

function updateUpcoming() {
  const list = document.getElementById('upcomingList'); list.innerHTML = '';
  const today = new Date(); today.setHours(0,0,0,0);
  const upcoming = Object.entries(workouts)
    .filter(([k]) => parseKey(k) >= today)
    .sort(([a],[b]) => a.localeCompare(b))
    .flatMap(([k, ws]) => ws.map(w => ({ ...w, key: k })))
    .slice(0, 8);
  if (!upcoming.length) { list.innerHTML = '<div class="empty-msg">No upcoming workouts</div>'; return; }
  upcoming.forEach(w => {
    const ti = typeInfo(w.type);
    const item = document.createElement('div'); item.className = 'upcoming-item';
    item.innerHTML = `<div class="upcoming-dot" style="background:${ti.color}"></div><div class="upcoming-info"><div class="upcoming-date">${fmtDateShort(w.key)}</div><div class="upcoming-type">${ti.label}${w.completed?' ✓':''}</div></div><div class="upcoming-dist">${w.distance?parseFloat(w.distance).toFixed(1)+' mi':''}</div>`;
    item.addEventListener('click', () => openModal(w.key, w.id));
    list.appendChild(item);
  });
}

// ── Race Countdown ─────────────────────────────────────────────────────────

function updateRaceCountdown(dateStr) {
  if (!dateStr) return;
  const race = new Date(dateStr + 'T00:00:00'), today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((race - today) / 86400000);
  const txt  = document.getElementById('raceCountdownText');
  const hdr  = document.getElementById('saveStatus'); // we only update txt; status used for save feedback
  if (diff > 0)      txt.textContent = `🎯 ${diff} DAYS TO RACE DAY`;
  else if (diff ===0) txt.textContent = '🎉 RACE DAY IS TODAY!';
  else               txt.textContent = `RACE WAS ${Math.abs(diff)} DAYS AGO`;
}

// ── Week View ──────────────────────────────────────────────────────────────

function getMonday(date) {
  const d = new Date(date); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
  return d;
}

function renderWeekView() {
  const container = document.getElementById('weekDays'); if (!container) return;
  container.innerHTML = '';
  if (!viewWeekStart) viewWeekStart = getMonday(new Date());

  const today = new Date(); today.setHours(0,0,0,0);
  const weekEnd = new Date(viewWeekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  const s = viewWeekStart.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const e = weekEnd.toLocaleDateString('en-US',       { month:'short', day:'numeric', year:'numeric' });
  document.getElementById('weekTitle').textContent = `${s} – ${e}`;

  const DS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  for (let i = 0; i < 7; i++) {
    const date = new Date(viewWeekStart); date.setDate(date.getDate() + i);
    const key = dateKey(date.getFullYear(), date.getMonth(), date.getDate());
    const ws  = workouts[key] || [];
    const isToday = date.getTime() === today.getTime();

    const row = document.createElement('div'); row.className = 'week-day-row' + (isToday ? ' wdr-today' : '');

    const head = document.createElement('div'); head.className = 'wdr-head';
    const dow  = document.createElement('div'); dow.className  = 'wdr-dow';  dow.textContent = DS[i];
    const num  = document.createElement('div'); num.className  = 'wdr-num' + (isToday ? ' wdr-num-today' : ''); num.textContent = date.getDate();
    head.appendChild(dow); head.appendChild(num);

    const body = document.createElement('div'); body.className = 'wdr-body';
    ws.forEach(w => {
      const ti   = typeInfo(w.type);
      const chip = document.createElement('div'); chip.className = 'workout-chip wdr-chip'; chip.style.background = ti.color;
      const lbl  = document.createElement('span'); lbl.className = 'chip-type'; lbl.textContent = ti.label + (w.completed ? ' ✓' : '');
      chip.appendChild(lbl);
      if (w.distance && w.type !== 'rest') {
        const dist = document.createElement('span'); dist.className = 'wdr-chip-dist';
        let dtxt = `${parseFloat(w.distance).toFixed(1)} mi`;
        if (w.hardMiles > 0) dtxt += ` · ${w.hardMiles.toFixed(1)} hard`;
        else if (w.pace)     dtxt += ` @ ${w.pace}`;
        dist.textContent = dtxt; chip.appendChild(dist);
      }
      chip.addEventListener('click', ev => { ev.stopPropagation(); openModal(key, w.id); });
      body.appendChild(chip);
    });
    const hint = document.createElement('div'); hint.className = 'wdr-hint';
    hint.textContent = ws.length ? '+ ADD ANOTHER' : '+ ADD WORKOUT';
    hint.addEventListener('click', ev => { ev.stopPropagation(); openModal(key, null); });
    body.appendChild(hint);

    row.addEventListener('click', () => openModal(key, null));
    row.appendChild(head); row.appendChild(body);
    container.appendChild(row);
  }
  updateSidebar();
}

function render() { renderCalendar(); renderWeekView(); }



// ── Modal ──────────────────────────────────────────────────────────────────

function openModal(key, id) {
  // Ensure we're NOT in template mode
  templateMode = false; editingTemplateId = null;
  document.getElementById('templateNameField').style.display = 'none';
  document.getElementById('effortField').style.display       = '';
  document.getElementById('notesField').style.display        = '';
  document.getElementById('completedField').style.display    = '';
  document.getElementById('saveBtn').textContent             = 'Save Workout';

  selDate = key; selId = id;
  const ws = workouts[key] || [], w = id ? ws.find(x => x.id === id) : null;
  document.getElementById('modalTitle').textContent   = w ? 'Edit Workout' : 'Add Workout';
  document.getElementById('modalDateStr').textContent = fmtDateLong(key);
  document.getElementById('deleteBtn').style.display  = w ? '' : 'none';
  selType     = w ? w.type                         : 'easy';
  selSubtype  = w ? (w.subtype  || 'easy')         : 'easy';
  selEffort   = w ? (w.effort   ?? null)           : null;
  completedOn = w ? !!w.completed                  : false;
  builderData = w?.structure ? JSON.parse(JSON.stringify(w.structure)) : null;
  document.getElementById('distInput').value  = w?.distance ?? '';
  document.getElementById('paceInput').value  = w?.pace     ?? '';
  document.getElementById('durInput').value   = w?.duration  ?? '';
  document.getElementById('notesInput').value = w?.notes     ?? '';
  renderTypePills(); renderEffortBtns(); syncToggle();
  document.getElementById('overlay').classList.add('open');
  setTimeout(() => { if (!isStructured()) document.getElementById('distInput')?.focus(); }, 60);
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  templateMode = false; editingTemplateId = null;
  document.getElementById('templateNameField').style.display       = 'none';
  document.getElementById('templateVisibilityField').style.display = 'none';
  document.getElementById('tplToggleTrack').classList.remove('on');
  document.getElementById('tplToggleLabel').textContent            = 'Private – only visible to you';
  document.getElementById('effortField').style.display             = '';
  document.getElementById('notesField').style.display              = '';
  document.getElementById('completedField').style.display          = '';
  document.getElementById('saveBtn').textContent                   = 'Save Workout';
  document.querySelector('.modal').classList.remove('wide');
}

function renderTypePills() {
  const wrap = document.getElementById('typePills'); wrap.innerHTML = '';
  TYPES.forEach(t => {
    const pill = document.createElement('div');
    pill.className = 'type-pill' + (selType === t.id ? ' active' : '');
    pill.style.background = t.color; pill.textContent = t.label;
    pill.addEventListener('click', () => {
      selType = t.id;
      builderData = null;
      if (selType !== 'long') selSubtype = 'easy';
      renderTypePills();
    });
    wrap.appendChild(pill);
  });
  renderModalForm();
}

function renderEffortBtns() {
  const row = document.getElementById('effortRow'); row.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('button'); btn.type = 'button';
    btn.className = 'effort-btn' + (selEffort === i ? ' active' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => { selEffort = selEffort === i ? null : i; renderEffortBtns(); });
    row.appendChild(btn);
  }
}

function syncToggle() { document.getElementById('toggleTrack').classList.toggle('on', completedOn); }

document.getElementById('completedToggle').addEventListener('click', () => { completedOn = !completedOn; syncToggle(); });

// ── Simple form auto-calc: dist ↔ pace ↔ duration ─────────────────────────
let simpleAC = false;
function autoCalcSimple(trigger) {
  if (simpleAC || document.getElementById('simpleFields').style.display === 'none') return;
  simpleAC = true;
  const distEl = document.getElementById('distInput');
  const paceEl = document.getElementById('paceInput');
  const durEl  = document.getElementById('durInput');
  const dist    = parseFloat(distEl.value) || 0;
  const paceSec = parsePaceSec(paceEl.value);
  const durSec  = parseDurationSec(durEl.value);
  if ((trigger === 'dist' || trigger === 'pace') && dist > 0 && paceSec > 0) {
    // dist + pace → duration
    durEl.value = formatDurationHM(Math.round(dist * paceSec));
  } else if (trigger === 'dur' && durSec > 0) {
    if (dist > 0)      paceEl.value = formatPaceMS(durSec / dist);        // dist + dur → pace
    else if (paceSec > 0) distEl.value = (durSec / paceSec).toFixed(2);   // pace + dur → dist
  }
  simpleAC = false;
}
document.getElementById('distInput').addEventListener('input', () => autoCalcSimple('dist'));
document.getElementById('paceInput').addEventListener('input', () => autoCalcSimple('pace'));
document.getElementById('durInput').addEventListener('input',  () => autoCalcSimple('dur'));

// ── Save workout ───────────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', () => {
  if (templateMode) { saveTemplateFromModal(); return; }
  const notes = document.getElementById('notesInput').value.trim();
  const dur   = document.getElementById('durInput').value.trim();
  let dist, pace, easyMiles, hardMiles, structure;

  if (isStructured()) {
    const { easy, hard } = calcBuilderMiles();
    dist      = (easy + hard) > 0 ? easy + hard : null;
    easyMiles = easy;
    hardMiles = hard;
    structure = builderData ? JSON.parse(JSON.stringify(builderData)) : null;
    pace      = null;
  } else {
    const raw = document.getElementById('distInput').value;
    dist      = raw ? parseFloat(raw) : null;
    pace      = document.getElementById('paceInput').value.trim() || null;
    easyMiles = null;
    hardMiles = null;
    structure = null;
  }

  if (!workouts[selDate]) workouts[selDate] = [];
  const ws  = workouts[selDate];
  const obj = {
    type:      selType,
    subtype:   selType === 'long' ? selSubtype : null,
    distance:  dist,
    pace,
    duration:  dur || null,
    effort:    selEffort,
    notes:     notes || null,
    completed: completedOn,
    easyMiles, hardMiles, structure,
    savedAt:   new Date().toISOString()
  };

  if (selId) {
    const idx = ws.findIndex(x => x.id === selId);
    if (idx !== -1) ws[idx] = { ...ws[idx], ...obj };
  } else {
    ws.push({ id: genId(), ...obj });
  }
  save(); render(); closeModal();
});

// ── Delete workout ─────────────────────────────────────────────────────────

document.getElementById('deleteBtn').addEventListener('click', () => {
  if (templateMode) {
    if (!editingTemplateId || !confirm('Delete this template?')) return;
    templates = templates.filter(t => t.id !== editingTemplateId);
    saveTemplates(); renderTemplatesCard(); closeModal();
    return;
  }
  if (!selDate || !selId || !confirm('Delete this workout?')) return;
  workouts[selDate] = (workouts[selDate] || []).filter(x => x.id !== selId);
  if (workouts[selDate].length === 0) delete workouts[selDate];
  save(); render(); closeModal();
});

// ── Navigation ─────────────────────────────────────────────────────────────

document.getElementById('prevBtn').addEventListener('click',  () => { viewMonth--; if (viewMonth < 0)  { viewMonth = 11; viewYear--; } renderCalendar(); });
document.getElementById('nextBtn').addEventListener('click',  () => { viewMonth++; if (viewMonth > 11) { viewMonth =  0; viewYear++; } renderCalendar(); });
document.getElementById('todayBtn').addEventListener('click', () => { const n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth(); viewWeekStart = getMonday(n); render(); });

document.getElementById('prevWeekBtn').addEventListener('click', () => { viewWeekStart = new Date(viewWeekStart); viewWeekStart.setDate(viewWeekStart.getDate() - 7); renderWeekView(); });
document.getElementById('nextWeekBtn').addEventListener('click', () => { viewWeekStart = new Date(viewWeekStart); viewWeekStart.setDate(viewWeekStart.getDate() + 7); renderWeekView(); });
document.getElementById('weekTodayBtn').addEventListener('click', () => { viewWeekStart = getMonday(new Date()); renderWeekView(); });

document.getElementById('closeBtn').addEventListener('click',  closeModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('overlay').addEventListener('click',   e => { if (e.target === document.getElementById('overlay')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.getElementById('fab').addEventListener('click', () => { const t = new Date(); openModal(dateKey(t.getFullYear(), t.getMonth(), t.getDate()), null); });

document.getElementById('raceDateInput').addEventListener('change', e => { updateRaceCountdown(e.target.value); save(); });

// ── Statistics ─────────────────────────────────────────────────────────────

let statsMonthDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let statsWeekSel   = 'all';   // 'all' | 0 | 1 | 2 | 3 | 4 (week index within month)

// Returns array of Monday dates for each week overlapping the current stats month
function getWeeksInStatsMonth() {
  const y = statsMonthDate.getFullYear(), m = statsMonthDate.getMonth();
  const lastDay = new Date(y, m + 1, 0);
  const cur = getMonday(new Date(y, m, 1));
  const weeks = [];
  while (cur <= lastDay) { weeks.push(new Date(cur)); cur.setDate(cur.getDate() + 7); }
  return weeks;
}

// ── Aggregate all stats data for the selected period ──────────────────────

function getStatData() {
  let totalMi = 0, easyMi = 0, hardMi = 0;
  let completedCount = 0, totalCount = 0;
  let effortSum = 0, effortCount = 0;
  const typeTotals = {};
  TYPES.forEach(t => typeTotals[t.id] = 0);
  const workoutList = [];

  const processWorkout = (w, key) => {
    const dist = parseFloat(w.distance) || 0;
    totalMi += dist;
    if (dist > 0 && typeTotals.hasOwnProperty(w.type)) typeTotals[w.type] += dist;

    // Easy / hard miles split
    if (w.easyMiles != null || w.hardMiles != null) {
      // Structured workout: use stored values
      easyMi += parseFloat(w.easyMiles) || 0;
      hardMi += parseFloat(w.hardMiles) || 0;
    } else {
      // Simple workout: classify by type
      const isHard = w.type === 'tempo' || w.type === 'intervals' || w.type === 'race';
      if (isHard) hardMi += dist; else easyMi += dist;
    }

    if (w.type !== 'rest') {
      totalCount++;
      if (w.completed) completedCount++;
    }

    if (w.effort != null) { effortSum += w.effort; effortCount++; }
    workoutList.push({ ...w, key });
  };

  if (statsWeekSel === 'all') {
    const y = statsMonthDate.getFullYear(), m = statsMonthDate.getMonth();
    Object.entries(workouts).forEach(([key, wList]) => {
      const d = parseKey(key);
      if (d.getFullYear() === y && d.getMonth() === m)
        wList.forEach(w => processWorkout(w, key));
    });
  } else {
    const mon = getWeeksInStatsMonth()[statsWeekSel];
    if (mon) {
      for (let d = 0; d < 7; d++) {
        const day = new Date(mon); day.setDate(day.getDate() + d);
        const key = dateKey(day.getFullYear(), day.getMonth(), day.getDate());
        (workouts[key] || []).forEach(w => processWorkout(w, key));
      }
    }
  }

  workoutList.sort((a, b) => b.key.localeCompare(a.key));
  const avgEffort = effortCount > 0 ? effortSum / effortCount : null;
  return { totalMi, easyMi, hardMi, completedCount, totalCount, avgEffort, typeTotals, workoutList };
}

function renderWeekFilterBtns() {
  const weeks = getWeeksInStatsMonth();
  const wrap  = document.getElementById('statsWeekFilter');
  wrap.innerHTML = '';
  const makeBtn = (label, val) => {
    const b = document.createElement('button');
    b.className = 'wf-btn' + (statsWeekSel === val ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { statsWeekSel = val; renderStats(); });
    wrap.appendChild(b);
  };
  makeBtn('MONTH', 'all');
  weeks.forEach((mon, i) => {
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    makeBtn(`W${i + 1}  ${fmt(mon)}–${fmt(sun)}`, i);
  });
}

function renderStats() {
  document.getElementById('statsPeriodLabel').textContent =
    statsMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  renderWeekFilterBtns();

  const { totalMi, easyMi, hardMi, completedCount, totalCount, avgEffort, typeTotals, workoutList } = getStatData();
  const kpisEl   = document.getElementById('statsKpis');
  const intensEl = document.getElementById('statsIntensity');
  const bdEl     = document.getElementById('statsBreakdown');
  const logEl    = document.getElementById('statsLog');

  if (totalMi === 0 && totalCount === 0) {
    kpisEl.innerHTML = intensEl.innerHTML = bdEl.innerHTML = '';
    bdEl.innerHTML = '<div class="stats-empty">No workouts logged for this period</div>';
    logEl.innerHTML = '';
    return;
  }

  // ── KPI chips ──────────────────────────────────────────────────────────────
  const completionPct = totalCount > 0 ? Math.round(completedCount / totalCount * 100) : 0;
  const hasEffort     = avgEffort != null;
  kpisEl.style.gridTemplateColumns = `repeat(${hasEffort ? 5 : 4}, 1fr)`;
  kpisEl.innerHTML = `
    <div class="stats-kpi">
      <div class="stats-kpi-val">${totalMi.toFixed(1)}</div>
      <div class="stats-kpi-lbl">Total mi</div>
    </div>
    <div class="stats-kpi">
      <div class="stats-kpi-val kpi-red">${hardMi.toFixed(1)}</div>
      <div class="stats-kpi-lbl">Hard mi</div>
    </div>
    <div class="stats-kpi">
      <div class="stats-kpi-val kpi-green">${easyMi.toFixed(1)}</div>
      <div class="stats-kpi-lbl">Easy mi</div>
    </div>
    <div class="stats-kpi">
      <div class="stats-kpi-val">${completedCount}<span style="font-size:15px;opacity:0.38"> /${totalCount}</span></div>
      <div class="stats-kpi-lbl">Done</div>
    </div>
    ${hasEffort ? `<div class="stats-kpi">
      <div class="stats-kpi-val">${avgEffort.toFixed(1)}</div>
      <div class="stats-kpi-lbl">Avg RPE</div>
    </div>` : ''}`;

  // ── Intensity split bar ────────────────────────────────────────────────────
  const splitTotal = easyMi + hardMi;
  if (splitTotal > 0) {
    const ePct = (easyMi / splitTotal * 100).toFixed(1);
    const hPct = (hardMi / splitTotal * 100).toFixed(1);
    intensEl.innerHTML = `
      <div class="intensity-section">
        <div class="intensity-label">Intensity Split</div>
        <div class="intensity-bar">
          <div class="intensity-easy" style="width:${ePct}%"></div>
          <div class="intensity-hard" style="width:${hPct}%"></div>
        </div>
        <div class="intensity-legend">
          <span class="il-easy">Easy ${easyMi.toFixed(1)} mi (${Math.round(parseFloat(ePct))}%)</span>
          <span class="il-hard">Hard ${hardMi.toFixed(1)} mi (${Math.round(parseFloat(hPct))}%)</span>
        </div>
      </div>`;
  } else {
    intensEl.innerHTML = '';
  }

  // ── Type breakdown ─────────────────────────────────────────────────────────
  const grand = Object.values(typeTotals).reduce((s, v) => s + v, 0);
  bdEl.innerHTML = '';
  if (grand > 0) {
    const lbl = document.createElement('div'); lbl.className = 'breakdown-section-label'; lbl.textContent = 'By Workout Type';
    bdEl.appendChild(lbl);
    TYPES.filter(t => typeTotals[t.id] > 0)
      .sort((a, b) => typeTotals[b.id] - typeTotals[a.id])
      .forEach(t => {
        const pct      = typeTotals[t.id] / grand * 100;
        const typeHard = workoutList
          .filter(w => w.type === t.id && (parseFloat(w.hardMiles) || 0) > 0)
          .reduce((s, w) => s + (parseFloat(w.hardMiles) || 0), 0);
        const hardTag  = typeHard > 0
          ? `<span class="breakdown-hard"> · ${typeHard.toFixed(1)} hard</span>` : '';
        const row = document.createElement('div'); row.className = 'breakdown-row';
        row.innerHTML = `
          <div class="breakdown-name"><div class="legend-dot" style="background:${t.color}"></div>${t.label.toUpperCase()}</div>
          <div class="breakdown-track"><div class="breakdown-fill" style="width:${pct.toFixed(1)}%;background:${t.color}"></div></div>
          <div class="breakdown-pct">${Math.round(pct)}%</div>
          <div class="breakdown-mi">${typeTotals[t.id].toFixed(1)} mi${hardTag}</div>`;
        bdEl.appendChild(row);
      });
  }

  // ── Workout log ────────────────────────────────────────────────────────────
  if (workoutList.length) {
    logEl.innerHTML = '<div class="stats-log-label">Workout Log</div>';
    const listEl = document.createElement('div'); listEl.className = 'stats-log-list';
    workoutList.forEach(w => {
      const ti    = typeInfo(w.type);
      const d     = parseKey(w.key);
      const dow   = d.toLocaleDateString('en-US', { weekday: 'short' });
      const mday  = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dist  = w.distance ? `${parseFloat(w.distance).toFixed(1)} mi` : '—';
      const hard  = (parseFloat(w.hardMiles) || 0) > 0 ? `${parseFloat(w.hardMiles).toFixed(1)} hard` : '';
      const rpe   = w.effort != null ? `RPE ${w.effort}` : '';
      const rpeColor = !w.effort ? '' : w.effort >= 8 ? 'color:var(--red)' : w.effort >= 5 ? 'color:#C8511A' : 'color:#2E7D5B';
      const doneEl = w.completed
        ? '<div class="sli-done">✓</div>'
        : '<div class="sli-pending">○</div>';
      const item = document.createElement('div'); item.className = 'stats-log-item';
      item.innerHTML = `
        <div class="sli-date"><div>${dow}</div><div>${mday}</div></div>
        <div class="sli-type"><div class="sli-dot" style="background:${ti.color}"></div>${ti.label}</div>
        <div class="sli-dist">${dist}</div>
        <div class="sli-hard">${hard}</div>
        <div class="sli-rpe" style="${rpeColor}">${rpe}</div>
        ${doneEl}`;
      item.addEventListener('click', () => {
        document.getElementById('tabWorkout').click();
        // Navigate calendar to that month then open
        const dd = parseKey(w.key);
        viewYear = dd.getFullYear(); viewMonth = dd.getMonth();
        render();
        setTimeout(() => openModal(w.key, w.id), 80);
      });
      listEl.appendChild(item);
    });
    logEl.appendChild(listEl);
  } else {
    logEl.innerHTML = '';
  }
}

// ── Stats navigation ────────────────────────────────────────────────────────

document.getElementById('statsPrevBtn').addEventListener('click', () => {
  statsMonthDate = new Date(statsMonthDate.getFullYear(), statsMonthDate.getMonth() - 1, 1);
  statsWeekSel = 'all';
  renderStats();
});

document.getElementById('statsNextBtn').addEventListener('click', () => {
  statsMonthDate = new Date(statsMonthDate.getFullYear(), statsMonthDate.getMonth() + 1, 1);
  statsWeekSel = 'all';
  renderStats();
});

document.getElementById('statsNowBtn').addEventListener('click', () => {
  statsMonthDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  statsWeekSel = 'all';
  renderStats();
});

// ── View tab switching ──────────────────────────────────────────────────────

document.getElementById('tabWorkout').addEventListener('click', () => {
  document.getElementById('tabWorkout').classList.add('active');
  document.getElementById('tabStats').classList.remove('active');
  document.getElementById('appWorkout').style.display = '';
  document.getElementById('appStats').classList.remove('visible');
});

document.getElementById('tabStats').addEventListener('click', () => {
  document.getElementById('tabStats').classList.add('active');
  document.getElementById('tabWorkout').classList.remove('active');
  document.getElementById('appWorkout').style.display = 'none';
  document.getElementById('appStats').classList.add('visible');
  renderStats();
});

// ── Athlete switcher (coach mode) ──────────────────────────────────────────

document.getElementById('athleteSelect').addEventListener('change', async function() {
  viewingAs = this.value === '__self__' ? currentUser : this.value;
  updateHeaderTitle();
  workouts = {};
  render();
  setSaveStatus('Loading…');
  try {
    await loadWorkoutsFor(viewingAs);
    setSaveStatus('');
  } catch(e) { /* already handled inside */ }
  render();
  // Re-render stats if stats tab is active
  if (document.getElementById('appStats').classList.contains('visible')) renderStats();
});

// ── Template event listeners ───────────────────────────────────────────────

document.getElementById('templateSelect').addEventListener('change', function() {
  if (!this.value) return;
  // Check if it's a shared template (prefixed with 'shared:')
  let tpl;
  if (this.value.startsWith('shared:')) {
    const sharedId = this.value.replace('shared:', '');
    tpl = publicTemplates.find(t => t.id === sharedId);
  } else {
    tpl = templates.find(t => t.id === this.value);
  }
  if (!tpl) return;
  if (tpl.structure) {
    builderData = JSON.parse(JSON.stringify(tpl.structure));
    const bldrEl = document.getElementById('builderSection');
    if (bldrEl) renderBuilder(bldrEl);
  } else {
    document.getElementById('distInput').value = tpl.dist     || '';
    document.getElementById('paceInput').value = tpl.pace     || '';
    document.getElementById('durInput').value  = tpl.duration || '';
  }
  this.value = '';   // reset dropdown after loading
});

document.getElementById('newTemplateBtn').addEventListener('click', () => openModalForTemplate(null));

// Visibility toggle click
document.getElementById('templatePublicToggle').addEventListener('click', function() {
  const track = document.getElementById('tplToggleTrack');
  const label = document.getElementById('tplToggleLabel');
  const isNowPublic = !track.classList.contains('on');
  track.classList.toggle('on', isNowPublic);
  label.textContent = isNowPublic
    ? 'Public – visible to all runners'
    : 'Private – only visible to you';
});

// ── Init ───────────────────────────────────────────────────────────────────

auth.onAuthStateChanged(function(authUser) {
  if (!authUser) { window.location.href = 'login.html'; return; }
  currentUser = authUser.displayName || '';
  viewingAs   = currentUser;
  updateHeaderTitle();

  const _n  = new Date();
  viewYear  = _n.getFullYear();
  viewMonth = _n.getMonth();
  viewWeekStart = getMonday(_n);

  load().then(() => { render(); });
  loadPublicTemplates();
});

// ============================================================
//  PDF Export  (window.print())
// ============================================================

function exportPDF() {
  buildPrintView();
  const pv = document.getElementById('printView');

  const ua = navigator.userAgent;
  const isIOS       = /iPad|iPhone|iPod/.test(ua);
  const isMacSafari = !isIOS && /Safari/.test(ua) && !/Chrome/.test(ua) && !/Chromium/.test(ua) && !/CriOS/.test(ua);
  const needsOverlay = isIOS || isMacSafari;

  if (needsOverlay) {
    const tip = isIOS
      ? 'Tap <strong>SAVE AS PDF</strong> &rarr; Print &rarr; Share &rarr; Save to Files'
      : 'Click <strong>SAVE AS PDF</strong> &rarr; in the print dialog choose <strong>Save as PDF</strong>';

    const overlay = document.createElement('div');
    overlay.id = 'pdf-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white;display:flex;flex-direction:column;';
    // Use inline onclick — Safari requires window.print() to fire from a native HTML
    // event attribute, not from addEventListener on a dynamically created element.
    const closeScript = "var o=document.getElementById('pdf-overlay');if(o)o.remove();var p=document.getElementById('printView');if(p)p.remove();";
    overlay.innerHTML =
      '<div style="background:#1a2240;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0">'
      + '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:13px;letter-spacing:0.15em;color:rgba(255,255,255,0.45);flex:1">TRAINING PLAN</span>'
      + '<button onclick="window.print()" style="font-family:\'Bebas Neue\',sans-serif;font-size:13px;letter-spacing:0.1em;background:#C8392B;color:white;border:none;padding:9px 18px;border-radius:3px;cursor:pointer">&#8595; SAVE AS PDF</button>'
      + '<button onclick="' + closeScript + '" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:white;padding:9px 13px;border-radius:3px;font-size:14px;cursor:pointer;margin-left:6px">&#10005;</button>'
      + '</div>'
      + '<div style="background:rgba(200,57,43,0.07);border-bottom:1px solid rgba(200,57,43,0.18);padding:8px 14px;font-family:system-ui,sans-serif;font-size:12px;color:#C8392B;text-align:center;flex-shrink:0">'
      + tip
      + '</div>'
      + '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:10px">'
      + pv.innerHTML
      + '</div>';

    document.body.appendChild(overlay);
    window.addEventListener('afterprint', function h() {
      var o = document.getElementById('pdf-overlay'); if (o) o.remove();
      if (pv) pv.remove();
      window.removeEventListener('afterprint', h);
    });

  } else {
    // Chrome on Windows / Mac / Android — standard print dialog
    window.print();
    setTimeout(() => { if (pv) pv.remove(); }, 2000);
  }
}

// ── Format builderData structure into lines (mirrors updateBuilderSummary) ──
function formatStructureLines(structure, wType) {
  if (!structure) return [];
  const lines = [];
  const fmtD = (val, unit) => {
    const n = parseFloat(val); if (!n) return '';
    return unit === 'm' ? Math.round(n) + 'm' : (n % 1 === 0 ? n : parseFloat(n.toFixed(2))) + 'mi';
  };
  const wu = structure.warmup;
  if (wu && (wu.dist || wu.time)) {
    const p = []; const d = fmtD(wu.dist, wu.unit || 'mi'); if (d) p.push(d);
    if (wu.pace) p.push('@ ' + wu.pace + '/mi'); if (wu.time) p.push('(' + wu.time + ')');
    if (p.length) lines.push({ label: 'WU', text: p.join(' '), cls: 'easy' });
  }
  if (Array.isArray(structure.blocks)) {
    structure.blocks.forEach((blk, bi) => {
      const sets = parseInt(blk.sets) || 1;
      const pieces = (blk.pieces || []).map(p => {
        let d = p.unit === 'time' ? (p.time || '—') : (fmtD(p.dist, p.unit || 'm') || '—');
        if (p.pace) d += ' @ ' + p.pace + '/mi';
        const ra = p.restAfter;
        if (ra && ra.kind && ra.kind !== 'none' && ra.val)
          d += ra.kind === 'jog' ? ' + ' + fmtD(ra.val, ra.restUnit || 'm') + ' jog' : ' + ' + ra.val + ' rest';
        return d;
      });
      const rbs = blk.restBetweenSets; let sr = '';
      if (rbs && rbs.kind && rbs.kind !== 'none' && rbs.val)
        sr = rbs.kind === 'jog' ? ' | ' + fmtD(rbs.val, rbs.restUnit || 'm') + ' jog btw sets' : ' | ' + rbs.val + ' btw sets';
      lines.push({ label: 'Block ' + (bi + 1), text: sets + '\xd7(' + pieces.join(' / ') + ')' + sr, cls: 'hard' });
    });
  }
  if (structure.hard) {
    const h = structure.hard; const p = []; const d = fmtD(h.dist, h.unit || 'mi'); if (d) p.push(d);
    if (h.pace) p.push('@ ' + h.pace + '/mi'); if (h.time) p.push('(' + h.time + ')');
    lines.push({ label: wType === 'tempo' ? 'Tempo' : 'MP Block', text: p.join(' ') || '—', cls: 'hard' });
  }
  const cd = structure.cooldown;
  if (cd && (cd.dist || cd.time)) {
    const p = []; const d = fmtD(cd.dist, cd.unit || 'mi'); if (d) p.push(d);
    if (cd.pace) p.push('@ ' + cd.pace + '/mi'); if (cd.time) p.push('(' + cd.time + ')');
    if (p.length) lines.push({ label: 'CD', text: p.join(' '), cls: 'easy' });
  }
  return lines;
}

// ── Main builder ──────────────────────────────────────────────────────────────
function buildPrintView() {
  const old = document.getElementById('printView'); if (old) old.remove();
  const pv = document.createElement('div'); pv.id = 'printView';
  pv.appendChild(buildMonthPage());
  const monthStart = new Date(viewYear, viewMonth, 1);
  const monthEnd   = new Date(viewYear, viewMonth + 1, 0);
  let ws = new Date(monthStart);
  const dOff = ws.getDay() === 0 ? 6 : ws.getDay() - 1;
  ws.setDate(ws.getDate() - dOff);
  while (ws <= monthEnd) {
    const we = new Date(ws); we.setDate(we.getDate() + 6);
    pv.appendChild(buildWeekPage(new Date(ws), new Date(we)));
    ws.setDate(ws.getDate() + 7);
  }
  document.body.appendChild(pv);
}

// ── Month page (landscape) ────────────────────────────────────────────────────
function buildMonthPage() {
  const page = document.createElement('div');
  page.className = 'pv-page pv-month-page';

  const hdr = document.createElement('div'); hdr.className = 'pv-hdr';
  const athleteName = (viewingAs || currentUser).toUpperCase();
  // Coach: if this IS the coach viewing an athlete → currentUser; if athlete viewing own plan → myCoachName
  const coachLabel  = (isCoach && viewingAs !== currentUser) ? currentUser : myCoachName;
  hdr.innerHTML = '<div class="pv-hdr-left">'
    + '<span class="pv-hdr-title">' + MONTHS[viewMonth].toUpperCase() + ' <span class="pv-hdr-year">' + viewYear + '</span></span>'
    + '<span class="pv-hdr-sep"> &middot; </span>'
    + '<span class="pv-hdr-athlete">' + athleteName + '</span>'
    + (coachLabel ? '<span class="pv-hdr-sep"> &middot; </span><span class="pv-hdr-coach">Coach: ' + coachLabel + '</span>' : '')
    + '</div>'
    + '<div class="pv-hdr-right">'
    + '<span class="pv-hdr-logo">MALLCOPS</span>'
    + '<div class="pv-hdr-sub">Monthly Training Overview</div>'
    + '</div>';
  page.appendChild(hdr);

  const tbl = document.createElement('table'); tbl.className = 'pv-cal-table';
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  ['MON','TUE','WED','THU','FRI','SAT','SUN'].forEach(d => {
    const th = document.createElement('th'); th.textContent = d; hrow.appendChild(th);
  });
  thead.appendChild(hrow); tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  const firstDay = new Date(viewYear, viewMonth, 1);
  let offset = firstDay.getDay(); offset = offset === 0 ? 6 : offset - 1;
  const lastDayNum = new Date(viewYear, viewMonth + 1, 0).getDate();
  const total = Math.ceil((offset + lastDayNum) / 7) * 7;
  const todayD = new Date();

  let tr = null;
  for (let i = 0; i < total; i++) {
    if (i % 7 === 0) { tr = document.createElement('tr'); tbody.appendChild(tr); }
    let year = viewYear, month = viewMonth, day, other = false;
    if (i < offset) {
      const d = new Date(viewYear, viewMonth, -(offset - i - 1));
      year = d.getFullYear(); month = d.getMonth(); day = d.getDate(); other = true;
    } else if (i >= offset + lastDayNum) {
      const d = new Date(viewYear, viewMonth + 1, i - offset - lastDayNum + 1);
      year = d.getFullYear(); month = d.getMonth(); day = d.getDate(); other = true;
    } else {
      day = i - offset + 1;
    }
    const isToday = !other && viewYear === todayD.getFullYear() && viewMonth === todayD.getMonth() && day === todayD.getDate();
    const td = document.createElement('td');
    if (other)   td.classList.add('pv-other');
    if (isToday) td.classList.add('pv-cal-today');

    const num = document.createElement('div'); num.className = 'pv-cal-num'; num.textContent = day;
    td.appendChild(num);

    const key = dateKey(year, month, day);
    (workouts[key] || []).forEach(w => {
      const ti   = typeInfo(w.type);
      const chip = document.createElement('div'); chip.className = 'pv-cal-chip'; chip.style.background = ti.color;
      const lbl  = document.createElement('span'); lbl.className = 'pv-cal-chip-type';
      lbl.textContent = ti.label + (w.completed ? ' ✓' : '');
      chip.appendChild(lbl);
      if (w.distance && w.type !== 'rest') {
        const dist = document.createElement('span'); dist.className = 'pv-cal-chip-dist';
        let dt = parseFloat(w.distance).toFixed(1) + ' mi';
        if (w.hardMiles > 0) dt += ' \xb7 ' + w.hardMiles.toFixed(1) + 'hd';
        else if (w.pace)     dt += ' @ ' + w.pace;
        dist.textContent = dt; chip.appendChild(dist);
      }
      td.appendChild(chip);
    });
    tr.appendChild(td);
  }
  tbl.appendChild(tbody);
  page.appendChild(tbl);
  return page;
}

// ── Week page (portrait) ──────────────────────────────────────────────────────
function buildWeekPage(weekStart, weekEnd) {
  const page = document.createElement('div'); page.className = 'pv-page pv-week-page';

  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const hdr = document.createElement('div'); hdr.className = 'pv-hdr';
  hdr.innerHTML = '<div><span class="pv-hdr-title">WEEK OF <span>'
    + fmt(weekStart).toUpperCase() + ' – ' + fmt(weekEnd).toUpperCase()
    + ', ' + weekEnd.getFullYear() + '</span></span>'
    + '<span class="pv-hdr-sub">&nbsp;&nbsp;' + (viewingAs || currentUser) + '</span></div>'
    + '<span class="pv-hdr-logo">MALLCOPS</span>';
  page.appendChild(hdr);

  const tbl = document.createElement('table'); tbl.className = 'pv-week-table';
  tbl.innerHTML = '<colgroup>'
    + '<col class="col-day"><col class="col-date"><col class="col-type">'
    + '<col class="col-det"><col class="col-eff"><col class="col-notes">'
    + '</colgroup>';

  const thead = document.createElement('thead');
  const hrow  = document.createElement('tr');
  ['DAY','DATE','WORKOUT','DETAILS','EFFORT','NOTES'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
  });
  thead.appendChild(hrow); tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  const DSHORT = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  let weekTotal = 0;

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart); date.setDate(date.getDate() + i);
    const key  = dateKey(date.getFullYear(), date.getMonth(), date.getDate());
    const ws   = workouts[key] || [];
    const inMonth = date.getMonth() === viewMonth && date.getFullYear() === viewYear;
    ws.forEach(w => { weekTotal += parseFloat(w.distance) || 0; });

    const row = document.createElement('tr');
    row.className = 'pv-week-row' + (i % 2 === 1 ? ' pv-alt' : '') + (!inMonth ? ' pv-off' : '');

    // DAY
    const tdDay = document.createElement('td');
    tdDay.innerHTML = '<div class="pv-wday">' + DSHORT[i] + '</div>';
    row.appendChild(tdDay);

    // DATE
    const tdDate = document.createElement('td');
    tdDate.innerHTML = '<div class="pv-wdate">' + date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</div>';
    row.appendChild(tdDate);

    // WORKOUT TYPE
    const tdType = document.createElement('td');
    if (ws.length === 0) {
      tdType.innerHTML = '<span class="pv-rest-lbl">Rest Day</span>';
    } else {
      ws.forEach((w, wi) => {
        const ti    = typeInfo(w.type);
        const badge = document.createElement('div'); badge.className = 'pv-type-badge'; badge.style.background = ti.color;
        let bt = ti.label;
        if (w.subtype && w.subtype !== 'easy') bt += ' — ' + w.subtype;
        if (w.completed) bt += ' ✓';
        badge.textContent = bt;
        if (wi > 0) tdType.appendChild(document.createElement('br'));
        tdType.appendChild(badge);
      });
    }
    row.appendChild(tdType);

    // DETAILS
    const tdDet = document.createElement('td');
    ws.forEach((w, wi) => {
      if (wi > 0) {
        const sep = document.createElement('div');
        sep.style.cssText = 'border-top:1px dashed #ddd;margin:3px 0';
        tdDet.appendChild(sep);
      }
      const si = [];
      if (w.distance && w.type !== 'rest') {
        let dt = parseFloat(w.distance).toFixed(1) + ' mi';
        if (w.hardMiles > 0) dt += ' (' + w.hardMiles.toFixed(1) + ' hard + ' + (parseFloat(w.easyMiles) || 0).toFixed(1) + ' easy)';
        si.push('<b>Distance:</b> ' + dt);
      }
      if (w.pace)     si.push('<b>Pace:</b> ' + w.pace + '/mi');
      if (w.duration) si.push('<b>Duration:</b> ' + w.duration);
      if (si.length) {
        const d = document.createElement('div'); d.className = 'pv-det-simple';
        d.innerHTML = si.join('&nbsp;&nbsp;'); tdDet.appendChild(d);
      }
      const sl = formatStructureLines(w.structure, w.type);
      sl.forEach(line => {
        const r = document.createElement('div'); r.className = 'pv-det-row pv-det-' + line.cls;
        r.innerHTML = '<span class="pv-det-lbl">' + line.label + ':</span> ' + line.text;
        tdDet.appendChild(r);
      });
    });
    row.appendChild(tdDet);

    // EFFORT
    const tdEff = document.createElement('td');
    const efv   = ws.length && ws[0].effort ? parseInt(ws[0].effort) : 0;
    const dots  = document.createElement('div'); dots.className = 'pv-effort-dots';
    for (let e = 1; e <= 10; e++) {
      const dot = document.createElement('div');
      dot.className = 'pv-edot' + (e === efv ? ' pv-edot-on' : '');
      dot.textContent = e; dots.appendChild(dot);
    }
    tdEff.appendChild(dots);
    row.appendChild(tdEff);

    // NOTES
    const tdNotes  = document.createElement('td');
    const noteLbl  = document.createElement('span'); noteLbl.className = 'pv-notes-lbl'; noteLbl.textContent = 'Notes:';
    tdNotes.appendChild(noteLbl);
    const noteText = ws.length && ws[0].notes ? ws[0].notes : '';
    for (let n = 0; n < 4; n++) {
      const line = document.createElement('div'); line.className = 'pv-note-line';
      if (n === 0 && noteText) line.textContent = noteText;
      tdNotes.appendChild(line);
    }
    row.appendChild(tdNotes);
    tbody.appendChild(row);
  }
  tbl.appendChild(tbody);
  page.appendChild(tbl);

  if (weekTotal > 0) {
    const foot = document.createElement('div'); foot.className = 'pv-week-footer';
    const tot  = document.createElement('div'); tot.className  = 'pv-week-total';
    tot.textContent = 'Week Total: ' + weekTotal.toFixed(1) + ' mi';
    foot.appendChild(tot); page.appendChild(foot);
  }
  return page;
}
