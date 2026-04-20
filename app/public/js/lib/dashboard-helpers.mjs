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

/** One line when the stream connects — varied, geeky-but-professional (random per turn). */
var CHAT_WORK_STARTED_LINES = [
  'Connected — spinning up the model…',
  'Link up. Handshake complete; patience compiling…',
  'Channel open — tensors clocking in…',
  'Stream ready. Loading weights, not lifting them…',
  'Pipe live — entropy is being negotiated…',
  'Secure session. Teaching gradients which way is “up”…',
  'Connected. Promise pending; resolve() en route…',
  'Bits flowing — the interesting kind of queue…',
  'Link established. Latent space on standby…',
  'Connected — context window, meet context life…',
];

/** After this many seconds with no output yet, switch to explicit “not stuck” copy (waiting line only). */
export const CHAT_LONG_WAIT_THRESHOLD_SEC = 20;

/** Reassuring lines when a turn is unusually slow — rotate every 8s after the threshold. */
var CHAT_WORK_LONG_WAIT_LINES = [
  'Still running — large context, slow tools, or a long reply can take a bit. Nothing is wrong.',
  'The session is still open. If this step is heavy, waiting longer than usual is normal.',
  'Work is in progress. Complex queries and multi-step tool runs often need extra time.',
  'Hang tight — the model is still processing; a quiet stretch here usually means real work.',
  'No timeout yet: your request is still being handled. You can stop anytime if you need to.',
];

/** Heartbeat lines rotate every 5s of elapsed time (bucket index = floor(sec/5)). */
var CHAT_WORK_HEARTBEAT_LINES = [
  'Still working — good answers have nonzero latency…',
  'Crunching context (software chewing, not dental)…',
  'Tokens on the move; judgment file still open…',
  'Sampling the next move — exploration, not indecision…',
  'Your patience: O(1). This step: a bit more polynomial…',
  'Consulting probability — the votes are being counted…',
  'Attention heads in conference; minutes not recorded…',
  'Aligning tensors, expectations, and line endings…',
  'Stochastic depth — disciplined randomness, not stalling…',
  'Fetching the next idea from a very large hat…',
  'Holding steady — eigen-things are in progress…',
];

export function pickChatWorkStartedLine() {
  return CHAT_WORK_STARTED_LINES[Math.floor(Math.random() * CHAT_WORK_STARTED_LINES.length)];
}

export function formatChatWorkHeartbeatLine(elapsedSec) {
  var n = Math.floor(Number(elapsedSec));
  if (isNaN(n) || n < 0) n = 0;
  var bucket = Math.floor(n / 5);
  var i = bucket % CHAT_WORK_HEARTBEAT_LINES.length;
  return CHAT_WORK_HEARTBEAT_LINES[i];
}

/**
 * Single “waiting” line: started copy (first ~5s), then playful heartbeats, then explicit
 * reassurance after CHAT_LONG_WAIT_THRESHOLD_SEC — so long stalls don’t feel like a hang.
 */
export function formatChatWaitingStatusLine(elapsedSec, startedText) {
  var n = Math.floor(Number(elapsedSec));
  if (isNaN(n) || n < 0) n = 0;
  if (n >= CHAT_LONG_WAIT_THRESHOLD_SEC) {
    var bucket = Math.floor((n - CHAT_LONG_WAIT_THRESHOLD_SEC) / 8);
    var i = bucket % CHAT_WORK_LONG_WAIT_LINES.length;
    return CHAT_WORK_LONG_WAIT_LINES[i];
  }
  if (n < 5 && startedText != null && String(startedText).trim()) {
    return String(startedText);
  }
  return formatChatWorkHeartbeatLine(n);
}

export function empty(msg) {
  return '<div class="text-center py-8 text-sm text-slate-400 dark:text-slate-500">' + msg + '</div>';
}
export function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Heuristic: column likely holds money (SQLite may return INTEGER cents or REAL). */
function datatableColumnLooksCurrency(name) {
  var c = String(name || '').toLowerCase();
  if (c === 'id' || /_id$/.test(c)) return false;
  return (
    c.includes('amount') ||
    c.includes('balance') ||
    c.includes('price') ||
    c.includes('total') ||
    c.includes('credit') ||
    c.includes('debit') ||
    c.includes('net') ||
    c.includes('salary') ||
    c.includes('value') ||
    c.includes('rate') ||
    c.includes('spent') ||
    c.includes('income') ||
    c.endsWith('_cad')
  );
}

