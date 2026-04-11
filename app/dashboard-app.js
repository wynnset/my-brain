// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtCurrency(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}
function fmtDate(d) {
  if (!d) return '—';
  const parts = d.split('-');
  return new Date(+parts[0], +parts[1] - 1, +parts[2]).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
function fmtDateLong(d) {
  if (!d) return '—';
  const parts = d.split('-');
  return new Date(+parts[0], +parts[1] - 1, +parts[2]).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}
function daysFrom(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const parts = d.split('-');
  return Math.round((new Date(+parts[0], +parts[1] - 1, +parts[2]) - today) / 86400000);
}
/** Local calendar date YYYY-MM-DD for greeting rollover */
function localDateKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/** Which time-of-day bucket we're in (local clock); used to refresh greeting when it changes. */
function homeGreetingPeriod() {
  var h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  if (h >= 21) return 'late';
  return 'night';
}
/** Time-of-day greeting with a little variety (client local time). */
function pickHomeGreeting() {
  var h = new Date().getHours();
  var morning = ['Good morning', 'Rise and shine', 'Morning — fresh start', 'Happy morning', 'Top of the morning', 'Coffee and Cyrus time?'];
  var afternoon = ['Good afternoon', 'Afternoon — you\'ve got this', 'Hey — good afternoon', 'Still cruising — good afternoon'];
  var evening = ['Good evening', 'Evening — how\'s it going?', 'Hey — good evening', 'Golden hour — hello'];
  var night = ['Good night', 'Still up? Hi there.', 'Burning the midnight oil?', 'Night owl mode — hello', 'Late shift — take it easy'];
  var lateEvening = ['Good evening', 'Winding down?', 'Almost bedtime — or not?', 'Evening — still going strong?'];
  var list;
  if (h >= 5 && h < 12) list = morning;
  else if (h >= 12 && h < 17) list = afternoon;
  else if (h >= 17 && h < 21) list = evening;
  else list = h >= 21 ? lateEvening : night;
  return list[Math.floor(Math.random() * list.length)];
}
function empty(msg) {
  return '<div class="text-center py-8 text-sm text-slate-400 dark:text-slate-500">' + msg + '</div>';
}
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Join SSE text chunks so sentence boundaries do not glue (e.g. "now." + "Good" → "now. Good").
 * Only inserts a space when the prior text ends in . ! ? (ignoring trailing closers) and the chunk starts with a letter without leading whitespace.
 */
function appendAssistantStreamChunk(existing, chunk) {
  var e = String(existing || '');
  var c = String(chunk || '');
  if (!c) return e;
  if (!e) return c;
  var fc = c.charCodeAt(0);
  if (fc === 32 || fc === 10 || fc === 13 || fc === 9) return e + c;
  var t = e.replace(/[\s\u00a0]+$/g, '');
  if (!t) return e + c;
  var j = t.length - 1;
  while (j >= 0 && /['")\]\u2019\u201d]/.test(t[j])) j--;
  var punct = j >= 0 ? t[j] : '';
  if (punct === '.' || punct === '!' || punct === '?' || punct === '\u2026') {
    var ch = c[0];
    if (/[A-Za-z]/.test(ch)) return e + ' ' + c;
  }
  return e + c;
}

/** Claude Code / Agent SDK may emit `Task` or `Agent` for subagent delegation. */
function isChatDelegationToolName(tool) {
  var t = String(tool || '').trim().toLowerCase();
  return t === 'task' || t === 'agent';
}

/** Default domain for team-inbox upload tags (must match server defaultUploadDomainForAgent). */
function uploadDefaultDomainForAgent(agentId) {
  var a = String(agentId || '').toLowerCase();
  if (a === 'ledger') return 'finance';
  if (a === 'charter') return 'business';
  if (a === 'owner') return 'personal';
  return 'career';
}
/** Same-origin API calls; sends session cookie when DASHBOARD_PASSWORD auth is enabled. */
function fetchWithAuth(url, init) {
  var cfg = init ? Object.assign({}, init) : {};
  cfg.credentials = 'include';
  return fetch(url, cfg).then(function(res) {
    if (res.status === 401) window.location.href = '/login.html';
    return res;
  });
}
const DOMAIN_CLASSES = {
  career:   'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  finance:  'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  business: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  personal: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  family:   'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300',
};
function filterItems(items, range) {
  if (range === 'all') return items;
  return items.filter(function(item) {
    if (!item.due_date) return range === 'nodateset';
    var days = daysFrom(item.due_date);
    if (range === 'overdue') return days < 0;
    if (range === 'today')   return days === 0;
    if (range === 'week')    return days >= 0 && days <= 7;
    if (range === '2weeks')  return days >= 0 && days <= 14;
    return true;
  });
}
function sortItems(items, sortKey) {
  var urgencyOrder = { critical: 1, high: 2, medium: 3, low: 4 };
  return items.slice().sort(function(a, b) {
    var au = urgencyOrder[a.urgency] || 3;
    var bu = urgencyOrder[b.urgency] || 3;
    var ad = a.due_date != null ? daysFrom(a.due_date) : 9999;
    var bd = b.due_date != null ? daysFrom(b.due_date) : 9999;
    if (sortKey === 'date-urgency') return ad !== bd ? ad - bd : au - bu;
    if (sortKey === 'urgency-date') return au !== bu ? au - bu : ad - bd;
    if (sortKey === 'urgency')      return au - bu;
    if (sortKey === 'date')         return ad - bd;
    return 0;
  });
}
function statusBadge(status) {
  var map = {
    offer: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    interview_final: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    interview_2: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    interview_1: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    phone_screen: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
    responded: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',
    applied: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
    researching: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
    upcoming: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    overdue: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    completed: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    lead: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
    conversation: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    proposal_sent: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
    negotiating: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
    won: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    'n/a': 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500',
  };
  var cls = map[status] || 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400';
  var label = (status || '').replace(/_/g, ' ');
  return '<span class="text-xs font-medium px-2 py-0.5 rounded-full ' + cls + '">' + esc(label) + '</span>';
}
function makeTable(cols, rows, emptyMsg) {
  emptyMsg = emptyMsg || 'No data';
  if (!rows || !rows.length) return empty(emptyMsg);
  var thead = cols.map(function(c) {
    return '<th class="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide px-4 py-2.5 whitespace-nowrap">' + c.label + '</th>';
  }).join('');
  var tbody = rows.map(function(row) {
    var cells = cols.map(function(c) {
      var val = c.render ? c.render(row[c.key], row) : esc(row[c.key]);
      return '<td class="px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 whitespace-nowrap">' + (val == null ? '—' : val) + '</td>';
    }).join('');
    return '<tr class="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">' + cells + '</tr>';
  }).join('');
  return '<table class="w-full min-w-full"><thead class="bg-slate-50 dark:bg-slate-700/50"><tr>' + thead + '</tr></thead><tbody>' + tbody + '</tbody></table>';
}
function statCard(opts) {
  var inner = '<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4' + (opts.link ? ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors' : '') + '">' +
    '<p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">' + esc(opts.label) + '</p>' +
    '<p class="text-xl font-bold mt-1 ' + (opts.colorClass || 'text-slate-900 dark:text-white') + '">' + esc(String(opts.value)) + '</p>' +
    (opts.sub ? '<p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">' + esc(opts.sub) + '</p>' : '') +
    '</div>';
  if (opts.link) return '<a href="' + opts.link + '">' + inner + '</a>';
  return inner;
}
function progressBar(value, max, colorClass) {
  colorClass = colorClass || 'bg-blue-500';
  var pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return '<div class="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 mt-1">' +
    '<div class="' + colorClass + ' h-2 rounded-full progress-bar" style="width:' + pct + '%"></div>' +
    '</div>';
}
function buildWeekCardHtml(week, goals) {
  if (!week) return empty('No active week');
  var goalsMetCount = (goals || []).filter(function(g) { return g.is_met; }).length;
  var goalsTotal = (goals || []).length;
  var hoursUsed = week.hours_actual || 0;
  var hoursBudget = week.hours_budget || 15;
  var goalsList = goals && goals.length ? '<ul class="space-y-1.5 mt-4">' +
    goals.slice(0, 8).map(function(g) {
      return '<li class="flex items-center gap-2 text-sm ' + (g.is_met ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-700 dark:text-slate-200') + '">' +
        '<span class="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border text-xs ' + (g.is_met ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600') + '">' + (g.is_met ? ICON_SVG_CHECK : '') + '</span>' +
        esc(g.goal) +
        '</li>';
    }).join('') +
    (goals.length > 8 ? '<li class="text-xs text-slate-400 dark:text-slate-500 pl-6">+' + (goals.length - 8) + ' more goals</li>' : '') +
    '</ul>' : '';
  return '<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">' +
    '<div class="flex items-start justify-between mb-4">' +
      '<div>' +
        '<p class="text-xs font-semibold text-blue-500 uppercase tracking-wide">Week ' + week.week_number + ' of 8</p>' +
        '<h3 class="text-lg font-bold text-slate-900 dark:text-white mt-0.5">' + esc(week.title) + '</h3>' +
        '<p class="text-sm text-slate-500 dark:text-slate-400">' + esc(week.theme) + '</p>' +
      '</div>' +
      '<span class="text-xs text-slate-400 dark:text-slate-500 text-right">' + fmtDate(week.start_date) + ' – ' + fmtDate(week.end_date) + '</span>' +
    '</div>' +
    '<div class="grid grid-cols-2 gap-4">' +
      '<div><div class="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1"><span>Hours</span><span>' + hoursUsed + ' / ' + hoursBudget + '</span></div>' + progressBar(hoursUsed, hoursBudget, 'bg-blue-500') + '</div>' +
      '<div><div class="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1"><span>Goals</span><span>' + goalsMetCount + ' / ' + goalsTotal + '</span></div>' + progressBar(goalsMetCount, goalsTotal, 'bg-emerald-500') + '</div>' +
    '</div>' +
    goalsList +
  '</div>';
}

var ICON_SVG_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" class="inline w-3.5 h-3.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
var ICON_SVG_ARROW_UP = '<span class="inline-flex align-middle text-emerald-500" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg></span>';
var ICON_SVG_ARROW_DOWN = '<span class="inline-flex align-middle text-red-400" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M19 12l-7 7-7-7"/></svg></span>';

function renderChatMarkdown(raw) {
  if (!raw) return '';
  try {
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      var html = marked.parse(raw, { breaks: true, gfm: true });
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    }
  } catch (_) {}
  return esc(raw).replace(/\n/g, '<br>');
}

/** One-line role from team brief / CYRUS.md (`**Role:**` preferred, else H1 subtitle after em dash). */
function parseAgentBriefSummary(md) {
  if (!md) return '';
  var text = String(md).replace(/^\ufeff/, '');
  var roleLine = text.match(/^\s*\*\*Role:\*\*\s*(.+)$/im);
  if (roleLine) return roleLine[1].replace(/\s*#+\s*$/, '').trim();
  var h1 = text.match(/^#\s+(.+)$/m);
  if (!h1) return '';
  var title = h1[1].trim();
  var splitRe = /\s[—–-]\s/;
  var idx = title.search(splitRe);
  if (idx >= 0) return title.slice(idx).replace(splitRe, '').trim();
  return title;
}

var BRAIN_FILE_DIRS_RE = '(owners-inbox|team-inbox|team|docs)';

function brainFileHash(dir, fileName) {
  return '#/files/' + encodeURIComponent(dir) + '/' + encodeURIComponent(fileName);
}

/** Strip trailing punctuation / stray backticks models often glue to paths */
function trimBrainPathSegment(seg) {
  return String(seg || '').replace(/[`'")\].,;:]+$/g, '').replace(/^[`'"(]+/g, '').trim();
}

/**
 * Fix hash segments when markdown linkification glues `](...)` into the path or leaves `[` on the dir.
 * Used when parsing #/files/dir/name from the location bar or a clicked href.
 */
function sanitizeBrainHashDir(dir) {
  var d = String(dir || '').trim();
  try {
    d = decodeURIComponent(d);
  } catch (_) {}
  return d.replace(/^\[+/, '').replace(/\]+$/, '').trim();
}

function sanitizeBrainHashFileName(name) {
  var n = String(name || '').trim();
  try {
    n = decodeURIComponent(n);
  } catch (_) {}
  n = n.replace(/^\[+/, '');
  n = n.replace(/\]\([^)]*\)\s*$/g, '');
  n = n.replace(/\]+$/, '').trim();
  return n;
}

/**
 * Turn repo paths into markdown links to #/files/dir/name.
 * Handles inline code like `/ `owners-inbox/foo.md`` (slash + backticks) so we do not leave
 * stray backticks that break `[text](url)` parsing.
 */
function linkifyBrainFileReferences(raw) {
  if (!raw) return raw;
  var s = String(raw);
  // Fix older bad links where a stray backtick became %60 before ')'
  s = s.replace(/(\(#\/files\/[^)]+?)%60+(\))/g, '$1$2');

  // Whole markdown link wrapped in backticks — models often emit `/[path](#/files/...)` inside `code`, which prevents link parsing
  s = s.replace(/`(\/?\s*)\[([^\]\n]+)\]\(\s*#\/files\/([^)\n]+)\s*\)`/gi, function(full, _slash, label, pathTail) {
    var cleanTail = trimBrainPathSegment(pathTail);
    if (!cleanTail) return full;
    return '[' + trimBrainPathSegment(label) + '](#/files/' + cleanTail + ')';
  });

  // Stray `/` before an in-app file link breaks nothing visually but some pipelines confuse it; normalize to a plain markdown link
  s = s.replace(/\/(\[[^\]\n]+\]\(\s*#\/files\/[^)\n]+\s*\))/gi, '$1');

  // `CYRUS.md` / legacy `LARRY.md` in model output → canonical file
  s = s.replace(/(?:\/\s*)?`(LARRY\.md|CYRUS\.md)`/gi, function() {
    return '[CYRUS.md](#/files/root/CYRUS.md)';
  });

  // `/ `dir/file.ext`` or `` `dir/file.ext` `` — consume optional slash, spaces, and both backticks
  s = s.replace(new RegExp('(?:/\\s*)?`(' + BRAIN_FILE_DIRS_RE + '/[^`\\n]+)`', 'gi'), function(full, path) {
    var clean = trimBrainPathSegment(path);
    var slash = clean.indexOf('/');
    if (slash < 0) return full;
    var dir = clean.slice(0, slash);
    var name = trimBrainPathSegment(clean.slice(slash + 1));
    if (!name) return full;
    var label = dir + '/' + name;
    return '[' + label + '](' + brainFileHash(dir, name) + ')';
  });

  // Bare dir/file — skip inside markdown link labels (after '[') and skip paths already under #/files/…
  // (otherwise `[label](#/files/owners-inbox/x.md)` gets a second link wrapped inside the URL and corrupts the hash).
  s = s.replace(
    new RegExp('(?<!\\[)(?<!/files/)\\b' + BRAIN_FILE_DIRS_RE + '/([^\\s\\]\\)\\>\\<"\'\\,`]+)', 'gi'),
    function(full, dir, rest) {
      var file = trimBrainPathSegment(rest);
      if (!file) return full;
      return '[' + dir + '/' + file + '](' + brainFileHash(dir, file) + ')';
    }
  );

  s = s.replace(/(?<!\[)\b(LARRY\.md|CYRUS\.md)\b/gi, function() {
    return '[CYRUS.md](#/files/root/CYRUS.md)';
  });
  return s;
}

/** If marked still emitted <code>/[label](#/files/...)</code>, turn it into a real link (after entity decode). */
function unwrapBrainFileLinksFromCodeHtml(html) {
  if (!html) return html;
  function decodeBasicEntities(str) {
    return String(str || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  return html.replace(
    /<code>(\/?)\[([^\]<]+)\]\(#\/files\/([^<)]+)\)<\/code>/gi,
    function(full, _slash, labelHtml, pathHtml) {
      var pathTail = trimBrainPathSegment(decodeBasicEntities(pathHtml));
      if (!pathTail || pathTail.length > 512 || /[<"'\\]|\s/.test(pathTail)) return full;
      var href = '#/files/' + pathTail;
      var labelText = decodeBasicEntities(labelHtml);
      return '<a href="' + esc(href) + '">' + esc(labelText) + '</a>';
    }
  );
}

/** Assistant chat bubbles: markdown + auto-links to Files for known paths */
function renderAssistantMarkdown(raw) {
  if (!raw) return '';
  try {
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      var linked = linkifyBrainFileReferences(String(raw));
      var html = marked.parse(linked, { breaks: true, gfm: true });
      html = unwrapBrainFileLinksFromCodeHtml(html);
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    }
  } catch (_) {}
  return esc(raw).replace(/\n/g, '<br>');
}
/** Optional markdown body for dashboard action items (details field). */
function renderActionItemMarkdown(raw) {
  return renderAssistantMarkdown(raw || '');
}

document.addEventListener('alpine:init', function() {
  Alpine.data('app', function() { return {
    page: 'home',
    chatOpen: (function() {
      try {
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) return false;
        return true;
      } catch (_) { return true; }
    })(),
    _savedScrollY: 0,
    chatPanelWidth: (function() {
      try {
        var w = parseInt(localStorage.getItem('chat_panel_width') || '384', 10);
        return isNaN(w) ? 384 : Math.min(720, Math.max(280, w));
      } catch (_) { return 384; }
    })(),
    /** Desktop breakpoint (lg); used so file list width style only applies when layout is side-by-side. */
    viewportLg: (function() {
      try { return typeof window !== 'undefined' && window.innerWidth >= 1024; } catch (_) { return false; }
    })(),
    filesListPanelWidth: (function() {
      try {
        var w = parseInt(localStorage.getItem('files_list_panel_width') || '320', 10);
        return isNaN(w) ? 320 : Math.min(560, Math.max(220, w));
      } catch (_) { return 320; }
    })(),
    mobileMenuOpen: false,
    theme: (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) || 'system',
    refreshing: false,
    lastRefresh: '',
    cache: {},
    loadError: { home: null, career: null, finance: null, business: null },
    pageReady: { home: false, career: false, finance: false, business: false, files: false },
    actionState: {
      home:     { sort: 'date-urgency', group: 'none', range: 'all' },
      career:   { sort: 'date-urgency', group: 'none', range: 'all' },
      finance:  { sort: 'date-urgency', group: 'none', range: 'all' },
      business: { sort: 'date-urgency', group: 'none', range: 'all' },
    },
    actionData: { home: [], career: [], finance: [], business: [] },
    homeDateStr: '',
    homeGreeting: '',
    _homeGreetingDateKey: null,
    _homeGreetingPeriod: null,
    homeDomainCardsHtml: '',
    homeWeekHtml: '',
    careerPipelineHtml: '',
    careerApplicationsHtml: '',
    careerWeekHtml: '',
    careerOutreachHtml: '',
    careerConsultingHtml: '',
    financeAccountsHtml: '',
    financeBurnHtml: '',
    financeCategoriesHtml: '',
    financeIncomeHtml: '',
    financeMerchantsHtml: '',
    financeComplianceHtml: '',
    financeLoanHtml: '',
    trialBalanceMode: 'summary',
    trialBalanceHtml: '',
    businessSummaryHtml: '',
    businessComplianceHtml: '',
    businessCoaSections: [],
    filesData: {},
    fileSections: [],
    filesLoading: false,
    filesLoadError: null,
    filesFilterCreator: '',
    filesFilterDomain: '',
    fileMetaEditorOpen: false,
    fileMetaSaving: false,
    fileMetaDraft: { dir: '', name: '', createdBy: '', domain: '', category: '' },
    viewerOpen: false,
    viewerPath: null,
    viewerTitle: '',
    viewerContent: '',
    viewerDisplayMode: 'text',
    viewerLoadError: '',
    editorOpen: false,
    editorTitle: '',
    editorContent: '',
    editorPath: null,
    editorSaving: false,
    dropOverlayVisible: false,
    uploadToast: '',
    uploadToastClass: 'bg-slate-800 dark:bg-slate-700',
    ownerInboxToasts: [],
    _ownerInboxToastSeq: 0,
    _ownersInboxKnown: null,
    _ownersInboxBaselineReady: false,
    _ownersInboxPollTimer: null,
    chatAgents: [],
    chatAgent: 'cyrus',
    chatPrompt: '',
    chatConversationId: null,
    chatMessages: [],
    chatConversations: [],
    chatSessionTitle: '',
    chatHistoryOpen: false,
    chatStreaming: false,
    /** True from start of a turn (upload + stream) until turn finishes and queue is empty. */
    chatOutboundInFlight: false,
    /** Pending turns while a reply is in progress: { id, prompt, files: File[] } */
    chatOutboundQueue: [],
    chatStreamDraft: '',
    /**
     * Per-agent work segments for the current turn (merged activity + “is working” UI).
     * Each { id, agentId, lines: [{id,text}], expanded, done, startedAt, endedAt }.
     */
    chatWorkPanels: [],
    /** Bumped every second while streaming so elapsed labels stay reactive. */
    chatUiTick: 0,
    chatWorkingStartedAt: null,
    chatElapsedSec: 0,
    _chatElapsedTimer: null,
    chatAbortController: null,
    chatRetryPrompt: '',
    chatFiles: [],
    chatDragActive: false,
    /** Per slug: { status, summary, markdown?, error? } — full markdown for profile modal. */
    chatAgentMeta: {},
    /** slug -> Promise while `ensureChatAgentMeta` is in flight (dedupe concurrent loads). */
    _chatAgentMetaInflight: {},
    /** Custom agent picker modal (name + role per agent). */
    chatAgentPickerOpen: false,
    chatAgentProfileOpen: false,
    chatAgentProfileLoading: false,
    chatAgentProfileError: '',
    chatAgentProfileHtml: '',
    _osMqListener: null,
    loginRequired: false,
    lastActionError: '',
    actionItemEditorOpen: false,
    actionItemSaving: false,
    actionItemError: '',
    actionItemPageKey: 'home',
    actionItemShowDomain: false,
    actionItemShowCareerFields: false,
    actionItemShowProjectCategory: false,
    actionItemDraft: {
      id: null,
      title: '',
      description: '',
      details: '',
      due_date: '',
      urgency: 'medium',
      domain: 'career',
      project_category: '',
      effort_hours: '',
      project_week: '',
    },
    actionDetailExpanded: {},

    refreshHomeGreetingIfNeeded() {
      var key = localDateKey();
      var period = homeGreetingPeriod();
      if (this._homeGreetingDateKey !== key || this._homeGreetingPeriod !== period) {
        this._homeGreetingDateKey = key;
        this._homeGreetingPeriod = period;
        this.homeGreeting = pickHomeGreeting();
      }
    },

    init() {
      this.applyTheme(this.theme);
      this.refreshHomeGreetingIfNeeded();
      var self = this;
      fetch('/api/auth-status', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) { self.loginRequired = !!d.loginRequired; })
        .catch(function() {});
      this.refreshIcons();
      window.addEventListener('hashchange', function() { self.onHashChange(); });
      this.onHashChange();
      this.setupDropZone();
      setInterval(function() {
        if (['home','career','finance','business'].indexOf(self.page) >= 0) self.loadPage(self.page, true);
      }, 60000);
      this.loadChatAgents().finally(function() {
        self.bootstrapChat().finally(function() {
          self.ensureChatAgentMeta(self.chatAgent);
          self.prefetchAllChatAgentMeta();
          self.$nextTick(function() {
            if (self.chatOpen) self.focusChatPrompt();
            self.refreshIcons();
          });
        });
      });
      if (typeof this.$watch === 'function') {
        this.$watch('chatAgent', function (v) {
          self.ensureChatAgentMeta(v);
        });
      }
      this._onResizeViewport = function() {
        self.viewportLg = typeof window !== 'undefined' && window.innerWidth >= 1024;
      };
      window.addEventListener('resize', this._onResizeViewport);
      self.pollOwnersInbox();
      self._ownersInboxPollTimer = setInterval(function() { self.pollOwnersInbox(); }, 30000);
    },

    ownersInboxFileHash(name) {
      return brainFileHash('owners-inbox', name);
    },

    pushOwnerInboxToast(name) {
      var self = this;
      var id = ++this._ownerInboxToastSeq;
      var entry = { id: id, name: name, _timer: null };
      entry._timer = setTimeout(function() { self.dismissOwnerInboxToast(id); }, 12000);
      this.ownerInboxToasts.unshift(entry);
      this.$nextTick(function() { self.refreshIcons(); });
    },

    dismissOwnerInboxToast(id) {
      var self = this;
      this.ownerInboxToasts.forEach(function(t) {
        if (t.id === id && t._timer) {
          clearTimeout(t._timer);
          t._timer = null;
        }
      });
      this.ownerInboxToasts = this.ownerInboxToasts.filter(function(t) { return t.id !== id; });
      this.$nextTick(function() { self.refreshIcons(); });
    },

    async pollOwnersInbox() {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        var res = await fetchWithAuth('/api/files');
        if (!res.ok) return;
        var data = await res.json();
        var files = data['owners-inbox'] || [];
        var names = files.map(function(f) { return f.name; });
        if (!this._ownersInboxBaselineReady) {
          this._ownersInboxKnown = Object.create(null);
          names.forEach(function(n) { this._ownersInboxKnown[n] = true; }, this);
          this._ownersInboxBaselineReady = true;
          return;
        }
        var self = this;
        var anyNew = false;
        names.forEach(function(name) {
          if (!self._ownersInboxKnown[name]) {
            self._ownersInboxKnown[name] = true;
            anyNew = true;
            self.pushOwnerInboxToast(name);
          }
        });
        if (anyNew && self.page === 'files') self.loadFiles();
      } catch (_) {}
    },

    refreshIcons() {
      if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    },

    async signOut() {
      try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
      } catch (_) {}
      window.location.href = '/login.html';
    },

    /** Reserve space for fixed desktop chat without breaking mx-auto centering (margin-right-only shifts content right). */
    chatPanelInsetStyle() {
      if (!this.chatOpen) return {};
      if (typeof window !== 'undefined' && window.innerWidth < 1024) return {};
      return { paddingRight: this.chatPanelWidth + 'px' };
    },

    /** Shrink top nav horizontally so it does not paint over the fixed chat column (chat stays flush to the top). */
    chatNavStyle() {
      if (!this.chatOpen || !this.viewportLg) return {};
      var w = this.chatPanelWidth;
      return { width: 'calc(100% - ' + w + 'px)' };
    },

    startResizeChat(e) {
      var startX = e.clientX;
      var startW = this.chatPanelWidth;
      var self = this;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      function onMove(ev) {
        var dx = startX - ev.clientX;
        var w = Math.min(720, Math.max(280, startW + dx));
        self.chatPanelWidth = w;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try { localStorage.setItem('chat_panel_width', String(self.chatPanelWidth)); } catch (_) {}
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    filesListAsideStyle() {
      if (!this.viewportLg) return {};
      return { width: this.filesListPanelWidth + 'px' };
    },

    startResizeFilesList(e) {
      var startX = e.clientX;
      var startW = this.filesListPanelWidth;
      var self = this;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      function onMove(ev) {
        var dx = ev.clientX - startX;
        var w = Math.min(560, Math.max(220, startW + dx));
        self.filesListPanelWidth = w;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try { localStorage.setItem('files_list_panel_width', String(self.filesListPanelWidth)); } catch (_) {}
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    focusChatPrompt() {
      var self = this;
      this.$nextTick(function() {
        var tryFocus = function() {
          var wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
          var el = wide ? self.$refs.chatPromptDesktop : self.$refs.chatPromptMobile;
          if (el && typeof el.focus === 'function') {
            try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
          }
        };
        requestAnimationFrame(function() {
          requestAnimationFrame(tryFocus);
        });
        setTimeout(tryFocus, 50);
        setTimeout(tryFocus, 320);
      });
    },

    _lockBodyForMobileChat(lock) {
      if (typeof document === 'undefined') return;
      try {
        if (!window.matchMedia('(max-width: 1023px)').matches) return;
        if (lock) {
          this._savedScrollY = window.scrollY || 0;
          document.body.style.overflow = 'hidden';
          document.body.style.position = 'fixed';
          document.body.style.top = '-' + this._savedScrollY + 'px';
          document.body.style.left = '0';
          document.body.style.right = '0';
          document.body.style.width = '100%';
        } else {
          document.body.style.overflow = '';
          document.body.style.position = '';
          document.body.style.top = '';
          document.body.style.left = '';
          document.body.style.right = '';
          document.body.style.width = '';
          window.scrollTo(0, this._savedScrollY || 0);
        }
      } catch (_) {}
    },

    openChat() {
      this.chatOpen = true;
      this._lockBodyForMobileChat(true);
      this.focusChatPrompt();
      this.$nextTick(function() { this.refreshIcons(); }.bind(this));
    },

    closeChat() {
      this.chatOpen = false;
      this.chatAgentPickerOpen = false;
      this._lockBodyForMobileChat(false);
      this.$nextTick(function() { this.refreshIcons(); }.bind(this));
    },

    chatBubbleHtml(m) {
      if (!m || m.role === 'user') {
        var t = m ? String(m.content || '') : '';
        return esc(t).replace(/\n/g, '<br>');
      }
      return renderAssistantMarkdown(m.content || '');
    },

    viewerMarkdownHtml() {
      return renderChatMarkdown(this.viewerContent || '');
    },

    streamingAssistantHtml() {
      return renderAssistantMarkdown(this.chatStreamDraft || '');
    },

    /** Latest line for the “working” bubble (tool / heartbeat / connection). */
    normalizeWorkPanelAgentId(id) {
      if (id === '_delegate') return '_delegate';
      return this.normalizeChatAgentId(id);
    },

    workPanelDisplayName(agentId) {
      if (agentId === '_delegate') return 'Sub-task';
      return this.chatAgentDisplayName(agentId);
    },

    workPanelAvatarLetter(agentId) {
      var n = this.workPanelDisplayName(agentId) || 'A';
      return String(n).charAt(0).toUpperCase();
    },

    workPanelElapsedLabel(panel) {
      var _tick = this.chatUiTick;
      void _tick;
      if (!panel || !panel.startedAt) return '';
      if (panel.done && panel.endedAt) {
        var s = Math.max(0, Math.round((panel.endedAt - panel.startedAt) / 1000));
        return s + 's';
      }
      return Math.floor((Date.now() - panel.startedAt) / 1000) + 's';
    },

    initChatWorkPanelsForTurn() {
      this.chatWorkPanels = [];
      this._appendWorkPanel(this.normalizeWorkPanelAgentId(this.chatAgent), true);
    },

    _appendWorkPanel(agentId, expanded) {
      var panels = this.chatWorkPanels || [];
      for (var i = 0; i < panels.length; i++) {
        if (!panels[i].done) panels[i].expanded = false;
      }
      this.chatWorkPanels.push({
        id: 'wp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
        agentId: agentId,
        lines: [],
        expanded: expanded !== false,
        done: false,
        startedAt: Date.now(),
        endedAt: null,
      });
    },

    openNewWorkPanelForAgent(rawId) {
      var aid = rawId === '_delegate' ? '_delegate' : this.normalizeChatAgentId(rawId);
      this._appendWorkPanel(aid, true);
      this.chatUiTick = Date.now();
      this.$nextTick(function() { this.scrollChatToBottom(); }.bind(this));
    },

    /** Server/SDK detected a delegated agent; upgrade an empty placeholder panel when applicable. */
    applySegmentAgentFromStream(agentId) {
      if (agentId == null || !String(agentId).trim()) return;
      var aid = this.normalizeWorkPanelAgentId(String(agentId).trim().toLowerCase().replace(/\s+/g, '_'));
      var panels = this.chatWorkPanels;
      var last = panels.length ? panels[panels.length - 1] : null;
      if (last && !last.done && last.agentId === aid) {
        this.chatUiTick = Date.now();
        return;
      }
      if (last && last.agentId === '_delegate') {
        last.agentId = aid;
        last.startedAt = Date.now();
        this.chatUiTick = Date.now();
        return;
      }
      this.openNewWorkPanelForAgent(aid);
    },

    appendWorkLineToCurrentPanel(text, idSuffix) {
      var panels = this.chatWorkPanels;
      if (!panels.length) this.initChatWorkPanelsForTurn();
      var p = panels[panels.length - 1];
      if (p.done) return;
      p.lines.push({
        id: 'wl-' + Date.now() + '-' + (idSuffix || 'x') + '-' + Math.random().toString(36).slice(2, 6),
        text: text,
      });
      if (p.lines.length > 120) p.lines.shift();
      this.scrollChatToBottom();
    },

    guessWorkAgentFromTaskDetail(detail) {
      var raw = String(detail || '');
      var dl = raw.toLowerCase();
      var agents = this.chatAgents || [];
      for (var i = 0; i < agents.length; i++) {
        var a = String(agents[i] || '').toLowerCase();
        if (a && dl.indexOf(a) >= 0) return this.normalizeChatAgentId(agents[i]);
      }
      try {
        if (/^\s*\{/.test(raw)) {
          var o = JSON.parse(raw);
          var sub =
            o.subagent_type != null
              ? o.subagent_type
              : o.subagentType != null
                ? o.subagentType
                : o.agent != null
                  ? o.agent
                  : o.agent_id != null
                    ? o.agent_id
                    : o.agentId;
          if (sub != null && String(sub).trim()) {
            var id = this.normalizeChatAgentId(String(sub).trim());
            if (id) return id;
          }
        }
      } catch (_) {}
      var m =
        raw.match(/\byou are\s+([A-Za-z][A-Za-z0-9_-]*)\s*,/i) ||
        raw.match(/\byou are\s+([A-Za-z][A-Za-z0-9_-]*)\b/i);
      if (m) return this.normalizeChatAgentId(m[1]);
      return null;
    },

    finalizeChatWorkPanels() {
      var now = Date.now();
      (this.chatWorkPanels || []).forEach(function(p) {
        p.done = true;
        if (!p.endedAt) p.endedAt = now;
        p.expanded = false;
      });
    },

    toggleWorkPanelExpanded(panel) {
      if (!panel) return;
      panel.expanded = !panel.expanded;
      var self = this;
      this.$nextTick(function() {
        self.refreshIcons();
        self.scrollChatToBottom();
      });
    },

    viewerAssetUrl() {
      if (!this.viewerPath) return '';
      return this.fileDownloadHref(this.viewerPath.dir, this.viewerPath.name);
    },

    _clearChatElapsedTimer() {
      if (this._chatElapsedTimer) {
        clearInterval(this._chatElapsedTimer);
        this._chatElapsedTimer = null;
      }
    },

    scrollChatToBottom() {
      var self = this;
      this.$nextTick(function() {
        var d = self.$refs.chatScrollDesktop;
        var m = self.$refs.chatScrollMobile;
        if (d) d.scrollTop = d.scrollHeight;
        if (m) m.scrollTop = m.scrollHeight;
      });
    },

    maybeRequestNotificationPermission() {
      try {
        if (typeof Notification === 'undefined') return;
        if (Notification.permission === 'default') Notification.requestPermission();
      } catch (_) {}
    },

    maybeNotifyChatComplete() {
      try {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        if (!document.hidden) return;
        var assistants = this.chatMessages.filter(function(m) { return m.role === 'assistant'; });
        var last = assistants[assistants.length - 1];
        var preview = (last && last.content) ? String(last.content).replace(/\s+/g, ' ').trim().slice(0, 120) : 'Reply ready';
        new Notification(this.chatAgentDisplayName(this.chatAgent) + ' — Cyrus', { body: preview });
      } catch (_) {}
    },

    async loadConversationList() {
      try {
        var r = await fetchWithAuth('/api/chat/conversations');
        if (!r.ok) return;
        var d = await r.json();
        this.chatConversations = d.conversations || [];
      } catch (_) {}
    },

    /** Local-only chat shell: no server session until the user sends a message. */
    enterDraftChatState() {
      this.chatConversationId = null;
      this.chatMessages = [];
      this.chatSessionTitle = 'New chat';
      this.chatOutboundQueue = [];
      this.chatOutboundInFlight = false;
      this.chatWorkPanels = [];
      try { localStorage.removeItem('brain_last_chat_id'); } catch (_) {}
    },

    async createNewConversation() {
      var agent = this.normalizeChatAgentId(this.chatAgent);
      if (this.chatAgents.length && this.chatAgents.indexOf(agent) < 0) agent = this.chatAgents[0];
      this.chatAgent = agent;
      var r = await fetchWithAuth('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent }),
      });
      if (!r.ok) {
        var errMsg = 'Could not create conversation';
        try {
          var ej = await r.json();
          if (ej && ej.error) errMsg = ej.error;
        } catch (_) {}
        throw new Error(errMsg);
      }
      var d = await r.json();
      this.chatConversationId = d.id;
      this.chatMessages = [];
      this.chatSessionTitle = 'New chat';
      try { localStorage.setItem('brain_last_chat_id', d.id); } catch (_) {}
      await this.loadConversationList();
    },

    async bootstrapChat() {
      await this.loadConversationList();
      var last = null;
      try { last = localStorage.getItem('brain_last_chat_id'); } catch (_) {}
      if (last) {
        var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(last));
        if (r.ok) {
          var sess = await r.json();
          this.chatConversationId = sess.id;
          this.chatAgent = this.normalizeChatAgentId(sess.agent);
          this.chatMessages = sess.messages || [];
          this.chatSessionTitle = sess.title || 'Chat';
          this.chatOutboundQueue = [];
          this.chatOutboundInFlight = false;
          this.chatWorkPanels = [];
          return;
        }
        try { localStorage.removeItem('brain_last_chat_id'); } catch (_) {}
      }
      this.enterDraftChatState();
    },

    async ensureChatConversation() {
      if (this.chatConversationId) return;
      await this.createNewConversation();
    },

    openChatHistory() {
      this.chatAgentPickerOpen = false;
      this.chatHistoryOpen = true;
      this.loadConversationList();
      var self = this;
      this.$nextTick(function() { self.refreshIcons(); });
    },

    async openConversation(id) {
      var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(id));
      if (!r.ok) return;
      var sess = await r.json();
      this.chatConversationId = sess.id;
      this.chatAgent = this.normalizeChatAgentId(sess.agent);
      this.chatMessages = sess.messages || [];
      this.chatSessionTitle = sess.title || 'Chat';
      try { localStorage.setItem('brain_last_chat_id', id); } catch (_) {}
      this.chatHistoryOpen = false;
      this.chatOutboundQueue = [];
      this.chatOutboundInFlight = false;
      this.chatWorkPanels = [];
      await this.loadConversationList();
      this.$nextTick(function() { this.scrollChatToBottom(); this.refreshIcons(); }.bind(this));
    },

    async refreshActiveConversation() {
      if (!this.chatConversationId) return;
      var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(this.chatConversationId));
      if (!r.ok) return;
      var sess = await r.json();
      this.chatMessages = sess.messages || [];
      this.chatSessionTitle = sess.title || 'Chat';
    },

    async newChatConversation() {
      this.chatAgentPickerOpen = false;
      try {
        if (this.chatConversationId && this.chatMessages.length === 0) {
          try {
            await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(this.chatConversationId), {
              method: 'DELETE',
            });
          } catch (_) {}
        }
        this.enterDraftChatState();
        await this.loadConversationList();
        this.$nextTick(function() { this.focusChatPrompt(); this.refreshIcons(); }.bind(this));
      } catch (e) {
        console.warn('[chat] new conversation', e.message || e);
      }
    },

    async onChatAgentChange() {
      if (this.chatMessages.length > 0) return;
      var old = this.chatConversationId;
      if (old) {
        try {
          await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(old), { method: 'DELETE' });
        } catch (_) {}
      }
      this.enterDraftChatState();
      try {
        await this.loadConversationList();
      } catch (_) {}
      this.ensureChatAgentMeta(this.chatAgent);
    },

    async deleteConversation(id, ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (!confirm('Delete this conversation?')) return;
      try {
        var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(id), { method: 'DELETE' });
        if (!r.ok) return;
        if (this.chatConversationId === id) this.enterDraftChatState();
        await this.loadConversationList();
      } catch (_) {}
    },

    retryLastChat() {
      if (!this.chatRetryPrompt) return;
      var last = this.chatMessages[this.chatMessages.length - 1];
      if (last && last.role === 'assistant' && last.error) this.chatMessages.pop();
      this.chatPrompt = this.chatRetryPrompt;
      this.submitChat();
    },

    toggleChat() {
      if (this.chatOpen) this.closeChat();
      else this.openChat();
    },

    navLinkClass(p) {
      var on = this.page === p;
      return on
        ? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'
        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700';
    },
    go(p) {
      if (p !== 'files') {
        this.viewerOpen = false;
        this.viewerPath = null;
        this.viewerContent = '';
        this.viewerDisplayMode = 'text';
        this.viewerLoadError = '';
        this.editorOpen = false;
        this.editorPath = null;
      }
      this.page = p;
      location.hash = p === 'home' ? '#/' : '#/' + p;
    },
    onHashChange() {
      var raw = (location.hash || '#/').replace(/^#\/?/, '');
      if (raw === 'chat') {
        this.openChat();
        if (['home','career','finance','business','files'].indexOf(this.page) < 0) this.page = 'home';
        this.loadPage(this.page, false);
        return;
      }
      var fileMatch = raw.match(/^files\/([^/]+)\/(.+)$/);
      if (fileMatch) {
        var fd = sanitizeBrainHashDir(fileMatch[1]);
        var fn = sanitizeBrainHashFileName(fileMatch[2]);
        if (fd === 'root' && fn === 'LARRY.md') {
          fn = 'CYRUS.md';
          history.replaceState(null, '', '#/files/root/' + encodeURIComponent(fn));
        }
        this.page = 'files';
        var self = this;
        this.openFileFromHash(fd, fn);
        return;
      }
      var map = { '': 'home', 'career': 'career', 'finance': 'finance', 'business': 'business', 'files': 'files' };
      var nextPage = map[raw] || 'home';
      if (nextPage !== 'files') {
        this.viewerOpen = false;
        this.viewerPath = null;
        this.editorOpen = false;
        this.editorPath = null;
      }
      this.page = nextPage;
      this.loadPage(this.page, false);
    },

    async openFileFromHash(dir, name) {
      await this.loadPage('files', false);
      this.fileSections.forEach(function(sec) { sec.open = sec.dir === dir; });
      this.openFileRow(dir, name);
      var self = this;
      this.$nextTick(function() { self.refreshIcons(); });
    },

    cycleTheme() {
      var self = this;
      var cur = localStorage.getItem('theme') || 'system';
      var next = cur === 'system' ? 'light' : cur === 'light' ? 'dark' : 'system';
      localStorage.setItem('theme', next);
      this.theme = next;
      this.applyTheme(next);
      this.$nextTick(function() { self.refreshIcons(); });
    },

    applyTheme(theme) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (this._osMqListener) {
        mq.removeEventListener('change', this._osMqListener);
        this._osMqListener = null;
      }
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (theme === 'light') {
        document.documentElement.classList.remove('dark');
      } else {
        if (mq.matches) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
        this._osMqListener = function(e) {
          var t = localStorage.getItem('theme') || 'system';
          if (t === 'system') {
            if (e.matches) document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
          }
        };
        mq.addEventListener('change', this._osMqListener);
      }
    },

    getActionGroups(pageKey, opts) {
      opts = opts || {};
      var raw = this.actionData[pageKey] || [];
      var s = this.actionState[pageKey];
      var items = sortItems(filterItems(raw, s.range), s.sort);
      if (!items.length) return [];
      if (s.group === 'none') {
        return [{ key: pageKey + '-flat', label: null, headerClass: '', items: items }];
      }
      var groups = {}, order = [];
      items.forEach(function(item) {
        var k = (s.group === 'domain' ? item.domain : item.project_category) || 'other';
        if (!groups[k]) { groups[k] = []; order.push(k); }
        groups[k].push(item);
      });
      return order.map(function(k) {
        return {
          key: pageKey + '-' + k,
          label: k.replace(/_/g, ' '),
          headerClass: s.group === 'domain'
            ? (DOMAIN_CLASSES[k] || 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300')
            : 'bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300',
          items: groups[k],
        };
      });
    },
    domainBadgeClass(d) { return DOMAIN_CLASSES[d] || ''; },
    /** Border/hover styles for the circular “complete” control. */
    actionItemCheckboxRingClass(item) {
      var u = (item && item.urgency) || 'medium';
      var map = {
        critical: 'border-red-500 hover:border-red-600 hover:bg-red-50 dark:hover:bg-red-950/35',
        high: 'border-orange-400 hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/25',
        medium: 'border-amber-400/90 dark:border-amber-500/70 hover:bg-amber-50/90 dark:hover:bg-amber-950/20',
        low: 'border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700/50',
      };
      return map[u] || map.medium;
    },
    urgencyBorderClass(item) {
      var days = daysFrom(item.due_date);
      if (days === null) return 'border-l-slate-200 dark:border-l-slate-600';
      if (days < 0) return 'border-l-red-500';
      if (days === 0) return 'border-l-orange-400';
      if (days <= 3) return 'border-l-yellow-400';
      return 'border-l-slate-200 dark:border-l-slate-600';
    },
    dueChipHtml(item) {
      var days = daysFrom(item.due_date);
      if (days === null) return '';
      if (days < 0) return '<span class="text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded-full">' + Math.abs(days) + 'd overdue</span>';
      if (days === 0) return '<span class="text-xs font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 px-2 py-0.5 rounded-full">Due today</span>';
      if (days <= 3) return '<span class="text-xs font-medium text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/30 px-2 py-0.5 rounded-full">Due ' + fmtDate(item.due_date) + '</span>';
      return '<span class="text-xs text-slate-400 dark:text-slate-500">' + fmtDate(item.due_date) + '</span>';
    },
    coaTypeColor(type) {
      var typeColor = { asset: 'text-blue-600 dark:text-blue-400', liability: 'text-red-600 dark:text-red-400', equity: 'text-purple-600 dark:text-purple-400', revenue: 'text-emerald-600 dark:text-emerald-400', expense: 'text-orange-600 dark:text-orange-400' };
      return typeColor[type] || '';
    },

    actionItemDetailsHtml(item) {
      return renderActionItemMarkdown(item && item.details);
    },
    toggleActionDetail(id) {
      var key = id != null ? String(id) : '';
      var cur = this.actionDetailExpanded[key];
      this.actionDetailExpanded = Object.assign({}, this.actionDetailExpanded, { [key]: !cur });
    },
    isActionDetailOpen(id) {
      return !!this.actionDetailExpanded[id != null ? String(id) : ''];
    },
    closeActionItemEditor() {
      this.actionItemEditorOpen = false;
      this.actionItemError = '';
    },
    openActionItemEditor(item, pageKey) {
      var self = this;
      if (!item || item.id == null) return;
      this.actionItemPageKey = pageKey || 'home';
      this.actionItemShowDomain = this.actionItemPageKey === 'home';
      this.actionItemShowCareerFields = this.actionItemPageKey === 'career';
      this.actionItemShowProjectCategory = true;
      this.actionItemDraft = {
        id: item.id,
        title: item.title || '',
        description: item.description != null ? String(item.description) : '',
        details: item.details != null ? String(item.details) : '',
        due_date: item.due_date || '',
        urgency: item.urgency || 'medium',
        domain: item.domain || 'career',
        project_category: item.project_category != null ? String(item.project_category) : '',
        effort_hours: item.effort_hours != null && item.effort_hours !== '' ? String(item.effort_hours) : '',
        project_week: item.project_week != null ? String(item.project_week) : '',
      };
      this.actionItemError = '';
      this.actionItemEditorOpen = true;
      this.$nextTick(function() { self.refreshIcons(); });
    },
    saveActionItem() {
      var self = this;
      var d = this.actionItemDraft;
      var title = (d.title || '').trim();
      if (!title) {
        this.actionItemError = 'Title is required';
        return;
      }
      this.actionItemSaving = true;
      this.actionItemError = '';
      var body = {
        title: title,
        description: d.description ? String(d.description) : null,
        details: d.details ? String(d.details) : null,
        due_date: d.due_date || null,
        urgency: d.urgency || 'medium',
      };
      if (this.actionItemShowDomain) body.domain = d.domain;
      var cat = (d.project_category && String(d.project_category).trim()) ? String(d.project_category).trim() : null;
      if (this.actionItemShowProjectCategory) body.project_category = cat;
      if (this.actionItemShowCareerFields) {
        body.effort_hours = d.effort_hours === '' || d.effort_hours == null ? null : Number(d.effort_hours);
        body.project_week = d.project_week === '' ? null : parseInt(d.project_week, 10);
        if (body.effort_hours != null && Number.isNaN(body.effort_hours)) {
          this.actionItemSaving = false;
          this.actionItemError = 'Invalid effort hours';
          return;
        }
        if (body.project_week != null && !Number.isFinite(body.project_week)) {
          this.actionItemSaving = false;
          this.actionItemError = 'Invalid project week';
          return;
        }
      }
      fetchWithAuth('/api/action-items/' + d.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function(res) {
          if (!res.ok) {
            return res.json().then(function(err) {
              throw new Error((err && err.error) || 'HTTP ' + res.status);
            });
          }
          self.actionItemEditorOpen = false;
          self.lastActionError = '';
          return self.loadPage(self.actionItemPageKey, true);
        })
        .catch(function(e) {
          self.actionItemError = e.message || String(e);
        })
        .finally(function() {
          self.actionItemSaving = false;
          self.$nextTick(function() { self.refreshIcons(); });
        });
    },
    completeActionItem(item, pageKey) {
      var self = this;
      if (!item || item.id == null) return;
      var pk = pageKey || 'home';
      fetchWithAuth('/api/action-items/' + item.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
        .then(function(res) {
          if (!res.ok) {
            return res.json().then(function(err) {
              throw new Error((err && err.error) || 'HTTP ' + res.status);
            });
          }
          var key = String(item.id);
          if (self.actionDetailExpanded[key]) {
            var next = Object.assign({}, self.actionDetailExpanded);
            delete next[key];
            self.actionDetailExpanded = next;
          }
          self.lastActionError = '';
          return self.loadPage(pk, true);
        })
        .catch(function(e) {
          self.lastActionError = e.message || String(e);
        });
    },

    async loadPage(name, force) {
      var STALE_MS = 60000;
      var now = Date.now();
      if (name === 'files') { await this.loadFiles(); return; }
      if (!force && this.cache[name] && (now - this.cache[name].ts < STALE_MS)) return;
      this.refreshing = true;
      this.loadError[name] = null;
      var ENDPOINTS = { home: '/api/dashboard', career: '/api/career', finance: '/api/finance', business: '/api/business' };
      try {
        var res = await fetchWithAuth(ENDPOINTS[name]);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        this.cache[name] = { ts: Date.now(), data: data };
        if (name === 'home') this.renderHome(data);
        else if (name === 'career') this.renderCareer(data);
        else if (name === 'finance') this.renderFinance(data);
        else if (name === 'business') this.renderBusiness(data);
        this.pageReady[name] = true;
        this.lastRefresh = 'Updated ' + new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        this.loadError[name] = 'Failed to load data. Is server.js running? (' + e.message + ')';
        this.pageReady[name] = true;
      } finally {
        this.refreshing = false;
      }
    },

    renderHome(d) {
      this.actionData.home = d.actionItems || [];
      var summary = d.domainSummary || [];
      var domainMap = {};
      summary.forEach(function(r) { domainMap[r.domain] = r; });
      var domains = [
        { domain: 'career',   label: 'Career',   link: '#/career',   color: 'text-blue-600 dark:text-blue-400' },
        { domain: 'finance',  label: 'Finance',  link: '#/finance',  color: 'text-green-600 dark:text-green-400' },
        { domain: 'business', label: 'Business', link: '#/business', color: 'text-purple-600 dark:text-purple-400' },
      ];
      this.homeDomainCardsHtml = domains.map(function(d2) {
        var r = domainMap[d2.domain] || {};
        return statCard({
          label: d2.label,
          value: (r.total || 0) + ' items',
          sub: (r.high_urgency || 0) + ' high-priority · ' + (r.due_this_week || 0) + ' due this week',
          link: d2.link,
          colorClass: d2.color,
        });
      }).join('');
      this.homeWeekHtml = buildWeekCardHtml(d.activeWeek, d.weekGoals);
      this.homeDateStr = new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      this.refreshHomeGreetingIfNeeded();
    },

    renderCareer(d) {
      this.actionData.career = d.actionItems || [];
      var pipeline = d.pipeline || [];
      var FUNNEL_ORDER = ['offer','interview_final','interview_2','interview_1','phone_screen','responded','applied','researching'];
      var pipelineMap = {};
      pipeline.forEach(function(r) { pipelineMap[r.status] = r.count; });
      var maxCount = Math.max.apply(null, pipeline.map(function(r) { return r.count; }).concat([1]));
      var visibleStages = FUNNEL_ORDER.filter(function(s) { return pipelineMap[s]; });
      this.careerPipelineHtml = visibleStages.length
        ? visibleStages.map(function(s) {
            var count = pipelineMap[s] || 0;
            var pct = Math.max(20, Math.round((count / maxCount) * 100));
            return '<div class="flex items-center gap-3 mb-2">' +
              '<span class="text-xs text-slate-500 dark:text-slate-400 w-28 text-right flex-shrink-0 capitalize">' + s.replace(/_/g,' ') + '</span>' +
              '<div class="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-6 relative">' +
              '<div class="bg-blue-500 dark:bg-blue-600 h-6 rounded-full" style="width:' + pct + '%"></div>' +
              '<span class="absolute right-2 top-0 h-6 flex items-center text-xs font-medium text-slate-700 dark:text-slate-100">' + count + '</span>' +
              '</div></div>';
          }).join('')
        : empty('No pipeline data yet');
      this.careerApplicationsHtml = makeTable([
        { key: 'company_name', label: 'Company' },
        { key: 'role_title', label: 'Role' },
        { key: 'status', label: 'Status', render: function(v) { return statusBadge(v); } },
        { key: 'salary_range', label: 'Salary', render: function(v) { return v ? esc(v) : '—'; } },
        { key: 'next_step_date', label: 'Next Step', render: function(v, r) {
            return (v ? fmtDate(v) : '—') + (r.next_step ? '<div class="text-xs text-slate-400 dark:text-slate-500">' + esc(r.next_step) + '</div>' : '');
        }},
      ], d.activeApplications || [], 'No active applications');
      this.careerWeekHtml = buildWeekCardHtml(d.activeWeek, d.weekGoals);
      this.careerOutreachHtml = makeTable([
        { key: 'name', label: 'Name' },
        { key: 'company', label: 'Company', render: function(v) { return v ? esc(v) : '—'; } },
        { key: 'relationship', label: 'Type', render: function(v) { return v ? esc(v) : '—'; } },
        { key: 'last_contact', label: 'Last Contact', render: function(v) { return fmtDate(v); } },
        { key: 'latest_status', label: 'Status', render: function(v) { return statusBadge(v); } },
        { key: 'next_action_date', label: 'Next Action', render: function(v) { return v ? fmtDate(v) : '—'; } },
      ], d.outreach || [], 'No outreach contacts yet');
      var leads = d.consultingLeads || [];
      var cPipeline = d.consultingPipeline || [];
      var pipelineTotal = cPipeline.reduce(function(s, r) { return s + (r.total_value || 0); }, 0);
      this.careerConsultingHtml = leads.length
        ? '<div class="flex items-center gap-2 mb-3 px-1"><span class="text-sm font-medium text-slate-700 dark:text-slate-200">Pipeline Value:</span><span class="text-sm font-bold text-emerald-600 dark:text-emerald-400">' + fmtCurrency(pipelineTotal) + '</span></div>' +
          makeTable([
            { key: 'company', label: 'Company' },
            { key: 'service_type', label: 'Service', render: function(v) { return v ? esc(v.replace(/_/g,' ')) : '—'; } },
            { key: 'estimated_value', label: 'Value', render: function(v) { return v ? fmtCurrency(v) : '—'; } },
            { key: 'status', label: 'Status', render: function(v) { return statusBadge(v); } },
            { key: 'contact_name', label: 'Contact', render: function(v) { return v ? esc(v) : '—'; } },
          ], leads)
        : empty('No consulting leads yet');
    },

    renderFinance(d) {
      this.actionData.finance = d.actionItems || [];
      var snapshots = d.accountSnapshots || [];
      var ownerColors = { personal: 'border-l-blue-400', business: 'border-l-purple-400', joint: 'border-l-teal-400' };
      this.financeAccountsHtml = snapshots.length ? snapshots.map(function(s) {
        var isDebt = ['credit_card','loc','mortgage'].indexOf(s.account_type) >= 0;
        var balColor = isDebt ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';
        return '<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 border-l-4 ' + (ownerColors[s.owner] || 'border-l-slate-300') + ' p-3">' +
          '<p class="text-xs text-slate-500 dark:text-slate-400 truncate">' + esc(s.name) + '</p>' +
          '<p class="text-lg font-bold mt-0.5 ' + balColor + '">' + fmtCurrency(s.balance) + '</p>' +
          '<p class="text-xs text-slate-400 dark:text-slate-500">' + esc(s.account_type) + ' · ' + esc(s.owner) + ' · ' + fmtDate(s.snapshot_date) + '</p>' +
          '</div>';
      }).join('') : empty('No account snapshots');
      this.financeBurnHtml = makeTable([
        { key: 'month', label: 'Month' },
        { key: 'total_burn', label: 'Total Burn', render: function(v) { return fmtCurrency(v); } },
        { key: 'fixed_burn', label: 'Fixed', render: function(v) { return fmtCurrency(v); } },
        { key: 'variable_burn', label: 'Variable', render: function(v) { return fmtCurrency(v); } },
        { key: 'tx_count', label: 'Txns' },
      ], d.burnRate || [], 'No burn rate data');
      this.financeCategoriesHtml = makeTable([
        { key: 'parent_category', label: 'Category' },
        { key: 'total_spent', label: 'Amount', render: function(v) { return fmtCurrency(v); } },
        { key: 'tx_count', label: 'Txns' },
      ], (d.categorySpend || []).slice(0, 10), 'No category data');
      this.financeIncomeHtml = makeTable([
        { key: 'month', label: 'Month' },
        { key: 'category', label: 'Source' },
        { key: 'total_income', label: 'Amount', render: function(v) { return fmtCurrency(v); } },
        { key: 'tx_count', label: 'Payments' },
      ], d.income || [], 'No income data');
      this.financeMerchantsHtml = makeTable([
        { key: 'merchant', label: 'Merchant' },
        { key: 'category', label: 'Category', render: function(v) { return v ? esc(v) : '—'; } },
        { key: 'last_12m', label: 'Last 12m', render: function(v) { return fmtCurrency(v); } },
        { key: 'tx_count_12m', label: 'Txns' },
      ], d.topMerchants || [], 'No merchant data');
      var compliance = d.complianceUpcoming || [];
      this.financeComplianceHtml = compliance.length ? makeTable([
        { key: 'event_type', label: 'Event', render: function(v) { return esc((v||'').replace(/_/g,' ')); } },
        { key: 'description', label: 'Description' },
        { key: 'due_date', label: 'Due', render: function(v) { return fmtDateLong(v); } },
        { key: 'days_remaining', label: 'Days', render: function(v) {
            var cls = v <= 7 ? 'text-red-600 dark:text-red-400 font-bold' : v <= 30 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-500 dark:text-slate-400';
            return '<span class="' + cls + '">' + v + 'd</span>';
        }},
      ], compliance) : empty('No compliance deadlines in next 90 days');
      var loan = d.shareholderLoan;
      var loanTxns = d.shareholderLoanTxns || [];
      if (loan) {
        var isOwed = loan.direction === 'corp_owes_aidin';
        this.financeLoanHtml =
          '<div class="mb-4">' +
            '<p class="text-xs text-slate-500 dark:text-slate-400 mb-1">Balance as of ' + fmtDate(loan.as_of) + '</p>' +
            '<p class="text-3xl font-bold ' + (isOwed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400') + '">' + fmtCurrency(loan.running_balance) + '</p>' +
            '<p class="text-sm text-slate-500 dark:text-slate-400 mt-1">' + esc(loan.summary || (isOwed ? 'Corp owes Aidin' : 'Aidin owes Corp')) + '</p>' +
          '</div>' +
          (loanTxns.length ? makeTable([
            { key: 'txn_date', label: 'Date', render: function(v) { return fmtDate(v); } },
            { key: 'description', label: 'Description' },
            { key: 'amount', label: 'Amount', render: function(v) { return fmtCurrency(v); } },
            { key: 'direction', label: 'Dir', render: function(v) { return v === 'corp_owes_aidin' ? ICON_SVG_ARROW_UP : ICON_SVG_ARROW_DOWN; } },
            { key: 'running_balance', label: 'Balance', render: function(v) { return fmtCurrency(v); } },
          ], loanTxns) : '');
      } else {
        this.financeLoanHtml = empty('No shareholder loan data');
      }
      this.trialBalanceMode = 'summary';
      this.refreshTrialBalance();
    },

    toggleTrialBalance() {
      this.trialBalanceMode = this.trialBalanceMode === 'detail' ? 'summary' : 'detail';
      this.refreshTrialBalance();
    },

    refreshTrialBalance() {
      var data = this.cache.finance && this.cache.finance.data;
      if (!data) { this.trialBalanceHtml = empty('No trial balance data'); return; }
      if (this.trialBalanceMode === 'summary') {
        this.trialBalanceHtml = makeTable([
          { key: 'type', label: 'Account Type', render: function(v) { return '<span class="capitalize font-medium">' + esc(v) + '</span>'; } },
          { key: 'debits', label: 'Debits', render: function(v) { return fmtCurrency(v); } },
          { key: 'credits', label: 'Credits', render: function(v) { return fmtCurrency(v); } },
          { key: 'net', label: 'Net', render: function(v) {
              var cls = v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-600 dark:text-red-400' : '';
              return '<span class="' + cls + ' font-medium">' + fmtCurrency(v) + '</span>';
          }},
        ], data.trialBalanceSummary || [], 'No trial balance data');
      } else if (data.trialBalanceDetail && data.trialBalanceDetail.length) {
        this.trialBalanceHtml = makeTable([
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Account' },
          { key: 'type', label: 'Type', render: function(v) { return '<span class="capitalize">' + esc(v) + '</span>'; } },
          { key: 'total_debits', label: 'Debits', render: function(v) { return fmtCurrency(v); } },
          { key: 'total_credits', label: 'Credits', render: function(v) { return fmtCurrency(v); } },
          { key: 'net', label: 'Net', render: function(v) {
              var cls = v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-600 dark:text-red-400' : '';
              return '<span class="' + cls + ' font-medium">' + fmtCurrency(v) + '</span>';
          }},
        ], data.trialBalanceDetail);
      } else {
        this.trialBalanceHtml = '<div class="p-4 text-sm text-slate-400 dark:text-slate-500">No detailed trial balance (no journal entries yet)</div>';
      }
    },

    renderBusiness(d) {
      this.actionData.business = d.actionItems || [];
      var compSummary = d.complianceSummary || [];
      var compMap = {};
      compSummary.forEach(function(r) { compMap[r.status] = r.count; });
      var loan = d.shareholderLoan;
      var ledger = d.ledgerSummary || {};
      var totalAccounts = (d.coaSummary || []).reduce(function(s, r) { return s + (r.account_count || 0); }, 0);
      this.businessSummaryHtml = [
        statCard({ label: 'Journal Entries', value: ledger.total_entries || '0', sub: ledger.last_entry ? 'Last: ' + fmtDate(ledger.last_entry) : 'No entries yet' }),
        statCard({ label: 'Active Accounts', value: totalAccounts || '—', sub: 'in chart of accounts' }),
        statCard({ label: 'Compliance', value: (compMap.upcoming || 0) + ' upcoming', sub: (compMap.overdue || 0) + ' overdue', colorClass: (compMap.overdue || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white' }),
        statCard({ label: 'Shareholder Loan', value: loan ? fmtCurrency(loan.running_balance) : '—', sub: loan ? (loan.direction === 'corp_owes_aidin' ? 'Corp owes you' : 'You owe corp') : '', colorClass: loan ? (loan.direction === 'corp_owes_aidin' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400') : 'text-slate-900 dark:text-white' }),
      ].join('');
      this.businessComplianceHtml = makeTable([
        { key: 'event_type', label: 'Event', render: function(v) { return esc((v||'').replace(/_/g,' ')); } },
        { key: 'description', label: 'Description' },
        { key: 'fiscal_period', label: 'Period', render: function(v) { return v ? esc(v) : '—'; } },
        { key: 'due_date', label: 'Due', render: function(v) { return fmtDateLong(v); } },
        { key: 'status', label: 'Status', render: function(v) { return statusBadge(v); } },
        { key: 'completed_by', label: 'By', render: function(v) { return v ? esc(v) : '—'; } },
      ], d.complianceCalendar || [], 'No compliance events');
      var coaSummary = d.coaSummary || [];
      var coaAccounts = d.coaAccounts || [];
      var coaByType = {};
      coaAccounts.forEach(function(a) {
        if (!coaByType[a.type]) coaByType[a.type] = [];
        coaByType[a.type].push(a);
      });
      this.businessCoaSections = coaSummary.map(function(row) {
        return {
          type: row.type,
          account_count: row.account_count,
          accounts: coaByType[row.type] || [],
          open: false,
        };
      });
    },

    async loadFiles() {
      this.filesLoading = true;
      this.filesLoadError = null;
      try {
        var res = await fetchWithAuth('/api/files');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        this.filesData = await res.json();
        this.rebuildFileSections();
        this.pageReady.files = true;
      } catch (err) {
        this.filesLoadError = 'Failed to load files: ' + err.message;
      } finally {
        this.filesLoading = false;
        var self = this;
        this.$nextTick(function() { self.refreshIcons(); });
      }
    },

    rebuildFileSections() {
      var LABELS = { 'root': 'Root', 'owners-inbox': 'Owners Inbox', 'team-inbox': 'Team Inbox', 'team': 'Team', 'docs': 'Docs' };
      var data = this.filesData;
      this.fileSections = [];
      var self = this;
      if (data.root && data.root.length) {
        this.fileSections.push({ dir: 'root', label: LABELS.root, files: data.root, open: false });
      }
      ['owners-inbox', 'team-inbox', 'team', 'docs'].forEach(function(dir) {
        if (!Object.prototype.hasOwnProperty.call(data, dir)) return;
        self.fileSections.push({ dir: dir, label: LABELS[dir] || dir, files: data[dir], open: false });
      });
    },

    fileMetaLine(f) {
      var kb = (f.size / 1024).toFixed(1);
      return kb + ' KB · ' + new Date(f.modified).toLocaleDateString();
    },
    fileMetaTags(f) {
      if (!f) return '';
      var bits = [];
      if (f.createdBy) bits.push(this.chatAgentDisplayName(f.createdBy));
      if (f.domain) bits.push(String(f.domain));
      if (f.category) bits.push(String(f.category));
      return bits.length ? bits.join(' · ') : '';
    },
    /** Tags, Details, and Archive only for these folders (matches server FILES_META_DIRS). */
    fileMetaEnabled(dir) {
      return ['docs', 'owners-inbox', 'team-inbox'].indexOf(dir) >= 0;
    },

    filesFilterActive() {
      return !!(String(this.filesFilterCreator || '').trim() || String(this.filesFilterDomain || '').trim());
    },

    fileFilterCreatorOptions() {
      var s = new Set();
      this.fileSections.forEach(function(sec) {
        (sec.files || []).forEach(function(f) {
          if (f.createdBy) s.add(String(f.createdBy).trim());
        });
      });
      return Array.from(s).sort(function(a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });
    },

    fileFilterDomainOptions() {
      var s = new Set();
      this.fileSections.forEach(function(sec) {
        (sec.files || []).forEach(function(f) {
          if (f.domain) s.add(String(f.domain).trim());
        });
      });
      return Array.from(s).sort(function(a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });
    },

    filteredSectionFiles(sec) {
      var files = sec.files || [];
      var c = String(this.filesFilterCreator || '').trim().toLowerCase();
      var d = String(this.filesFilterDomain || '').trim().toLowerCase();
      if (!c && !d) return files;
      return files.filter(function(f) {
        if (c && String(f.createdBy || '').trim().toLowerCase() !== c) return false;
        if (d && String(f.domain || '').trim().toLowerCase() !== d) return false;
        return true;
      });
    },

    sectionFileCountLabel(sec) {
      var n = this.filteredSectionFiles(sec).length;
      var t = (sec.files || []).length;
      if (!this.filesFilterActive() || n === t) return String(n);
      return n + ' / ' + t;
    },

    filesTotalCountAll() {
      var n = 0;
      this.fileSections.forEach(function(sec) { n += (sec.files || []).length; });
      return n;
    },

    filesFilteredTotalCount() {
      var self = this;
      var n = 0;
      this.fileSections.forEach(function(sec) { n += self.filteredSectionFiles(sec).length; });
      return n;
    },

    clearFilesFilters() {
      this.filesFilterCreator = '';
      this.filesFilterDomain = '';
    },

    fileTypeLabel(name) {
      var m = String(name || '').match(/\.([^.]+)$/);
      var ext = m ? m[1].toLowerCase() : '';
      var map = {
        md: 'Markdown',
        markdown: 'Markdown',
        pdf: 'PDF',
        html: 'HTML',
        htm: 'HTML',
        json: 'JSON',
        txt: 'Plain text',
        csv: 'CSV',
        sql: 'SQL',
        png: 'PNG image',
        jpg: 'JPEG image',
        jpeg: 'JPEG image',
        gif: 'GIF image',
        webp: 'WebP image',
        svg: 'SVG image',
        zip: 'ZIP archive',
        doc: 'Word document',
        docx: 'Word document',
        xls: 'Excel spreadsheet',
        xlsx: 'Excel spreadsheet',
      };
      if (map[ext]) return map[ext];
      if (ext) return ext.toUpperCase() + ' file';
      return 'File';
    },
    fileIsText(name) { return /\.(md|html|txt|json|csv|sql)$/i.test(name); },
    fileIsPdf(name) { return /\.pdf$/i.test(name); },
    fileIsEditable(name) { return /\.(md|html|txt|json)$/i.test(name); },
    fileDownloadHref(dir, name) {
      return dir === 'root' ? '/api/cyrus' : '/api/files/' + encodeURIComponent(dir) + '/' + encodeURIComponent(name);
    },

    findFileEntry(dir, name) {
      var sec = this.fileSections.find(function(s) { return s.dir === dir; });
      if (!sec || !sec.files) return null;
      return sec.files.find(function(f) { return f.name === name; }) || null;
    },

    openFileMetaEditor() {
      var p = this.viewerPath || this.editorPath;
      if (!p || !this.fileMetaEnabled(p.dir)) return;
      var f = this.findFileEntry(p.dir, p.name);
      this.fileMetaDraft = {
        dir: p.dir,
        name: p.name,
        createdBy: f && f.createdBy ? f.createdBy : '',
        domain: f && f.domain ? f.domain : '',
        category: f && f.category ? f.category : '',
      };
      this.fileMetaEditorOpen = true;
      var self = this;
      this.$nextTick(function() { self.refreshIcons(); });
    },

    closeFileMetaEditor() {
      this.fileMetaEditorOpen = false;
    },

    async saveFileMeta() {
      var d = this.fileMetaDraft;
      if (!d || !d.name) return;
      this.fileMetaSaving = true;
      try {
        var url = '/api/files/' + encodeURIComponent(d.dir) + '/' + encodeURIComponent(d.name) + '/meta';
        var r = await fetchWithAuth(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            createdBy: d.createdBy,
            domain: d.domain,
            category: d.category,
          }),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        this.fileMetaEditorOpen = false;
        await this.loadFiles();
      } catch (err) {
        alert('Could not save details: ' + (err && err.message ? err.message : String(err)));
      } finally {
        this.fileMetaSaving = false;
      }
    },

    async archiveFile(dir, name) {
      if (dir === 'root') return;
      if (!confirm('Archive this file? It will be renamed with the _archived_ prefix and hidden from the list.')) return;
      try {
        var url = '/api/files/' + encodeURIComponent(dir) + '/' + encodeURIComponent(name) + '/archive';
        var r = await fetchWithAuth(url, { method: 'POST' });
        var errBody = null;
        try {
          errBody = await r.json();
        } catch (_) {}
        if (!r.ok) {
          alert((errBody && errBody.error) ? errBody.error : 'Archive failed');
          return;
        }
        this.viewerOpen = false;
        this.viewerPath = null;
        this.editorOpen = false;
        this.editorPath = null;
        await this.loadFiles();
      } catch (e) {
        alert('Archive failed: ' + (e && e.message ? e.message : String(e)));
      }
    },

    async triggerFileDownload(dir, name) {
      var url = this.fileDownloadHref(dir, name);
      try {
        var r = await fetchWithAuth(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var blob = await r.blob();
        var objUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = objUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(objUrl); }, 2500);
      } catch (e) {
        alert('Download failed: ' + (e && e.message ? e.message : String(e)));
      }
    },

    openFileRow(dir, name) {
      if (this.fileIsPdf(name)) {
        this.openPdfViewer(dir, name);
        return;
      }
      if (this.fileIsText(name)) {
        this.viewFile(dir, name);
        return;
      }
      this.showDownloadOnlyPanel(dir, name);
    },

    openPdfViewer(dir, name) {
      this.editorOpen = false;
      this.viewerPath = { dir: dir, name: name };
      this.viewerTitle = name;
      this.viewerContent = '';
      this.viewerLoadError = '';
      this.viewerDisplayMode = 'pdf';
      this.viewerOpen = true;
      var self = this;
      this.$nextTick(function() { self.refreshIcons(); });
    },

    showDownloadOnlyPanel(dir, name) {
      this.editorOpen = false;
      this.viewerPath = { dir: dir, name: name };
      this.viewerTitle = name;
      this.viewerContent = '';
      this.viewerLoadError = '';
      this.viewerDisplayMode = 'download';
      this.viewerOpen = true;
      var self = this;
      this.$nextTick(function() { self.refreshIcons(); });
    },

    editFromViewer() {
      if (!this.viewerPath) return;
      var p = this.viewerPath;
      this.viewerOpen = false;
      this.viewerPath = null;
      this.editFile(p.dir, p.name);
    },

    closeViewer() {
      this.viewerOpen = false;
      this.viewerPath = null;
      this.viewerContent = '';
      this.viewerDisplayMode = 'text';
      this.viewerLoadError = '';
    },

    async viewFile(dir, name) {
      var url = dir === 'root' ? '/api/cyrus' : '/api/files/' + encodeURIComponent(dir) + '/' + encodeURIComponent(name);
      this.editorOpen = false;
      this.viewerPath = { dir: dir, name: name };
      this.viewerTitle = name;
      this.viewerLoadError = '';
      try {
        var r = await fetchWithAuth(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var text = await r.text();
        this.viewerContent = text;
        this.viewerDisplayMode = /\.md$/i.test(name) ? 'markdown' : 'text';
        this.viewerOpen = true;
        var self = this;
        this.$nextTick(function() { self.refreshIcons(); });
      } catch (err) {
        this.viewerContent = '';
        this.viewerLoadError = err.message || 'Could not load file';
        this.viewerDisplayMode = 'error';
        this.viewerOpen = true;
        var self = this;
        this.$nextTick(function() { self.refreshIcons(); });
      }
    },

    async editFile(dir, name) {
      var url = dir === 'root' ? '/api/cyrus' : '/api/files/' + encodeURIComponent(dir) + '/' + encodeURIComponent(name);
      try {
        var r = await fetchWithAuth(url);
        var text = await r.text();
        this.viewerOpen = false;
        this.viewerPath = null;
        this.editorPath = { dir: dir, name: name };
        this.editorTitle = name;
        this.editorContent = text;
        this.editorOpen = true;
        var self = this;
        this.$nextTick(function() { self.refreshIcons(); });
      } catch (err) {
        alert('Could not load file: ' + err.message);
      }
    },

    async saveFile() {
      if (!this.editorPath) return;
      this.editorSaving = true;
      var p = this.editorPath;
      var url = p.dir === 'root' ? '/api/cyrus' : '/api/files/' + encodeURIComponent(p.dir) + '/' + encodeURIComponent(p.name);
      try {
        var r = await fetchWithAuth(url, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: this.editorContent });
        await r.json();
        this.editorOpen = false;
        this.editorPath = null;
        await this.loadFiles();
      } catch (err) {
        alert('Save failed: ' + err.message);
      } finally {
        this.editorSaving = false;
      }
    },

    chatAgentDisplayName(agentId) {
      var a = String(agentId || '').toLowerCase();
      if (a === 'cyrus' || a === 'larry') return 'Cyrus';
      if (a === 'owner') return 'Owner';
      if (!a) return 'Cyrus';
      return a.charAt(0).toUpperCase() + a.slice(1);
    },
    normalizeChatAgentId(agentId) {
      var a = String(agentId || '').toLowerCase().trim();
      if (!a) return 'cyrus';
      return a === 'larry' ? 'cyrus' : a;
    },

    chatAgentSummaryLine(agentId) {
      var id = this.normalizeChatAgentId(agentId);
      var row = this.chatAgentMeta[id];
      if (!row || !row.status) return '';
      if (row.status === 'loading') return 'Loading role…';
      if (row.status === 'err') return row.error || 'Could not load role.';
      return row.summary || '';
    },

    isActiveChatAgentPick(slug) {
      return this.normalizeChatAgentId(this.chatAgent) === this.normalizeChatAgentId(slug);
    },

    toggleChatAgentPicker() {
      if (this.chatMessages.length > 0) return;
      this.chatAgentPickerOpen = !this.chatAgentPickerOpen;
      if (this.chatAgentPickerOpen) this.prefetchAllChatAgentMeta();
      var self = this;
      this.$nextTick(function () {
        self.refreshIcons();
      });
    },

    closeChatAgentPicker() {
      if (!this.chatAgentPickerOpen) return;
      this.chatAgentPickerOpen = false;
      var self = this;
      this.$nextTick(function () {
        self.refreshIcons();
      });
    },

    async selectChatAgentFromPicker(slug) {
      if (this.chatMessages.length > 0) return;
      var next = this.normalizeChatAgentId(slug);
      var cur = this.normalizeChatAgentId(this.chatAgent);
      this.chatAgentPickerOpen = false;
      var self = this;
      if (next === cur) {
        this.$nextTick(function () {
          self.refreshIcons();
        });
        return;
      }
      this.chatAgent = next;
      await this.onChatAgentChange();
      this.$nextTick(function () {
        self.refreshIcons();
      });
    },

    async fetchChatAgentMarkdownRaw(agentId) {
      var id = this.normalizeChatAgentId(agentId);
      var url = id === 'cyrus' ? '/api/cyrus' : '/api/files/team/' + encodeURIComponent(id + '.md');
      var r = await fetchWithAuth(url);
      if (!r.ok) {
        var msg = 'Could not load agent brief';
        try {
          var ej = await r.json();
          if (ej && ej.error) msg = ej.error;
        } catch (_) {}
        throw new Error(msg);
      }
      return r.text();
    },

    async ensureChatAgentMeta(agentId) {
      var id = this.normalizeChatAgentId(agentId);
      var cur = this.chatAgentMeta[id];
      if (cur && cur.status === 'ok' && cur.markdown) return;
      var inflight = this._chatAgentMetaInflight[id];
      if (inflight) return inflight;

      if (!this.chatAgentMeta[id]) this.chatAgentMeta[id] = {};
      this.chatAgentMeta[id].status = 'loading';
      this.chatAgentMeta[id].summary = '';
      this.chatAgentMeta[id].markdown = '';
      delete this.chatAgentMeta[id].error;

      var self = this;
      var p = this.fetchChatAgentMarkdownRaw(id)
        .then(function (md) {
          var summary = parseAgentBriefSummary(md);
          self.chatAgentMeta[id] = { status: 'ok', summary: summary, markdown: md };
        })
        .catch(function (e) {
          self.chatAgentMeta[id] = {
            status: 'err',
            summary: '',
            markdown: '',
            error: e.message || String(e),
          };
        })
        .finally(function () {
          delete self._chatAgentMetaInflight[id];
        });

      this._chatAgentMetaInflight[id] = p;
      return p;
    },

    prefetchAllChatAgentMeta() {
      var agents = this.chatAgents || [];
      for (var i = 0; i < agents.length; i++) this.ensureChatAgentMeta(agents[i]);
    },

    async openChatAgentProfile() {
      this.chatAgentPickerOpen = false;
      var id = this.normalizeChatAgentId(this.chatAgent);
      this.chatAgentProfileOpen = true;
      this.chatAgentProfileLoading = true;
      this.chatAgentProfileError = '';
      this.chatAgentProfileHtml = '';
      var self = this;
      this.$nextTick(function () {
        self.refreshIcons();
      });
      try {
        await this.ensureChatAgentMeta(id);
        var row = this.chatAgentMeta[id];
        if (!row || row.status !== 'ok' || !row.markdown) {
          throw new Error((row && row.error) || 'No profile available');
        }
        this.chatAgentProfileHtml = renderAssistantMarkdown(row.markdown);
      } catch (e) {
        this.chatAgentProfileError = e.message || String(e);
      } finally {
        this.chatAgentProfileLoading = false;
        this.$nextTick(function () {
          self.refreshIcons();
        });
      }
    },

    closeChatAgentProfile() {
      this.chatAgentProfileOpen = false;
      this.chatAgentProfileLoading = false;
      this.chatAgentProfileError = '';
      this.chatAgentProfileHtml = '';
      var self = this;
      this.$nextTick(function () {
        self.refreshIcons();
      });
    },

    async loadChatAgents() {
      try {
        var r = await fetchWithAuth('/api/files');
        var data = await r.json();
        var teamFiles = (data.team || []).map(function(f) { return f.name.replace(/\.md$/, ''); });
        this.chatAgents = ['cyrus'].concat(teamFiles.filter(function(n) { return n !== 'cyrus'; }));
        if (this.chatAgents.indexOf(this.chatAgent) < 0) this.chatAgent = 'cyrus';
      } catch (_) {
        this.chatAgents = ['cyrus'];
      }
    },

    async submitChat() {
      if (!this.chatPrompt.trim()) return;
      var prompt = this.chatPrompt.trim();
      var files = this.chatFiles && this.chatFiles.length ? this.chatFiles.slice() : [];
      if (this.chatOutboundInFlight) {
        this.chatOutboundQueue.push({
          id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          prompt: prompt,
          files: files,
        });
        this.chatPrompt = '';
        this.chatFiles = [];
        var self = this;
        this.$nextTick(function() {
          self.scrollChatToBottom();
          self.refreshIcons();
        });
        return;
      }
      this.chatOutboundInFlight = true;
      await this.runChatTurn(prompt, files);
    },

    /**
     * Sends one user turn (optional team-inbox file upload, then chat stream).
     * Serializes with the outbound queue: when this turn finishes, the next queued item runs automatically.
     */
    async runChatTurn(prompt, files) {
      var self = this;
      if (!this.chatOutboundInFlight) this.chatOutboundInFlight = true;
      var skipQueueDrain = false;
      files = files || [];
      try {
        if (files.length > 0) {
          try {
            var fd = new FormData();
            files.forEach(function(f) { fd.append('files', f); });
            var agentId = this.normalizeChatAgentId(this.chatAgent);
            fd.append('createdBy', agentId);
            fd.append('domain', uploadDefaultDomainForAgent(agentId));
            await fetchWithAuth('/api/upload', { method: 'POST', body: fd });
          } catch (up) {
            alert('Upload failed: ' + (up.message || String(up)));
            skipQueueDrain = true;
            return;
          }
        }
        this.maybeRequestNotificationPermission();
        try {
          await this.ensureChatConversation();
        } catch (e) {
          alert('Could not start chat: ' + e.message);
          skipQueueDrain = true;
          return;
        }
        var optimisticId = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        this.initChatWorkPanelsForTurn();
        this.chatStreamDraft = '';
        this.chatWorkingStartedAt = Date.now();
        this.chatElapsedSec = 0;
        this.chatUiTick = Date.now();
        this._clearChatElapsedTimer();
        this._chatElapsedTimer = setInterval(function() {
          if (self.chatWorkingStartedAt) self.chatElapsedSec = Math.floor((Date.now() - self.chatWorkingStartedAt) / 1000);
          self.chatUiTick = Date.now();
        }, 1000);
        this.chatMessages.push({ id: optimisticId, role: 'user', content: prompt });
        this.chatPrompt = '';
        this.chatStreaming = true;
        this.$nextTick(function() { self.refreshIcons(); });
        this.chatAbortController = new AbortController();
        this.chatRetryPrompt = prompt;
        var streamOk = false;
        var acceptedByServer = false;
        try {
          var res = await fetchWithAuth('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agent: this.normalizeChatAgentId(this.chatAgent),
              prompt: prompt,
              conversationId: this.chatConversationId,
            }),
            signal: this.chatAbortController.signal,
          });
          if (!res.ok) {
            this.chatMessages = this.chatMessages.filter(function(m) { return m.id !== optimisticId; });
            this.chatPrompt = prompt;
            var errMsg = 'Chat request failed: ' + res.status;
            try {
              var ej = await res.json();
              if (ej && ej.error) errMsg = ej.error;
            } catch (_) {}
            this.chatMessages.push({
              id: 'err-' + Date.now(),
              role: 'assistant',
              content: '[Error: ' + errMsg + ']',
              error: true,
            });
            return;
          }
          acceptedByServer = true;
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buf = '';
          while (true) {
            var result = await reader.read();
            if (result.done) break;
            buf += decoder.decode(result.value, { stream: true });
            var lines = buf.split('\n');
            buf = lines.pop();
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (!line.startsWith('data: ')) continue;
              var payload = line.slice(6).trim();
              if (payload === '[DONE]') { streamOk = true; break; }
              try {
                var msg = JSON.parse(payload);
                if (msg.segmentAgent) {
                  self.applySegmentAgentFromStream(msg.segmentAgent);
                }
                if (msg.status === 'started') {
                  self.appendWorkLineToCurrentPanel('Connected — waiting for the model…', 's');
                }
                if (msg.heartbeat) {
                  self.appendWorkLineToCurrentPanel(
                    'Still working… (' + (msg.elapsedSec != null ? msg.elapsedSec + 's' : '') + ')',
                    'h'
                  );
                }
                if (msg.text) self.chatStreamDraft = appendAssistantStreamChunk(self.chatStreamDraft, msg.text);
                if (msg.error) {
                  self.appendWorkLineToCurrentPanel('[stderr] ' + String(msg.error).trim().slice(0, 500), 'e');
                }
                if (msg.tool) {
                  var td = msg.toolDetail ? String(msg.toolDetail).trim().slice(0, 240) : '';
                  self.appendWorkLineToCurrentPanel(td ? msg.tool + ': ' + td : String(msg.tool), 'tool');
                  if (isChatDelegationToolName(msg.tool)) {
                    var guessed = self.guessWorkAgentFromTaskDetail(msg.toolDetail || '');
                    self.openNewWorkPanelForAgent(guessed || '_delegate');
                  }
                }
              } catch (_) {}
            }
            self.scrollChatToBottom();
            if (streamOk) break;
          }
          self.chatStreamDraft = '';
          await self.refreshActiveConversation();
          await self.loadConversationList();
          if (streamOk) self.maybeNotifyChatComplete();
        } catch (err) {
          self.chatStreamDraft = '';
          if (err.name === 'AbortError') {
            await self.refreshActiveConversation();
            await self.loadConversationList();
          } else if (!acceptedByServer) {
            self.chatMessages = self.chatMessages.filter(function(m) { return m.id !== optimisticId; });
            self.chatPrompt = prompt;
            self.chatMessages.push({
              id: 'err-' + Date.now(),
              role: 'assistant',
              content: '[Error: ' + err.message + ']',
              error: true,
            });
          } else {
            await self.refreshActiveConversation();
            await self.loadConversationList();
            var last = self.chatMessages[self.chatMessages.length - 1];
            if (!last || last.role !== 'assistant' || !String(last.content || '').trim()) {
              self.chatMessages.push({
                id: 'err-' + Date.now(),
                role: 'assistant',
                content: '[Error: ' + err.message + ']',
                error: true,
              });
            }
          }
        }
      } finally {
        self._clearChatElapsedTimer();
        self.chatStreaming = false;
        self.chatStreamDraft = '';
        self.chatAbortController = null;
        self.chatWorkingStartedAt = null;
        self.finalizeChatWorkPanels();
        self.scrollChatToBottom();
        self.$nextTick(function() { self.refreshIcons(); });
        if (skipQueueDrain) {
          self.chatOutboundInFlight = false;
        } else if (self.chatOutboundQueue.length) {
          var next = self.chatOutboundQueue.shift();
          self.$nextTick(function() {
            self.runChatTurn(next.prompt, next.files || []).catch(function(e) {
              console.warn('[chat] queued turn', e);
            });
          });
        } else {
          self.chatOutboundInFlight = false;
        }
      }
    },

    abortChat() {
      if (this.chatAbortController) this.chatAbortController.abort();
    },

    handleChatDrop(e) {
      this.chatDragActive = false;
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        this.chatFiles = this.chatFiles.concat(Array.from(e.dataTransfer.files));
        var self = this;
        this.$nextTick(function() { self.refreshIcons(); });
      }
    },

    handleChatFileSelect(e) {
      if (e.target.files && e.target.files.length) {
        this.chatFiles = this.chatFiles.concat(Array.from(e.target.files));
        e.target.value = '';
        var self = this;
        this.$nextTick(function() { self.refreshIcons(); });
      }
    },

    handleFileInput(e) {
      if (e.target.files && e.target.files.length) this.uploadFiles(e.target.files);
      e.target.value = '';
    },

    setupDropZone() {
      var self = this;
      var counter = 0;
      document.addEventListener('dragenter', function(e) {
        if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
          counter++;
          self.dropOverlayVisible = true;
        }
      });
      document.addEventListener('dragleave', function() {
        counter--;
        if (counter <= 0) { counter = 0; self.dropOverlayVisible = false; }
      });
      document.addEventListener('dragover', function(e) { e.preventDefault(); });
      document.addEventListener('drop', function(e) {
        e.preventDefault();
        counter = 0;
        self.dropOverlayVisible = false;
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          self.uploadFiles(e.dataTransfer.files);
        }
      });
    },

    uploadFiles(files) {
      var self = this;
      this.uploadToast = 'Uploading ' + files.length + ' file(s)…';
      this.uploadToastClass = 'bg-slate-800 dark:bg-slate-700';
      var formData = new FormData();
      for (var i = 0; i < files.length; i++) formData.append('files', files[i]);
      formData.append('createdBy', 'owner');
      formData.append('domain', uploadDefaultDomainForAgent('owner'));
      fetchWithAuth('/api/upload', { method: 'POST', body: formData })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          self.uploadToast = 'Uploaded: ' + data.uploaded.map(function(f) { return f.name; }).join(', ');
          self.uploadToastClass = 'bg-emerald-700';
          if (self.page === 'files') self.loadFiles();
          setTimeout(function() { self.uploadToast = ''; }, 4000);
        })
        .catch(function(err) {
          self.uploadToast = 'Upload failed: ' + err.message;
          self.uploadToastClass = 'bg-red-700';
          setTimeout(function() { self.uploadToast = ''; }, 4000);
        });
    },
  }; });
});