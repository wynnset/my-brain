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
    filesSearchQuery: '',
    /** Sort key for the file list: 'name' | 'date' | 'type' | 'creator' | 'category' */
    filesSort: (function() {
      try { return localStorage.getItem('files_sort') || 'date'; } catch (_) { return 'date'; }
    })(),
    /** Keyed by `sectionDir + ':' + relPath` → boolean open state for subdirectories. */
    _folderOpenState: {},
    /** What to show on each file row; persisted to localStorage. Defaults are minimal: only tags. */
    filesViewOptions: (function() {
      try {
        var saved = JSON.parse(localStorage.getItem('files_view_options') || '{}');
        return {
          type: saved.type === true,
          size: saved.size === true,
          date: saved.date === true,
          tags: saved.tags !== false,
        };
      } catch (_) {
        return { type: false, size: false, date: false, tags: true };
      }
    })(),
    filesViewOptionsOpen: false,
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
    /**
     * Draft text for the "no conversation yet" composer (before the first send
     * creates a server session). Mirrors the localStorage key
     * `brain_chat_draft:__new__` so a refresh restores the in-progress message.
     */
    _chatDraftPromptNoConv: '',
    chatConversationId: null,
    chatMessages: [],
    /** From server: cumulative SDK billing for the active conversation (Anthropic / Agent SDK). */
    chatSdkUsageSessionTotals: null,
    chatConversations: [],
    /** Server-enforced cap mirrored on the client so the UI can show a helpful hint. */
    chatMaxPins: 5,
    /** Per-id flag to disable the pin button while the POST is in flight. */
    chatPinPending: {},
    /** Drives the top-center pin-limit banner (z-[120], visible above any modal). */
    chatPinLimitHintVisible: false,
    /**
     * Mirrors `/api/chat/limits` for the signed-in tenant. Populated on first
     * chat-panel open and refreshed after every 402 response from POST /api/chat.
     * `exceeded` drives the prominent "out of credits" banner + disables the
     * composer submit button. `null` means the payload has not loaded yet.
     * @type {null | { enabled: boolean, exceeded: boolean, exceededKind: 'daily'|'monthly'|null, resetsAt: string|null, dailyLimitUsd: number, monthlyLimitUsd: number, daySpendUsd: number, monthSpendUsd: number, dayResetsAt: string, monthResetsAt: string, accountCreatedAt: string }}
     */
    chatCreditLimit: null,
    /** Optional human-readable error from the most recent 402 response. */
    chatCreditLimitMessage: '',
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
    /** When true, the "N message(s) queued" banner expands to preview queued prompts. */
    chatQueuePreviewOpen: false,
    chatStreamDraft: '',
    /**
     * Per-agent work segments for the current turn (merged activity + “is working” UI).
     * Each { id, agentId, lines: [{id,text}], expanded, done, startedAt, endedAt }.
     */
    chatWorkPanels: [],
    /**
     * True when *assistant message* text arrived while the user was scrolled
     * up, so we suppressed the auto-follow. (Work / tool / "thinking" activity
     * does not set this.) Reveals a "New replies below" pill that jumps back
     * to the latest on click. Reset when the user scrolls near the bottom or
     * we force-scroll on user-driven actions.
     */
    chatShowNewRepliesButton: false,
    /**
     * Per conversation id (string key): quick-switch strip shows a dot when that
     * pinned chat received assistant output while you were elsewhere or the window
     * was not focused. Cleared when you open the chat or refocus while viewing it.
     */
    chatPinnedUnread: {},
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
    /** Popover listing attached files (paperclip); only used when chatFiles.length > 0. */
    chatAttachmentsMenuOpen: false,
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
    /**
     * Per-conversationId live stream state so multiple chats can run and be viewed without cross-talk.
     * When `chatConversationId` matches a bucket, root fields (`chatMessages`, `chatStreaming`, …) point at the same array/object refs.
     */
    chatStreams: {},
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
        // Persist the composer draft per-chat on every keystroke so users can
        // prepare messages for multiple chats in parallel and have them
        // restored on refresh. Also keep the no-conv mirror in sync.
        this.$watch('chatPrompt', function (v) {
          if (self.chatConversationId == null) {
            self._chatDraftPromptNoConv = typeof v === 'string' ? v : '';
          }
          self.persistChatDraftToStorage();
        });
        this.$watch('filesSort', function (v) {
          try { localStorage.setItem('files_sort', v); } catch (_) {}
          self.$nextTick(function() { self.refreshIcons(); });
        });
        this.$watch('filesViewOptions', function (v) {
          try { localStorage.setItem('files_view_options', JSON.stringify(v)); } catch (_) {}
          self.$nextTick(function() { self.refreshIcons(); });
        });
        this.$watch('filesSearchQuery', function () {
          self.$nextTick(function() { self.refreshIcons(); });
        });
        this.$watch('filesFilterCreator', function () {
          self.$nextTick(function() { self.refreshIcons(); });
        });
        this.$watch('filesFilterDomain', function () {
          self.$nextTick(function() { self.refreshIcons(); });
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
      self._onChatFocusOrVisibilityForPinned = function() {
        self.clearChatPinnedUnreadIfViewingAndFocused();
      };
      document.addEventListener('visibilitychange', self._onChatFocusOrVisibilityForPinned);
      window.addEventListener('focus', self._onChatFocusOrVisibilityForPinned);
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
      // Pinned-chat strip reads from chatConversations; refresh silently so
      // the user sees the up-to-date pins as soon as the panel opens, and
      // repaint lucide icons once pinned rows land in the DOM.
      var self = this;
      this.loadConversationList()
        .catch(function () {})
        .then(function () { self.$nextTick(function () { self.refreshIcons(); }); });
      this.refreshChatCreditLimit().catch(function () {});
      this.$nextTick(function() { self.refreshIcons(); });
    },

    /**
     * Fetch the current per-user credit-limit snapshot from the server. Silent
     * on failure — the banner stays hidden rather than confusing the user with
     * transient network errors.
     */
    async refreshChatCreditLimit() {
      try {
        var r = await fetchWithAuth('/api/chat/limits');
        if (!r.ok) return;
        var payload = await r.json();
        this.ingestChatCreditLimitPayload(payload);
      } catch (_) {}
    },

    /**
     * Store a `/api/chat/limits` or 402 response payload on the app state.
     * Clears the exceeded message once the snapshot is no longer over-limit.
     */
    ingestChatCreditLimitPayload(payload) {
      if (!payload || typeof payload !== 'object') {
        this.chatCreditLimit = null;
        this.chatCreditLimitMessage = '';
        return;
      }
      if (payload.enabled === false) {
        this.chatCreditLimit = null;
        this.chatCreditLimitMessage = '';
        return;
      }
      this.chatCreditLimit = payload;
      if (!payload.exceeded) this.chatCreditLimitMessage = '';
      else if (payload.error) this.chatCreditLimitMessage = String(payload.error);
    },

    /** True when the composer should show the out-of-credits state. */
    chatIsOverCreditLimit() {
      return Boolean(this.chatCreditLimit && this.chatCreditLimit.exceeded);
    },

    /** Headline for the credit-exceeded banner. */
    chatCreditLimitHeadline() {
      var c = this.chatCreditLimit;
      if (!c || !c.exceeded) return '';
      var kind = c.exceededKind === 'monthly' ? 'monthly' : 'daily';
      var limit = kind === 'monthly' ? c.monthlyLimitUsd : c.dailyLimitUsd;
      var limitTxt = Number.isFinite(Number(limit)) ? '$' + Number(limit).toFixed(2) : '';
      return "You've reached your " + kind + ' credit limit' + (limitTxt ? ' (' + limitTxt + ')' : '') + '.';
    },

    /** Secondary line: when credits reset (uses the visitor's locale). */
    chatCreditLimitResetLine() {
      var c = this.chatCreditLimit;
      if (!c || !c.exceeded || !c.resetsAt) return '';
      var when;
      try {
        var d = new Date(c.resetsAt);
        when = d.toLocaleString(undefined, {
          weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        });
      } catch (_) {
        when = c.resetsAt;
      }
      var kind = c.exceededKind === 'monthly' ? 'Monthly' : 'Daily';
      return kind + ' credits reset ' + when + '.';
    },

    /** One-line summary of the current spend vs. limits for the banner footer. */
    chatCreditLimitUsageLine() {
      var c = this.chatCreditLimit;
      if (!c) return '';
      function fmt(n) { return Number.isFinite(Number(n)) ? '$' + Number(n).toFixed(2) : '—'; }
      return 'Today: ' + fmt(c.daySpendUsd) + ' / ' + fmt(c.dailyLimitUsd)
        + '   •   This month: ' + fmt(c.monthSpendUsd) + ' / ' + fmt(c.monthlyLimitUsd);
    },

    // ─── Usage-page credit-limit helpers ───────────────────────────────────
    //
    // Thin computed helpers used by the progress bars + history table on the
    // Usage page. They all degrade gracefully when `chatCreditLimit` is null
    // (limits not yet loaded) so the surrounding Alpine template can hide
    // the whole block via `x-show="chatCreditLimitIsActive()"`.

    /** True when the credit-limit feature is active for this tenant. */
    chatCreditLimitIsActive() {
      var c = this.chatCreditLimit;
      return !!(c && c.enabled !== false);
    },

    /**
     * Progress-bar percentage (0–100, capped) for the daily or monthly cycle.
     * Returns 0 when the cap is 0 / unset (a limit of 0 means "disabled" on
     * the server).
     */
    chatCreditLimitPercent(kind) {
      var c = this.chatCreditLimit;
      if (!c) return 0;
      var spend = kind === 'monthly' ? Number(c.monthSpendUsd) : Number(c.daySpendUsd);
      var cap = kind === 'monthly' ? Number(c.monthlyLimitUsd) : Number(c.dailyLimitUsd);
      if (!Number.isFinite(spend) || spend <= 0) return 0;
      if (!Number.isFinite(cap) || cap <= 0) return 0;
      var pct = (spend / cap) * 100;
      if (pct < 0) return 0;
      if (pct > 100) return 100;
      return pct;
    },

    /** Tailwind class for the progress bar fill, scaled by usage ratio. */
    chatCreditLimitBarClass(kind) {
      var pct = this.chatCreditLimitPercent(kind);
      if (pct >= 100) return 'bg-rose-500 dark:bg-rose-500';
      if (pct >= 85) return 'bg-amber-500 dark:bg-amber-400';
      if (pct >= 60) return 'bg-indigo-500 dark:bg-indigo-400';
      return 'bg-emerald-500 dark:bg-emerald-400';
    },

    /** "$1.23 / $10.00" line above each progress bar. */
    chatCreditLimitSpendLine(kind) {
      var c = this.chatCreditLimit;
      if (!c) return '';
      var spend = kind === 'monthly' ? c.monthSpendUsd : c.daySpendUsd;
      var cap = kind === 'monthly' ? c.monthlyLimitUsd : c.dailyLimitUsd;
      var capNum = Number(cap);
      if (!Number.isFinite(capNum) || capNum <= 0) {
        return this._fmtCreditUsd(spend) + ' used   \u2022   No limit';
      }
      return this._fmtCreditUsd(spend) + ' / ' + this._fmtCreditUsd(cap);
    },

    /** "Resets at …" caption beneath each bar (uses visitor locale). */
    chatCreditLimitResetCaption(kind) {
      var c = this.chatCreditLimit;
      if (!c) return '';
      var iso = kind === 'monthly' ? c.monthResetsAt : c.dayResetsAt;
      if (!iso) return '';
      try {
        var d = new Date(iso);
        var opts = kind === 'monthly'
          ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
          : { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
        return 'Resets ' + d.toLocaleString(undefined, opts);
      } catch (_) { return ''; }
    },

    /** Subtitle for the monthly card — e.g. "Apr 20 → May 20 cycle". */
    chatCreditLimitMonthlyCycleLabel() {
      var c = this.chatCreditLimit;
      if (!c || !c.monthPeriodStart || !c.monthResetsAt) return '';
      try {
        var start = new Date(c.monthPeriodStart + 'T12:00:00Z');
        var end = new Date(c.monthResetsAt);
        var o = { month: 'short', day: 'numeric' };
        return start.toLocaleDateString(undefined, o) + ' \u2192 ' + end.toLocaleDateString(undefined, o) + ' cycle';
      } catch (_) { return ''; }
    },

    /** Human-friendly label for an archived monthly cycle row. */
    chatCreditLimitHistoryLabel(row) {
      if (!row || !row.periodStart) return '';
      try {
        var start = new Date(row.periodStart + 'T12:00:00Z');
        var end = row.periodEnd ? new Date(row.periodEnd + 'T12:00:00Z') : null;
        var o = { month: 'short', day: 'numeric', year: 'numeric' };
        if (!end) return start.toLocaleDateString(undefined, o);
        return (
          start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          + ' \u2013 '
          + end.toLocaleDateString(undefined, o)
        );
      } catch (_) {
        return String(row.periodStart);
      }
    },

    /** History-row progress ratio, measured against the user's CURRENT monthly cap. */
    chatCreditLimitHistoryPercent(row) {
      var c = this.chatCreditLimit;
      if (!c || !row) return 0;
      var cap = Number(c.monthlyLimitUsd);
      if (!Number.isFinite(cap) || cap <= 0) return 0;
      var spend = Number(row.spendUsd) || 0;
      var pct = (spend / cap) * 100;
      if (pct < 0) return 0;
      if (pct > 100) return 100;
      return pct;
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
          maximumFractionDigits: 2,
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

    /**
     * One-line stats for the home footer. When credit limits are configured,
     * formats as:
     *   "Today $1.23 / $10.00  •  April $7.45 / $10.00"
     * so the caps are visible at a glance. Falls back to the simpler
     * month-to-date phrasing (from `/api/chat/usage-summary`) when the limits
     * snapshot hasn't loaded yet.
     */
    homeUsageFooterMain() {
      var limits = this.chatCreditLimit;
      if (limits && limits.enabled !== false) {
        var monthName = 'This month';
        var mps = limits.monthPeriodStart || '';
        if (mps && mps.length >= 7) {
          try {
            var d = new Date(mps + 'T12:00:00Z');
            monthName = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
          } catch (_) {}
        }
        return (
          'Today ' + this._fmtCreditUsd(limits.daySpendUsd) + ' / ' + this._fmtCreditUsd(limits.dailyLimitUsd)
          + '  \u2022  '
          + monthName + ' ' + this._fmtCreditUsd(limits.monthSpendUsd) + ' / ' + this._fmtCreditUsd(limits.monthlyLimitUsd)
        );
      }
      var u = this.chatUsageSummaryForHome;
      if (!u || !u.monthToDate) return 'No usage yet';
      var m = u.monthToDate;
      var monthKey = m.month || '';
      var name = 'This month';
      if (monthKey && monthKey.length >= 7) {
        try {
          var d2 = new Date(monthKey + '-01T12:00:00Z');
          name = d2.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
        } catch (_) {}
      }
      var usd = typeof m.totalCostUsd === 'number' && Number.isFinite(m.totalCostUsd) ? m.totalCostUsd : 0;
      return name + ' usage: $' + usd.toFixed(2);
    },

    _fmtCreditUsd(n) {
      var v = Number(n);
      return Number.isFinite(v) ? '$' + v.toFixed(2) : '—';
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

    /** @param {any} [bucket] per-conversation stream bucket; defaults to active conversation */
    initChatWorkPanelsForTurn(bucket) {
      bucket = bucket || this.getChatStreamBucket(this.chatConversationId);
      if (!bucket) return;
      // Reassign a fresh array and re-sync the root reactive field so the UI
      // doesn't keep rendering the previous turn's "Done" panels. Without this
      // re-sync, `this.chatWorkPanels` keeps pointing at the stale array that
      // `restoreRootFromChatBucket` (called just before this) bound to.
      bucket.workPanels = [];
      if (this.chatConversationId === bucket.convId) {
        this.chatWorkPanels = bucket.workPanels;
      }
      this._appendWorkPanel(bucket, this.normalizeWorkPanelAgentId(this.chatAgent), true);
    },

    _appendWorkPanel(bucket, agentId, expanded, delegationId) {
      if (!bucket) return;
      var panels = bucket.workPanels || [];
      for (var i = 0; i < panels.length; i++) {
        if (!panels[i].done) panels[i].expanded = false;
      }
      bucket.workPanels.push({
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

    openNewWorkPanelForAgent(rawId, bucket) {
      bucket = bucket || this.getChatStreamBucket(this.chatConversationId);
      if (!bucket) return;
      var aid = rawId === '_delegate' ? '_delegate' : this.normalizeChatAgentId(rawId);
      this._appendWorkPanel(bucket, aid, true);
      bucket.uiTick = Date.now();
      if (this.chatConversationId === bucket.convId) this.chatUiTick = bucket.uiTick;
      this.$nextTick(function() { this.scrollChatToBottom({ suppressNewRepliesPill: true }); }.bind(this));
    },

    /**
     * Server/SDK confirmed a delegation handoff to a real team agent. Open (or
     * promote) a work panel so the UI shows "<agent> is working" instead of the
     * parent agent. Generic SDK subagent ids are ignored by the server, but we
     * re-check here defensively and also require the slug to be a known team
     * member so "General-purpose" / stray ids never surface as speakers.
     */
    applySegmentAgentFromStream(agentId, bucket) {
      bucket = bucket || this.getChatStreamBucket(this.chatConversationId);
      if (!bucket) return;
      if (agentId == null || !String(agentId).trim()) return;
      if (isGenericSdkSubagentId(agentId)) return;
      var aid = this.normalizeWorkPanelAgentId(String(agentId).trim().toLowerCase().replace(/\s+/g, '_'));
      var known = (this.chatAgents || []).some(function (slug) {
        return this.normalizeChatAgentId(slug) === aid;
      }, this);
      if (!known) return;
      var panels = bucket.workPanels;
      var last = panels.length ? panels[panels.length - 1] : null;
      if (last && !last.done && last.agentId === aid) {
        bucket.uiTick = Date.now();
        if (this.chatConversationId === bucket.convId) this.chatUiTick = bucket.uiTick;
        return;
      }
      if (last && last.agentId === '_delegate') {
        last.agentId = aid;
        last.startedAt = Date.now();
        bucket.uiTick = Date.now();
        if (this.chatConversationId === bucket.convId) this.chatUiTick = bucket.uiTick;
        return;
      }
      this.openNewWorkPanelForAgent(aid, bucket);
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
    applySegmentAgentStartFromStream(evt, bucket) {
      bucket = bucket || this.getChatStreamBucket(this.chatConversationId);
      if (!bucket) return;
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
      var panels = bucket.workPanels || [];
      if (delegationId) {
        for (var i = 0; i < panels.length; i++) {
          if (panels[i].delegationId === delegationId) {
            bucket.uiTick = Date.now();
            if (this.chatConversationId === bucket.convId) this.chatUiTick = bucket.uiTick;
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
          bucket.uiTick = Date.now();
          if (this.chatConversationId === bucket.convId) this.chatUiTick = bucket.uiTick;
          return;
        }
        // Stop at the first not-done panel that isn't a match — we don't
        // want to promote a Cyrus / parent panel.
        break;
      }
      this._appendWorkPanel(bucket, aid, true, delegationId || null);
      bucket.uiTick = Date.now();
      if (this.chatConversationId === bucket.convId) this.chatUiTick = bucket.uiTick;
      this.$nextTick(function () { this.scrollChatToBottom({ suppressNewRepliesPill: true }); }.bind(this));
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
    applySegmentAgentEndFromStream(evt, bucket) {
      bucket = bucket || this.getChatStreamBucket(this.chatConversationId);
      if (!bucket) return;
      if (!evt) return;
      var delegationId = evt.id != null ? String(evt.id) : '';
      var agentRaw = evt.agent != null ? String(evt.agent).trim() : '';
      var aid = agentRaw
        ? this.normalizeWorkPanelAgentId(agentRaw.toLowerCase().replace(/\s+/g, '_'))
        : '';
      var panels = bucket.workPanels || [];
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
      bucket.uiTick = Date.now();
      if (this.chatConversationId === bucket.convId) this.chatUiTick = bucket.uiTick;
    },

    appendWorkLineToCurrentPanel(text, idSuffix, bucket) {
      bucket = bucket || this.getChatStreamBucket(this.chatConversationId);
      if (!bucket) return;
      var panels = bucket.workPanels;
      if (!panels.length) this.initChatWorkPanelsForTurn(bucket);
      var p = panels[panels.length - 1];
      if (p.done) return;
      p.lines.push({
        id: 'wl-' + Date.now() + '-' + (idSuffix || 'x') + '-' + Math.random().toString(36).slice(2, 6),
        text: text,
      });
      if (p.lines.length > 120) p.lines.shift();
      this.scrollChatToBottom({ suppressNewRepliesPill: true });
    },

    /** One live log line for connect/waiting; copy refreshes at least every 5s (see formatChatWaitingStatusLine). */
    appendChatWaitingStatusLine(startedText, bucket) {
      bucket = bucket || this.getChatStreamBucket(this.chatConversationId);
      if (!bucket) return;
      var panels = bucket.workPanels;
      if (!panels.length) this.initChatWorkPanelsForTurn(bucket);
      var p = panels[panels.length - 1];
      if (p.done) return;
      for (var j = 0; j < p.lines.length; j++) {
        if (p.lines[j].waitingSlot) return;
      }
      var sec = bucket.workingStartedAt ? Math.floor((Date.now() - bucket.workingStartedAt) / 1000) : 0;
      p.lines.push({
        id: 'wl-' + Date.now() + '-wait-' + Math.random().toString(36).slice(2, 6),
        text: formatChatWaitingStatusLine(sec, startedText),
        waitingSlot: true,
        _startedText: startedText,
      });
      if (p.lines.length > 120) p.lines.shift();
      this.scrollChatToBottom({ suppressNewRepliesPill: true });
    },

    /** True while streaming past the long-wait threshold — bumps with chatUiTick every second. */
    chatStreamFeelsLong() {
      var b = this.getChatStreamBucket(this.chatConversationId);
      var _tick = b ? b.uiTick : this.chatUiTick;
      void _tick;
      if (!b || !b.streaming || b.workingStartedAt == null) return false;
      return Math.floor((Date.now() - b.workingStartedAt) / 1000) > CHAT_LONG_WAIT_THRESHOLD_SEC;
    },

    refreshChatWaitingStatusLineIfStreaming(bucket) {
      bucket = bucket || this.getChatStreamBucket(this.chatConversationId);
      if (!bucket || !bucket.streaming || bucket.workingStartedAt == null) return;
      var sec = Math.floor((Date.now() - bucket.workingStartedAt) / 1000);
      var panels = bucket.workPanels || [];
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
      bucket.uiTick = Date.now();
      if (this.chatConversationId === bucket.convId) this.chatUiTick = bucket.uiTick;
    },

    /** Drop playful “waiting” lines once assistant text, tools, or stderr appear (any panel). */
    clearAllWorkPanelWaitingSlots(bucket) {
      bucket = bucket || this.getChatStreamBucket(this.chatConversationId);
      if (!bucket) return;
      var panels = bucket.workPanels || [];
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
        bucket.uiTick = Date.now();
        if (this.chatConversationId === bucket.convId) this.chatUiTick = bucket.uiTick;
        this.scrollChatToBottom({ suppressNewRepliesPill: true });
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

    finalizeChatWorkPanels(bucket) {
      bucket = bucket || this.getChatStreamBucket(this.chatConversationId);
      if (!bucket) return;
      var now = Date.now();
      (bucket.workPanels || []).forEach(function(p) {
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
      return this.fileApiPath(this.viewerPath.dir, this.viewerPath.name);
    },

    _clearChatElapsedTimer(bucket) {
      var t = bucket ? bucket.elapsedTimer : this._chatElapsedTimer;
      if (t) {
        clearInterval(t);
        if (bucket) bucket.elapsedTimer = null;
        else this._chatElapsedTimer = null;
      }
    },

    /**
     * Scroll the chat transcript to the newest content. By default this only
     * follows when the user was already pinned near the bottom so that
     * stream-driven appends do not yank them away from earlier messages they
     * are reading. The "New replies below" affordance is only for assistant
     * *message* growth (or full reload after a turn), not for work/activity
     * UI — use `suppressNewRepliesPill: true` for the latter. Pass
     * `{ force: true }` for user-initiated actions (send, jump-to-latest, open
     * conversation, expand panel) that should always land on the latest content.
     *
     * The pinned state is tracked by a scroll listener on each container
     * (see `handleChatScroll`) rather than re-checked at call-time, because
     * Alpine re-renders between the caller and `$nextTick` would otherwise
     * make freshly-appended content look like an upward scroll.
     *
     * @param {{ force?: boolean, suppressNewRepliesPill?: boolean }} [opts]
     * `suppressNewRepliesPill` — for non-reply height changes (work panels, tool
     * lines, waiting); do not show "New replies below" for these.
     */
    scrollChatToBottom(opts) {
      var force = !!(opts && opts.force);
      var suppressPill = !!(opts && opts.suppressNewRepliesPill);
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
        } else if (anyUnpinnedVisible && !suppressPill) {
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
      this.maybeNotifyChatCompleteForBucket(this.getChatStreamBucket(this.chatConversationId));
    },

    /** @param {any} bucket */
    maybeNotifyChatCompleteForBucket(bucket) {
      try {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        if (!document.hidden) return;
        if (!bucket || !bucket.messages) return;
        var assistants = bucket.messages.filter(function(m) { return m.role === 'assistant'; });
        var last = assistants[assistants.length - 1];
        var preview = (last && last.content) ? String(last.content).replace(/\s+/g, ' ').trim().slice(0, 120) : 'Reply ready';
        var slug = bucket.chatAgent != null ? this.normalizeChatAgentId(bucket.chatAgent) : this.chatAgent;
        new Notification(this.chatAgentDisplayName(slug) + ' — Cyrus', { body: preview });
      } catch (_) {}
    },

    async loadConversationList() {
      try {
        var r = await fetchWithAuth('/api/chat/conversations');
        if (!r.ok) return;
        var d = await r.json();
        this.chatConversations = d.conversations || [];
        if (Number.isFinite(d.maxPins) && d.maxPins > 0) this.chatMaxPins = d.maxPins;
        var self = this;
        (this.chatConversations || []).forEach(function (c) {
          if (c && c.active && c.id) self.ensureBackgroundStreamAttach(String(c.id));
        });
        // Pinned strip + history modal use dynamic :data-lucide icon names;
        // lucide doesn't repaint until we ask it to.
        this.$nextTick(function () { self.refreshIcons(); });
      } catch (_) {}
    },

    chatWindowObscured() {
      try {
        if (document.hidden) return true;
        if (typeof document.hasFocus === 'function' && !document.hasFocus()) return true;
        return false;
      } catch (_) {
        return false;
      }
    },

    /** @param {string} convId */
    isConversationPinned(convId) {
      if (!convId) return false;
      var id = String(convId);
      var list = this.chatConversations || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id) === id && list[i].pinned) return true;
      }
      return false;
    },

    /**
     * @param {string} convId
     * @param {boolean} on
     */
    setChatPinnedUnread(convId, on) {
      if (!convId) return;
      var key = String(convId);
      var next = Object.assign({}, this.chatPinnedUnread || {});
      if (on) next[key] = true;
      else delete next[key];
      this.chatPinnedUnread = next;
    },

    /**
     * Assistant text arrived on the SSE stream: mark pinned conv if the user is not
     * looking at it (other tab/chat) or the page is in the background.
     */
    maybeMarkPinnedUnreadForStreamAssistantText(convId) {
      if (!this.isConversationPinned(convId)) return;
      if (this.chatConversationId === convId && !this.chatWindowObscured()) return;
      this.setChatPinnedUnread(convId, true);
    },

    clearChatPinnedUnreadIfViewingAndFocused() {
      var id = this.chatConversationId;
      if (!id) return;
      if (this.chatWindowObscured()) return;
      this.setChatPinnedUnread(id, false);
    },

    /** Pinned conversations ordered as the server returned them (pinnedAt desc, newest-pin first). */
    pinnedChatConversations() {
      var list = this.chatConversations || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].pinned) out.push(list[i]);
      }
      return out;
    },

    /**
     * True iff the currently open chat is pinned. Drives the chat-header pin
     * toggle so users can (un)pin without opening the history modal.
     */
    currentChatPinned() {
      var id = this.chatConversationId;
      if (!id) return false;
      var list = this.chatConversations || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) return !!list[i].pinned;
      }
      return false;
    },

    /** True iff the tenant is already at the pin cap and `id` is not already one of them. */
    pinLimitReachedFor(id) {
      var pinned = this.pinnedChatConversations();
      if (pinned.length < (this.chatMaxPins || 5)) return false;
      for (var i = 0; i < pinned.length; i++) {
        if (pinned[i].id === id) return false;
      }
      return true;
    },

    /**
     * Briefly show the pin-cap message via a dedicated top-center banner at
     * z-[120] so it floats above the Conversations modal (z-[70]) and any
     * other overlay, instead of being painted under them like the shared
     * upload-toast stack at z-[60].
     */
    showPinLimitHint() {
      this.chatPinLimitHintVisible = true;
      var self = this;
      if (this._pinHintTimer) clearTimeout(this._pinHintTimer);
      this._pinHintTimer = setTimeout(function () {
        self.chatPinLimitHintVisible = false;
        self._pinHintTimer = null;
      }, 4000);
    },

    dismissPinLimitHint() {
      this.chatPinLimitHintVisible = false;
      if (this._pinHintTimer) {
        clearTimeout(this._pinHintTimer);
        this._pinHintTimer = null;
      }
    },

    /**
     * Flip pin state on a conversation. Optimistically updates the local copy
     * so the stacked strip reorders immediately, then reconciles on the
     * response. Called from both the history modal and the strip itself.
     */
    async togglePinConversation(id, ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (!id) return;
      var list = this.chatConversations || [];
      var row = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) { row = list[i]; break; }
      }
      var nextPinned = !(row && row.pinned);
      if (nextPinned && this.pinLimitReachedFor(id)) {
        this.showPinLimitHint();
        return;
      }
      this.chatPinPending = Object.assign({}, this.chatPinPending, (function () { var o = {}; o[id] = true; return o; })());
      try {
        var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(id) + '/pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned: nextPinned }),
        });
        if (!r.ok) {
          var msg = 'Could not update pin';
          var serverMaxPins = null;
          try {
            var ej = await r.json();
            if (ej && ej.error) msg = ej.error;
            if (ej && Number.isFinite(ej.maxPins) && ej.maxPins > 0) serverMaxPins = ej.maxPins;
          } catch (_) {}
          if (r.status === 400 && serverMaxPins) {
            this.chatMaxPins = serverMaxPins;
            this.showPinLimitHint();
          } else {
            this.uploadToast = msg;
            this.uploadToastClass = 'bg-red-700';
            var self2 = this;
            setTimeout(function () { self2.uploadToast = ''; }, 4000);
          }
          return;
        }
        if (!nextPinned) this.setChatPinnedUnread(id, false);
        await this.loadConversationList();
        var self = this;
        this.$nextTick(function () { self.refreshIcons(); });
      } catch (e) {
        console.warn('[chat] togglePin', e && e.message ? e.message : e);
      } finally {
        var copy = Object.assign({}, this.chatPinPending);
        delete copy[id];
        this.chatPinPending = copy;
      }
    },

    /** @param {string} convId */
    getChatStreamBucket(convId) {
      if (!convId) return null;
      return this.chatStreams[convId] || null;
    },

    /** @param {string} convId */
    ensureChatStreamBucket(convId) {
      if (!convId) return null;
      if (this.chatStreams[convId]) return this.chatStreams[convId];
      var b = {
        convId: convId,
        messages: [],
        streaming: false,
        streamDraft: '',
        abortController: null,
        workPanels: [],
        workingStartedAt: null,
        uiTick: 0,
        elapsedTimer: null,
        outboundQueue: [],
        outboundInFlight: false,
        planTodos: [],
        planMarkdown: '',
        planAwaitingExecute: false,
        planInboxFile: null,
        sdkUsageSessionTotals: null,
        workspaceTouches: [],
        retryPrompt: '',
        showNewRepliesButton: false,
        pinnedDesktop: true,
        pinnedMobile: true,
        lastEventSeq: 0,
        streamReaderPromise: null,
        chatAgent: '',
        // Per-conversation composer draft so users can simultaneously prep
        // messages for multiple chats and switch between them without losing
        // text. Persisted to localStorage by `persistChatDraftToStorage`.
        prompt: '',
      };
      this.chatStreams[convId] = b;
      return b;
    },

    /** Copy root chat UI state into a bucket (before switching away from this conversation). */
    snapshotRootChatIntoBucket(convId) {
      if (!convId) return;
      var b = this.ensureChatStreamBucket(convId);
      b.messages = this.chatMessages;
      b.streaming = this.chatStreaming;
      b.streamDraft = this.chatStreamDraft;
      b.abortController = this.chatAbortController;
      b.workPanels = this.chatWorkPanels;
      b.workingStartedAt = this.chatWorkingStartedAt;
      b.uiTick = this.chatUiTick;
      b.elapsedTimer = this._chatElapsedTimer;
      b.outboundQueue = this.chatOutboundQueue;
      b.outboundInFlight = this.chatOutboundInFlight;
      b.planTodos = this.chatPlanTodos;
      b.planMarkdown = this.chatPlanMarkdown;
      b.planAwaitingExecute = this.chatPlanAwaitingExecute;
      b.planInboxFile = this.chatPlanInboxFile;
      b.sdkUsageSessionTotals = this.chatSdkUsageSessionTotals;
      b.workspaceTouches = this.chatWorkspaceTouches;
      b.retryPrompt = this.chatRetryPrompt;
      b.showNewRepliesButton = this.chatShowNewRepliesButton;
      b.pinnedDesktop = this._chatPinnedDesktop;
      b.pinnedMobile = this._chatPinnedMobile;
      b.prompt = this.chatPrompt || '';
    },

    /** Point root fields at the given bucket (same object refs as the bucket). */
    restoreRootFromChatBucket(convId) {
      var b = convId ? this.getChatStreamBucket(convId) : null;
      if (!b) {
        this.chatMessages = [];
        this.chatStreaming = false;
        this.chatStreamDraft = '';
        this.chatAbortController = null;
        this.chatWorkPanels = [];
        this.chatWorkingStartedAt = null;
        this.chatUiTick = 0;
        this._chatElapsedTimer = null;
        this.chatOutboundQueue = [];
        this.chatOutboundInFlight = false;
        this.chatPlanTodos = [];
        this.chatPlanMarkdown = '';
        this.chatPlanAwaitingExecute = false;
        this.chatPlanInboxFile = null;
        this.chatSdkUsageSessionTotals = null;
        this.chatWorkspaceTouches = [];
        this.chatRetryPrompt = '';
        this.chatShowNewRepliesButton = false;
        this._chatPinnedDesktop = true;
        this._chatPinnedMobile = true;
        this.chatPrompt = this._chatDraftPromptNoConv || '';
        return;
      }
      this.chatMessages = b.messages;
      this.chatStreaming = b.streaming;
      this.chatStreamDraft = b.streamDraft;
      this.chatAbortController = b.abortController;
      this.chatWorkPanels = b.workPanels;
      this.chatWorkingStartedAt = b.workingStartedAt;
      this.chatUiTick = b.uiTick;
      this._chatElapsedTimer = b.elapsedTimer;
      this.chatOutboundQueue = b.outboundQueue;
      this.chatOutboundInFlight = b.outboundInFlight;
      this.chatPlanTodos = b.planTodos;
      this.chatPlanMarkdown = b.planMarkdown;
      this.chatPlanAwaitingExecute = b.planAwaitingExecute;
      this.chatPlanInboxFile = b.planInboxFile;
      this.chatSdkUsageSessionTotals = b.sdkUsageSessionTotals;
      this.chatWorkspaceTouches = b.workspaceTouches;
      this.chatRetryPrompt = b.retryPrompt;
      this.chatShowNewRepliesButton = b.showNewRepliesButton;
      this._chatPinnedDesktop = b.pinnedDesktop;
      this._chatPinnedMobile = b.pinnedMobile;
      this.chatPrompt = b.prompt || '';
    },

    /** localStorage key for the per-conversation composer draft. */
    chatDraftStorageKey(convId) {
      return 'brain_chat_draft:' + (convId ? String(convId) : '__new__');
    },

    /** Persist the current `chatPrompt` to localStorage under the active conv's key. */
    persistChatDraftToStorage() {
      try {
        var key = this.chatDraftStorageKey(this.chatConversationId);
        var v = this.chatPrompt;
        if (typeof v === 'string' && v.length > 0) {
          localStorage.setItem(key, v);
        } else {
          localStorage.removeItem(key);
        }
      } catch (_) {}
    },

    /** Remove the saved draft for `convId` (or the no-conversation draft when null). */
    removeChatDraftFromStorage(convId) {
      try {
        localStorage.removeItem(this.chatDraftStorageKey(convId));
      } catch (_) {}
    },

    /**
     * Pull saved drafts off localStorage into the in-memory buckets so a refresh
     * restores the composer text for every chat. Stale entries (drafts for
     * conversations that no longer exist) are pruned to avoid unbounded growth.
     */
    hydrateChatDraftsFromStorage() {
      var knownIds = {};
      (this.chatConversations || []).forEach(function (c) {
        if (c && c.id != null) knownIds[String(c.id)] = true;
      });
      var prefix = 'brain_chat_draft:';
      var stale = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!k || k.indexOf(prefix) !== 0) continue;
          var convKey = k.substring(prefix.length);
          if (convKey !== '__new__' && !knownIds[convKey]) {
            stale.push(k);
            continue;
          }
          var val = localStorage.getItem(k);
          if (typeof val !== 'string' || !val) continue;
          if (convKey === '__new__') {
            this._chatDraftPromptNoConv = val;
          } else {
            var b = this.ensureChatStreamBucket(convKey);
            b.prompt = val;
          }
        }
      } catch (_) {}
      stale.forEach(function (k) {
        try { localStorage.removeItem(k); } catch (_) {}
      });
    },

    /**
     * Switch active conversation: persist previous bucket, load new session into root (or draft).
     * Does not abort in-flight streams on other conversations.
     * @param {string | null} newConvId
     * @param {object | null} sess optional pre-fetched session (same shape as GET /api/chat/conversations/:id)
     */
    async swapActiveChatConversation(newConvId, sess) {
      var prev = this.chatConversationId;
      if (prev) this.snapshotRootChatIntoBucket(prev);

      this.chatConversationId = newConvId;
      if (newConvId) this.setChatPinnedUnread(newConvId, false);
      if (!newConvId) {
        this.restoreRootFromChatBucket(null);
        return;
      }

      if (!sess) {
        var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(newConvId));
        if (!r.ok) return;
        sess = await r.json();
      }

      this.chatTitleEditing = false;
      this.chatTitleDraft = '';
      this.chatAgent = this.normalizeChatAgentId(sess.agent);
      if (sess.model) this.chatModel = this.ensureChatModelFromCatalog(sess.model);
      this.chatSessionTitle = sess.title || 'Chat';
      try { localStorage.setItem('brain_last_chat_id', newConvId); } catch (_) {}

      var b = this.ensureChatStreamBucket(newConvId);
      if (!b.streaming) {
        b.messages = sess.messages || [];
        b.sdkUsageSessionTotals = sess.sdkUsageSessionTotals || null;
        this.hydrateChatPlanFromSessionIntoBucket(b, sess);
        this.hydrateChatWorkspaceTouchesIntoBucket(b, sess);
      } else if (!b.messages || !b.messages.length) {
        b.messages = sess.messages || [];
        b.sdkUsageSessionTotals = sess.sdkUsageSessionTotals || null;
        this.hydrateChatPlanFromSessionIntoBucket(b, sess);
        this.hydrateChatWorkspaceTouchesIntoBucket(b, sess);
      }
      this.restoreRootFromChatBucket(newConvId);
      b.chatAgent = sess.agent != null ? String(sess.agent) : this.chatAgent;
      if (sess.active) {
        this.ensureBackgroundStreamAttach(newConvId);
      }
    },

    hydrateChatPlanFromSessionIntoBucket(bucket, sess) {
      if (!bucket || !sess) return;
      var pending = sess.planExecutePending === true;
      bucket.planAwaitingExecute = pending;
      if (!pending) {
        bucket.planTodos = [];
        bucket.planMarkdown = '';
        bucket.planInboxFile = null;
        return;
      }
      bucket.planTodos = Array.isArray(sess.planTodos)
        ? sess.planTodos.map(function (t) {
            return {
              id: t.id != null ? String(t.id) : '',
              title: t.title != null ? String(t.title) : '',
              status: t.status || 'pending',
            };
          })
        : [];
      bucket.planMarkdown = sess.planMarkdown ? String(sess.planMarkdown) : '';
      bucket.planInboxFile =
        sess.planInboxFile && sess.planInboxFile.dir && sess.planInboxFile.name
          ? { dir: String(sess.planInboxFile.dir), name: String(sess.planInboxFile.name) }
          : null;
    },

    hydrateChatWorkspaceTouchesIntoBucket(bucket, sess) {
      if (!bucket) return;
      var raw = sess && Array.isArray(sess.workspaceTouches) ? sess.workspaceTouches : [];
      bucket.workspaceTouches = raw
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

    /** @param {string} convId */
    ensureBackgroundStreamAttach(convId) {
      if (!convId) return;
      var b = this.ensureChatStreamBucket(convId);
      if (b.streamReaderPromise) return;
      if (b.streaming) return;
      var self = this;
      b.streamReaderPromise = this.readChatSseStream(convId, {
        fromSeq: b.lastEventSeq || 0,
      }).finally(function() {
        var cur = self.getChatStreamBucket(convId);
        if (cur) cur.streamReaderPromise = null;
      });
    },

    /** @param {string} convId */
    detachChatStreamReader(convId) {
      var b = this.getChatStreamBucket(convId);
      if (!b || !b.abortController) return;
      try {
        b.abortController.abort();
      } catch (_) {}
      if (this.chatConversationId === convId) {
        this.chatAbortController = null;
      }
      b.abortController = null;
    },

    /**
     * Read SSE for one conversation: either `reader` from POST /api/chat body, or GET .../stream.
     * @param {string} convId
     * @param {{ reader?: ReadableStreamDefaultReader<Uint8Array>, fromSeq?: number, externalSignal?: AbortSignal }} opts
     */
    async readChatSseStream(convId, opts) {
      var self = this;
      opts = opts || {};
      var bucket = this.ensureChatStreamBucket(convId);
      var streamOk = false;
      var reader = opts.reader || null;
      var releaseAbort = false;
      if (!reader) {
        this.detachChatStreamReader(convId);
        bucket.abortController = new AbortController();
        releaseAbort = true;
        if (this.chatConversationId === convId) this.chatAbortController = bucket.abortController;
        var fromSeq = opts.fromSeq != null ? Number(opts.fromSeq) || 0 : 0;
        var sig = opts.externalSignal || bucket.abortController.signal;
        bucket.streaming = true;
        if (this.chatConversationId === convId) this.chatStreaming = true;
        var url =
          '/api/chat/conversations/' + encodeURIComponent(convId) + '/stream?fromSeq=' + encodeURIComponent(String(fromSeq));
        var res = await fetchWithAuth(url, { method: 'GET', signal: sig });
        if (!res.ok || !res.body) {
          bucket.streaming = false;
          if (this.chatConversationId === convId) this.chatStreaming = false;
          if (releaseAbort && bucket.abortController) {
            bucket.abortController = null;
            if (this.chatConversationId === convId) this.chatAbortController = null;
          }
          return;
        }
        reader = res.body.getReader();
      }
      var decoder = new TextDecoder();
      var buf = '';
      try {
        while (true) {
          var result = await reader.read();
          if (result.done) break;
          buf += decoder.decode(result.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          var hadAssistantStreamText = false;
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line.startsWith('data: ')) continue;
            var payload = line.slice(6).trim();
            if (payload === '[DONE]') {
              streamOk = true;
              break;
            }
            try {
              var msg = JSON.parse(payload);
              if (msg.seq != null && typeof msg.seq === 'number') bucket.lastEventSeq = msg.seq;
              if (msg.noActiveRun) {
                streamOk = true;
                break;
              }
              if (msg.bufferTruncated) {
                try {
                  console.warn('[chat] stream buffer truncated', msg.message || '');
                } catch (_) {}
              }
              if (msg.done) {
                streamOk = true;
                break;
              }
              if (msg.segmentAgent) {
                self.applySegmentAgentFromStream(msg.segmentAgent, bucket);
              }
              if (msg.segmentAgentStart) {
                self.applySegmentAgentStartFromStream(msg.segmentAgentStart, bucket);
              }
              if (msg.segmentAgentEnd) {
                self.applySegmentAgentEndFromStream(msg.segmentAgentEnd, bucket);
              }
              if (msg.status === 'started') {
                self.appendChatWaitingStatusLine(pickChatWorkStartedLine(), bucket);
              }
              if (msg.text) {
                hadAssistantStreamText = true;
                self.clearAllWorkPanelWaitingSlots(bucket);
                bucket.streamDraft = appendAssistantStreamChunk(bucket.streamDraft || '', msg.text);
                if (self.chatConversationId === convId) self.chatStreamDraft = bucket.streamDraft;
              }
              if (msg.error) {
                self.clearAllWorkPanelWaitingSlots(bucket);
                self.appendWorkLineToCurrentPanel('[stderr] ' + String(msg.error).trim().slice(0, 500), 'e', bucket);
              }
              if (msg.tool) {
                self.clearAllWorkPanelWaitingSlots(bucket);
                var td = msg.toolDetail ? String(msg.toolDetail).trim().slice(0, 240) : '';
                self.appendWorkLineToCurrentPanel(td ? msg.tool + ': ' + td : String(msg.tool), 'tool', bucket);
              }
              if (msg.sdkUsageSessionTotals != null) {
                bucket.sdkUsageSessionTotals = msg.sdkUsageSessionTotals;
                if (self.chatConversationId === convId) self.chatSdkUsageSessionTotals = bucket.sdkUsageSessionTotals;
              }
              if (msg.phase === 'plan') {
                if (Array.isArray(msg.planTodos)) {
                  bucket.planTodos = msg.planTodos.map(function (t) {
                    return {
                      id: t.id != null ? String(t.id) : '',
                      title: t.title != null ? String(t.title) : '',
                      status: t.status || 'pending',
                    };
                  });
                  if (self.chatConversationId === convId) self.chatPlanTodos = bucket.planTodos;
                }
                if (msg.planMarkdown != null) {
                  bucket.planMarkdown = String(msg.planMarkdown);
                  if (self.chatConversationId === convId) self.chatPlanMarkdown = bucket.planMarkdown;
                }
                bucket.planAwaitingExecute = !!(bucket.planTodos && bucket.planTodos.length);
                if (self.chatConversationId === convId) self.chatPlanAwaitingExecute = bucket.planAwaitingExecute;
                if (msg.planInboxFile && msg.planInboxFile.dir && msg.planInboxFile.name) {
                  bucket.planInboxFile = {
                    dir: String(msg.planInboxFile.dir),
                    name: String(msg.planInboxFile.name),
                  };
                  if (self.chatConversationId === convId) {
                    self.chatPlanInboxFile = bucket.planInboxFile;
                    self.navigateToOwnersInboxPlan(self.chatPlanInboxFile);
                  }
                } else {
                  bucket.planInboxFile = null;
                  if (self.chatConversationId === convId) self.chatPlanInboxFile = null;
                }
              }
              if (msg.phase === 'execute') {
                bucket.planAwaitingExecute = false;
                if (self.chatConversationId === convId) self.chatPlanAwaitingExecute = false;
              }
              if (msg.phase === 'plan' || msg.phase === 'execute') {
                self.$nextTick(function() {
                  self.refreshIcons();
                });
              }
            } catch (_) {}
          }
          if (hadAssistantStreamText) {
            self.maybeMarkPinnedUnreadForStreamAssistantText(convId);
          }
          if (self.chatConversationId === convId) {
            self.scrollChatToBottom({ suppressNewRepliesPill: !hadAssistantStreamText });
          }
          if (streamOk) break;
        }
        bucket.streamDraft = '';
        if (self.chatConversationId === convId) self.chatStreamDraft = '';
        await self.refreshChatSessionForConv(convId);
        await self.loadConversationList();
        if (streamOk) {
          self.maybeNotifyChatCompleteForBucket(bucket);
          try {
            delete self.cache.usage;
          } catch (_) {}
          if (self.page === 'home') await self.refreshHomeUsageFooter();
        }
      } catch (err) {
        bucket.streamDraft = '';
        if (self.chatConversationId === convId) self.chatStreamDraft = '';
        await self.refreshChatSessionForConv(convId);
        await self.loadConversationList();
        if (!(err && err.name === 'AbortError')) {
          try {
            delete self.cache.usage;
          } catch (_) {}
          if (self.page === 'home') await self.refreshHomeUsageFooter();
        }
      } finally {
        if (releaseAbort && bucket.abortController) {
          bucket.abortController = null;
          if (self.chatConversationId === convId) self.chatAbortController = null;
        }
        bucket.streaming = false;
        if (self.chatConversationId === convId) self.chatStreaming = false;
        self._clearChatElapsedTimer(bucket);
        bucket.workingStartedAt = null;
        if (self.chatConversationId === convId) self.chatWorkingStartedAt = null;
        self.finalizeChatWorkPanels(bucket);
        if (self.chatConversationId === convId) {
          self.scrollChatToBottom();
        }
        self.$nextTick(function() {
          self.refreshIcons();
        });
      }
    },

    /** Reload one conversation from GET (updates bucket + root if active). */
    async refreshChatSessionForConv(convId) {
      if (!convId) return;
      var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(convId));
      if (!r.ok) return;
      var sess = await r.json();
      var b = this.getChatStreamBucket(convId);
      if (b) {
        b.messages = sess.messages || [];
        b.sdkUsageSessionTotals = sess.sdkUsageSessionTotals || null;
        this.hydrateChatPlanFromSessionIntoBucket(b, sess);
        this.hydrateChatWorkspaceTouchesIntoBucket(b, sess);
        b.chatAgent = sess.agent != null ? String(sess.agent) : b.chatAgent;
      }
      if (this.chatConversationId === convId) {
        this.chatMessages = sess.messages || [];
        this.chatSdkUsageSessionTotals = sess.sdkUsageSessionTotals || null;
        this.chatSessionTitle = sess.title || 'Chat';
        if (sess.model) this.chatModel = this.ensureChatModelFromCatalog(sess.model);
        this.hydrateChatPlanFromSession(sess);
        this.hydrateChatWorkspaceTouches(sess);
      }
      if (sess.active) this.ensureBackgroundStreamAttach(convId);
    },

    currentChatOutboundBusy() {
      var b = this.getChatStreamBucket(this.chatConversationId);
      if (b) return !!(b.streaming || b.outboundInFlight);
      return !!(this.chatStreaming || this.chatOutboundInFlight);
    },

    /** Local-only chat shell: no server session until the user sends a message. */
    enterDraftChatState() {
      if (this.chatConversationId) this.snapshotRootChatIntoBucket(this.chatConversationId);
      this.chatConversationId = null;
      this.restoreRootFromChatBucket(null);
      this.chatTitleEditing = false;
      this.chatTitleDraft = '';
      this.chatSessionTitle = 'New chat';
      this.chatStreaming = false;
      this.chatStreamDraft = '';
      this.chatAbortController = null;
      this.chatWorkingStartedAt = null;
      this._clearChatElapsedTimer();
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
      // We're transitioning out of the no-conversation draft state into a real
      // conversation. The old "__new__" composer draft has been consumed (by
      // the caller, typically `submitChat`), so wipe it from memory + storage
      // to avoid resurfacing the same text on a future refresh.
      if (this.chatConversationId == null) {
        this._chatDraftPromptNoConv = '';
        this.removeChatDraftFromStorage(null);
      }
      if (this.chatConversationId) this.snapshotRootChatIntoBucket(this.chatConversationId);
      var nb = this.ensureChatStreamBucket(d.id);
      nb.messages = [];
      nb.sdkUsageSessionTotals = null;
      nb.workPanels = [];
      nb.streaming = false;
      nb.streamDraft = '';
      nb.abortController = null;
      nb.workingStartedAt = null;
      nb.elapsedTimer = null;
      nb.outboundQueue = [];
      nb.outboundInFlight = false;
      nb.planTodos = [];
      nb.planMarkdown = '';
      nb.planAwaitingExecute = false;
      nb.planInboxFile = null;
      nb.workspaceTouches = [];
      nb.retryPrompt = '';
      nb.showNewRepliesButton = false;
      nb.pinnedDesktop = true;
      nb.pinnedMobile = true;
      nb.lastEventSeq = 0;
      nb.chatAgent = agent;
      this.chatTitleEditing = false;
      this.chatTitleDraft = '';
      this.chatConversationId = d.id;
      this.restoreRootFromChatBucket(d.id);
      this.chatSessionTitle = 'New chat';
      this.resetChatPlanUiForNewShell();
      try { localStorage.setItem('brain_last_chat_id', d.id); } catch (_) {}
      await this.loadConversationList();
    },

    async bootstrapChat() {
      await this.loadConversationList();
      // Pull any saved per-chat composer drafts into the in-memory buckets
      // before we restore the active conversation, so `restoreRootFromChatBucket`
      // picks up the right draft text.
      this.hydrateChatDraftsFromStorage();
      var last = null;
      try { last = localStorage.getItem('brain_last_chat_id'); } catch (_) {}
      if (last) {
        var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(last));
        if (r.ok) {
          var sess = await r.json();
          await this.swapActiveChatConversation(String(sess.id), sess);
          var bb = this.getChatStreamBucket(String(sess.id));
          if (bb) {
            bb.outboundQueue = [];
            bb.outboundInFlight = false;
          }
          this.chatOutboundQueue = bb ? bb.outboundQueue : [];
          this.chatOutboundInFlight = false;
          this.hydrateChatPlanFromSession(sess);
          this.hydrateChatWorkspaceTouches(sess);
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
      await this.swapActiveChatConversation(String(sess.id), sess);
      this.hydrateChatPlanFromSession(sess);
      this.hydrateChatWorkspaceTouches(sess);
      this.chatHistoryOpen = false;
      this.chatShowNewRepliesButton = false;
      await this.loadConversationList();
      this.$nextTick(function() { this.scrollChatToBottom({ force: true }); this.refreshIcons(); }.bind(this));
    },

    async refreshActiveConversation() {
      if (!this.chatConversationId) return;
      var r = await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(this.chatConversationId));
      if (!r.ok) return;
      var sess = await r.json();
      var b = this.getChatStreamBucket(this.chatConversationId);
      if (b) {
        b.messages = sess.messages || [];
        b.sdkUsageSessionTotals = sess.sdkUsageSessionTotals || null;
        this.hydrateChatPlanFromSessionIntoBucket(b, sess);
        this.hydrateChatWorkspaceTouchesIntoBucket(b, sess);
      }
      this.chatMessages = sess.messages || [];
      this.chatSdkUsageSessionTotals = sess.sdkUsageSessionTotals || null;
      this.chatSessionTitle = sess.title || 'Chat';
      if (sess.model) this.chatModel = this.ensureChatModelFromCatalog(sess.model);
      this.hydrateChatPlanFromSession(sess);
      this.hydrateChatWorkspaceTouches(sess);
      if (sess.active) this.ensureBackgroundStreamAttach(this.chatConversationId);
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
      return !this.chatConversationId || this.currentChatOutboundBusy();
    },

    chatUserMessageEditDisabled(m) {
      if (!m || m.role !== 'user') return true;
      if (!this.chatConversationId || this.currentChatOutboundBusy()) return true;
      var b = this.getChatStreamBucket(this.chatConversationId);
      if (b && b.outboundQueue && b.outboundQueue.length) return true;
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
          var bEd = this.ensureChatStreamBucket(this.chatConversationId);
          bEd.outboundInFlight = true;
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
          var bFork = this.ensureChatStreamBucket(this.chatConversationId);
          bFork.outboundInFlight = true;
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
          var delId = this.chatConversationId;
          this.detachChatStreamReader(String(delId));
          try {
            await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(delId), {
              method: 'DELETE',
            });
          } catch (_) {}
          try {
            delete this.chatStreams[String(delId)];
          } catch (_) {}
          this.removeChatDraftFromStorage(delId);
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
        this.detachChatStreamReader(String(old));
        try {
          await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(old), { method: 'DELETE' });
        } catch (_) {}
        try {
          delete this.chatStreams[String(old)];
        } catch (_) {}
        this.removeChatDraftFromStorage(old);
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
        this.detachChatStreamReader(String(id));
        try {
          delete this.chatStreams[String(id)];
        } catch (_) {}
        this.removeChatDraftFromStorage(id);
        if (this.chatConversationId === id) this.enterDraftChatState();
        await this.loadConversationList();
      } catch (_) {}
    },

    retryLastChat() {
      var prompt = this.chatRetryPrompt;
      if (!prompt) {
        for (var i = this.chatMessages.length - 1; i >= 0; i--) {
          var m = this.chatMessages[i];
          if (m && m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
            prompt = m.content;
            break;
          }
        }
      }
      if (!prompt) return;
      var last = this.chatMessages[this.chatMessages.length - 1];
      if (last && last.role === 'assistant' && last.error) this.chatMessages.pop();
      this.chatPrompt = prompt;
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
      // Expand the section and any intermediate folders
      var self = this;
      this.fileSections.forEach(function(sec) { if (sec.dir === dir) sec.open = true; });
      var parts = String(name || '').split('/');
      if (parts.length > 1) {
        for (var i = 1; i < parts.length; i++) {
          var folderKey = dir + ':' + parts.slice(0, i).join('/');
          self._folderOpenState[folderKey] = true;
        }
      }
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
          this.refreshChatCreditLimit().catch(function () {});
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
          // Keep the credit-limit cards on this page in sync with the server.
          // Repaint lucide icons once the "Over limit" badge lands in the DOM.
          var selfU = this;
          this.refreshChatCreditLimit()
            .catch(function () {})
            .then(function () { selfU.$nextTick(function () { selfU.refreshIcons(); }); });
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
        if (!force && this.cache.home && (now - this.cache.home.ts < STALE_MS)) {
          this.refreshChatCreditLimit().catch(function () {});
          return;
        }
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
          // Credit-limit snapshot powers the "Today $X / $Y" footer on home and
          // the progress cards on /usage. Fire-and-forget so a failure doesn't
          // block the rest of the page from rendering.
          this.refreshChatCreditLimit().catch(function () {});
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
      this.filesLoadError = null;
      // Only the initial load replaces the list with a skeleton; background refreshes keep the list
      // so folder expand state and scroll position stay intact.
      var showListSkeleton = !this.pageReady.files;
      if (showListSkeleton) this.filesLoading = true;
      var scrollEl = this.$refs.filesListScroll;
      var savedScroll = scrollEl && typeof scrollEl.scrollTop === 'number' ? scrollEl.scrollTop : 0;
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
        this.$nextTick(function() {
          // Only re-apply when the list was unmounted (initial load); on background refresh the
          // list stayed mounted, so restoring would overwrite any scroll during the request.
          if (showListSkeleton && scrollEl && scrollEl.isConnected) scrollEl.scrollTop = savedScroll;
          self.refreshIcons();
        });
      }
    },

    rebuildFileSections() {
      var LABELS = { 'owners-inbox': 'Owners Inbox', 'team-inbox': 'Team Inbox', 'team': 'Team', 'docs': 'Docs' };
      var data = this.filesData;
      var openByDir = Object.create(null);
      (this.fileSections || []).forEach(function(sec) {
        if (sec && sec.dir != null) openByDir[sec.dir] = sec.open;
      });
      this.fileSections = [];
      var self = this;
      // Root-level files: rendered loose (no section header) at the top of the unified tree.
      if (data.root && data.root.length) {
        this.fileSections.push({ dir: 'root', label: 'Root', entries: data.root, open: true, loose: true });
      }
      ['owners-inbox', 'team-inbox', 'team', 'docs'].forEach(function(dir) {
        if (!Object.prototype.hasOwnProperty.call(data, dir)) return;
        var hasOpen = Object.prototype.hasOwnProperty.call(openByDir, dir);
        self.fileSections.push({
          dir: dir,
          label: LABELS[dir] || dir,
          entries: data[dir],
          // Default Owners Inbox open on first load; preserve user toggles otherwise.
          open: hasOpen ? openByDir[dir] === true : (dir === 'owners-inbox'),
        });
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
      return !!(String(this.filesFilterCreator || '').trim() || String(this.filesFilterDomain || '').trim() || String(this.filesSearchQuery || '').trim());
    },

    filesSearchActive() {
      return !!String(this.filesSearchQuery || '').trim();
    },

    /** Recursively collect all file entries from a nested entries array. */
    _collectAllFiles(entries, relPrefix) {
      var results = [];
      (entries || []).forEach(function(e) {
        var relPath = relPrefix ? relPrefix + '/' + e.name : e.name;
        if (e.isDir) {
          var nested = this._collectAllFiles(e.children || [], relPath);
          for (var i = 0; i < nested.length; i++) results.push(nested[i]);
        } else {
          results.push({ name: e.name, relPath: relPath, size: e.size, modified: e.modified, createdBy: e.createdBy || '', domain: e.domain || '', category: e.category || '', isDir: false });
        }
      }.bind(this));
      return results;
    },

    /** Count files that pass creator/domain filters, recursively. */
    _countFilesInEntries(entries, c, d) {
      var n = 0;
      (entries || []).forEach(function(e) {
        if (e.isDir) {
          n += this._countFilesInEntries(e.children || [], c, d);
        } else {
          if (c && String(e.createdBy || '').trim().toLowerCase() !== c) return;
          if (d && String(e.domain || '').trim().toLowerCase() !== d) return;
          n++;
        }
      }.bind(this));
      return n;
    },

    fileFilterCreatorOptions() {
      var s = new Set();
      this.fileSections.forEach(function(sec) {
        this._collectAllFiles(sec.entries || [], '').forEach(function(f) {
          if (f.createdBy) s.add(String(f.createdBy).trim());
        });
      }.bind(this));
      return Array.from(s).sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    },

    fileFilterDomainOptions() {
      var s = new Set();
      this.fileSections.forEach(function(sec) {
        this._collectAllFiles(sec.entries || [], '').forEach(function(f) {
          if (f.domain) s.add(String(f.domain).trim());
        });
      }.bind(this));
      return Array.from(s).sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    },

    sectionFileCountLabel(sec) {
      var c = String(this.filesFilterCreator || '').trim().toLowerCase();
      var d = String(this.filesFilterDomain || '').trim().toLowerCase();
      var total = this._countFilesInEntries(sec.entries || [], null, null);
      if (!c && !d) return String(total);
      var filtered = this._countFilesInEntries(sec.entries || [], c || null, d || null);
      return filtered === total ? String(total) : filtered + ' / ' + total;
    },

    filesTotalCountAll() {
      var n = 0;
      this.fileSections.forEach(function(sec) { n += this._countFilesInEntries(sec.entries || [], null, null); }.bind(this));
      return n;
    },

    filesFilteredTotalCount() {
      var c = String(this.filesFilterCreator || '').trim().toLowerCase();
      var d = String(this.filesFilterDomain || '').trim().toLowerCase();
      var n = 0;
      this.fileSections.forEach(function(sec) { n += this._countFilesInEntries(sec.entries || [], c || null, d || null); }.bind(this));
      return n;
    },

    clearFilesFilters() {
      this.filesFilterCreator = '';
      this.filesFilterDomain = '';
      this.filesSearchQuery = '';
    },

    /** Flat list of files matching the current search query (across all sections/subdirs). */
    filesSearchResultsFlat() {
      var q = String(this.filesSearchQuery || '').trim().toLowerCase();
      if (!q) return [];
      var results = [];
      this.fileSections.forEach(function(sec) {
        this._collectAllFiles(sec.entries || [], '').forEach(function(f) {
          if (f.name.toLowerCase().includes(q) || f.relPath.toLowerCase().includes(q)) {
            results.push({
              key: 'sr:' + sec.dir + ':' + f.relPath,
              sectionDir: sec.dir,
              sectionLabel: sec.label,
              name: f.name,
              relPath: f.relPath,
              size: f.size,
              modified: f.modified,
              createdBy: f.createdBy,
              domain: f.domain,
              category: f.category,
            });
          }
        });
      }.bind(this));
      return this._sortFileItems(results);
    },

    /** Pre-computed flat visible list for a single section (for normal tree rendering). */
    filesVisibleFlatListForSection(sec) {
      var self = this;
      var c = String(this.filesFilterCreator || '').trim().toLowerCase();
      var d = String(this.filesFilterDomain || '').trim().toLowerCase();
      var result = [];

      function countVisible(entries) {
        var n = 0;
        (entries || []).forEach(function(e) {
          if (e.isDir) n += countVisible(e.children || []);
          else {
            if (c && String(e.createdBy || '').toLowerCase() !== c) return;
            if (d && String(e.domain || '').toLowerCase() !== d) return;
            n++;
          }
        });
        return n;
      }

      function walk(entries, depth, relPrefix) {
        self._sortFileItems(entries || []).forEach(function(entry) {
          var relPath = relPrefix ? relPrefix + '/' + entry.name : entry.name;
          if (entry.isDir) {
            var visCount = countVisible(entry.children || []);
            if (c || d) { if (visCount === 0) return; }
            var openKey = sec.dir + ':' + relPath;
            var isOpen = !!self._folderOpenState[openKey];
            result.push({ type: 'dir', key: 'dir:' + sec.dir + ':' + relPath, name: entry.name, relPath: relPath, depth: depth, open: isOpen, visibleChildCount: visCount, totalChildCount: countVisible(entry.children || []) });
            if (isOpen) walk(entry.children || [], depth + 1, relPath);
          } else {
            if (c && String(entry.createdBy || '').toLowerCase() !== c) return;
            if (d && String(entry.domain || '').toLowerCase() !== d) return;
            result.push({ type: 'file', key: 'file:' + sec.dir + ':' + relPath, name: entry.name, relPath: relPath, depth: depth, size: entry.size, modified: entry.modified, createdBy: entry.createdBy || '', domain: entry.domain || '', category: entry.category || '' });
          }
        });
      }

      walk(sec.entries || [], 0, '');
      return result;
    },

    /**
     * Sort an array of file-like objects by the current `filesSort` preference.
     * Directories are always sorted before files (by name); only files are affected by the sort key.
     */
    _sortFileItems(items) {
      var s = this.filesSort;
      return (items || []).slice().sort(function(a, b) {
        var aDir = !!a.isDir, bDir = !!b.isDir;
        if (aDir && !bDir) return -1;
        if (!aDir && bDir) return 1;
        if (aDir && bDir) return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        // Both are files — sort by chosen key
        if (s === 'date') {
          var td = new Date(b.modified) - new Date(a.modified);
          return td !== 0 ? td : a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        }
        if (s === 'type') {
          var extA = (a.name.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
          var extB = (b.name.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
          var te = extA.localeCompare(extB);
          return te !== 0 ? te : a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        }
        if (s === 'creator') {
          var tc = String(a.createdBy || '').toLowerCase().localeCompare(String(b.createdBy || '').toLowerCase());
          return tc !== 0 ? tc : a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        }
        if (s === 'category') {
          var tcat = String(a.category || '').toLowerCase().localeCompare(String(b.category || '').toLowerCase());
          return tcat !== 0 ? tcat : a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        }
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
    },

    toggleFolderInSection(sectionDir, relPath) {
      var key = sectionDir + ':' + relPath;
      this._folderOpenState[key] = !this._folderOpenState[key];
      // Force reactivity
      this._folderOpenState = Object.assign({}, this._folderOpenState);
      var self = this;
      this.$nextTick(function() { self.refreshIcons(); });
    },

    isFolderOpenInSection(sectionDir, relPath) {
      return !!this._folderOpenState[sectionDir + ':' + relPath];
    },

    /** Toggle a top-level section and refresh the file-type icons that appear when it expands. */
    toggleSection(sec) {
      if (!sec) return;
      sec.open = !sec.open;
      var self = this;
      this.$nextTick(function() { self.refreshIcons(); });
    },

    /**
     * Single flat row list for the unified tree container.
     * Yields `{ type: 'section' | 'dir' | 'file', ... }` rows with `depth` for indentation.
     * Sections are depth 0; their children are depth 1+.
     */
    filesFlatTreeList() {
      var rows = [];
      var c = String(this.filesFilterCreator || '').trim().toLowerCase();
      var d = String(this.filesFilterDomain || '').trim().toLowerCase();
      var self = this;
      this.fileSections.forEach(function(sec) {
        var total = self._countFilesInEntries(sec.entries || [], null, null);
        var visibleCount = self._countFilesInEntries(sec.entries || [], c || null, d || null);
        if ((c || d) && visibleCount === 0) return;
        // Loose sections (e.g. root) are flattened: their files appear directly in the list
        // without a section header — they're not a real folder.
        if (sec.loose) {
          self.filesVisibleFlatListForSection(sec).forEach(function(item) {
            var copy = Object.assign({}, item);
            // No depth bump — loose files sit at depth 0 alongside section headers.
            copy.sectionDir = sec.dir;
            rows.push(copy);
          });
          return;
        }
        rows.push({
          type: 'section',
          key: 'sec:' + sec.dir,
          sectionDir: sec.dir,
          name: sec.label,
          count: visibleCount,
          totalCount: total,
          depth: 0,
          open: !!sec.open,
        });
        if (sec.open) {
          self.filesVisibleFlatListForSection(sec).forEach(function(item) {
            var copy = Object.assign({}, item);
            copy.depth = item.depth + 1;
            copy.sectionDir = sec.dir;
            rows.push(copy);
          });
        }
      });
      return rows;
    },

    /** Return the last path segment (basename) of a relPath. */
    fileBaseName(relPath) {
      var parts = String(relPath || '').split('/');
      return parts[parts.length - 1];
    },

    /**
     * Return a Lucide icon name for the file type.
     * Picks distinctive icons (image, film, music, code, table-2, …) over generic "file-*" variants
     * so the type is recognizable at a glance.
     */
    fileIconName(name) {
      var n = String(name || '').toLowerCase();
      if (/\.(md|markdown)$/.test(n)) return 'notebook';
      if (/\.(txt|log)$/.test(n)) return 'align-left';
      if (/\.(html|htm)$/.test(n)) return 'code-2';
      if (/\.(json|js|mjs|cjs|ts|tsx|jsx|sql|xml|yaml|yml|ini|conf|toml|sh|py|rb|go|rs)$/.test(n)) return 'braces';
      if (/\.pdf$/.test(n)) return 'file-text';
      if (/\.(csv|tsv|xls|xlsx)$/.test(n)) return 'table-2';
      if (/\.(doc|docx)$/.test(n)) return 'file-text';
      if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/.test(n)) return 'image';
      if (/\.(mp4|webm|mov|m4v|ogv|mkv)$/.test(n)) return 'film';
      if (/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/.test(n)) return 'music';
      if (/\.(zip|tar|gz|tgz|7z|rar)$/.test(n)) return 'archive';
      if (/\.(db|sqlite|sqlite3)$/.test(n)) return 'database';
      return 'file';
    },

    /** Tailwind text color class for a given file's icon — paired with `fileIconName`. */
    fileIconColorClass(name) {
      var n = String(name || '').toLowerCase();
      if (/\.(md|markdown)$/.test(n)) return 'text-sky-500 dark:text-sky-400';
      if (/\.(txt|log)$/.test(n)) return 'text-slate-500 dark:text-slate-400';
      if (/\.(html|htm)$/.test(n)) return 'text-orange-500 dark:text-orange-400';
      if (/\.(json|js|mjs|cjs|ts|tsx|jsx|xml|yaml|yml|ini|conf|toml|sh|py|rb|go|rs|sql)$/.test(n)) return 'text-amber-500 dark:text-amber-400';
      if (/\.pdf$/.test(n)) return 'text-rose-500 dark:text-rose-400';
      if (/\.(csv|tsv|xls|xlsx)$/.test(n)) return 'text-emerald-500 dark:text-emerald-400';
      if (/\.(doc|docx)$/.test(n)) return 'text-blue-500 dark:text-blue-400';
      if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/.test(n)) return 'text-violet-500 dark:text-violet-400';
      if (/\.(mp4|webm|mov|m4v|ogv|mkv)$/.test(n)) return 'text-pink-500 dark:text-pink-400';
      if (/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/.test(n)) return 'text-indigo-500 dark:text-indigo-400';
      if (/\.(zip|tar|gz|tgz|7z|rar)$/.test(n)) return 'text-amber-600 dark:text-amber-500';
      if (/\.(db|sqlite|sqlite3)$/.test(n)) return 'text-cyan-500 dark:text-cyan-400';
      return 'text-slate-400 dark:text-slate-500';
    },

    /** Compact human-readable byte size. */
    formatFileSize(bytes) {
      if (bytes == null) return '';
      var b = Number(bytes);
      if (!isFinite(b) || b < 0) return '';
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
      if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
      return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    },

    /** Short relative date label, e.g. "today", "Mon", "Jan 5", "2024". */
    fileShortDate(modified) {
      if (!modified) return '';
      var d = new Date(modified);
      if (isNaN(d.getTime())) return '';
      var now = new Date();
      var sameDay = d.toDateString() === now.toDateString();
      if (sameDay) {
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }
      var diffMs = now - d;
      var sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (diffMs >= 0 && diffMs < sevenDays) {
        return d.toLocaleDateString(undefined, { weekday: 'short' });
      }
      var sameYear = d.getFullYear() === now.getFullYear();
      if (sameYear) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    },

    /** Inline metadata string (right side of file row): type · size · date based on view options. */
    fileMetaInlineString(f) {
      if (!f) return '';
      var parts = [];
      if (this.filesViewOptions.type && f.name) parts.push(this.fileTypeLabel(f.name));
      if (this.filesViewOptions.size && f.size != null) parts.push(this.formatFileSize(f.size));
      if (this.filesViewOptions.date && f.modified) parts.push(this.fileShortDate(f.modified));
      return parts.join(' · ');
    },

    /** Whether any optional inline-meta info would be shown (used to decide layout). */
    fileHasInlineMeta(f) {
      if (!f) return false;
      if (this.filesViewOptions.type && f.name) return true;
      if (this.filesViewOptions.size && f.size != null) return true;
      if (this.filesViewOptions.date && f.modified) return true;
      return false;
    },

    /** Build a URL for accessing a file via the API (supports nested relPaths). */
    fileApiPath(dir, relPath) {
      if (dir === 'root') {
        var name = String(relPath || '');
        // Brief is served via the orchestrator-aware route (handles legacy LARRY.md migration).
        if (name === 'CYRUS.md') return '/api/cyrus';
        if (name === 'LARRY.md') return '/api/larry';
        return '/api/files/root/' + encodeURIComponent(name);
      }
      return '/api/files/' + encodeURIComponent(dir) + '/' +
        String(relPath || '').split('/').map(encodeURIComponent).join('/');
    },

    fileTypeLabel(name) {
      var base = this.fileBaseName(name);
      var m = String(base || '').match(/\.([^.]+)$/);
      var ext = m ? m[1].toLowerCase() : '';
      var map = {
        md: 'Markdown', markdown: 'Markdown',
        pdf: 'PDF',
        html: 'HTML', htm: 'HTML',
        json: 'JSON',
        txt: 'Plain text',
        csv: 'CSV',
        sql: 'SQL',
        png: 'PNG image', jpg: 'JPEG image', jpeg: 'JPEG image',
        gif: 'GIF image', webp: 'WebP image', svg: 'SVG image',
        zip: 'ZIP archive',
        doc: 'Word document', docx: 'Word document',
        xls: 'Excel spreadsheet', xlsx: 'Excel spreadsheet',
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
    fileDownloadHref(dir, relPath) {
      return this.fileApiPath(dir, relPath);
    },
    /** Meta tagging and archiving are only available for top-level files in meta-enabled dirs. */
    fileMetaAndArchiveEnabled(dir, relPath) {
      return ['docs', 'owners-inbox', 'team-inbox'].indexOf(dir) >= 0 && !String(relPath || '').includes('/');
    },

    findFileEntry(dir, relPath) {
      var sec = this.fileSections.find(function(s) { return s.dir === dir; });
      if (!sec) return null;
      var parts = String(relPath || '').split('/');
      var entries = sec.entries || [];
      for (var i = 0; i < parts.length - 1; i++) {
        var part = parts[i];
        var dirEntry = null;
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].isDir && entries[j].name === part) { dirEntry = entries[j]; break; }
        }
        if (!dirEntry) return null;
        entries = dirEntry.children || [];
      }
      var fileName = parts[parts.length - 1];
      for (var k = 0; k < entries.length; k++) {
        if (!entries[k].isDir && entries[k].name === fileName) return entries[k];
      }
      return null;
    },

    openFileMetaEditor() {
      var p = this.viewerPath || this.editorPath;
      if (!p || !this.fileMetaAndArchiveEnabled(p.dir, p.name)) return;
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
      var url = this.fileApiPath(dir, name);
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
      this.viewerTitle = this.fileBaseName(name);
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
      this.viewerTitle = this.fileBaseName(name);
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
      var url = this.fileApiPath(dir, name);
      this.editorOpen = false;
      this.viewerPath = { dir: dir, name: name };
      this.viewerTitle = this.fileBaseName(name);
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
      var url = this.fileApiPath(dir, name);
      try {
        var r = await fetchWithAuth(url);
        var text = await r.text();
        this.viewerOpen = false;
        this.viewerPath = null;
        this.editorPath = { dir: dir, name: name };
        this.editorTitle = this.fileBaseName(name);
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
      var url = this.fileApiPath(p.dir, p.name);
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
      if (this.chatModelPickerDisabled()) return;
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
      if (this.chatModelPickerDisabled()) return;
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
      var convId = this.chatConversationId;
      if (convId) {
        fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(convId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: next }),
        })
          .then(function (r) {
            if (r.ok) return r.json();
            return r
              .json()
              .then(function (ej) {
                throw new Error((ej && ej.error) ? ej.error : 'Could not update model');
              })
              .catch(function () {
                throw new Error('Could not update model');
              });
          })
          .then(function (d) {
            var list = self.chatConversations || [];
            var saved = d && d.model ? d.model : next;
            for (var i = 0; i < list.length; i++) {
              if (list[i] && list[i].id === convId) {
                list[i].model = saved;
                break;
              }
            }
          })
          .catch(function (e) {
            self.chatModel = cur;
            alert(e && e.message ? e.message : String(e));
          });
      }
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

    /** True while a turn is in flight — avoid changing model mid-stream or with queued sends. */
    chatModelPickerDisabled() {
      var q = this.chatOutboundQueue || [];
      return Boolean(this.chatStreaming || this.chatOutboundInFlight || q.length > 0);
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

    toggleChatQueuePreview() {
      if (!this.chatOutboundQueue.length) {
        this.chatQueuePreviewOpen = false;
        return;
      }
      this.chatQueuePreviewOpen = !this.chatQueuePreviewOpen;
      var self = this;
      this.$nextTick(function() { self.refreshIcons(); });
    },

    queuedChatMessagePreview(item) {
      if (!item) return '';
      var raw = typeof item.prompt === 'string' ? item.prompt : '';
      var t = raw.replace(/\s+/g, ' ').trim();
      if (!t) {
        if (item.files && item.files.length) {
          var names = item.files
            .map(function(f) {
              return f && f.name ? String(f.name) : '?';
            })
            .join(', ');
          return '(' + item.files.length + ' file' + (item.files.length === 1 ? '' : 's') + ': ' + names + ')';
        }
        return '(empty)';
      }
      return t;
    },

    queuedChatMessageFileCount(item) {
      if (!item || !item.files) return 0;
      return item.files.length || 0;
    },

    queuedChatMessagePhaseLabel(item) {
      if (!item || !item.planPhase) return '';
      if (item.planPhase === 'plan') return 'Plan';
      if (item.planPhase === 'execute') return 'Execute';
      return item.planPhase;
    },

    removeQueuedChatMessage(id) {
      if (!id) return;
      var b = this.getChatStreamBucket(this.chatConversationId);
      if (!b || !b.outboundQueue) return;
      var idx = -1;
      for (var i = 0; i < b.outboundQueue.length; i++) {
        if (b.outboundQueue[i] && b.outboundQueue[i].id === id) { idx = i; break; }
      }
      if (idx < 0) return;
      b.outboundQueue.splice(idx, 1);
      if (this.chatConversationId === b.convId) this.chatOutboundQueue = b.outboundQueue;
      if (!b.outboundQueue.length) this.chatQueuePreviewOpen = false;
    },

    /**
     * Builds the user message sent to the API and shown in the thread, including
     * explicit file names so the model and user see what was attached (files are
     * uploaded separately to team-inbox).
     */
    buildChatPromptWithAttachments(trimmedUserText, files) {
      files = files || [];
      var nameLine = files.length
        ? files
            .map(function(f) {
              return f && f.name ? String(f.name) : 'file';
            })
            .join(', ')
        : '';
      var hasText = Boolean(trimmedUserText && String(trimmedUserText).length);
      if (!files.length) {
        return hasText ? String(trimmedUserText) : '';
      }
      if (!hasText) {
        return 'I attached these file(s) in team-inbox: ' + nameLine;
      }
      return String(trimmedUserText) + '\n\n(Attached: ' + nameLine + ')';
    },

    closeChatAttachmentsMenu() {
      this.chatAttachmentsMenuOpen = false;
    },

    /** Window escape: close attach menu if open (does not steal Esc from other dialogs if menu closed). */
    onEscapeCloseChatAttachmentsMenu() {
      if (this.chatAttachmentsMenuOpen) this.closeChatAttachmentsMenu();
    },

    /**
     * @param {boolean} mobile - use `chatFileInputMobile` ref instead of desktop
     */
    onChatAttachmentButtonClick(mobile) {
      if (!this.chatFiles || !this.chatFiles.length) {
        this.chatAttachmentsMenuOpen = false;
        var ref = mobile ? 'chatFileInputMobile' : 'chatFileInputDesktop';
        var self = this;
        this.$nextTick(function() {
          try {
            if (self.$refs[ref]) self.$refs[ref].click();
          } catch (_) {}
        });
        return;
      }
      this.chatAttachmentsMenuOpen = !this.chatAttachmentsMenuOpen;
      var self = this;
      this.$nextTick(function() {
        self.refreshIcons();
      });
    },

    addMoreChatAttachments(mobile) {
      var ref = mobile ? 'chatFileInputMobile' : 'chatFileInputDesktop';
      var self = this;
      this.$nextTick(function() {
        try {
          if (self.$refs[ref]) self.$refs[ref].click();
        } catch (_) {}
      });
    },

    removeChatFileAt(index) {
      if (!this.chatFiles || index < 0 || index >= this.chatFiles.length) return;
      this.chatFiles.splice(index, 1);
      if (!this.chatFiles.length) this.chatAttachmentsMenuOpen = false;
      var self = this;
      this.$nextTick(function() {
        self.refreshIcons();
      });
    },

    async submitChat() {
      var files = this.chatFiles && this.chatFiles.length ? this.chatFiles.slice() : [];
      if (!this.chatPrompt.trim() && !files.length) return;
      if (this.chatIsOverCreditLimit()) {
        // Banner is already visible; refresh the snapshot in case credits
        // just reset on the server so the user can retry without reloading.
        this.refreshChatCreditLimit().catch(function () {});
        return;
      }
      var prompt = this.buildChatPromptWithAttachments(this.chatPrompt.trim(), files);
      if (!prompt) return;
      this.chatAttachmentsMenuOpen = false;
      var planPhase = this.chatPlanAwaitingExecute ? 'execute' : this.chatPlanMode ? 'plan' : null;
      try {
        await this.ensureChatConversation();
      } catch (e) {
        alert('Could not start chat: ' + (e && e.message ? e.message : String(e)));
        return;
      }
      var convId = this.chatConversationId;
      if (!convId) {
        alert('Could not start chat: no conversation id.');
        return;
      }
      var b = this.getChatStreamBucket(convId) || this.ensureChatStreamBucket(convId);
      if (!b) {
        alert('Could not start chat: internal state error.');
        return;
      }
      if (b.streaming || b.outboundInFlight) {
        b.outboundQueue.push({
          id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          prompt: prompt,
          files: files,
          planPhase: planPhase,
        });
        if (this.chatConversationId === b.convId) this.chatOutboundQueue = b.outboundQueue;
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
      b.outboundInFlight = true;
      if (this.chatConversationId === convId) this.chatOutboundInFlight = true;
      await this.runChatTurn(prompt, files, { planPhase: planPhase });
    },

    async executeApprovedChatPlan() {
      if (!this.chatConversationId || !this.chatPlanAwaitingExecute) return;
      if (!this.chatPlanTodos || !this.chatPlanTodos.length) {
        alert('No checklist items. Run a plan turn first.');
        return;
      }
      var p = this.chatPrompt.trim() || 'Execute the approved plan.';
      var b = this.ensureChatStreamBucket(this.chatConversationId);
      if (b.streaming || b.outboundInFlight) {
        b.outboundQueue.push({
          id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          prompt: p,
          files: [],
          planPhase: 'execute',
        });
        this.chatOutboundQueue = b.outboundQueue;
        this.chatPrompt = '';
        var self = this;
        this.$nextTick(function() {
          self.scrollChatToBottom({ force: true });
          self.refreshIcons();
          self.syncChatComposerHeights();
        });
        return;
      }
      b.outboundInFlight = true;
      this.chatOutboundInFlight = true;
      await this.runChatTurn(p, [], { planPhase: 'execute' });
    },

    /**
     * Sends one user turn (optional team-inbox file upload, then chat stream).
     * Serializes with the outbound queue: when this turn finishes, the next queued item runs automatically.
     * opts.fromOutboundQueue: if true, do not clear the composer; the user may be drafting the next message.
     */
    async runChatTurn(prompt, files, opts) {
      var self = this;
      opts = opts || {};
      var skipQueueDrain = false;
      files = files || [];
      var convId = this.chatConversationId;
      var bucket = convId ? this.ensureChatStreamBucket(convId) : null;
      if (bucket && !bucket.outboundInFlight) bucket.outboundInFlight = true;
      if (!this.chatOutboundInFlight) this.chatOutboundInFlight = true;
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
        convId = this.chatConversationId;
        bucket = this.ensureChatStreamBucket(convId);
        if (this.chatConversationId === convId) this.restoreRootFromChatBucket(convId);

        var optimisticId = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        this.initChatWorkPanelsForTurn(bucket);
        bucket.streamDraft = '';
        if (this.chatConversationId === convId) this.chatStreamDraft = '';
        bucket.workingStartedAt = Date.now();
        bucket.uiTick = Date.now();
        if (this.chatConversationId === convId) {
          this.chatWorkingStartedAt = bucket.workingStartedAt;
          this.chatUiTick = bucket.uiTick;
        }
        this._clearChatElapsedTimer(bucket);
        bucket.elapsedTimer = setInterval(function() {
          bucket.uiTick = Date.now();
          if (self.chatConversationId === convId) self.chatUiTick = bucket.uiTick;
          self.refreshChatWaitingStatusLineIfStreaming(bucket);
        }, 1000);
        if (this.chatConversationId === convId) this._chatElapsedTimer = bucket.elapsedTimer;

        bucket.messages.push({ id: optimisticId, role: 'user', content: prompt });
        if (this.chatConversationId === convId) this.chatMessages = bucket.messages;

        // Direct sends clear the composer here; a turn drained from the outbound
        // queue must not, because the user may already be typing their next message.
        if (!opts.fromOutboundQueue) {
          this.chatPrompt = '';
          this.chatFiles = [];
        }
        bucket.streaming = true;
        if (this.chatConversationId === convId) this.chatStreaming = true;

        if (this.chatConversationId === convId) {
          this.scrollChatToBottom({ force: true });
        }
        this.$nextTick(function() {
          self.refreshIcons();
          self.syncChatComposerHeights();
        });

        bucket.abortController = new AbortController();
        if (this.chatConversationId === convId) this.chatAbortController = bucket.abortController;
        bucket.retryPrompt = prompt;
        if (this.chatConversationId === convId) this.chatRetryPrompt = prompt;

        var acceptedByServer = false;
        try {
          var body = {
            agent: this.normalizeChatAgentId(this.chatAgent),
            prompt: prompt,
            conversationId: convId,
            model: this.ensureChatModelFromCatalog(this.chatModel),
          };
          if (opts.planPhase) body.planPhase = opts.planPhase;
          if (opts.planPhase === 'execute' && bucket.planTodos && bucket.planTodos.length) {
            body.planTodos = bucket.planTodos;
          }
          var res = await fetchWithAuth('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: bucket.abortController.signal,
          });
          if (res.status === 409) {
            bucket.outboundQueue.push({
              id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
              prompt: prompt,
              files: [],
              planPhase: opts.planPhase || null,
            });
            if (this.chatConversationId === convId) this.chatOutboundQueue = bucket.outboundQueue;
            bucket.messages = bucket.messages.filter(function(m) { return m.id !== optimisticId; });
            if (this.chatConversationId === convId) this.chatMessages = bucket.messages;
            if (!opts.fromOutboundQueue) this.chatPrompt = prompt;
            this.$nextTick(function() {
              self.syncChatComposerHeights();
            });
            return;
          }
          if (res.status === 402) {
            // Per-user credit limit reached. Drop the optimistic user bubble,
            // restore the prompt so they don't lose their draft, and surface
            // the exceeded payload so the banner + disabled composer render.
            var payload402 = null;
            try { payload402 = await res.json(); } catch (_) {}
            if (payload402 && payload402.creditLimitExceeded) {
              this.ingestChatCreditLimitPayload(payload402);
            }
            bucket.messages = bucket.messages.filter(function(m) { return m.id !== optimisticId; });
            if (this.chatConversationId === convId) this.chatMessages = bucket.messages;
            if (!opts.fromOutboundQueue) this.chatPrompt = prompt;
            this.$nextTick(function() {
              self.syncChatComposerHeights();
            });
            return;
          }
          if (!res.ok) {
            bucket.messages = bucket.messages.filter(function(m) { return m.id !== optimisticId; });
            if (this.chatConversationId === convId) this.chatMessages = bucket.messages;
            if (!opts.fromOutboundQueue) this.chatPrompt = prompt;
            this.$nextTick(function() {
              self.syncChatComposerHeights();
            });
            var errMsg = 'Chat request failed: ' + res.status;
            try {
              var ej = await res.json();
              if (ej && ej.error) errMsg = ej.error;
            } catch (_) {}
            bucket.messages.push({
              id: 'err-' + Date.now(),
              role: 'assistant',
              content: '[Error: ' + errMsg + ']',
              error: true,
            });
            if (this.chatConversationId === convId) this.chatMessages = bucket.messages;
            return;
          }
          acceptedByServer = true;
          if (!res.body || !res.body.getReader) {
            throw new Error('No response body');
          }
          await self.readChatSseStream(convId, { reader: res.body.getReader() });
        } catch (err) {
          if (!acceptedByServer) {
            if (bucket && bucket.messages) {
              bucket.messages = bucket.messages.filter(function(m) { return m.id !== optimisticId; });
              if (self.chatConversationId === convId) self.chatMessages = bucket.messages;
            }
            if (!opts.fromOutboundQueue) self.chatPrompt = prompt;
            self.$nextTick(function() {
              self.syncChatComposerHeights();
            });
            if (bucket) {
              bucket.messages.push({
                id: 'err-' + Date.now(),
                role: 'assistant',
                content: '[Error: ' + err.message + ']',
                error: true,
              });
              if (self.chatConversationId === convId) self.chatMessages = bucket.messages;
            }
          }
        }
      } finally {
        if (bucket) {
          self._clearChatElapsedTimer(bucket);
          bucket.streaming = false;
          bucket.streamDraft = '';
          bucket.abortController = null;
          bucket.workingStartedAt = null;
          self.finalizeChatWorkPanels(bucket);
        }
        if (self.chatConversationId === convId) {
          self.chatStreaming = false;
          self.chatStreamDraft = '';
          self.chatAbortController = null;
          self.chatWorkingStartedAt = null;
          self._chatElapsedTimer = null;
        }
        if (self.chatConversationId === convId) {
          self.scrollChatToBottom();
        }
        self.refreshChatCreditLimit().catch(function () {});
        self.$nextTick(function() {
          self.refreshIcons();
        });
        if (skipQueueDrain) {
          if (bucket) bucket.outboundInFlight = false;
          self.chatOutboundInFlight = false;
        } else if (bucket && bucket.outboundQueue.length) {
          var next = bucket.outboundQueue.shift();
          if (self.chatConversationId === convId) self.chatOutboundQueue = bucket.outboundQueue;
          self.$nextTick(function() {
            self
              .runChatTurn(next.prompt, next.files || [], {
                planPhase: next.planPhase || null,
                fromOutboundQueue: true,
              })
              .catch(function(e) {
                console.warn('[chat] queued turn', e);
              });
          });
        } else {
          if (bucket) bucket.outboundInFlight = false;
          self.chatOutboundInFlight = false;
        }
      }
    },

    async abortChat() {
      var id = this.chatConversationId;
      if (this.chatAbortController) {
        try {
          this.chatAbortController.abort();
        } catch (_) {}
      }
      if (id) {
        try {
          await fetchWithAuth('/api/chat/conversations/' + encodeURIComponent(id) + '/abort', { method: 'POST' });
        } catch (_) {}
      }
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