/**
 * Format one cell for dashboard SQL tables (dates, currency, booleans).
 * Used by interactive datatables and by legacy HTML table builder.
 */
export function formatDatatableCell(columnName, raw) {
  if (raw === null || raw === undefined) return '—';
  if (raw === '') return '—';
  var c = String(columnName || '').toLowerCase();
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (typeof raw === 'number' && (raw === 0 || raw === 1)) {
    if (/^is_|^has_|^can_/.test(c) || c === 'is_met' || c.endsWith('_flag')) return raw ? 'Yes' : 'No';
  }
  var s0 = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s0)) return fmtDate(s0);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d/.test(s0)) {
    try {
      var dt = new Date(s0);
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
      }
    } catch (_) {}
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && datatableColumnLooksCurrency(c)) {
    return fmtCurrency(raw);
  }
  return s0;
}

/** Shareholder loan direction column — matches `metric_datatable` arrows. */
function datatableDirectionArrowHtml(raw) {
  return raw === 'corp_owes_aidin'
    ? '<span class="inline-flex align-middle text-emerald-500" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg></span>'
    : '<span class="inline-flex align-middle text-red-400" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M19 12l-7 7-7-7"/></svg></span>';
}

/**
 * Rich cell output for interactive datatables when `columnSpecs` includes `format` / `secondaryKey`.
 * @param {object|null|undefined} spec normalized `{ format, secondaryKey }` from manifest
 * @returns {{ useHtml: boolean, text: string, html: string }}
 */
export function formatDatatableCellBundle(columnKey, raw, row, spec) {
  spec = spec || {};
  var fmt = String(spec.format || 'auto').toLowerCase();
  if (fmt === 'date_long') fmt = 'datelong';

  function secondaryBlock() {
    var secKey = spec.secondaryKey;
    if (!secKey || !row) return '';
    var s = row[secKey];
    if (s == null || s === '') return '';
    return '<div class="text-xs text-slate-400 dark:text-slate-500">' + esc(String(s)) + '</div>';
  }

  function finish(isHtml, textPlain, htmlInner) {
    var sec = secondaryBlock();
    if (!sec) {
      return isHtml
        ? { useHtml: true, html: htmlInner, text: '' }
        : { useHtml: false, text: textPlain, html: '' };
    }
    if (isHtml) {
      return { useHtml: true, html: '<div class="min-w-0">' + htmlInner + '</div>' + sec, text: '' };
    }
    return { useHtml: true, html: '<div class="min-w-0">' + esc(textPlain) + '</div>' + sec, text: '' };
  }

  function dateKeyPart(v) {
    if (v == null || v === '') return null;
    var m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }

  switch (fmt) {
    case 'text': {
      var t1 = raw == null || raw === '' ? '—' : String(raw);
      return finish(false, t1, '');
    }
    case 'optional_text': {
      var t2 = raw == null || raw === '' || !String(raw).trim() ? '—' : String(raw);
      return finish(false, t2, '');
    }
    case 'enum': {
      var t3 = raw == null || raw === '' ? '—' : String(String(raw).replace(/_/g, ' '));
      return finish(false, t3, '');
    }
    case 'currency': {
      if (raw == null || raw === '') return finish(false, '—', '');
      var cn = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return finish(false, Number.isFinite(cn) ? fmtCurrency(cn) : '—', '');
    }
    case 'date': {
      var dk = dateKeyPart(raw);
      var t4 = dk ? fmtDate(dk) : raw == null || raw === '' ? '—' : formatDatatableCell(columnKey, raw);
      return finish(false, t4, '');
    }
    case 'datelong': {
      var dk2 = dateKeyPart(raw);
      var t5 = dk2 ? fmtDateLong(dk2) : raw == null || raw === '' ? '—' : formatDatatableCell(columnKey, raw);
      return finish(false, t5, '');
    }
    case 'capitalize': {
      if (raw == null || raw === '') return finish(false, '—', '');
      return finish(true, '', '<span class="capitalize font-medium">' + esc(String(raw)) + '</span>');
    }
    case 'days_remaining': {
      var dd = Number(raw);
      if (!Number.isFinite(dd)) {
        return finish(false, raw == null || raw === '' ? '—' : String(raw), '');
      }
      var cls =
        dd <= 7
          ? 'text-red-600 dark:text-red-400 font-bold'
          : dd <= 30
            ? 'text-amber-600 dark:text-amber-400 font-medium'
            : 'text-slate-500 dark:text-slate-400';
      return finish(true, '', '<span class="' + cls + '">' + esc(String(dd)) + 'd</span>');
    }
    case 'net_tone': {
      var nn = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isFinite(nn)) return finish(false, '—', '');
      var clsN = nn > 0 ? 'text-emerald-600 dark:text-emerald-400' : nn < 0 ? 'text-red-600 dark:text-red-400' : '';
      return finish(true, '', '<span class="' + clsN + ' font-medium">' + fmtCurrency(nn) + '</span>');
    }
    case 'direction_arrow':
      return finish(true, '', datatableDirectionArrowHtml(raw));
    case 'badge':
      return finish(true, '', statusBadge(raw));
    case 'auto':
    default:
      return finish(false, formatDatatableCell(columnKey, raw), '');
  }
}

