// Pure helpers for the dashboard Alpine app (no DOM side effects).
export function fmtCurrency(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}
export function fmtDate(d) {
  if (!d) return '—';
  const parts = d.split('-');
  return new Date(+parts[0], +parts[1] - 1, +parts[2]).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
export function fmtDateLong(d) {
  if (!d) return '—';
  const parts = d.split('-');
  return new Date(+parts[0], +parts[1] - 1, +parts[2]).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}
export function daysFrom(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const parts = d.split('-');
  return Math.round((new Date(+parts[0], +parts[1] - 1, +parts[2]) - today) / 86400000);
}
/** Local calendar date YYYY-MM-DD for greeting rollover */
export function localDateKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/** Which time-of-day bucket we're in (local clock); used to refresh greeting when it changes. */
export function homeGreetingPeriod() {
  var h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  if (h >= 21) return 'late';
  return 'night';
}
/** Time-of-day greeting with a little variety (client local time). */
export function pickHomeGreeting() {
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
export function empty(msg) {
  return '<div class="text-center py-8 text-sm text-slate-400 dark:text-slate-500">' + msg + '</div>';
}
export function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Build dashboard table HTML from `/api/dashboard-page` or `/api/dashboard-section` JSON. */
export function datatableHtmlFromPayload(d) {
  var cols = (d && d.columns) || [];
  var rows = (d && d.rows) || [];
  var truncated = !!(d && d.truncated);
  if (!cols.length) {
    return {
      html: '<div class="text-center py-10 text-sm text-slate-400 dark:text-slate-500">No columns returned</div>',
      truncated: truncated,
    };
  }
  var th = cols
    .map(function (c) {
      return (
        '<th scope="col" class="text-left font-medium text-slate-600 dark:text-slate-300 px-3 py-2 border-b border-slate-200 dark:border-slate-600 whitespace-nowrap">' +
        esc(c) +
        '</th>'
      );
    })
    .join('');
  var trs = rows
    .map(function (r) {
      return (
        '<tr class="border-b border-slate-100 dark:border-slate-700/80 last:border-0">' +
        cols
          .map(function (c) {
            var v = r[c];
            var cell = v == null ? '' : String(v);
            return (
              '<td class="px-3 py-2 text-slate-800 dark:text-slate-200 max-w-[28rem] truncate" title="' +
              esc(cell) +
              '">' +
              esc(cell) +
              '</td>'
            );
          })
          .join('') +
        '</tr>'
      );
    })
    .join('');
  var html =
    '<div class="dashboard-table-x-scroll rounded-xl border border-slate-200 dark:border-slate-700">' +
    '<table class="min-w-full text-sm">' +
    '<thead class="bg-slate-50 dark:bg-slate-800/80"><tr>' +
    th +
    '</tr></thead><tbody>' +
    (trs ||
      '<tr><td colspan="' +
      cols.length +
      '" class="px-3 py-8 text-center text-slate-400 dark:text-slate-500">No rows</td></tr>') +
    '</tbody></table></div>';
  return { html: html, truncated: truncated };
}

/** Claude Code / Agent SDK may emit `Task` or `Agent` for subagent delegation. */
export function isChatDelegationToolName(tool) {
  var t = String(tool || '').trim().toLowerCase();
  return t === 'task' || t === 'agent';
}

/** Default domain for team-inbox upload tags (must match server defaultUploadDomainForAgent). */
export function uploadDefaultDomainForAgent(agentId, pages) {
  var p = pages || { career: true, finance: true, business: true };
  var a = String(agentId || '').toLowerCase();
  if (a === 'ledger') return p.finance ? 'finance' : 'personal';
  if (a === 'charter') return p.business ? 'business' : 'personal';
  if (a === 'owner') return 'personal';
  return p.career ? 'career' : 'personal';
}
/** Same-origin API calls; sends session cookie when DASHBOARD_PASSWORD auth is enabled. */
export function fetchWithAuth(url, init) {
  var cfg = init ? Object.assign({}, init) : {};
  cfg.credentials = 'include';
  return fetch(url, cfg).then(function(res) {
    if (res.status === 401) window.location.href = '/login.html';
    return res;
  });
}
export const DOMAIN_CLASSES = {
  career:   'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  finance:  'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  business: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  personal: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  family:   'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300',
};
export function filterItems(items, range) {
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
export function sortItems(items, sortKey) {
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
export function statusBadge(status) {
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
export function makeTable(cols, rows, emptyMsg) {
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
  return (
    '<div class="dashboard-table-x-scroll">' +
    '<table class="w-full min-w-full"><thead class="bg-slate-50 dark:bg-slate-700/50"><tr>' +
    thead +
    '</tr></thead><tbody>' +
    tbody +
    '</tbody></table></div>'
  );
}
export function statCard(opts) {
  var inner = '<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4' + (opts.link ? ' cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors' : '') + '">' +
    '<p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">' + esc(opts.label) + '</p>' +
    '<p class="text-xl font-bold mt-1 ' + (opts.colorClass || 'text-slate-900 dark:text-white') + '">' + esc(String(opts.value)) + '</p>' +
    (opts.sub ? '<p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">' + esc(opts.sub) + '</p>' : '') +
    '</div>';
  if (opts.link) return '<a href="' + opts.link + '">' + inner + '</a>';
  return inner;
}
export function progressBar(value, max, colorClass) {
  colorClass = colorClass || 'bg-blue-500';
  var pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return '<div class="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 mt-1">' +
    '<div class="' + colorClass + ' h-2 rounded-full progress-bar" style="width:' + pct + '%"></div>' +
    '</div>';
}
export function buildWeekCardHtml(week, goals) {
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

export const ICON_SVG_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" class="inline w-3.5 h-3.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
export const ICON_SVG_ARROW_UP = '<span class="inline-flex align-middle text-emerald-500" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg></span>';
export const ICON_SVG_ARROW_DOWN = '<span class="inline-flex align-middle text-red-400" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M19 12l-7 7-7-7"/></svg></span>';

/** Wrap top-level <table> nodes so wide GFM tables scroll instead of stretching the layout (post-sanitize). */
function wrapHtmlTablesForScroll(html) {
  if (!html || String(html).indexOf('<table') === -1) return html;
  try {
    var parser = new DOMParser();
    var doc = parser.parseFromString('<div class="dashboard-table-wrap-root">' + html + '</div>', 'text/html');
    var root = doc.body.firstElementChild;
    if (!root) return html;
    var tables = root.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var table = tables[i];
      var par = table.parentElement;
      if (par && par.classList && par.classList.contains('dashboard-table-x-scroll')) continue;
      var wrap = doc.createElement('div');
      wrap.setAttribute('class', 'dashboard-table-x-scroll');
      par.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
    return root.innerHTML;
  } catch (_) {
    return html;
  }
}

/**
 * In-app chat links use the hash router (e.g. #/files/…). Everything else should not
 * hijack the current dashboard tab; mailto/tel/sms keep default behavior (no blank tab).
 */
function shouldOpenChatMarkdownLinkInNewWindow(href) {
  if (!href) return false;
  var h = String(href).trim();
  if (h.charAt(0) === '#') return false;
  var lower = h.slice(0, 8).toLowerCase();
  if (lower.indexOf('mailto:') === 0) return false;
  if (lower.indexOf('tel:') === 0) return false;
  if (lower.indexOf('sms:') === 0) return false;
  return true;
}

function addExternalTargetToMarkdownAnchors(html) {
  if (!html || String(html).indexOf('<a') === -1) return html;
  try {
    var parser = new DOMParser();
    var doc = parser.parseFromString('<div class="chat-md-anchors-root">' + html + '</div>', 'text/html');
    var root = doc.body.firstElementChild;
    if (!root) return html;
    var links = root.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href') || '';
      if (!shouldOpenChatMarkdownLinkInNewWindow(href)) continue;
      a.setAttribute('target', '_blank');
      var rel = (a.getAttribute('rel') || '').trim().split(/\s+/).filter(Boolean);
      if (rel.indexOf('noopener') === -1) rel.push('noopener');
      if (rel.indexOf('noreferrer') === -1) rel.push('noreferrer');
      a.setAttribute('rel', rel.join(' '));
    }
    return root.innerHTML;
  } catch (_) {
    return html;
  }
}

export function renderChatMarkdown(raw) {
  if (!raw) return '';
  try {
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      var html = marked.parse(raw, { breaks: true, gfm: true });
      html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
      html = wrapHtmlTablesForScroll(html);
      return addExternalTargetToMarkdownAnchors(html);
    }
  } catch (_) {}
  return esc(raw).replace(/\n/g, '<br>');
}

/** One-line role from team brief / CYRUS.md (`**Role:**` preferred, else H1 subtitle after em dash). */
export function parseAgentBriefSummary(md) {
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

export function brainFileHash(dir, fileName) {
  return '#/files/' + encodeURIComponent(dir) + '/' + encodeURIComponent(fileName);
}

/** Strip trailing punctuation / stray backticks models often glue to paths */
export function trimBrainPathSegment(seg) {
  return String(seg || '').replace(/[`'")\].,;:]+$/g, '').replace(/^[`'"(]+/g, '').trim();
}

/**
 * Fix hash segments when markdown linkification glues `](...)` into the path or leaves `[` on the dir.
 * Used when parsing #/files/dir/name from the location bar or a clicked href.
 */
export function sanitizeBrainHashDir(dir) {
  var d = String(dir || '').trim();
  try {
    d = decodeURIComponent(d);
  } catch (_) {}
  return d.replace(/^\[+/, '').replace(/\]+$/, '').trim();
}

export function sanitizeBrainHashFileName(name) {
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
export function linkifyBrainFileReferences(raw) {
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

/**
 * Detect ``` / ```json fences whose body is a JSON array of todo-like objects
 * `{ id?, title, status? }` and replace with a markdown bullet list (☐ / ☑ + title + id/status).
 * Other fenced languages are left unchanged; non-matching JSON is left as-is.
 */
export function transformTodoJsonFencesToMarkdown(raw) {
  if (!raw || String(raw).indexOf('```') < 0) return raw;
  return String(raw).replace(/```([\w-]*)\s*\n?([\s\S]*?)```/gi, function(full, lang, inner) {
    var l = String(lang || '').trim().toLowerCase();
    if (l && l !== 'json') return full;
    var trimmed = String(inner || '').trim();
    if (!trimmed || trimmed.charAt(0) !== '[') return full;
    var parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      return full;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return full;
    function isTodoLikeRow(o) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
      if (typeof o.title !== 'string' || !o.title.trim()) return false;
      return true;
    }
    if (!parsed.every(isTodoLikeRow)) return full;
    var lines = [];
    for (var i = 0; i < parsed.length; i++) {
      var item = parsed[i];
      var title = String(item.title || '').replace(/\n+/g, ' ').trim();
      title = title.replace(/\*\*/g, '').replace(/^\s*[-*]\s+/, '');
      var st = String(item.status != null ? item.status : 'pending').toLowerCase();
      var done = st === 'completed' || st === 'done' || st === 'complete';
      var sym = done ? '\u2611' : '\u2610';
      var bits = ['- ', sym, ' ', title];
      var id = item.id != null && item.id !== '' ? String(item.id).trim() : '';
      if (id) bits.push(' · #', id);
      if (item.status != null && String(item.status).trim()) bits.push(' · ', String(item.status).trim());
      lines.push(bits.join(''));
    }
    return '\n\n' + lines.join('\n') + '\n\n';
  });
}

/** If marked still emitted <code>/[label](#/files/...)</code>, turn it into a real link (after entity decode). */
export function unwrapBrainFileLinksFromCodeHtml(html) {
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
export function renderAssistantMarkdown(raw) {
  if (!raw) return '';
  try {
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      var withTodos = transformTodoJsonFencesToMarkdown(String(raw));
      var linked = linkifyBrainFileReferences(withTodos);
      var html = marked.parse(linked, { breaks: true, gfm: true });
      html = unwrapBrainFileLinksFromCodeHtml(html);
      html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
      html = wrapHtmlTablesForScroll(html);
      return addExternalTargetToMarkdownAnchors(html);
    }
  } catch (_) {}
  return esc(raw).replace(/\n/g, '<br>');
}
/** Optional markdown body for dashboard action items (details field). */
export function renderActionItemMarkdown(raw) {
  return renderAssistantMarkdown(raw || '');
}
