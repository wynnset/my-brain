import {
  appendAssistantStreamChunk,
  isGenericSdkSubagentId,
} from '../shared/stream-chunk.mjs';
import {
  DOMAIN_CLASSES,
  ICON_SVG_ARROW_DOWN,
  ICON_SVG_ARROW_UP,
  ICON_SVG_CHECK,
  brainFileHash,
  buildWeekCardHtml,
  createDatatableInteractiveState,
  formatDatatableCell,
  formatDatatableCellBundle,
  renderAccountCardsHtml,
  richSectionHtmlFromPayload,
  daysFrom,
  empty,
  esc,
  fetchWithAuth,
  filterItems,
  fmtCurrency,
  fmtDate,
  fmtDateLong,
  homeGreetingPeriod,
  isChatDelegationToolName,
  linkifyBrainFileReferences,
  localDateKey,
  makeTable,
  parseAgentBriefSummary,
  CHAT_LONG_WAIT_THRESHOLD_SEC,
  formatChatWaitingStatusLine,
  pickChatWorkStartedLine,
  pickHomeGreeting,
  progressBar,
  renderActionItemMarkdown,
  renderAssistantMarkdown,
  renderChatMarkdown,
  sanitizeBrainHashDir,
  sanitizeBrainHashFileName,
  sortItems,
  statCard,
  statusBadge,
  transformTodoJsonFencesToMarkdown,
  trimBrainPathSegment,
  unwrapBrainFileLinksFromCodeHtml,
  uploadDefaultDomainForAgent
} from './lib/dashboard-helpers.mjs';

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
    /** Domain tabs — toggled from server from manifest + `*.db` files per tenant (`personal` / `family` via `action_domain` pages). */
    dashboardPages: { career: true, finance: true, business: true, personal: false, family: false },
    /** Enabled nav entries from `workspace/dashboard.json` (see `/api/dashboard-manifest`). */
    dashboardNavPages: [],
    theme: (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) || 'system',
    refreshing: false,
    lastRefresh: '',
    cache: {},
    loadError: { home: null, career: null, finance: null, business: null, usage: null },
    pageReady: { home: false, career: false, finance: false, business: false, files: false, usage: false },
    /** Last `/api/chat/usage-summary` response (for home footer one-liner). */
    chatUsageSummaryForHome: null,
    /** Full usage payload while `page === 'usage'`. */
    chatUsageSummary: null,
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
    datatableHtml: '',
    /** Standalone `datatable` template page: columns/rows + UI state (sort, filter, page). */
    datatableInteractive: null,
    datatableLoadError: '',
    datatableReady: false,
    datatableTruncated: false,
    /** Multi-section page: `{ id, label, html, error, loading, skipped?, skipReason?, truncated }[]` */
    sectionsPagePanels: [],
    sectionsPageReady: false,
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
    /** From server: cumulative SDK billing for the active conversation (Anthropic / Agent SDK). */
    chatSdkUsageSessionTotals: null,
    chatConversations: [],
    chatSessionTitle: '',
    /** Inline rename: click title → edit; saved via PATCH. */
    chatTitleEditing: false,
    chatTitleDraft: '',
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
    /**
     * True when stream-driven content arrived while the user was scrolled up,
     * so we suppressed the auto-follow. Reveals a "New replies below" pill
     * that jumps back to the latest on click. Reset when the user scrolls
     * near the bottom or we force-scroll on user-driven actions.
     */
    chatShowNewRepliesButton: false,
    /**
     * Sticky "pinned near bottom" flags updated on scroll events — used to
     * decide whether stream-driven appends should auto-follow to the newest
     * content. Kept separately for desktop and mobile because both scroll
     * containers exist in the DOM (only one is visible at a time via CSS).
     */
    _chatPinnedDesktop: true,
    _chatPinnedMobile: true,
    /** Bumped every second while streaming for reactive UI (waiting-line copy, etc.). */
    chatUiTick: 0,
    chatWorkingStartedAt: null,
    _chatElapsedTimer: null,
    chatAbortController: null,
    chatRetryPrompt: '',
    chatFiles: [],
    chatDragActive: false,
    /** When true, the next chat turn uses server plan phase (read-only tools + JSON checklist). */
    chatPlanMode: false,
    /** Editable checklist from the last plan turn (also loaded from session). */
    chatPlanTodos: [],
    /** Markdown from `docs/brain-chat-plan.md` when the agent wrote it. */
    chatPlanMarkdown: '',
    /** Server `planExecutePending`: user should run the execute step. */
    chatPlanAwaitingExecute: false,
    /** When set, markdown plan was saved under this path (owners-inbox). */
    chatPlanInboxFile: null,
    /** From session: files touched in this chat under inbox / team / docs / brief (see server). */
    chatWorkspaceTouches: [],
    /** Per slug: { status, summary, markdown?, error? } — full markdown for profile modal. */
    chatAgentMeta: {},
    /** slug -> Promise while `ensureChatAgentMeta` is in flight (dedupe concurrent loads). */
    _chatAgentMetaInflight: {},
    /** Claude model alias from `/api/chat/models` (e.g. sonnet, opus, haiku). */
    chatModel: 'haiku',
    chatModelCatalog: [],
    chatModelPickerOpen: false,
    /** Edit user message → overwrite thread or fork + resend. */
    chatUserMessageEditOpen: false,
    chatUserMessageEditTargetId: null,
    chatUserMessageEditDraft: '',
    chatUserMessageEditApplying: false,
    /** Briefly set to an assistant `message.id` after copy succeeds (checkmark in UI). */
    chatCopiedAssistantMessageId: null,
    _chatCopyFlashTimer: null,
    chatAgentProfileOpen: false,
    /** Slug whose brief is shown in the profile modal (may differ from `chatAgent` when chat is locked). */
    chatAgentProfileViewing: null,
    chatAgentProfileLoading: false,
    chatAgentProfileError: '',
    chatAgentProfileHtml: '',
    _osMqListener: null,
    /** True when the primary pointer is coarse (typical touch phones/tablets); keyboard newline hints stay hidden. */
    chatCoarsePointer: (function() {
      try {
        return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
      } catch (_) { return false; }
    })(),
    _chatPointerCoarseMqListener: null,
    loginRequired: false,
    /** Multi-user: `{ login, displayName }` from `/api/auth-status` when signed in. */
    sessionAccount: null,
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
      domain: 'personal',
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
        .then(function(d) {
          self.loginRequired = !!d.loginRequired;
          self.sessionAccount = d.account || null;
          if (d.dashboardPages) {
            self.dashboardPages = {
              career: !!d.dashboardPages.career,
              finance: !!d.dashboardPages.finance,
              business: !!d.dashboardPages.business,
              personal: !!d.dashboardPages.personal,
              family: !!d.dashboardPages.family,
            };
          }
          if (Array.isArray(d.dashboardNavPages)) {
            self.dashboardNavPages = d.dashboardNavPages.slice();
          }
          self.onHashChange();
        })
        .catch(function() { self.onHashChange(); });
      this.refreshIcons();
      window.addEventListener('hashchange', function() { self.onHashChange(); });
      this.setupDropZone();
      setInterval(function() {
        var slugs = (self.dashboardNavPages || []).map(function(p) { return p.slug; });
        if (self.page === 'home' || self.page === 'files' || self.page === 'usage' || slugs.indexOf(self.page) >= 0) {
          self.loadPage(self.page, true);
        }
      }, 60000);
      Promise.all([self.loadChatAgents(), self.loadChatModels()]).finally(function() {
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
        self.syncChatComposerHeights();
      };
      window.addEventListener('resize', this._onResizeViewport);
      try {
        var pmq = window.matchMedia('(pointer: coarse)');
        this._chatPointerCoarseMqListener = function() {
          self.chatCoarsePointer = pmq.matches;
        };
        this._chatPointerCoarseMqListener();
        pmq.addEventListener('change', this._chatPointerCoarseMqListener);
      } catch (_) {}
      self.pollOwnersInbox();
      self._ownersInboxPollTimer = setInterval(function() { self.pollOwnersInbox(); }, 30000);
    },

    ownersInboxFileHash(name) {
      return brainFileHash('owners-inbox', name);
    },

    chatPlanInboxOpenHref() {
      var f = this.chatPlanInboxFile;
      if (!f || !f.dir || !f.name) return '#/files';
      return brainFileHash(f.dir, f.name);
    },

    async navigateToOwnersInboxPlan(f) {
      f = f || this.chatPlanInboxFile;
      if (!f || !f.dir || !f.name) return;
      var h = brainFileHash(f.dir, f.name);
      if (location.hash !== h) {
        location.hash = h;
      } else {
        await this.openFileFromHash(f.dir, f.name);
      }
    },

    /** Open Files viewer from a workspace-relative path stored on the chat session. */
    async openChatWorkspaceTouch(row) {
      var rel = row && row.path ? String(row.path).replace(/\\/g, '/').trim() : '';
      if (!rel) return;
      this.chatOpen = true;
      var slash = rel.indexOf('/');
      if (slash < 0) {
        if (rel === 'CYRUS.md' || rel === 'LARRY.md') {
          await this.openFileFromHash('root', rel);
          return;
        }
        return;
      }
      var dir = rel.slice(0, slash);
      var name = rel.slice(slash + 1);
      if (['owners-inbox', 'team-inbox', 'team', 'docs'].indexOf(dir) < 0) return;
      await this.openFileFromHash(dir, name);
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
          self.syncChatComposerHeights();
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
      this.closeChatAgentProfile();
      this._lockBodyForMobileChat(false);
      this.$nextTick(function() { this.refreshIcons(); }.bind(this));
    },

    /** True when chat uses the full-viewport mobile panel (below lg / 1024px). */
    isMobileFullWindowChat() {
      try {
        return !!this.chatOpen && window.matchMedia('(max-width: 1023px)').matches;
      } catch (_) {
        return false;
      }
    },

    chatSdkBillingHasData(b) {
      if (!b || typeof b !== 'object') return false;
      if (b.totalCostUsd != null && Number.isFinite(b.totalCostUsd)) return true;
      if (b.usage && typeof b.usage === 'object' && Object.keys(b.usage).length) return true;
      if (b.modelUsage && typeof b.modelUsage === 'object' && Object.keys(b.modelUsage).length) return true;
      return false;
    },

    chatSdkSessionTotalsHasData(t) {
      if (!t || typeof t !== 'object') return false;
      if (t.totalCostUsd != null && Number.isFinite(t.totalCostUsd)) return true;
      if (t.usage && typeof t.usage === 'object' && Object.keys(t.usage).length) return true;
      if (t.modelUsage && typeof t.modelUsage === 'object' && Object.keys(t.modelUsage).length) return true;
      return false;
    },

    formatChatUsd(v) {
      if (v == null || !Number.isFinite(Number(v))) return '';
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 6,
        }).format(Number(v));
      } catch (_) {
        return '$' + String(v);
      }
    },

    /** Short token hint from API-shaped `usage` (input_tokens / output_tokens, etc.). */
    chatSdkUsageTokenHint(usage) {
      if (!usage || typeof usage !== 'object') return '';
      var parts = [];
      var ink = usage.input_tokens;
      var outk = usage.output_tokens;
      if (typeof ink === 'number' && Number.isFinite(ink)) parts.push(ink.toLocaleString() + ' in');
      if (typeof outk === 'number' && Number.isFinite(outk)) parts.push(outk.toLocaleString() + ' out');
      return parts.join(' · ');
    },

    chatSdkBillingSummaryLine(b) {
      if (!this.chatSdkBillingHasData(b)) return 'Usage';
      var bits = [];
      if (b.totalCostUsd != null && Number.isFinite(b.totalCostUsd)) bits.push(this.formatChatUsd(b.totalCostUsd));
      var hint = this.chatSdkUsageTokenHint(b.usage);
      if (hint) bits.push(hint);
      else if (b.modelUsage && typeof b.modelUsage === 'object') {
        var mk = Object.keys(b.modelUsage);
        if (mk.length) bits.push(mk.length + ' model' + (mk.length === 1 ? '' : 's'));
      }
      if (typeof b.numTurns === 'number' && b.numTurns > 0) bits.push(b.numTurns + ' turns');
      return bits.length ? bits.join(' · ') : 'Usage';
    },

    chatSdkBillingDetailText(b) {
      try {
        return JSON.stringify(
          {
            totalCostUsd: b.totalCostUsd,
            usage: b.usage || null,
            modelUsage: b.modelUsage || null,
            numTurns: b.numTurns,
            resultSubtype: b.resultSubtype,
          },
          null,
          2
        );
      } catch (_) {
        return String(b);
      }
    },

    chatSdkSessionTotalsSummaryLine(t) {
      if (!this.chatSdkSessionTotalsHasData(t)) return '';
      var bits = ['Session'];
      if (t.totalCostUsd != null && Number.isFinite(t.totalCostUsd)) bits.push(this.formatChatUsd(t.totalCostUsd));
      var hint = this.chatSdkUsageTokenHint(t.usage);
      if (hint) bits.push(hint + ' (Σ)');
      else if (t.modelUsage && typeof t.modelUsage === 'object') {
        var ks = Object.keys(t.modelUsage);
        if (ks.length) bits.push(ks.length + ' model' + (ks.length === 1 ? '' : 's'));
      }
      return bits.join(' · ');
    },

    chatSdkSessionTotalsDetailText(t) {
      try {
        return JSON.stringify(t, null, 2);
      } catch (_) {
        return String(t);
      }
    },

    /** One-line stats for home footer (month-to-date, UTC, from `/api/chat/usage-summary`). */
    homeUsageFooterMain() {
      var u = this.chatUsageSummaryForHome;
      if (!u || !u.monthToDate) return 'No usage yet';
      var m = u.monthToDate;
      var monthKey = m.month || '';
      var name = 'This month';
      if (monthKey && monthKey.length >= 7) {
        try {
          var d = new Date(monthKey + '-01T12:00:00Z');
          name = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
        } catch (_) {}
      }
      var usd = typeof m.totalCostUsd === 'number' && Number.isFinite(m.totalCostUsd) ? m.totalCostUsd : 0;
      return name + ' usage: $' + usd.toFixed(2);
    },

    usageTokPair(inTok, outTok) {
      return (inTok || 0).toLocaleString() + ' in / ' + (outTok || 0).toLocaleString() + ' out tok';
    },

    usageMonthLabel(ym) {
      if (!ym || ym.length < 7) return ym || '';
      try {
        var d = new Date(ym + '-01T12:00:00Z');
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      } catch (_) {
        return ym;
      }
    },

    usageWeekLabel(weekMonday) {
      if (!weekMonday) return '';
      try {
        var d0 = new Date(weekMonday + 'T12:00:00Z');
        var d1 = new Date(d0.getTime() + 6 * 86400000);
        var o = { month: 'short', day: 'numeric', timeZone: 'UTC' };
        return (
          d0.toLocaleDateString('en-US', o) +
          '\u2013' +
          d1.toLocaleDateString('en-US', Object.assign({}, o, { year: 'numeric' }))
        );
      } catch (_) {
        return 'Week of ' + weekMonday;
      }
    },

    usageGeneratedLabel() {
      var u = this.chatUsageSummary;
      if (!u || !u.generatedAt) return '';
      try {
        return 'Updated ' + new Date(u.generatedAt).toLocaleString();
      } catch (_) {
        return '';
      }
    },

    usageSessionCostTwoDecimals(row) {
      var n = row && typeof row.totalCostUsd === 'number' && Number.isFinite(row.totalCostUsd) ? row.totalCostUsd : 0;
      return '$' + n.toFixed(2);
    },

    usageSessionUpdatedLabel(iso) {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      } catch (_) {
        return String(iso);
      }
    },

    async openChatSessionFromUsage(row) {
      if (!row || !row.id) return;
      await this.openConversation(String(row.id));
      this.openChat();
    },

    async refreshHomeUsageFooter() {
      try {
        var r = await fetchWithAuth('/api/chat/usage-summary');
        if (r.ok) this.chatUsageSummaryForHome = await r.json();
      } catch (_) {}
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

    initChatWorkPanelsForTurn() {
      this.chatWorkPanels = [];
      this._appendWorkPanel(this.normalizeWorkPanelAgentId(this.chatAgent), true);
    },

    _appendWorkPanel(agentId, expanded, delegationId) {
      var panels = this.chatWorkPanels || [];
      for (var i = 0; i < panels.length; i++) {
        if (!panels[i].done) panels[i].expanded = false;
      }
      this.chatWorkPanels.push({
        id: 'wp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
        agentId: agentId,
        /** Server `tool_use_id` for matching segment-end events (parallel delegations). */
        delegationId: delegationId || null,
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

    /**
     * Server/SDK confirmed a delegation handoff to a real team agent. Open (or
     * promote) a work panel so the UI shows "<agent> is working" instead of the
     * parent agent. Generic SDK subagent ids are ignored by the server, but we
     * re-check here defensively and also require the slug to be a known team
     * member so "General-purpose" / stray ids never surface as speakers.
     */
    applySegmentAgentFromStream(agentId) {
      if (agentId == null || !String(agentId).trim()) return;
      if (isGenericSdkSubagentId(agentId)) return;
      var aid = this.normalizeWorkPanelAgentId(String(agentId).trim().toLowerCase().replace(/\s+/g, '_'));
      var known = (this.chatAgents || []).some(function (slug) {
        return this.normalizeChatAgentId(slug) === aid;
      }, this);
      if (!known) return;
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

    /**
     * Server saw a `Task` tool_use block in an assistant message and emitted a
     * segment-start for a real team member. Unlike {@link applySegmentAgentFromStream},
     * this tags the panel with the `tool_use_id` so the matching segment-end
     * event can target the right panel even when multiple delegations run in
     * parallel. Idempotent: if a panel with the same delegationId is already
     * open we leave it alone.
     *
     * @param {{ id?: string, agent?: string }} evt
     */
    applySegmentAgentStartFromStream(evt) {
      if (!evt || evt.agent == null) return;
      var agentRaw = String(evt.agent).trim();
      if (!agentRaw) return;
      if (isGenericSdkSubagentId(agentRaw)) return;
      var aid = this.normalizeWorkPanelAgentId(agentRaw.toLowerCase().replace(/\s+/g, '_'));
      var known = (this.chatAgents || []).some(function (slug) {
        return this.normalizeChatAgentId(slug) === aid;
      }, this);
      if (!known) return;
      var delegationId = evt.id != null ? String(evt.id) : '';
      var panels = this.chatWorkPanels || [];
      if (delegationId) {
        for (var i = 0; i < panels.length; i++) {
          if (panels[i].delegationId === delegationId) {
            this.chatUiTick = Date.now();
            return;
          }
        }
      }
      // Promote a placeholder panel left by an earlier handler in the same
      // turn instead of opening a second card. Two shapes to promote:
      //   1. A generic "_delegate" placeholder (legacy `segmentAgent` path).
      //   2. A same-slug panel opened optimistically by the `tool` event
      //      handler (guessed from Task prompt body) that is still untagged.
      // In both cases we adopt the server's `tool_use_id` so the matching
      // segment-end can close the right card.
      for (var pi = panels.length - 1; pi >= 0; pi--) {
        var cand = panels[pi];
        if (cand.done || cand.delegationId) continue;
        if (cand.agentId === '_delegate' || cand.agentId === aid) {
          cand.agentId = aid;
          cand.delegationId = delegationId || null;
          cand.startedAt = cand.startedAt || Date.now();
          cand.expanded = true;
          this.chatUiTick = Date.now();
          return;
        }
        // Stop at the first not-done panel that isn't a match — we don't
        // want to promote a Cyrus / parent panel.
        break;
      }
      this._appendWorkPanel(aid, true, delegationId || null);
      this.chatUiTick = Date.now();
      this.$nextTick(function () { this.scrollChatToBottom(); }.bind(this));
    },

    /**
     * Server saw a `tool_result` arrive for a previously-started delegation.
     * Mark the matching panel done so the UI stops showing "<agent> is
     * working" for it. If the delegationId doesn't match any panel (older
     * server / missed start event), fall back to the most recent open panel
     * for that agent slug.
     *
     * @param {{ id?: string, agent?: string, ok?: boolean }} evt
     */
    applySegmentAgentEndFromStream(evt) {
      if (!evt) return;
      var delegationId = evt.id != null ? String(evt.id) : '';
      var agentRaw = evt.agent != null ? String(evt.agent).trim() : '';
      var aid = agentRaw
        ? this.normalizeWorkPanelAgentId(agentRaw.toLowerCase().replace(/\s+/g, '_'))
        : '';
      var panels = this.chatWorkPanels || [];
      var target = null;
      if (delegationId) {
        for (var i = 0; i < panels.length; i++) {
          if (panels[i].delegationId === delegationId) { target = panels[i]; break; }
        }
      }
      if (!target && aid) {
        for (var j = panels.length - 1; j >= 0; j--) {
          if (!panels[j].done && panels[j].agentId === aid) { target = panels[j]; break; }
        }
      }
      if (!target) return;
      target.done = true;
      target.expanded = false;
      if (!target.endedAt) target.endedAt = Date.now();
      this.chatUiTick = Date.now();
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

    /** One live log line for connect/waiting; copy refreshes at least every 5s (see formatChatWaitingStatusLine). */
    appendChatWaitingStatusLine(startedText) {
      var panels = this.chatWorkPanels;
      if (!panels.length) this.initChatWorkPanelsForTurn();
      var p = panels[panels.length - 1];
      if (p.done) return;
      for (var j = 0; j < p.lines.length; j++) {
        if (p.lines[j].waitingSlot) return;
      }
      var sec = this.chatWorkingStartedAt ? Math.floor((Date.now() - this.chatWorkingStartedAt) / 1000) : 0;
      p.lines.push({
        id: 'wl-' + Date.now() + '-wait-' + Math.random().toString(36).slice(2, 6),
        text: formatChatWaitingStatusLine(sec, startedText),
        waitingSlot: true,
        _startedText: startedText,
      });
      if (p.lines.length > 120) p.lines.shift();
      this.scrollChatToBottom();
    },

    /** True while streaming past the long-wait threshold — bumps with chatUiTick every second. */
    chatStreamFeelsLong() {
      var _tick = this.chatUiTick;
      void _tick;
      if (!this.chatStreaming || this.chatWorkingStartedAt == null) return false;
      return (
        Math.floor((Date.now() - this.chatWorkingStartedAt) / 1000) > CHAT_LONG_WAIT_THRESHOLD_SEC
      );
    },

    refreshChatWaitingStatusLineIfStreaming() {
      if (!this.chatStreaming || this.chatWorkingStartedAt == null) return;
      var sec = Math.floor((Date.now() - this.chatWorkingStartedAt) / 1000);
      var panels = this.chatWorkPanels || [];
      if (!panels.length) return;
      var p = panels[panels.length - 1];
      if (!p || p.done || !p.lines || !p.lines.length) return;
      var line = null;
      for (var i = 0; i < p.lines.length; i++) {
        if (p.lines[i].waitingSlot) {
          line = p.lines[i];
          break;
        }
      }
      if (!line || line._startedText == null) return;
      var next = formatChatWaitingStatusLine(sec, line._startedText);
      if (line.text === next) return;
      line.text = next;
      this.chatUiTick = Date.now();
    },

    /** Drop playful “waiting” lines once assistant text, tools, or stderr appear (any panel). */
    clearAllWorkPanelWaitingSlots() {
      var panels = this.chatWorkPanels || [];
      var changed = false;
      for (var pi = 0; pi < panels.length; pi++) {
        var p = panels[pi];
        if (p.done || !p.lines || !p.lines.length) continue;
        var next = p.lines.filter(function(l) {
          return !l.waitingSlot;
        });
        if (next.length !== p.lines.length) {
          p.lines = next;
          changed = true;
        }
      }
      if (changed) {
        this.chatUiTick = Date.now();
        this.scrollChatToBottom();
      }
    },

    /**
     * Resolve the target of a `Task` / `Agent` delegation from its tool_input to a
     * real team-member slug (one of `this.chatAgents`). Returns null for generic
     * SDK preset subagents (general-purpose, explore, …) and for unrecognized
     * names — in those cases the parent agent remains the active speaker and no
     * new "<name> is working" panel is opened.
     */
    guessWorkAgentFromTaskDetail(detail) {
      var raw = String(detail || '');
      var agents = this.chatAgents || [];
      var teamSet = {};
      for (var ai = 0; ai < agents.length; ai++) {
        var slug = this.normalizeChatAgentId(agents[ai]);
        if (slug) teamSet[slug] = true;
      }
      var self = this;
      function resolveFromRaw(candidate) {
        if (candidate == null) return null;
        var s = String(candidate).trim();
        if (!s) return null;
        if (isGenericSdkSubagentId(s)) return null;
        var id = self.normalizeChatAgentId(s);
        if (id && teamSet[id]) return id;
        return null;
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
            if (isGenericSdkSubagentId(sub)) return null;
            var fromJson = resolveFromRaw(sub);
            if (fromJson) return fromJson;
          }
        }
      } catch (_) {}
      for (var i = 0; i < agents.length; i++) {
        var a = String(agents[i] || '').toLowerCase();
        if (a.length < 2) continue;
        try {
          var re = new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
          if (re.test(raw)) return this.normalizeChatAgentId(agents[i]);
        } catch (_) {}
      }
      var m =
        raw.match(/\byou are\s+([A-Za-z][A-Za-z0-9_-]*)\s*,/i) ||
        raw.match(/\byou are\s+([A-Za-z][A-Za-z0-9_-]*)\b/i);
      if (m) return resolveFromRaw(m[1]);
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
        self.scrollChatToBottom({ force: true });
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

    /**
     * Scroll the chat transcript to the newest content. By default this only
     * follows when the user was already pinned near the bottom so that
     * stream-driven appends do not yank them away from earlier messages they
     * are reading. Pass `{ force: true }` for user-initiated actions (send,
     * jump-to-latest, open conversation, expand panel) that should always
     * land on the latest content.
     *
     * The pinned state is tracked by a scroll listener on each container
     * (see `handleChatScroll`) rather than re-checked at call-time, because
     * Alpine re-renders between the caller and `$nextTick` would otherwise
     * make freshly-appended content look like an upward scroll.
     *
     * @param {{ force?: boolean }} [opts]
     */
    scrollChatToBottom(opts) {
      var force = !!(opts && opts.force);
      var self = this;
      this.$nextTick(function() {
        var d = self.$refs.chatScrollDesktop;
        var m = self.$refs.chatScrollMobile;
        var anyUnpinnedVisible = false;
        if (d) {
          if (force || self._chatPinnedDesktop) {
            d.scrollTop = d.scrollHeight;
            self._chatPinnedDesktop = true;
          } else if (d.offsetParent !== null) {
            anyUnpinnedVisible = true;
          }
        }
        if (m) {
          if (force || self._chatPinnedMobile) {
            m.scrollTop = m.scrollHeight;
            self._chatPinnedMobile = true;
          } else if (m.offsetParent !== null) {
            anyUnpinnedVisible = true;
          }
        }
        if (force) {
          self.chatShowNewRepliesButton = false;
        } else if (anyUnpinnedVisible) {
          self.chatShowNewRepliesButton = true;
        }
      });
    },

    /** True when the scroll container is within a small threshold of the bottom. */
    _isChatScrollNearBottom(el) {
      if (!el) return true;
      var gap = el.scrollHeight - el.clientHeight - el.scrollTop;
      return gap <= 80;
    },

    /**
     * Bound to the scroll containers. Updates the sticky pinned flag for the
     * emitting container and hides the "New replies below" pill once the
     * user is caught up again.
     */
    handleChatScroll(e) {
      var el = e && e.target;
      if (!el) return;
      var pinned = this._isChatScrollNearBottom(el);
      if (el === this.$refs.chatScrollDesktop) {
        this._chatPinnedDesktop = pinned;
      } else if (el === this.$refs.chatScrollMobile) {
        this._chatPinnedMobile = pinned;
      }
      if (pinned) this.chatShowNewRepliesButton = false;
    },

    /** User clicked the "New replies below" pill: jump to latest and hide it. */
    jumpChatToLatest() {
      this.chatShowNewRepliesButton = false;
      this.scrollChatToBottom({ force: true });
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
      this.chatTitleEditing = false;
      this.chatTitleDraft = '';
      this.chatConversationId = null;
      this.chatMessages = [];
      this.chatSdkUsageSessionTotals = null;
      this.chatSessionTitle = 'New chat';
      this.chatOutboundQueue = [];
      this.chatOutboundInFlight = false;
      this.chatWorkPanels = [];
      this.chatShowNewRepliesButton = false;
      this._chatPinnedDesktop = true;
      this._chatPinnedMobile = true;
      this.resetChatPlanUiForNewShell();
      this.chatWorkspaceTouches = [];
      this.closeChatUserMessageEditor();
      try { localStorage.removeItem('brain_last_chat_id'); } catch (_) {}
    },

    resetChatPlanUiForNewShell() {
      this.chatPlanTodos = [];
      this.chatPlanMarkdown = '';
      this.chatPlanAwaitingExecute = false;
      this.chatPlanInboxFile = null;
    },

    hydrateChatPlanFromSession(sess) {
      if (!sess) return;
      var pending = sess.planExecutePending === true;
      this.chatPlanAwaitingExecute = pending;
      if (!pending) {
        this.chatPlanTodos = [];
        this.chatPlanMarkdown = '';
        this.chatPlanInboxFile = null;
        return;
      }
      this.chatPlanTodos = Array.isArray(sess.planTodos)
        ? sess.planTodos.map(function (t) {
            return {
              id: t.id != null ? String(t.id) : '',
              title: t.title != null ? String(t.title) : '',
              status: t.status || 'pending',
            };
          })
        : [];
      this.chatPlanMarkdown = sess.planMarkdown ? String(sess.planMarkdown) : '';
      this.chatPlanInboxFile =
        sess.planInboxFile && sess.planInboxFile.dir && sess.planInboxFile.name
          ? { dir: String(sess.planInboxFile.dir), name: String(sess.planInboxFile.name) }
          : null;
    },

    hydrateChatWorkspaceTouches(sess) {
      var raw = sess && Array.isArray(sess.workspaceTouches) ? sess.workspaceTouches : [];
      this.chatWorkspaceTouches = raw
        .map(function (t) {
          return {
            path: t.path != null ? String(t.path) : '',
            kind: t.kind === 'edited' ? 'edited' : 'added',
            at: t.at != null ? String(t.at) : '',
          };
        })
        .filter(function (t) {
          return t.path;
        });
    },

    async createNewConversation() {
      var agent = this.normalizeChatAgentId(this.chatAgent);
      if (this.chatAgents.length && this.chatAgents.indexOf(agent) < 0) agent = this.chatAgents[0];
      this.chatAgent = agent;
      var model = this.ensureChatModelFromCatalog(this.chatModel);
      this.chatModel = model;
      var r = await fetchWithAuth('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent, model: model }),
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
      this.chatTitleEditing = false;
      this.chatTitleDraft = '';
      this.chatConversationId = d.id;
      this.chatMessages = [];
      this.chatSdkUsageSessionTotals = null;
      this.chatSessionTitle = 'New chat';
      this.resetChatPlanUiForNewShell();
      this.chatWorkspaceTouches = [];
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
          this.chatTitleEditing = false;
          this.chatTitleDraft = '';
          this.chatConversationId = sess.id;
          this.chatAgent = this.normalizeChatAgentId(sess.agent);
          if (sess.model) this.chatModel = this.ensureChatModelFromCatalog(sess.model);
          this.chatMessages = sess.messages || [];
          this.chatSdkUsageSessionTotals = sess.sdkUsageSessionTotals || null;
          this.chatSessionTitle = sess.title || 'Chat';
          this.hydrateChatPlanFromSession(sess);
          this.hydrateChatWorkspaceTouches(sess);
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
      this.closeChatAgentProfile();
      this.chatHistoryOpen = true;
      this.loadConversationList();
      var self = this;
      this.$nextTick(function() { self.refreshIcons(); });
    },

    async openConversation(id) {
      var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(id));
      if (!r.ok) return;
      var sess = await r.json();
      this.chatTitleEditing = false;
      this.chatTitleDraft = '';
      this.chatConversationId = sess.id;
      this.chatAgent = this.normalizeChatAgentId(sess.agent);
      if (sess.model) this.chatModel = this.ensureChatModelFromCatalog(sess.model);
      this.chatMessages = sess.messages || [];
      this.chatSdkUsageSessionTotals = sess.sdkUsageSessionTotals || null;
      this.chatSessionTitle = sess.title || 'Chat';
      this.hydrateChatPlanFromSession(sess);
      this.hydrateChatWorkspaceTouches(sess);
      try { localStorage.setItem('brain_last_chat_id', id); } catch (_) {}
      this.chatHistoryOpen = false;
      this.chatOutboundQueue = [];
      this.chatOutboundInFlight = false;
      this.chatWorkPanels = [];
      this.chatShowNewRepliesButton = false;
      this._chatPinnedDesktop = true;
      this._chatPinnedMobile = true;
      await this.loadConversationList();
      this.$nextTick(function() { this.scrollChatToBottom({ force: true }); this.refreshIcons(); }.bind(this));
    },

    async refreshActiveConversation() {
      if (!this.chatConversationId) return;
      var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(this.chatConversationId));
      if (!r.ok) return;
      var sess = await r.json();
      this.chatMessages = sess.messages || [];
      this.chatSdkUsageSessionTotals = sess.sdkUsageSessionTotals || null;
      this.chatSessionTitle = sess.title || 'Chat';
      if (sess.model) this.chatModel = this.ensureChatModelFromCatalog(sess.model);
      this.hydrateChatPlanFromSession(sess);
      this.hydrateChatWorkspaceTouches(sess);
    },

    startChatTitleEdit() {
      if (!this.chatConversationId) return;
      this.chatTitleDraft = this.chatSessionTitle || 'Chat';
      this.chatTitleEditing = true;
      var self = this;
      this.$nextTick(function() {
        var wide = false;
        try {
          wide = window.matchMedia && window.matchMedia('(min-width: 1024px)').matches;
        } catch (_) {}
        var el = wide ? self.$refs.chatTitleInputDesktop : self.$refs.chatTitleInputMobile;
        try {
          if (el && el.focus) el.focus();
          if (el && el.select) el.select();
        } catch (_) {}
      });
    },

    cancelChatTitleEdit() {
      this.chatTitleEditing = false;
      this.chatTitleDraft = '';
    },

    async commitChatTitleEdit() {
      if (!this.chatTitleEditing) return;
      var id = this.chatConversationId;
      if (!id) {
        this.cancelChatTitleEdit();
        return;
      }
      var trimmed = String(this.chatTitleDraft || '').trim();
      if (!trimmed) trimmed = this.chatSessionTitle || 'Chat';
      if (trimmed === (this.chatSessionTitle || 'Chat')) {
        this.chatTitleEditing = false;
        this.chatTitleDraft = '';
        return;
      }
      try {
        var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: trimmed }),
        });
        if (!r.ok) {
          var errMsg = 'Could not rename conversation';
          try {
            var ej = await r.json();
            if (ej && ej.error) errMsg = ej.error;
          } catch (_) {}
          alert(errMsg);
          return;
        }
        var d = await r.json();
        if (d && d.title != null) this.chatSessionTitle = String(d.title);
        else this.chatSessionTitle = trimmed;
        this.chatTitleEditing = false;
        this.chatTitleDraft = '';
        await this.loadConversationList();
      } catch (e) {
        alert('Could not rename: ' + (e.message || String(e)));
      }
    },

    chatForkUiDisabled() {
      return !this.chatConversationId || this.chatStreaming || this.chatOutboundInFlight;
    },

    chatUserMessageEditDisabled(m) {
      if (!m || m.role !== 'user') return true;
      if (!this.chatConversationId || this.chatStreaming || this.chatOutboundInFlight) return true;
      if (this.chatOutboundQueue && this.chatOutboundQueue.length) return true;
      var id = String(m.id || '');
      if (id.indexOf('local-') === 0 || id.indexOf('err-') === 0) return true;
      return false;
    },

    openChatUserMessageEditor(m) {
      if (this.chatUserMessageEditDisabled(m)) return;
      this.closeChatAgentProfile();
      this.chatModelPickerOpen = false;
      this.chatUserMessageEditTargetId = m.id;
      this.chatUserMessageEditDraft = String(m.content || '');
      this.chatUserMessageEditOpen = true;
      var self = this;
      this.$nextTick(function() {
        self.refreshIcons();
        try {
          var el = self.$refs.chatUserMessageEditTextarea;
          if (el && el.focus) el.focus();
        } catch (_) {}
      });
    },

    closeChatUserMessageEditor() {
      this.chatUserMessageEditOpen = false;
      this.chatUserMessageEditTargetId = null;
      this.chatUserMessageEditDraft = '';
      var self = this;
      this.$nextTick(function() {
        self.refreshIcons();
      });
    },

    /**
     * After editing a user message: truncate or fork, then send the edited text as a new turn.
     * @param {'overwrite' | 'fork'} mode
     */
    async applyChatUserMessageEdit(mode) {
      if (this.chatUserMessageEditApplying) return;
      var tid = this.chatUserMessageEditTargetId;
      var draft = String(this.chatUserMessageEditDraft || '').trim();
      if (!tid) return;
      if (!draft) {
        alert('Message cannot be empty.');
        return;
      }
      var planPhase = this.chatPlanAwaitingExecute ? 'execute' : this.chatPlanMode ? 'plan' : null;
      var opts = { planPhase: planPhase };
      this.chatUserMessageEditApplying = true;
      try {
        if (mode === 'overwrite') {
          var r = await fetchWithAuth(
            '/api/chat/conversations/' + encodeURIComponent(this.chatConversationId) + '/truncate-at-user',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ messageId: tid }),
            }
          );
          if (!r.ok) {
            var errMsg = 'Could not update conversation';
            try {
              var ej = await r.json();
              if (ej && ej.error) errMsg = ej.error;
            } catch (_) {}
            alert(errMsg);
            return;
          }
          await this.refreshActiveConversation();
          this.closeChatUserMessageEditor();
          this.chatOutboundInFlight = true;
          await this.runChatTurn(draft, [], opts);
        } else if (mode === 'fork') {
          var rf = await fetchWithAuth(
            '/api/chat/conversations/' + encodeURIComponent(this.chatConversationId) + '/fork',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ editUserMessageId: tid }),
            }
          );
          if (!rf.ok) {
            var errFork = 'Could not start new conversation';
            try {
              var ejf = await rf.json();
              if (ejf && ejf.error) errFork = ejf.error;
            } catch (_) {}
            alert(errFork);
            return;
          }
          var d = await rf.json();
          if (!d || !d.id) {
            alert('Could not start new conversation');
            return;
          }
          await this.openConversation(d.id);
          this.closeChatUserMessageEditor();
          this.chatOutboundInFlight = true;
          await this.runChatTurn(draft, [], opts);
        }
      } catch (e) {
        alert('Could not resend: ' + (e.message || String(e)));
      } finally {
        this.chatUserMessageEditApplying = false;
      }
    },

    /**
     * Copy assistant reply text (markdown source) to the clipboard.
     */
    async copyChatAssistantMessage(m) {
      if (!m || m.role !== 'assistant') return;
      var text = String(m.content || '').replace(/\r\n/g, '\n');
      if (!text.trim()) return;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
        } else {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        this.chatCopiedAssistantMessageId = m.id;
        clearTimeout(this._chatCopyFlashTimer);
        var self = this;
        this._chatCopyFlashTimer = setTimeout(function() {
          self.chatCopiedAssistantMessageId = null;
        }, 2000);
        this.$nextTick(function() {
          this.refreshIcons();
        }.bind(this));
      } catch (e) {
        console.warn('[chat] copy', e.message || e);
        alert('Could not copy to clipboard');
      }
    },

    /**
     * Copy this conversation through the given assistant reply into a new saved session and open it.
     */
    async forkChatFromAssistantMessage(m) {
      if (!m || m.role !== 'assistant' || this.chatForkUiDisabled()) return;
      if (
        !confirm(
          'Start a new chat from this reply?\n\n' +
            'Everything in this conversation up through this reply will be copied to a new conversation. The current chat stays unchanged.'
        )
      ) {
        return;
      }
      try {
        var r = await fetchWithAuth(
          '/api/chat/conversations/' + encodeURIComponent(this.chatConversationId) + '/fork',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId: m.id }),
          }
        );
        if (!r.ok) {
          var errMsg = 'Could not fork conversation';
          try {
            var ej = await r.json();
            if (ej && ej.error) errMsg = ej.error;
          } catch (_) {}
          alert(errMsg);
          return;
        }
        var d = await r.json();
        if (!d || !d.id) {
          alert('Could not fork conversation');
          return;
        }
        await this.openConversation(d.id);
        this.$nextTick(function() {
          this.focusChatPrompt();
          this.refreshIcons();
        }.bind(this));
      } catch (e) {
        alert('Could not fork conversation: ' + (e.message || String(e)));
      }
    },

    async newChatConversation() {
      this.closeChatAgentProfile();
      this.chatModelPickerOpen = false;
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

    slugToTemplate(slug) {
      var nav = this.dashboardNavPages || [];
      for (var i = 0; i < nav.length; i++) {
        if (nav[i].slug === slug) return nav[i].template || '';
      }
      return '';
    },
    getPageTemplate() {
      if (this.page === 'home' || this.page === 'files' || this.page === 'usage') return '';
      return this.slugToTemplate(this.page);
    },
    currentNavPage() {
      var nav = this.dashboardNavPages || [];
      for (var i = 0; i < nav.length; i++) {
        if (nav[i].slug === this.page) return nav[i];
      }
      return null;
    },
    currentNavLabel() {
      var p = this.currentNavPage();
      return p && p.label ? p.label : '';
    },
    currentNavDescription() {
      var p = this.currentNavPage();
      return p && p.description != null ? String(p.description) : '';
    },
    /** Sections page: `half` = one column on md+ (pair two halves for a 2-column row). */
    sectionsPanelGridClass(panel) {
      var base = 'scroll-mt-4 min-w-0 col-span-1';
      if (panel && panel.layout === 'half') return base + ' md:col-span-1';
      return base + ' md:col-span-2';
    },
    /** Home “Domains” section: built-in domain pages and/or `action_domain` manifest tabs. */
    homeShowDomainsBlock() {
      var p = this.dashboardPages || {};
      if (p.career || p.finance || p.business) return true;
      return (this.dashboardNavPages || []).some(function(x) {
        return x.template === 'action_domain';
      });
    },
    ensureActionDomainPageState(slug) {
      var s = String(slug || '');
      if (!s) return;
      if (!this.actionState[s]) {
        this.actionState = Object.assign({}, this.actionState, {
          [s]: { sort: 'date-urgency', group: 'none', range: 'all' },
        });
      }
      if (!Object.prototype.hasOwnProperty.call(this.actionData, s)) {
        this.actionData = Object.assign({}, this.actionData, { [s]: [] });
      }
      if (this.loadError[s] === undefined) {
        this.loadError = Object.assign({}, this.loadError, { [s]: null });
      }
      if (this.pageReady[s] === undefined) {
        this.pageReady = Object.assign({}, this.pageReady, { [s]: false });
      }
    },
    /** State for `template: "todos"` blocks inside a `sections` page (key = pageSlug:sectionId). */
    ensureTodosSectionState(todosKey) {
      var s = String(todosKey || '');
      if (!s) return;
      if (!this.actionState[s]) {
        this.actionState = Object.assign({}, this.actionState, {
          [s]: { sort: 'date-urgency', group: 'none', range: 'all' },
        });
      }
      if (!Object.prototype.hasOwnProperty.call(this.actionData, s)) {
        this.actionData = Object.assign({}, this.actionData, { [s]: [] });
      }
      if (this.loadError[s] === undefined) {
        this.loadError = Object.assign({}, this.loadError, { [s]: null });
      }
    },
    slugLinkForTemplate(tmpl) {
      var nav = this.dashboardNavPages || [];
      var t = String(tmpl || '');
      for (var i = 0; i < nav.length; i++) {
        if (nav[i].slug === t) return '#/' + nav[i].slug;
      }
      for (var j = 0; j < nav.length; j++) {
        if (nav[j].template === t) return '#/' + nav[j].slug;
      }
      return '#/';
    },
    navSlugSet() {
      var o = Object.create(null);
      (this.dashboardNavPages || []).forEach(function(p) { o[p.slug] = true; });
      return o;
    },

    navLinkClass(p) {
      var on = this.page === p;
      return on
        ? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'
        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700';
    },
    go(p) {
      if (p !== 'home' && p !== 'files' && p !== 'usage') {
        var nav = this.dashboardNavPages || [];
        var bySlug = nav.some(function(x) { return x.slug === p; });
        if (!bySlug && ['career', 'finance', 'business'].indexOf(p) >= 0) {
          var hit = nav.find(function(x) { return x.slug === p || x.template === p; });
          p = hit ? hit.slug : 'home';
        } else if (!bySlug) {
          p = 'home';
        }
      }
      if (p !== 'files') {
        this.viewerOpen = false;
        this.viewerPath = null;
        this.viewerContent = '';
        this.viewerDisplayMode = 'text';
        this.viewerLoadError = '';
        this.editorOpen = false;
        this.editorPath = null;
      }
      var closeMobileChat = this.isMobileFullWindowChat();
      this.page = p;
      if (this.slugToTemplate(p) === 'action_domain') this.ensureActionDomainPageState(p);
      location.hash = p === 'home' ? '#/' : '#/' + p;
      if (closeMobileChat) this.closeChat();
    },
    onHashChange() {
      var raw = (location.hash || '#/').replace(/^#\/?/, '');
      if (raw === 'chat') {
        this.openChat();
        var slugSet = this.navSlugSet();
        var okChat = this.page === 'home' || this.page === 'files' || this.page === 'usage' || slugSet[this.page];
        if (!okChat) this.page = 'home';
        this.loadPage(this.page, false);
        return;
      }
      var fileMatch = raw.match(/^files\/([^/]+)\/(.+)$/);
      if (fileMatch) {
        if (this.isMobileFullWindowChat()) this.closeChat();
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
      var nextPage = 'home';
      if (raw === '' || raw === 'home') {
        nextPage = 'home';
      } else if (raw === 'files') {
        nextPage = 'files';
      } else if (raw === 'usage') {
        nextPage = 'usage';
      } else {
        var slugSet = this.navSlugSet();
        if (slugSet[raw]) {
          nextPage = raw;
        } else if (['career', 'finance', 'business'].indexOf(raw) >= 0) {
          var nav = this.dashboardNavPages || [];
          var legacy = nav.find(function(x) { return x.slug === raw || x.template === raw; });
          if (legacy) {
            nextPage = legacy.slug;
            history.replaceState(null, '', '#/' + legacy.slug);
          } else {
            nextPage = 'home';
            history.replaceState(null, '', '#/');
          }
        } else {
          nextPage = 'home';
          history.replaceState(null, '', '#/');
        }
      }
      if (nextPage !== 'files') {
        this.viewerOpen = false;
        this.viewerPath = null;
        this.editorOpen = false;
        this.editorPath = null;
      }
      this.page = nextPage;
      if (this.slugToTemplate(this.page) === 'action_domain') this.ensureActionDomainPageState(this.page);
      if (this.isMobileFullWindowChat()) this.closeChat();
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
      var s = this.actionState[pageKey] || { sort: 'date-urgency', group: 'none', range: 'all' };
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
    actionItemDomainOptions() {
      var d = this.actionItemDraft || {};
      var cur = String(d.domain || '');
      var o = [];
      if (this.dashboardPages.career || cur === 'career') o.push({ value: 'career', label: 'career' });
      if (this.dashboardPages.finance || cur === 'finance') o.push({ value: 'finance', label: 'finance' });
      if (this.dashboardPages.business || cur === 'business') o.push({ value: 'business', label: 'business' });
      o.push({ value: 'personal', label: 'personal' });
      o.push({ value: 'family', label: 'family' });
      return o;
    },

    openActionItemEditor(item, pageKey) {
      var self = this;
      if (!item || item.id == null) return;
      if (pageKey != null && pageKey !== '') {
        this.actionItemPageKey = pageKey;
      } else {
        this.actionItemPageKey = this.page === 'home' ? 'home' : this.page;
      }
      this.actionItemShowDomain = this.actionItemPageKey === 'home';
      this.actionItemShowCareerFields =
        this.page === 'career' || this.getPageTemplate() === 'career';
      this.actionItemShowProjectCategory = true;
      this.actionItemDraft = {
        id: item.id,
        title: item.title || '',
        description: item.description != null ? String(item.description) : '',
        details: item.details != null ? String(item.details) : '',
        due_date: item.due_date || '',
        urgency: item.urgency || 'medium',
        domain: item.domain || 'personal',
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
    datatableFormatCell(columnName, raw) {
      return formatDatatableCell(columnName, raw);
    },
    datatableColumnLabel(tb, col) {
      return (tb && tb.columnLabels && tb.columnLabels[col]) || col;
    },
    datatableSpecFor(tb, col) {
      return tb && tb.specByKey ? tb.specByKey[col] : null;
    },
    datatableCellBundle(tb, col, row) {
      var spec = this.datatableSpecFor(tb, col);
      return formatDatatableCellBundle(col, row[col], row, spec);
    },
    datatableCellUsesHtml(tb, col, row) {
      return this.datatableCellBundle(tb, col, row).useHtml;
    },
    datatableCellText(tb, col, row) {
      return this.datatableCellBundle(tb, col, row).text;
    },
    datatableCellHtml(tb, col, row) {
      return this.datatableCellBundle(tb, col, row).html;
    },
    datatableFilteredRows(tb) {
      if (!tb || !tb.rows) return [];
      var cols = tb.columns || [];
      var q = (tb.filter || '').trim().toLowerCase();
      if (!q) return tb.rows.slice();
      return tb.rows.filter(function(row) {
        for (var i = 0; i < cols.length; i++) {
          var ck = cols[i];
          var v = row[ck];
          if (v != null && String(v).toLowerCase().indexOf(q) >= 0) return true;
          var sp = tb.specByKey && tb.specByKey[ck];
          if (sp && sp.secondaryKey) {
            var v2 = row[sp.secondaryKey];
            if (v2 != null && String(v2).toLowerCase().indexOf(q) >= 0) return true;
          }
        }
        return false;
      });
    },
    datatableCmp(va, vb) {
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'boolean' || typeof vb === 'boolean') {
        return String(va).localeCompare(String(vb));
      }
      var na = Number(va);
      var nb = Number(vb);
      if (
        !Number.isNaN(na) &&
        !Number.isNaN(nb) &&
        String(va).trim() !== '' &&
        String(vb).trim() !== '' &&
        String(va).trim() === String(na) &&
        String(vb).trim() === String(nb)
      ) {
        return na - nb;
      }
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    },
    datatableSortedRows(tb) {
      var rows = this.datatableFilteredRows(tb);
      var sk = tb.sortKey;
      if (!sk) return rows;
      var dir = tb.sortDir === 'desc' ? -1 : 1;
      var self = this;
      return rows.slice().sort(function(a, b) {
        return self.datatableCmp(a[sk], b[sk]) * dir;
      });
    },
    datatablePageSlice(tb) {
      var rows = this.datatableSortedRows(tb);
      var ps = tb.pageSize || 50;
      var totalP = Math.max(1, Math.ceil(rows.length / ps) || 1);
      if ((tb.page || 1) > totalP) tb.page = totalP;
      if ((tb.page || 1) < 1) tb.page = 1;
      var p = tb.page || 1;
      var start = (p - 1) * ps;
      return rows.slice(start, start + ps);
    },
    datatableFilteredCount(tb) {
      return this.datatableFilteredRows(tb).length;
    },
    datatableTotalPages(tb) {
      var n = this.datatableFilteredRows(tb).length;
      var ps = tb.pageSize || 50;
      return Math.max(1, Math.ceil(n / ps) || 1);
    },
    datatableToggleSort(tb, col) {
      if (!tb) return;
      if (tb.sortKey === col) tb.sortDir = tb.sortDir === 'asc' ? 'desc' : 'asc';
      else {
        tb.sortKey = col;
        tb.sortDir = 'asc';
      }
      tb.page = 1;
    },

    completeActionItem(item, pageKey) {
      var self = this;
      if (!item || item.id == null) return;
      var pk;
      if (pageKey != null && pageKey !== '') {
        if (typeof pageKey === 'string' && pageKey.indexOf(':') >= 0) {
          pk = self.page === 'home' ? 'home' : self.page;
        } else {
          pk = pageKey;
        }
      } else {
        pk = this.page === 'home' ? 'home' : this.page;
      }
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
      if (name === 'files') {
        this.datatableHtml = '';
        this.datatableInteractive = null;
        this.datatableLoadError = '';
        this.datatableReady = false;
        this.datatableTruncated = false;
        this.sectionsPagePanels = [];
        this.sectionsPageReady = false;
        await this.loadFiles();
        return;
      }
      if (name === 'usage') {
        this.datatableHtml = '';
        this.datatableInteractive = null;
        this.datatableLoadError = '';
        this.datatableReady = false;
        this.datatableTruncated = false;
        this.sectionsPagePanels = [];
        this.sectionsPageReady = false;
        if (!force && this.cache.usage && now - this.cache.usage.ts < STALE_MS) {
          this.chatUsageSummary = this.cache.usage.data;
          this.pageReady.usage = true;
          return;
        }
        this.refreshing = true;
        this.loadError.usage = null;
        this.pageReady.usage = false;
        try {
          var resUsage = await fetchWithAuth('/api/chat/usage-summary');
          if (!resUsage.ok) throw new Error('HTTP ' + resUsage.status);
          var usageData = await resUsage.json();
          this.chatUsageSummary = usageData;
          this.cache.usage = { ts: Date.now(), data: usageData };
          this.pageReady.usage = true;
        } catch (eU) {
          this.loadError.usage = 'Could not load usage. ' + (eU.message || String(eU));
          this.chatUsageSummary = null;
          this.pageReady.usage = true;
        } finally {
          this.refreshing = false;
        }
        return;
      }
      if (name === 'home') {
        this.datatableHtml = '';
        this.datatableInteractive = null;
        this.datatableLoadError = '';
        this.datatableReady = false;
        this.datatableTruncated = false;
        this.sectionsPagePanels = [];
        this.sectionsPageReady = false;
        if (!force && this.cache.home && (now - this.cache.home.ts < STALE_MS)) return;
        this.refreshing = true;
        this.loadError.home = null;
        try {
          var resH = await fetchWithAuth('/api/dashboard');
          if (!resH.ok) throw new Error('HTTP ' + resH.status);
          var dataH = await resH.json();
          this.cache.home = { ts: Date.now(), data: dataH };
          this.renderHome(dataH);
          this.pageReady.home = true;
          this.lastRefresh = 'Updated ' + new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
          try {
            var resUsageH = await fetchWithAuth('/api/chat/usage-summary');
            if (resUsageH.ok) this.chatUsageSummaryForHome = await resUsageH.json();
            else this.chatUsageSummaryForHome = null;
          } catch (_) {
            this.chatUsageSummaryForHome = null;
          }
        } catch (e) {
          this.loadError.home = 'Failed to load data. Is server.js running? (' + e.message + ')';
          this.pageReady.home = true;
          this.chatUsageSummaryForHome = null;
        } finally {
          this.refreshing = false;
        }
        return;
      }
      var slug = name;
      var template = this.slugToTemplate(slug);
      if (!template && ['career', 'finance', 'business'].indexOf(slug) >= 0) {
        var hit = (this.dashboardNavPages || []).find(function(p) {
          return p.slug === slug || p.template === slug;
        });
        if (hit) {
          slug = hit.slug;
          template = hit.template;
        }
      }
      if (!template) {
        this.refreshing = true;
        this.loadError[slug] = 'This page is not available.';
        this.pageReady[slug] = true;
        this.refreshing = false;
        return;
      }
      if (template === 'sections') {
        this.datatableHtml = '';
        this.datatableInteractive = null;
        this.datatableLoadError = '';
        this.datatableReady = false;
        this.datatableTruncated = false;
        this.pageReady[slug] = false;
        var navPage = this.currentNavPage();
        var secList = navPage && navPage.sections ? navPage.sections : [];
        this.sectionsPagePanels = [];
        this.sectionsPageReady = false;
        if (!secList.length) {
          this.sectionsPagePanels = [
            {
              id: '_empty',
              label: '',
              layout: 'full',
              html: '',
              error: 'No sections configured for this page.',
              loading: false,
              skipped: false,
              truncated: false,
            },
          ];
          this.sectionsPageReady = true;
          this.pageReady[slug] = true;
          return;
        }
        var allCached = !force;
        if (!force) {
          for (var ci = 0; ci < secList.length; ci++) {
            var sc0 = secList[ci];
            if (!sc0.enabled) continue;
            if (sc0.template === 'datatable') {
              var ckeyDs = 'ds:' + slug + ':' + sc0.id;
              if (!this.cache[ckeyDs] || now - this.cache[ckeyDs].ts >= STALE_MS) {
                allCached = false;
                break;
              }
            } else if (sc0.template === 'todos') {
              var ckeyTodo0 = 'dTodo:' + slug + ':' + sc0.id;
              if (!this.cache[ckeyTodo0] || now - this.cache[ckeyTodo0].ts >= STALE_MS) {
                allCached = false;
                break;
              }
            } else if (
              sc0.template === 'funnel_bars' ||
              sc0.template === 'progress_card' ||
              sc0.template === 'stat_cards' ||
              sc0.template === 'grouped_accordion' ||
              sc0.template === 'metric_datatable' ||
              sc0.template === 'account_cards' ||
              sc0.template === 'link_groups'
            ) {
              var ckeyRv0 = 'dView:' + slug + ':' + sc0.id;
              if (!this.cache[ckeyRv0] || now - this.cache[ckeyRv0].ts >= STALE_MS) {
                allCached = false;
                break;
              }
            }
          }
        } else {
          allCached = false;
        }
        if (allCached) {
          var cachedBuilt = [];
          for (var cj = 0; cj < secList.length; cj++) {
            var sc1 = secList[cj];
            if (!sc1.enabled) {
              cachedBuilt.push({
                id: sc1.id,
                label: sc1.label,
                layout: sc1.layout === 'half' ? 'half' : 'full',
                html: '',
                error: '',
                loading: false,
                skipped: true,
                skipReason: 'Waiting for required database file under your account.',
                truncated: false,
              });
            } else if (sc1.template === 'todos') {
              var ckeyT = 'dTodo:' + slug + ':' + sc1.id;
              var tk = slug + ':' + sc1.id;
              this.ensureTodosSectionState(tk);
              var dataTodo = this.cache[ckeyT].data;
              this.actionData[tk] = (dataTodo && dataTodo.actionItems) || [];
              this.loadError[tk] = null;
              cachedBuilt.push({
                id: sc1.id,
                label: sc1.label,
                layout: sc1.layout === 'half' ? 'half' : 'full',
                template: 'todos',
                todosKey: tk,
                actionDomain: sc1.domain || (dataTodo && dataTodo.actionDomain) || '',
                todosReady: true,
                html: '',
                error: '',
                loading: false,
                skipped: false,
                truncated: false,
              });
            } else if (
              sc1.template === 'funnel_bars' ||
              sc1.template === 'progress_card' ||
              sc1.template === 'stat_cards' ||
              sc1.template === 'grouped_accordion' ||
              sc1.template === 'metric_datatable' ||
              sc1.template === 'account_cards' ||
              sc1.template === 'link_groups'
            ) {
              var ckeyRv = 'dView:' + slug + ':' + sc1.id;
              var dataRv = this.cache[ckeyRv].data;
              cachedBuilt.push({
                id: sc1.id,
                label: sc1.label,
                layout: sc1.layout === 'half' ? 'half' : 'full',
                template: sc1.template,
                html: richSectionHtmlFromPayload(dataRv),
                error: '',
                loading: false,
                skipped: false,
                truncated: false,
              });
            } else if (sc1.template === 'datatable') {
              var ckey1 = 'ds:' + slug + ':' + sc1.id;
              var dataC = this.cache[ckey1].data;
              cachedBuilt.push({
                id: sc1.id,
                label: sc1.label,
                layout: sc1.layout === 'half' ? 'half' : 'full',
                template: 'datatable',
                table: createDatatableInteractiveState(dataC),
                html: '',
                error: '',
                loading: false,
                skipped: false,
                truncated: !!(dataC && dataC.truncated),
              });
            } else {
              cachedBuilt.push({
                id: sc1.id,
                label: sc1.label,
                layout: sc1.layout === 'half' ? 'half' : 'full',
                html: '',
                error: 'This section type is not supported in the browser yet.',
                loading: false,
                skipped: false,
                truncated: false,
              });
            }
          }
          this.sectionsPagePanels = cachedBuilt;
          this.sectionsPageReady = true;
          this.pageReady[slug] = true;
          return;
        }
        this.refreshing = true;
        try {
          var built = [];
          for (var si = 0; si < secList.length; si++) {
            var sec = secList[si];
            if (!sec.enabled) {
              built.push({
                id: sec.id,
                label: sec.label,
                layout: sec.layout === 'half' ? 'half' : 'full',
                html: '',
                error: '',
                loading: false,
                skipped: true,
                skipReason: 'Waiting for required database file under your account.',
                truncated: false,
              });
              continue;
            }
            if (sec.template === 'todos') {
              var tk2 = slug + ':' + sec.id;
              var ckTodo = 'dTodo:' + slug + ':' + sec.id;
              this.ensureTodosSectionState(tk2);
              this.loadError[tk2] = null;
              try {
                var resTodo = await fetchWithAuth(
                  '/api/dashboard-section-todos/' + encodeURIComponent(slug) + '/' + encodeURIComponent(sec.id),
                );
                if (!resTodo.ok) {
                  var errTodo = {};
                  try {
                    errTodo = await resTodo.json();
                  } catch (_) {}
                  throw new Error((errTodo && errTodo.error) || 'HTTP ' + resTodo.status);
                }
                var dataTodo2 = await resTodo.json();
                this.cache[ckTodo] = { ts: Date.now(), data: dataTodo2 };
                this.actionData[tk2] = dataTodo2.actionItems || [];
                built.push({
                  id: sec.id,
                  label: sec.label,
                  layout: sec.layout === 'half' ? 'half' : 'full',
                  template: 'todos',
                  todosKey: tk2,
                  actionDomain: sec.domain || dataTodo2.actionDomain || '',
                  todosReady: true,
                  html: '',
                  error: '',
                  loading: false,
                  skipped: false,
                  truncated: false,
                });
              } catch (errTodo2) {
                this.loadError[tk2] = errTodo2.message || String(errTodo2);
                this.actionData[tk2] = [];
                built.push({
                  id: sec.id,
                  label: sec.label,
                  layout: sec.layout === 'half' ? 'half' : 'full',
                  template: 'todos',
                  todosKey: tk2,
                  actionDomain: sec.domain || '',
                  todosReady: true,
                  html: '',
                  error: '',
                  loading: false,
                  skipped: false,
                  truncated: false,
                });
              }
              continue;
            }
            if (
              sec.template === 'funnel_bars' ||
              sec.template === 'progress_card' ||
              sec.template === 'stat_cards' ||
              sec.template === 'grouped_accordion' ||
              sec.template === 'metric_datatable' ||
              sec.template === 'account_cards' ||
              sec.template === 'link_groups'
            ) {
              var ckView = 'dView:' + slug + ':' + sec.id;
              try {
                var resV = await fetchWithAuth(
                  '/api/dashboard-section-view/' + encodeURIComponent(slug) + '/' + encodeURIComponent(sec.id),
                );
                if (!resV.ok) {
                  var errV = {};
                  try {
                    errV = await resV.json();
                  } catch (_) {}
                  throw new Error((errV && errV.error) || 'HTTP ' + resV.status);
                }
                var dataV2 = await resV.json();
                this.cache[ckView] = { ts: Date.now(), data: dataV2 };
                built.push({
                  id: sec.id,
                  label: sec.label,
                  layout: sec.layout === 'half' ? 'half' : 'full',
                  template: sec.template,
                  html: richSectionHtmlFromPayload(dataV2),
                  error: '',
                  loading: false,
                  skipped: false,
                  truncated: false,
                });
              } catch (errV2) {
                built.push({
                  id: sec.id,
                  label: sec.label,
                  layout: sec.layout === 'half' ? 'half' : 'full',
                  template: sec.template,
                  html: '',
                  error: errV2.message || String(errV2),
                  loading: false,
                  skipped: false,
                  truncated: false,
                });
              }
              continue;
            }
            if (sec.template !== 'datatable') {
              built.push({
                id: sec.id,
                label: sec.label,
                layout: sec.layout === 'half' ? 'half' : 'full',
                html: '',
                error: 'This section type is not supported in the browser yet.',
                loading: false,
                skipped: false,
                truncated: false,
              });
              continue;
            }
            var ck = 'ds:' + slug + ':' + sec.id;
            try {
              var resS = await fetchWithAuth(
                '/api/dashboard-section/' + encodeURIComponent(slug) + '/' + encodeURIComponent(sec.id),
              );
              if (!resS.ok) {
                var errBodyS = {};
                try {
                  errBodyS = await resS.json();
                } catch (_) {}
                throw new Error((errBodyS && errBodyS.error) || 'HTTP ' + resS.status);
              }
              var dataS = await resS.json();
              this.cache[ck] = { ts: Date.now(), data: dataS };
              built.push({
                id: sec.id,
                label: sec.label,
                layout: sec.layout === 'half' ? 'half' : 'full',
                template: 'datatable',
                table: createDatatableInteractiveState(dataS),
                html: '',
                error: '',
                loading: false,
                skipped: false,
                truncated: !!dataS.truncated,
              });
            } catch (errS) {
              built.push({
                id: sec.id,
                label: sec.label,
                layout: sec.layout === 'half' ? 'half' : 'full',
                template: 'datatable',
                html: '',
                error: errS.message || String(errS),
                loading: false,
                skipped: false,
                truncated: false,
              });
            }
          }
          this.sectionsPagePanels = built;
          this.sectionsPageReady = true;
          this.pageReady[slug] = true;
          this.lastRefresh = 'Updated ' + new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
        } finally {
          this.refreshing = false;
        }
        return;
      }
      if (template === 'datatable') {
        this.sectionsPagePanels = [];
        this.sectionsPageReady = false;
        this.datatableHtml = '';
        this.datatableInteractive = null;
        this.datatableLoadError = '';
        this.datatableReady = false;
        this.datatableTruncated = false;
        this.pageReady[slug] = false;
        var dtKey = 'dt:' + slug;
        if (!force && this.cache[dtKey] && (now - this.cache[dtKey].ts < STALE_MS)) {
          this.renderDatatable(this.cache[dtKey].data);
          this.datatableReady = true;
          this.pageReady[slug] = true;
          return;
        }
        this.refreshing = true;
        try {
          var resDt = await fetchWithAuth('/api/dashboard-page/' + encodeURIComponent(slug));
          if (!resDt.ok) {
            var errBody = {};
            try {
              errBody = await resDt.json();
            } catch (_) {}
            throw new Error((errBody && errBody.error) || 'HTTP ' + resDt.status);
          }
          var dataDt = await resDt.json();
          this.cache[dtKey] = { ts: Date.now(), data: dataDt };
          this.renderDatatable(dataDt);
          this.datatableReady = true;
          this.pageReady[slug] = true;
          this.lastRefresh = 'Updated ' + new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
          this.datatableInteractive = null;
          this.datatableLoadError = 'Failed to load table. (' + (e.message || String(e)) + ')';
          this.datatableReady = true;
          this.pageReady[slug] = true;
        } finally {
          this.refreshing = false;
        }
        return;
      }
      if (template === 'action_domain') {
        this.ensureActionDomainPageState(slug);
        this.datatableHtml = '';
        this.datatableInteractive = null;
        this.datatableLoadError = '';
        this.datatableReady = false;
        this.datatableTruncated = false;
        this.sectionsPagePanels = [];
        this.sectionsPageReady = false;
        var adKey = 'ad:' + slug;
        if (!force && this.cache[adKey] && now - this.cache[adKey].ts < STALE_MS) {
          this.actionData[slug] = this.cache[adKey].data.actionItems || [];
          this.pageReady[slug] = true;
          return;
        }
        this.refreshing = true;
        this.loadError[slug] = null;
        this.pageReady[slug] = false;
        try {
          var resAd = await fetchWithAuth('/api/action-domain/' + encodeURIComponent(slug));
          if (!resAd.ok) {
            var errAd = {};
            try {
              errAd = await resAd.json();
            } catch (_) {}
            throw new Error((errAd && errAd.error) || 'HTTP ' + resAd.status);
          }
          var dataAd = await resAd.json();
          this.cache[adKey] = { ts: Date.now(), data: dataAd };
          this.actionData[slug] = dataAd.actionItems || [];
          this.pageReady[slug] = true;
          this.lastRefresh = 'Updated ' + new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
        } catch (eAd) {
          this.loadError[slug] = 'Failed to load data. (' + (eAd.message || String(eAd)) + ')';
          this.pageReady[slug] = true;
        } finally {
          this.refreshing = false;
        }
        return;
      }
      this.datatableHtml = '';
      this.datatableInteractive = null;
      this.datatableLoadError = '';
      this.datatableReady = false;
      this.datatableTruncated = false;
      this.sectionsPagePanels = [];
      this.sectionsPageReady = false;
      var key = template;
      if (!force && this.cache[key] && (now - this.cache[key].ts < STALE_MS)) return;
      this.refreshing = true;
      this.loadError[key] = null;
      var ENDPOINTS = { career: '/api/career', finance: '/api/finance', business: '/api/business' };
      try {
        var res = await fetchWithAuth(ENDPOINTS[template]);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        this.cache[key] = { ts: Date.now(), data: data };
        if (template === 'career') this.renderCareer(data);
        else if (template === 'finance') this.renderFinance(data);
        else if (template === 'business') this.renderBusiness(data);
        this.pageReady[key] = true;
        this.lastRefresh = 'Updated ' + new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        this.loadError[key] = 'Failed to load data. Is server.js running? (' + e.message + ')';
        this.pageReady[key] = true;
      } finally {
        this.refreshing = false;
      }
    },

    renderDatatable(d) {
      this.datatableInteractive = createDatatableInteractiveState(d);
      this.datatableTruncated = !!(d && d.truncated);
    },

    renderHome(d) {
      this.actionData.home = d.actionItems || [];
      if (d.dashboardPages) {
        this.dashboardPages = {
          career: !!d.dashboardPages.career,
          finance: !!d.dashboardPages.finance,
          business: !!d.dashboardPages.business,
          personal: !!d.dashboardPages.personal,
          family: !!d.dashboardPages.family,
        };
      }
      if (Array.isArray(d.dashboardNavPages)) {
        this.dashboardNavPages = d.dashboardNavPages.slice();
      }
      var summary = d.domainSummary || [];
      var domainMap = {};
      summary.forEach(function(r) { domainMap[r.domain] = r; });
      var pages = this.dashboardPages;
      var self = this;
      var domains = [
        { domain: 'career',   label: 'Career',   link: self.slugLinkForTemplate('career'),   color: 'text-blue-600 dark:text-blue-400', show: pages.career },
        { domain: 'finance',  label: 'Finance',  link: self.slugLinkForTemplate('finance'),  color: 'text-green-600 dark:text-green-400', show: pages.finance },
        { domain: 'business', label: 'Business', link: self.slugLinkForTemplate('business'), color: 'text-purple-600 dark:text-purple-400', show: pages.business },
      ].filter(function(d2) { return d2.show; });
      var seenDomain = {};
      domains.forEach(function(d0) { seenDomain[d0.domain] = true; });
      (this.dashboardNavPages || []).forEach(function(navP) {
        if (navP.template !== 'action_domain' || !navP.actionDomain) return;
        var dom = String(navP.actionDomain);
        if (seenDomain[dom]) return;
        seenDomain[dom] = true;
        var colorMap = {
          personal: 'text-orange-600 dark:text-orange-400',
          family: 'text-pink-600 dark:text-pink-400',
          career: 'text-blue-600 dark:text-blue-400',
          finance: 'text-green-600 dark:text-green-400',
          business: 'text-purple-600 dark:text-purple-400',
        };
        domains.push({
          domain: dom,
          label: navP.label || dom,
          link: '#/' + navP.slug,
          color: colorMap[dom] || 'text-slate-600 dark:text-slate-300',
          show: true,
        });
      });
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
      this.financeAccountsHtml = renderAccountCardsHtml(snapshots);
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
    fileIsText(name) { return /\.(md|html|txt|json|csv|sql|log|xml|yaml|yml|ini|conf|tsv)$/i.test(name); },
    fileIsPdf(name) { return /\.pdf$/i.test(name); },
    fileIsEditable(name) { return /\.(md|html|txt|json)$/i.test(name); },
    fileIsImage(name) { return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(name); },
    fileIsAudio(name) { return /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(name); },
    fileIsVideo(name) { return /\.(mp4|webm|ogv|mov|m4v)$/i.test(name); },
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
        this.openAssetViewer(dir, name, 'pdf');
        return;
      }
      if (this.fileIsImage(name)) {
        this.openAssetViewer(dir, name, 'image');
        return;
      }
      if (this.fileIsVideo(name)) {
        this.openAssetViewer(dir, name, 'video');
        return;
      }
      if (this.fileIsAudio(name)) {
        this.openAssetViewer(dir, name, 'audio');
        return;
      }
      if (this.fileIsText(name)) {
        this.viewFile(dir, name);
        return;
      }
      this.showDownloadOnlyPanel(dir, name);
    },

    openPdfViewer(dir, name) { this.openAssetViewer(dir, name, 'pdf'); },

    /** Reset all viewer scroll containers to the top (Alpine `<template>`-rendered nodes use `data-viewer-scroll`). */
    _resetViewerScroll() {
      var nodes = document.querySelectorAll('[data-viewer-scroll]');
      for (var i = 0; i < nodes.length; i++) nodes[i].scrollTop = 0;
    },

    /** Open the viewer in an asset mode (pdf/image/video/audio) that streams bytes directly from /api/files. */
    openAssetViewer(dir, name, mode) {
      this.editorOpen = false;
      this.viewerPath = { dir: dir, name: name };
      this.viewerTitle = name;
      this.viewerContent = '';
      this.viewerLoadError = '';
      this.viewerDisplayMode = mode;
      this.viewerOpen = true;
      var self = this;
      this.$nextTick(function() {
        self.refreshIcons();
        self._resetViewerScroll();
      });
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
      this.$nextTick(function() {
        self.refreshIcons();
        self._resetViewerScroll();
      });
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
        this.$nextTick(function() {
          self.refreshIcons();
          self._resetViewerScroll();
        });
      } catch (err) {
        this.viewerContent = '';
        this.viewerLoadError = err.message || 'Could not load file';
        this.viewerDisplayMode = 'error';
        this.viewerOpen = true;
        var self = this;
        this.$nextTick(function() {
          self.refreshIcons();
          self._resetViewerScroll();
        });
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
      // Generic SDK subagent ids (general-purpose, explore, …) must never surface
      // in the UI; if one slipped through we fall back to Cyrus so the "is working"
      // banner stays in the agent vocabulary the user actually recognizes.
      if (isGenericSdkSubagentId(a)) return 'Cyrus';
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

    chatAgentSelectionLocked() {
      return !!(this.chatMessages && this.chatMessages.length > 0);
    },

    isChatAgentProfileViewingPick(slug) {
      var v = this.chatAgentProfileViewing;
      if (v == null || v === '') return this.isActiveChatAgentPick(slug);
      return this.normalizeChatAgentId(v) === this.normalizeChatAgentId(slug);
    },

    toggleChatAgentProfile() {
      if (this.chatAgentProfileOpen) {
        this.closeChatAgentProfile();
        return;
      }
      this.chatModelPickerOpen = false;
      this.openChatAgentProfile();
    },

    toggleChatModelPicker() {
      if (this.chatMessages.length > 0) return;
      this.closeChatAgentProfile();
      this.chatModelPickerOpen = !this.chatModelPickerOpen;
      var self = this;
      this.$nextTick(function () {
        self.refreshIcons();
      });
    },

    closeChatModelPicker() {
      if (!this.chatModelPickerOpen) return;
      this.chatModelPickerOpen = false;
      var self = this;
      this.$nextTick(function () {
        self.refreshIcons();
      });
    },

    selectChatModelFromPicker(mid) {
      if (this.chatMessages.length > 0) return;
      var next = this.ensureChatModelFromCatalog(mid);
      var cur = this.ensureChatModelFromCatalog(this.chatModel);
      this.chatModelPickerOpen = false;
      var self = this;
      if (next === cur) {
        this.$nextTick(function () {
          self.refreshIcons();
        });
        return;
      }
      this.chatModel = next;
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

    async loadChatAgentProfileForViewing(agentId) {
      var id = this.normalizeChatAgentId(agentId);
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

    async openChatAgentProfile() {
      this.chatModelPickerOpen = false;
      var id = this.normalizeChatAgentId(this.chatAgent);
      this.chatAgentProfileViewing = id;
      this.chatAgentProfileOpen = true;
      this.prefetchAllChatAgentMeta();
      await this.loadChatAgentProfileForViewing(id);
    },

    async switchChatAgentProfileSidebar(slug) {
      var next = this.normalizeChatAgentId(slug);
      var self = this;
      var prev = this.chatAgentProfileViewing != null ? this.normalizeChatAgentId(this.chatAgentProfileViewing) : null;
      if (prev === next && this.chatAgentProfileHtml && !this.chatAgentProfileError) {
        var cached = this.chatAgentMeta[next];
        if (cached && cached.status === 'ok' && cached.markdown) {
          this.$nextTick(function () {
            self.refreshIcons();
          });
          return;
        }
      }
      this.chatAgentProfileViewing = next;
      if (!this.chatAgentSelectionLocked()) {
        var cur = this.normalizeChatAgentId(this.chatAgent);
        if (next !== cur) {
          this.chatAgent = next;
          await this.onChatAgentChange();
        }
      }
      await this.loadChatAgentProfileForViewing(next);
      this.$nextTick(function () {
        self.refreshIcons();
      });
    },

    closeChatAgentProfile() {
      this.chatAgentProfileOpen = false;
      this.chatAgentProfileViewing = null;
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

    async loadChatModels() {
      var self = this;
      try {
        var r = await fetchWithAuth('/api/chat/models');
        if (!r.ok) return;
        var d = await r.json();
        this.chatModelCatalog = Array.isArray(d.models) ? d.models : [];
        var def =
          (d.defaultModel && self.chatModelCatalog.some(function (m) { return m.id === d.defaultModel; })
            ? d.defaultModel
            : null) ||
          (self.chatModelCatalog[0] && self.chatModelCatalog[0].id) ||
          'haiku';
        if (!self.chatModelCatalog.some(function (m) { return m.id === self.chatModel; })) {
          self.chatModel = def;
        }
      } catch (_) {
        this.chatModelCatalog = [];
      }
    },

    ensureChatModelFromCatalog(id) {
      var c = this.chatModelCatalog || [];
      var s = String(id || '').trim().toLowerCase();
      if (c.some(function (m) { return m.id === s; })) return s;
      return c[0] && c[0].id ? c[0].id : 'haiku';
    },

    chatModelDisplayLabel(modelId) {
      var id = String(modelId || '').trim().toLowerCase();
      var row = (this.chatModelCatalog || []).find(function (m) { return m.id === id; });
      return row ? row.label : modelId || 'Model';
    },

    chatModelSummaryLine(modelId) {
      var id = String(modelId || '').trim().toLowerCase();
      var row = (this.chatModelCatalog || []).find(function (m) { return m.id === id; });
      if (!row) return '';
      var ctx = row.contextLabel ? String(row.contextLabel) + ' ctx' : '';
      var cost = row.costHint ? String(row.costHint) : '';
      if (ctx && cost) return ctx + ' · ' + cost;
      return ctx || cost;
    },

    chatModelPickerMetaLine(entry) {
      if (!entry) return '';
      var ctx = entry.contextLabel ? String(entry.contextLabel) + ' ctx' : '';
      var cost = entry.costHint ? String(entry.costHint) : '';
      if (ctx && cost) return ctx + ' · ' + cost;
      return ctx || cost;
    },

    isActiveChatModelPick(mid) {
      return this.ensureChatModelFromCatalog(this.chatModel) === this.ensureChatModelFromCatalog(mid);
    },

    chatPromptPlaceholderDesktop() {
      if (this.chatCoarsePointer) return 'Ask your agent…';
      return 'Ask your agent… (Enter to send, Shift+Enter or Cmd+Enter for newline)';
    },

    chatPromptPlaceholderMobile() {
      if (this.chatCoarsePointer) return 'Ask…';
      return 'Ask… (Enter to send, Shift+Enter or Cmd+Enter for newline)';
    },

    /** Visible chat composer (desktop sidebar vs mobile full-screen). */
    activeChatComposerEl() {
      try {
        var wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
        return wide ? this.$refs.chatPromptDesktop : this.$refs.chatPromptMobile;
      } catch (_) {
        return null;
      }
    },

    /**
     * Grow the chat textarea with content, up to half the viewport height; scroll inside when taller.
     */
    adjustChatComposerHeight(el) {
      if (!el || el.tagName !== 'TEXTAREA') return;
      try {
        var r = el.getBoundingClientRect();
        if (!r.width && !r.height) return;
      } catch (_) {
        return;
      }
      var maxPx = Math.floor(window.innerHeight * 0.5);
      el.style.height = 'auto';
      var full = el.scrollHeight;
      var next = Math.min(full, maxPx);
      el.style.height = next + 'px';
      el.style.overflowY = full > maxPx ? 'auto' : 'hidden';
    },

    syncChatComposerHeights() {
      var el = this.activeChatComposerEl();
      if (el) this.adjustChatComposerHeight(el);
    },

    insertNewlineInChatComposer(el) {
      if (!el || el.tagName !== 'TEXTAREA') return;
      var self = this;
      var start = el.selectionStart;
      var end = el.selectionEnd;
      var val = this.chatPrompt;
      var pos = start + 1;
      this.chatPrompt = val.slice(0, start) + '\n' + val.slice(end);
      this.$nextTick(function() {
        try {
          el.selectionStart = el.selectionEnd = pos;
        } catch (_) {}
        self.adjustChatComposerHeight(el);
      });
    },

    /** Fine pointer: Enter sends, Shift/Cmd/Ctrl+Enter newline. Coarse (touch-primary): Enter always newline; use Send. */
    onChatComposerEnterKeydown(e) {
      if (this.chatCoarsePointer) {
        e.preventDefault();
        this.insertNewlineInChatComposer(e.target);
        return;
      }
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        this.insertNewlineInChatComposer(e.target);
        return;
      }
      e.preventDefault();
      this.submitChat();
    },

    async submitChat() {
      var files = this.chatFiles && this.chatFiles.length ? this.chatFiles.slice() : [];
      if (!this.chatPrompt.trim() && !files.length) return;
      var prompt = this.chatPrompt.trim() || '(See attached file(s).)';
      var planPhase = this.chatPlanAwaitingExecute ? 'execute' : this.chatPlanMode ? 'plan' : null;
      if (this.chatOutboundInFlight) {
        this.chatOutboundQueue.push({
          id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          prompt: prompt,
          files: files,
          planPhase: planPhase,
        });
        this.chatPrompt = '';
        this.chatFiles = [];
        var self = this;
        this.$nextTick(function() {
          self.scrollChatToBottom({ force: true });
          self.refreshIcons();
          self.syncChatComposerHeights();
        });
        return;
      }
      this.chatOutboundInFlight = true;
      await this.runChatTurn(prompt, files, { planPhase: planPhase });
    },

    async executeApprovedChatPlan() {
      if (!this.chatConversationId || !this.chatPlanAwaitingExecute) return;
      if (!this.chatPlanTodos || !this.chatPlanTodos.length) {
        alert('No checklist items. Run a plan turn first.');
        return;
      }
      var p = this.chatPrompt.trim() || 'Execute the approved plan.';
      if (this.chatOutboundInFlight) {
        this.chatOutboundQueue.push({
          id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          prompt: p,
          files: [],
          planPhase: 'execute',
        });
        this.chatPrompt = '';
        var self = this;
        this.$nextTick(function() {
          self.scrollChatToBottom({ force: true });
          self.refreshIcons();
          self.syncChatComposerHeights();
        });
        return;
      }
      this.chatOutboundInFlight = true;
      await this.runChatTurn(p, [], { planPhase: 'execute' });
    },

    /**
     * Sends one user turn (optional team-inbox file upload, then chat stream).
     * Serializes with the outbound queue: when this turn finishes, the next queued item runs automatically.
     */
    async runChatTurn(prompt, files, opts) {
      var self = this;
      opts = opts || {};
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
            fd.append('domain', uploadDefaultDomainForAgent(agentId, self.dashboardPages));
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
        this.chatUiTick = Date.now();
        this._clearChatElapsedTimer();
        this._chatElapsedTimer = setInterval(function() {
          self.chatUiTick = Date.now();
          self.refreshChatWaitingStatusLineIfStreaming();
        }, 1000);
        this.chatMessages.push({ id: optimisticId, role: 'user', content: prompt });
        this.chatPrompt = '';
        this.chatStreaming = true;
        this.scrollChatToBottom({ force: true });
        this.$nextTick(function() {
          self.refreshIcons();
          self.syncChatComposerHeights();
        });
        this.chatAbortController = new AbortController();
        this.chatRetryPrompt = prompt;
        var streamOk = false;
        var acceptedByServer = false;
        try {
          var body = {
            agent: this.normalizeChatAgentId(this.chatAgent),
            prompt: prompt,
            conversationId: this.chatConversationId,
            model: this.ensureChatModelFromCatalog(this.chatModel),
          };
          if (opts.planPhase) body.planPhase = opts.planPhase;
          if (opts.planPhase === 'execute' && this.chatPlanTodos && this.chatPlanTodos.length) {
            body.planTodos = this.chatPlanTodos;
          }
          var res = await fetchWithAuth('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: this.chatAbortController.signal,
          });
          if (!res.ok) {
            this.chatMessages = this.chatMessages.filter(function(m) { return m.id !== optimisticId; });
            this.chatPrompt = prompt;
            this.$nextTick(function() {
              self.syncChatComposerHeights();
            });
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
                if (msg.segmentAgentStart) {
                  self.applySegmentAgentStartFromStream(msg.segmentAgentStart);
                }
                if (msg.segmentAgentEnd) {
                  self.applySegmentAgentEndFromStream(msg.segmentAgentEnd);
                }
                if (msg.status === 'started') {
                  self.appendChatWaitingStatusLine(pickChatWorkStartedLine());
                }
                if (msg.text) {
                  self.clearAllWorkPanelWaitingSlots();
                  self.chatStreamDraft = appendAssistantStreamChunk(self.chatStreamDraft, msg.text);
                }
                if (msg.error) {
                  self.clearAllWorkPanelWaitingSlots();
                  self.appendWorkLineToCurrentPanel('[stderr] ' + String(msg.error).trim().slice(0, 500), 'e');
                }
                if (msg.tool) {
                  self.clearAllWorkPanelWaitingSlots();
                  var td = msg.toolDetail ? String(msg.toolDetail).trim().slice(0, 240) : '';
                  self.appendWorkLineToCurrentPanel(td ? msg.tool + ': ' + td : String(msg.tool), 'tool');
                  // Delegation panels are driven exclusively by the authoritative
                  // server `segmentAgentStart` / `segmentAgentEnd` events. We
                  // intentionally do NOT guess the delegate from the Task prompt
                  // body here — that optimistic path created duplicate cards
                  // (one from the prompt-text guess, one from the tool_use_id
                  // event). The parent panel keeps showing the `Task: ...` log
                  // line above; the delegate's own panel is opened by
                  // applySegmentAgentStartFromStream when the server confirms.
                }
                if (msg.sdkUsageSessionTotals != null) {
                  self.chatSdkUsageSessionTotals = msg.sdkUsageSessionTotals;
                }
                if (msg.phase === 'plan') {
                  if (Array.isArray(msg.planTodos)) {
                    self.chatPlanTodos = msg.planTodos.map(function (t) {
                      return {
                        id: t.id != null ? String(t.id) : '',
                        title: t.title != null ? String(t.title) : '',
                        status: t.status || 'pending',
                      };
                    });
                  }
                  if (msg.planMarkdown != null) self.chatPlanMarkdown = String(msg.planMarkdown);
                  self.chatPlanAwaitingExecute = !!(self.chatPlanTodos && self.chatPlanTodos.length);
                  if (msg.planInboxFile && msg.planInboxFile.dir && msg.planInboxFile.name) {
                    self.chatPlanInboxFile = {
                      dir: String(msg.planInboxFile.dir),
                      name: String(msg.planInboxFile.name),
                    };
                    self.navigateToOwnersInboxPlan(self.chatPlanInboxFile);
                  } else {
                    self.chatPlanInboxFile = null;
                  }
                }
                if (msg.phase === 'execute') {
                  self.chatPlanAwaitingExecute = false;
                }
                if (msg.phase === 'plan' || msg.phase === 'execute') {
                  self.$nextTick(function() {
                    self.refreshIcons();
                  });
                }
              } catch (_) {}
            }
            self.scrollChatToBottom();
            if (streamOk) break;
          }
          self.chatStreamDraft = '';
          await self.refreshActiveConversation();
          await self.loadConversationList();
          if (streamOk) {
            self.maybeNotifyChatComplete();
            try {
              delete self.cache.usage;
            } catch (_) {}
            if (self.page === 'home') await self.refreshHomeUsageFooter();
          }
        } catch (err) {
          self.chatStreamDraft = '';
          if (err.name === 'AbortError') {
            await self.refreshActiveConversation();
            await self.loadConversationList();
          } else if (!acceptedByServer) {
            self.chatMessages = self.chatMessages.filter(function(m) { return m.id !== optimisticId; });
            self.chatPrompt = prompt;
            self.$nextTick(function() {
              self.syncChatComposerHeights();
            });
            self.chatMessages.push({
              id: 'err-' + Date.now(),
              role: 'assistant',
              content: '[Error: ' + err.message + ']',
              error: true,
            });
          } else {
            await self.refreshActiveConversation();
            await self.loadConversationList();
            try {
              delete self.cache.usage;
            } catch (_) {}
            if (self.page === 'home') await self.refreshHomeUsageFooter();
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
            self
              .runChatTurn(next.prompt, next.files || [], { planPhase: next.planPhase || null })
              .catch(function(e) {
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

    /**
     * Add pasted images (or other files) from the clipboard to chat attachments, same as drag/drop.
     * Uses Clipboard API items/files; prevents default only when file data is present.
     */
    handleChatPaste(e) {
      var cd = e.clipboardData;
      if (!cd) return;
      var files = [];
      if (cd.items && cd.items.length) {
        for (var i = 0; i < cd.items.length; i++) {
          var item = cd.items[i];
          if (item.kind === 'file') {
            var f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      }
      if (!files.length && cd.files && cd.files.length) {
        files = Array.from(cd.files);
      }
      if (!files.length) return;
      e.preventDefault();
      this.chatFiles = this.chatFiles.concat(files);
      var self = this;
      this.$nextTick(function() {
        self.refreshIcons();
      });
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
      formData.append('domain', uploadDefaultDomainForAgent('owner', self.dashboardPages));
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