/** Client-side state for sortable / filterable dashboard tables (Alpine). */
export function createDatatableInteractiveState(d) {
  var rows = (d && d.rows) ? d.rows.slice() : [];
  var specList = (d && d.columnSpecs) ? d.columnSpecs : null;
  var columns;
  var columnLabels = {};
  var specByKey = {};
  if (specList && specList.length) {
    for (var i = 0; i < specList.length; i++) {
      var s = specList[i];
      if (!s || !s.key) continue;
      columnLabels[s.key] = s.label || s.key;
      specByKey[s.key] = s;
    }
    columns = specList.map(function (x) {
      return x.key;
    });
  } else {
    columns = (d && d.columns) ? d.columns.slice() : rows.length ? Object.keys(rows[0]) : [];
    for (var j = 0; j < columns.length; j++) {
      columnLabels[columns[j]] = columns[j];
    }
  }
  return {
    columns: columns,
    columnLabels: columnLabels,
    specByKey: specByKey,
    rows: rows,
    truncated: !!(d && d.truncated),
    filter: '',
    sortKey: null,
    sortDir: 'asc',
    page: 1,
    pageSize: 50,
  };
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
            var display = formatDatatableCell(c, v);
            var full = v == null || v === '' ? '' : String(v);
            return (
              '<td class="px-3 py-2 text-slate-800 dark:text-slate-200 max-w-[28rem] truncate" title="' +
              esc(full || display) +
              '">' +
              esc(display) +
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

/**
 * Horizontal bar chart from SQL rows (`funnel_bars` section). Uses `labelColumn` + `valueColumn`
 * (defaults: status + count). Only rows with a positive numeric value are shown; order follows the query.
 */
export function renderFunnelBarsHtml(rows, labelColumn, valueColumn) {
  rows = rows || [];
  var lk = labelColumn || 'status';
  var vk = valueColumn || 'count';
  var bars = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || typeof r !== 'object') continue;
    var rawV = r[vk];
    var num = typeof rawV === 'number' ? rawV : parseFloat(rawV);
    if (!isFinite(num) || num <= 0) continue;
    var lab = r[lk];
    bars.push({ label: lab != null ? String(lab) : '', count: num });
  }
  if (!bars.length) {
    return empty('No data yet');
  }
  var counts = bars.map(function(b) {
    return b.count;
  });
  var maxCount = Math.max.apply(null, counts.concat([1]));
  return bars
    .map(function(b) {
      var pct = Math.max(20, Math.round((b.count / maxCount) * 100));
      var displayLabel = String(b.label).replace(/_/g, ' ');
      return (
        '<div class="flex items-center gap-3 mb-2">' +
        '<span class="text-xs text-slate-500 dark:text-slate-400 w-28 text-right flex-shrink-0 capitalize">' +
        esc(displayLabel) +
        '</span>' +
        '<div class="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-6 relative">' +
        '<div class="bg-blue-500 dark:bg-blue-600 h-6 rounded-full" style="width:' +
        pct +
        '%"></div>' +
        '<span class="absolute right-2 top-0 h-6 flex items-center text-xs font-medium text-slate-700 dark:text-slate-100">' +
        esc(String(b.count)) +
        '</span>' +
        '</div></div>'
      );
    })
    .join('');
}

/** @deprecated Use {@link renderFunnelBarsHtml} with status/count columns */
export function renderPipelineFunnelHtml(pipeline) {
  return renderFunnelBarsHtml(pipeline, 'status', 'count');
}

/** KPI grid (`stat_cards`): SQL rows use label/value/sub/value_tone columns (keys configurable via payload). */
export function renderStatCardsHtml(d) {
  var rows = (d && d.rows) || [];
  var lk = (d && d.labelKey) || 'label';
  var vk = (d && d.valueKey) || 'value';
  var sk = (d && d.subKey) || 'sub';
  var tk = (d && d.toneKey) || 'value_tone';
  var toneMap = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    red: 'text-red-600 dark:text-red-400',
    amber: 'text-amber-600 dark:text-amber-400',
    slate: 'text-slate-900 dark:text-white',
    default: 'text-slate-900 dark:text-white',
  };
  if (!rows.length) return empty('No summary data');
  var cards = rows
    .map(function(r) {
      if (!r || typeof r !== 'object') return '';
      var label = r[lk];
      var value = r[vk];
      var sub = r[sk];
      var tone = String(r[tk] || 'default')
        .trim()
        .toLowerCase();
      var colorClass = toneMap[tone] || toneMap.default;
      return statCard({
        label: label != null ? String(label) : '—',
        value: value != null ? String(value) : '—',
        sub: sub != null ? String(sub) : '',
        colorClass: colorClass,
      });
    })
    .join('');
  return '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' + cards + '</div>';
}

function accordionGroupHeaderClass(g) {
  var key = String(g || '')
    .trim()
    .toLowerCase();
  var map = {
    asset: 'text-blue-600 dark:text-blue-400',
    liability: 'text-red-600 dark:text-red-400',
    equity: 'text-purple-600 dark:text-purple-400',
    revenue: 'text-emerald-600 dark:text-emerald-400',
    expense: 'text-orange-600 dark:text-orange-400',
  };
  return map[key] || 'text-slate-800 dark:text-slate-200';
}

/** Grouped `<details>` list (`grouped_accordion`). */
export function renderGroupedAccordionHtml(d) {
  var rows = (d && d.rows) || [];
  var gk = (d && d.groupColumn) || 'type';
  var cols = (d && d.accordionColumns) || [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'subtype', label: '' },
  ];
  var order = (d && d.groupOrder) || null;
  if (!rows.length) return empty('No rows');
  var byGroup = {};
  rows.forEach(function(r) {
    if (!r || typeof r !== 'object') return;
    var g = r[gk];
    var key = g != null ? String(g) : '';
    if (!byGroup[key]) byGroup[key] = [];
    byGroup[key].push(r);
  });
  var groupKeys = Object.keys(byGroup);
  if (order && order.length) {
    var rank = {};
    order.forEach(function(x, i) {
      rank[x] = i;
    });
    groupKeys.sort(function(a, b) {
      var ra = rank[a.toLowerCase()];
      var rb = rank[b.toLowerCase()];
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return a.localeCompare(b);
    });
  } else {
    groupKeys.sort(function(a, b) {
      return a.localeCompare(b);
    });
  }
  var parts = groupKeys.map(function(gKey, gi) {
    var list = byGroup[gKey] || [];
    var count = list.length;
    var headCls = accordionGroupHeaderClass(gKey);
    var label = gKey ? gKey.replace(/_/g, ' ') : 'Other';
    var openAttr = gi === 0 ? ' open' : '';
    var thead =
      '<thead class="bg-slate-50 dark:bg-slate-700/50"><tr>' +
      cols
        .map(function(c) {
          return (
            '<th class="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide px-3 py-2 whitespace-nowrap">' +
            esc(c.label || c.key) +
            '</th>'
          );
        })
        .join('') +
      '</tr></thead>';
    var tbody = list
      .map(function(row) {
        return (
          '<tr class="border-t border-slate-50 dark:border-slate-700/50">' +
          cols
            .map(function(c, ci) {
              var v = row[c.key];
              var display = v == null ? '' : String(v);
              var align = ci === cols.length - 1 ? ' text-right' : '';
              var muted = ci === cols.length - 1 ? ' text-slate-400 dark:text-slate-500' : ' text-slate-800 dark:text-slate-200';
              return (
                '<td class="py-1.5 px-3' +
                align +
                muted +
                '">' +
                esc(display) +
                '</td>'
              );
            })
            .join('') +
          '</tr>'
        );
      })
      .join('');
    return (
      '<details class="border-b border-slate-100 dark:border-slate-700 last:border-0"' +
      openAttr +
      '>' +
      '<summary class="list-none cursor-pointer flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors marker:content-none">' +
      '<span class="font-medium capitalize ' +
      headCls +
      '">' +
      esc(label) +
      '</span>' +
      '<span class="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">' +
      '<span>' +
      esc(String(count)) +
      ' item' +
      (count === 1 ? '' : 's') +
      '</span>' +
      '<svg class="w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 details-chevron" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>' +
      '</span>' +
      '</summary>' +
      '<div class="px-4 pb-3 min-w-0 max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">' +
      '<table class="w-full text-sm min-w-max">' +
      thead +
      '<tbody>' +
      tbody +
      '</tbody></table></div></details>'
    );
  });
  return (
    '<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden min-w-0 max-w-full">' +
    '<style>details > summary .details-chevron { transform: rotate(0deg); } details[open] > summary .details-chevron { transform: rotate(180deg); }</style>' +
    parts.join('') +
    '</div>'
  );
}

function metricTableToneFromSummary(s) {
  if (!s || typeof s !== 'object') return 'text-slate-900 dark:text-white';
  var t = s.value_tone;
  if (t) {
    var toneMap = {
      emerald: 'text-emerald-600 dark:text-emerald-400',
      red: 'text-red-600 dark:text-red-400',
      amber: 'text-amber-600 dark:text-amber-400',
      slate: 'text-slate-900 dark:text-white',
    };
    var k = String(t)
      .trim()
      .toLowerCase();
    if (toneMap[k]) return toneMap[k];
  }
  if (s.direction === 'corp_owes_aidin') return 'text-emerald-600 dark:text-emerald-400';
  if (s.direction != null && s.direction !== '') return 'text-red-600 dark:text-red-400';
  return 'text-slate-900 dark:text-white';
}

function metricTableCellHtml(colKey, raw) {
  var c = String(colKey || '').toLowerCase();
  if (c === 'direction') {
    return datatableDirectionArrowHtml(raw);
  }
  return esc(formatDatatableCell(colKey, raw));
}

/** Summary headline + scrollable table (`metric_datatable`). */
export function renderMetricDatatableHtml(d) {
  var summary = d && d.summary;
  var rows = (d && d.rows) || [];
  var tableColumns = (d && d.tableColumns) || [];
  if (!summary || typeof summary !== 'object') return empty('No summary row');
  if (!tableColumns.length) return empty('No table columns');
  var asOf = summary.metric_date != null ? summary.metric_date : summary.as_of;
  var caption = summary.metric_caption != null ? summary.metric_caption : summary.summary;
  var valRaw = summary.metric_value != null ? summary.metric_value : summary.running_balance;
  var valDisplay =
    typeof valRaw === 'number' && Number.isFinite(valRaw) ? fmtCurrency(valRaw) : esc(valRaw != null ? String(valRaw) : '—');
  var toneCls = metricTableToneFromSummary(summary);
  var dateLine = asOf ? 'Balance as of ' + fmtDate(String(asOf)) : '';
  var summaryBlock =
    '<div class="mb-4">' +
    (dateLine ? '<p class="text-xs text-slate-500 dark:text-slate-400 mb-1">' + esc(dateLine) + '</p>' : '') +
    '<p class="text-3xl font-bold ' +
    toneCls +
    '">' +
    valDisplay +
    '</p>' +
    (caption ? '<p class="text-sm text-slate-500 dark:text-slate-400 mt-1">' + esc(String(caption)) + '</p>' : '') +
    '</div>';
  var th = tableColumns
    .map(function(tc) {
      return (
        '<th scope="col" class="text-left font-medium text-slate-600 dark:text-slate-300 px-3 py-2 border-b border-slate-200 dark:border-slate-600 whitespace-nowrap">' +
        esc(tc.label || tc.key) +
        '</th>'
      );
    })
    .join('');
  var trs = rows
    .map(function(row) {
      return (
        '<tr class="border-b border-slate-100 dark:border-slate-700/80 last:border-0">' +
        tableColumns
          .map(function(tc) {
            var v = row[tc.key];
            var inner = metricTableCellHtml(tc.key, v);
            var full = v == null || v === '' ? '' : String(v);
            return (
              '<td class="px-3 py-2 text-slate-800 dark:text-slate-200 max-w-[28rem] truncate" title="' +
              esc(full || inner) +
              '">' +
              inner +
              '</td>'
            );
          })
          .join('') +
        '</tr>'
      );
    })
    .join('');
  var tableHtml =
    '<div class="dashboard-table-x-scroll rounded-xl border border-slate-200 dark:border-slate-700">' +
    '<table class="min-w-full text-sm">' +
    '<thead class="bg-slate-50 dark:bg-slate-800/80"><tr>' +
    th +
    '</tr></thead><tbody>' +
    trs +
    '</tbody></table></div>';
  return (
    '<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 min-w-0 max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">' +
    summaryBlock +
    (rows.length ? tableHtml : empty('No transactions')) +
    '</div>'
  );
}

/** Account balance cards (`account_cards`) — matches legacy Finance “Accounts” snapshot grid. */
export function renderAccountCardsHtml(rows) {
  rows = rows || [];
  if (!rows.length) return empty('No account snapshots');
  var ownerColors = { personal: 'border-l-blue-400', business: 'border-l-purple-400', joint: 'border-l-teal-400' };
  var html = rows
    .map(function(s) {
      if (!s || typeof s !== 'object') return '';
      var isDebt = ['credit_card', 'loc', 'mortgage'].indexOf(s.account_type) >= 0;
      var balColor = isDebt ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';
      var name = s.name != null ? String(s.name) : '—';
      var snap = s.snapshot_date != null ? fmtDate(String(s.snapshot_date)) : '—';
      var owner = s.owner != null ? String(s.owner) : '—';
      var at = s.account_type != null ? String(s.account_type) : '—';
      return (
        '<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 border-l-4 ' +
        (ownerColors[s.owner] || 'border-l-slate-300') +
        ' p-3">' +
        '<p class="text-xs text-slate-500 dark:text-slate-400 truncate">' +
        esc(name) +
        '</p>' +
        '<p class="text-lg font-bold mt-0.5 ' +
        balColor +
        '">' +
        fmtCurrency(s.balance) +
        '</p>' +
        '<p class="text-xs text-slate-400 dark:text-slate-500">' +
        esc(at) +
        ' · ' +
        esc(owner) +
        ' · ' +
        snap +
        '</p>' +
        '</div>'
      );
    })
    .join('');
  return '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 min-w-0">' + html + '</div>';
}

/** Categorized link lists in two columns (`link_groups`). */
export function renderLinkGroupsHtml(d) {
  var groups = (d && d.groups) || [];
  if (!groups.length) return empty('No links');
  var extIcon =
    '<svg class="inline-block w-3.5 h-3.5 ml-1 text-slate-400 dark:text-slate-500 align-text-bottom" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>';
  var col1 = [];
  var col2 = [];
  groups.forEach(function(g) {
    var lis = (g.links || [])
      .map(function(L) {
        var a =
          '<a class="text-blue-600 dark:text-blue-400 hover:underline" href="' +
          esc(L.href) +
          '"' +
          (L.external ? ' target="_blank" rel="noopener noreferrer"' : '') +
          '>' +
          esc(L.label) +
          '</a>' +
          (L.external ? extIcon : '');
        return '<li class="text-slate-700 dark:text-slate-200 pl-1">' + a + '</li>';
      })
      .join('');
    var block =
      '<div class="min-w-0">' +
      '<h3 class="text-base font-semibold text-slate-800 dark:text-slate-100 mb-2">' +
      esc(g.heading) +
      '</h3>' +
      '<ul class="list-disc list-outside ml-4 space-y-1.5 text-sm">' +
      lis +
      '</ul></div>';
    if (g.column === 2) col2.push(block);
    else col1.push(block);
  });
  return (
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8 items-start text-left max-w-5xl">' +
    '<div class="space-y-8 min-w-0">' +
    col1.join('') +
    '</div><div class="space-y-8 min-w-0">' +
    col2.join('') +
    '</div></div>'
  );
}

/** Build HTML for `funnel_bars` / `progress_card` payloads from `/api/dashboard-section-view/...`. */
export function richSectionHtmlFromPayload(d) {
  if (!d || !d.view) return '';
  if (d.view === 'funnel_bars') return renderFunnelBarsHtml(d.rows, d.labelColumn, d.valueColumn);
  if (d.view === 'progress_card') return buildProgressCardHtml(d.summary, d.items);
  if (d.view === 'stat_cards') return renderStatCardsHtml(d);
  if (d.view === 'grouped_accordion') return renderGroupedAccordionHtml(d);
  if (d.view === 'metric_datatable') return renderMetricDatatableHtml(d);
  if (d.view === 'account_cards') return renderAccountCardsHtml(d.rows);
  if (d.view === 'link_groups') return renderLinkGroupsHtml(d);
  if (d.view === 'job_pipeline') return renderFunnelBarsHtml(d.pipeline, 'status', 'count');
  if (d.view === 'week_card') return buildProgressCardHtml(d.activeWeek, d.weekGoals);
  return '';
}

/** Summary row + checklist (`progress_card`). Compatible with launchpad week/weekly_goals or aliased columns. */
export function buildProgressCardHtml(summary, items) {
  if (!summary) return empty('No summary row');
  items = items || [];
  function itemDone(g) {
    return g && (g.is_met || g.done === 1 || g.done === true);
  }
  function itemText(g) {
    if (!g) return '';
    if (g.goal != null) return String(g.goal);
    if (g.label != null) return String(g.label);
    if (g.title != null) return String(g.title);
    return '';
  }
  var goalsMetCount = items.filter(itemDone).length;
  var goalsTotal = items.length;
  var hoursUsed = summary.hours_actual != null ? Number(summary.hours_actual) : 0;
  var hoursBudget = summary.hours_budget != null ? Number(summary.hours_budget) : 15;
  if (!isFinite(hoursBudget) || hoursBudget < 1) hoursBudget = 15;

  var title = summary.title != null ? String(summary.title) : 'Progress';
  var themeLine = '';
  if (summary.theme != null) themeLine = String(summary.theme);
  else if (summary.subtitle != null) themeLine = String(summary.subtitle);

  var badgeHtml = '';
  if (summary.week_number != null) {
    var wof = summary.week_of != null ? Number(summary.week_of) : 8;
    badgeHtml =
      '<p class="text-xs font-semibold text-blue-500 uppercase tracking-wide">Week ' +
      esc(String(summary.week_number)) +
      ' of ' +
      esc(String(wof)) +
      '</p>';
  } else if (summary.badge != null) {
    badgeHtml =
      '<p class="text-xs font-semibold text-blue-500 uppercase tracking-wide">' +
      esc(String(summary.badge)) +
      '</p>';
  }

  var dateRight = '';
  if (summary.start_date && summary.end_date) {
    dateRight = fmtDate(summary.start_date) + ' – ' + fmtDate(summary.end_date);
  } else if (summary.meta != null) {
    dateRight = esc(String(summary.meta));
  }

  var goalsList = items.length
    ? '<ul class="space-y-1.5 mt-4">' +
      items.slice(0, 8).map(function(g) {
        var met = itemDone(g);
        return (
          '<li class="flex items-center gap-2 text-sm ' +
          (met ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-700 dark:text-slate-200') +
          '">' +
          '<span class="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border text-xs ' +
          (met ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600') +
          '">' +
          (met ? ICON_SVG_CHECK : '') +
          '</span>' +
          esc(itemText(g)) +
          '</li>'
        );
      }).join('') +
      (items.length > 8
        ? '<li class="text-xs text-slate-400 dark:text-slate-500 pl-6">+' + (items.length - 8) + ' more</li>'
        : '') +
      '</ul>'
    : '';

  return (
    '<div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">' +
    '<div class="flex items-start justify-between mb-4">' +
    '<div>' +
    badgeHtml +
    '<h3 class="text-lg font-bold text-slate-900 dark:text-white mt-0.5">' +
    esc(title) +
    '</h3>' +
    (themeLine
      ? '<p class="text-sm text-slate-500 dark:text-slate-400">' + esc(themeLine) + '</p>'
      : '') +
    '</div>' +
    (dateRight
      ? '<span class="text-xs text-slate-400 dark:text-slate-500 text-right">' + dateRight + '</span>'
      : '') +
    '</div>' +
    '<div class="grid grid-cols-2 gap-4">' +
    '<div><div class="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1"><span>Hours</span><span>' +
    hoursUsed +
    ' / ' +
    hoursBudget +
    '</span></div>' +
    progressBar(hoursUsed, hoursBudget, 'bg-blue-500') +
    '</div>' +
    '<div><div class="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1"><span>Goals</span><span>' +
    goalsMetCount +
    ' / ' +
    goalsTotal +
    '</span></div>' +
    progressBar(goalsMetCount, Math.max(goalsTotal, 1), 'bg-emerald-500') +
    '</div>' +
    '</div>' +
    goalsList +
    '</div>'
  );
}

export function buildWeekCardHtml(week, goals) {
  return buildProgressCardHtml(week, goals);
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
 * Map a workspace-relative POSIX path (under the tenant workspace dir) to a markdown link for the Files viewer.
 * Returns null when the path is not a known Files tab (root file or owners-inbox / team-inbox / team / docs).
 */
function workspaceRelToBrainLinkMarkdown(relRaw) {
  var rel = trimBrainPathSegment(relRaw);
  if (!rel) return null;
  try {
    rel = decodeURIComponent(String(rel).replace(/\+/g, ' '));
  } catch (_) {}
  rel = rel.replace(/^\/+/, '').replace(/\\/g, '/');
  var parts = rel.split('/').filter(Boolean);
  if (!parts.length) return null;
  var topDirs = { 'owners-inbox': 1, 'team-inbox': 1, team: 1, docs: 1 };
  if (parts.length >= 2 && topDirs[parts[0]]) {
    var dir = parts[0];
    var name = trimBrainPathSegment(parts.slice(1).join('/'));
    if (!name) return null;
    return '[' + dir + '/' + name + '](' + brainFileHash(dir, name) + ')';
  }
  if (parts.length === 1) {
    var fn = trimBrainPathSegment(parts[0]);
    if (!fn) return null;
    if (!/^[\w.-]+\.[a-z0-9]{1,12}$/i.test(fn)) return null;
    if (/^larry\.md$/i.test(fn)) fn = 'CYRUS.md';
    return '[' + fn + '](' + brainFileHash('root', fn) + ')';
  }
  return null;
}

var HOST_VOL_WORKSPACE_RE =
  '\\/data\\/users\\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\/workspace\\/';

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

  // Multi-user volume paths (`/data/users/<uuid>/workspace/...`) — models often emit these instead of workspace-relative paths
  s = s.replace(new RegExp('`' + '(' + HOST_VOL_WORKSPACE_RE + '[^`\\n]+)' + '`', 'gi'), function(full, inner) {
    var low = inner.toLowerCase();
    var w = '/workspace/';
    var ix = low.indexOf(w);
    if (ix < 0) return full;
    var rel = inner.slice(ix + w.length);
    var md = workspaceRelToBrainLinkMarkdown(rel);
    return md != null ? md : full;
  });
  s = s.replace(new RegExp('(?<!\\]\\()' + '(' + HOST_VOL_WORKSPACE_RE + '[^\\s\\)\\]\\>`]+)', 'gi'), function(full, pathFromData) {
    var low = pathFromData.toLowerCase();
    var w = '/workspace/';
    var ix = low.indexOf(w);
    if (ix < 0) return full;
    var rel = pathFromData.slice(ix + w.length);
    var md = workspaceRelToBrainLinkMarkdown(rel);
    return md != null ? md : full;
  });

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

  // Bold `**owners-inbox/foo.md**` / `**MyFile.md**` (root) — before bare dir/file so `**` is not eaten as part of the path
  s = s.replace(new RegExp('\\*\\*(' + BRAIN_FILE_DIRS_RE + '/[^*\\n]+)\\*\\*', 'gi'), function(full, path) {
    var clean = trimBrainPathSegment(path);
    var slash = clean.indexOf('/');
    if (slash < 0) return full;
    var dir = clean.slice(0, slash);
    var name = trimBrainPathSegment(clean.slice(slash + 1));
    if (!name) return full;
    return '[' + dir + '/' + name + '](' + brainFileHash(dir, name) + ')';
  });
  s = s.replace(/\*\*([\w.-]+\.(?:md|txt|json))\*\*/gi, function(full, fn) {
    var clean = trimBrainPathSegment(fn);
    if (!/^[\w.-]+\.(?:md|txt|json)$/i.test(clean)) return full;
    if (/^larry\.md$/i.test(clean)) clean = 'CYRUS.md';
    return '[' + clean + '](' + brainFileHash('root', clean) + ')';
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

  // Root workspace files in backticks (not only CYRUS/LARRY): `notes.md` — exclude paths with `/` so we do not match `plan.md` inside `owners-inbox/plan.md`
  s = s.replace(/`([^/\n`]+\.(?:md|txt|json))`/gi, function(full, fn) {
    var clean = trimBrainPathSegment(fn);
    if (!/^[\w.-]+\.(?:md|txt|json)$/i.test(clean)) return full;
    if (/^(LARRY\.md|CYRUS\.md)$/i.test(clean)) return '[CYRUS.md](#/files/root/CYRUS.md)';
    return '[' + clean + '](' + brainFileHash('root', clean) + ')';
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
