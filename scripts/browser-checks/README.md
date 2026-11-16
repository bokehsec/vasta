# Browser checks

Playwright scripts that drive the web app in the isolated test env (`scripts/test-env.sh`: Vite on
5183 without a service worker, the server on 5184 serving `packages/web/dist` with it). They refuse
other addresses; never point them at the dev server on 5173/5174 or at production.

    scripts/test-env.sh &            # restart it after server edits; `pnpm --filter @vasta/web build` for 5184
    cd scripts/browser-checks && npm install   # once (browsers: npx playwright install chromium webkit)
    VASTA_DATA=<the test env's dir> node ../../packages/server/src/cli.ts token add tester ui-test --scope capture
    CAPTURE_TOKEN=<token> node replica.mjs chromium http://127.0.0.1:5183
    CAPTURE_TOKEN=<token> node replica.mjs chromium http://127.0.0.1:5184   # + reload offline (service worker)
    CAPTURE_TOKEN=<token> node replica.mjs webkit http://127.0.0.1:5184     # iPhone 15 profile
    node views.mjs [base]        # every screen, search, trash + Undo, second tab, logout
    node editor.mjs [base]       # slash menu, mention, undo, moving a block, image upload
    node weblink.mjs             # a weblink created on the replica, fetched by the server
    node device.mjs; node update.mjs
    node page-width.mjs [chromium|webkit]   # Vite on 5183 only: Appearance choice, persistence, object/daily-note widths, columns, phones and panes (MODE=json too; SETTINGS=0 skips the headless WebKit Settings hang)
    node desktop.mjs [base]      # Settings › This device: download links, the desktop app's version and shortcut
    node firstsync.mjs [chromium|webkit]   # LAST_OBJECT=<id>: also open it offline
    node refused.mjs             # a refused change: toast, Settings list, dismiss (PHONE=1, SHOTS=<dir>)
    node httpsave.mjs            # HTTP mode: a rename made elsewhere while typing is not undone
    node calendar.mjs [chromium|webkit] [base] [phone]   # repeating dates: drag, resize, the three choices, bars, a repeating task's checkbox; phone = long press (chromium)
    node calendar-closed.mjs [chromium|webkit] [base]   # closed tasks on the Calendar page: Done and Dropped left out by default (month, week, day, the small month's dots), "Done and dropped tasks" in the Show menu (struck, no "hidden" count, kept on reload), a task ticked there stays checked and struck with Undo until another range or a reload
    node calendar-planned.mjs [chromium|webkit] [base]   # planned work vs deadlines, actual completion/Undo, same-slot deduplication, safe repeats, task filtering and explicit related-date moves; desktop/phone; defaults to isolated 5383, MODE=json too
    node group-collapse.mjs [chromium|webkit] [base]   # group carets, personal per-view/embed folds, keyboard, phone rows, linked chips and full preview counts (default 5283; MODE=json too)
    node table.mjs [chromium|webkit] [base]   # Columns menu, resizing, filters through a relation (MODE=json too)
    node listrows.mjs [chromium|webkit] [base]   # fields on list rows: the Fields menu (Due, wrap titles), a task's checkbox, reset to default (MODE=json too)
    node formula.mjs [chromium|webkit] [base]  # a formula column, writing one in Type settings, sort, filter, the object page (MODE=json too)
    node blocks.mjs [chromium|webkit] [base]   # block colors, copy link to block, opening it, ids of duplicates (MODE=json too)
    node columnhandle.mjs [chromium|webkit] [base]   # the ⋮⋮ handle of a block in a second column: in the gap, holds still, opens its menu
    node quotes.mjs [chromium|webkit] [base]   # save a passage as a quote, open it from the highlight, delete it (MODE=json too)
    node compactembed.mjs [chromium|webkit] [base]   # a query embedded in a page shown Compact (block menu): no header, Edit query + Done, kept on reload, back to Full (MODE=json too)
    node agenda.mjs [chromium|webkit] [base]   # the Agenda layout: a query in a page as day sections (chips, timed rows, the line for now, a checkbox, an empty day), Days in its settings, a type view and its date field, dragging an entry to another day moves its date (MODE=json too)
    node compactblock.mjs [chromium|webkit] [base]   # an embedded block shown compact: no frame or group panel, Open block in the block menu, hidden while empty
    node calmhome.mjs [chromium|webkit] [base]   # a calm home page: a space's start page has its icon beside the title and no empty tags row or "Add property" line (Tags/Property on hover; another page unchanged), an Agenda's all-day events as chips beside timed rows, an empty compact query and its heading hidden, this year's dates on list rows without the year (replica off: the agenda's calendar is faked in the browser; SHOTS=<dir>)
    node handover.mjs [base]     # a second tab takes the replica over when the first closes
    node capture.mjs [base]      # /Type in quick capture (alone by default; in today’s note with Settings › Desktop app), a relation's values, ⌘K, the panel's bridge (MODE=json too)
    node toggles.mjs [base]      # Tab nests under the line above (a toggle), ⇧Tab takes it out, /Toggle on a written line (MODE=json too)
    node blockrefs.mjs [base]    # @Title#… mentions a block, @@ embeds one read-only; it follows edits; links open the block (MODE=json too)
    node channels.mjs [base]     # Settings › Capture channels and Telegram's chats (the bot's state faked)
    node inbox.mjs [base]        # Settings › Inbox: the word for reviewed items, fading, in the inbox and the daily note
    node diagram.mjs [base]      # Mermaid: /Diagram drawn, code hidden and shown, a mistake's line, ```mermaid typed (SHOTS=<dir>: light and dark)
    node import.mjs <export.zip> [base]   # Settings › Import: a Capacities full export into a new space, the report, a type and an object (SHOTS=<dir>)
    node nutrition.mjs [chromium|webkit] [base] [phone]   # food tracking: Settings, a weekly goal, the picker, editing, a recipe, portions, /food in ⌘K, the Nutrition page, kcal in the month (MODE=json too)
    node board.mjs [chromium|webkit] [base] [phone]   # drag between columns and within one (manual order), "+", WIP limit, folding, swimlanes, card fields, Blocked; phone = long press (chromium) (MODE=json too)
    node completion-feedback.mjs [chromium|webkit] [base]   # a task marked Done stays where it was, checked, muted and struck, until a fresh view (Chromium/WebKit, 1280 and 390 wide, light and dark; base 5183 or 5383): list with and without columns, table (phone: rows), cards, quick actions, status board (the card keeps its column; a drag to Done still moves it), search keeping matches, a view switch and reload clearing them, Undo back to exactly Next, a repeating task ("Done this time · Next: …"), rapid double taps, the full page and Back (phone: gone; side pane: stays); MODE=json: a failed save with Retry; replica on: Done while offline (WIDTH=desktop|phone, THEME=light|dark run one cell; SHOTS=<dir>)
    node phone-rows.mjs [chromium|webkit] [base]   # tasks on a phone (390×844, touch): a table view as rows (its columns as row fields, no sideways scroll), the swipe tip, swipe right = Defer in the bottom sheet + Undo, a tiny swipe springs back, a short slow one uncovers Defer (swipe back closes), a short flick defers or opens, swipe left = Done…More without opening the task, a vertical move scrolls, the long-press menu's quick actions, "Show as table on this phone", a board one column at a time, a swipe inside a query embedded in a page (Chromium: CDP touches; WebKit: touch events in the page, hover: none faked) (MODE=json too)
    node phone-touch.mjs [chromium|webkit] [base]  # touch sizes and fallbacks on a phone (SIZE=320x568 for a small one, DARK=1): task page actions 44px (Mark done tinted, not filled; Defer…), the page ⋯ and Open type 44px, Defer's sheet (no day picked at first, the task named from a row, 44px days, Save on screen), Copy link when the clipboard refuses (copy command, else the link to copy by hand), Undo/Dismiss 44px and the notice waiting while held; MODE=json: a failed save says it could not reach the server
    node subtasks.mjs [chromium|webkit] [base]   # subtasks: Type settings › Subtasks adds "Part of"; a task's page adds steps (Return, pasted lines; they take the parent's priority and tags), ticks them, "All subtasks done" + Done (never by itself), "still open" when closed early; a list nests steps (caret folds, "3/4" chip), "Nest subtasks" off, a step without its listed parent names it, "Make subtask of…" leaves out its own steps, a row's menu takes a step out, a phone at 16px (MODE=json too)
    node review.mjs [chromium|webkit] [base]   # the review of the current view: keys (D Done, → skip, ← back, S Scheduled asking a date, the end's counts, Escape), only tasks not reviewed this week, "Review all", R marks one reviewed, whole notes; phone: full screen, a swipe left skips, Done + Undo, the next step as a plan field, Pause/Resume over a reload, Open page and Back, Review skipped, End (MODE=json too)
    node no-multiselect.mjs [chromium|webkit] [base]   # rows one at a time, multiselect gone: no select box (desktop hover, phone), no picked look, no bulk bar; a Shift-click opens the task, the completion circle and a row's menu action still work (right-click on a desktop, ⋯ on a phone, no Select entry), a phone's More menu offers no "Select tasks", a tap opens (MODE=json too)
    node quick-actions.mjs [chromium|webkit] [base]   # a task's quick actions: the defaults and old settings shaping them, custom actions (Done/Defer/Drop/Waiting, an asking one), the page and row buttons, the view toggle and table column, the query checkbox, Undo everywhere, a phone width; a non-task type with its own action (settings, page, row, column, process mode) (MODE=json too)
    node phone-back.mjs [chromium|webkit] [base]   # Back on a phone closes the open row menu (a submenu first), Defer's question, the Filters sheet, the side menu, Review tasks and its chooser, Quick capture (draft kept), and the page stays; a grabber pulled down closes a sheet, a small pull springs back; Quick capture offline saves on the replica (MODE=json too)
    node review-scope.mjs [chromium|webkit] [base]   # Review follows view/search/Mine, incoming first even when recently reviewed; explicit whole-space sweep ignores filters, closed/recent commitments excluded; paused scope/position survive view switch/reload, new session confirmation, phone Mine chip and 320–430px targets; list/table/board, explicit full sweeps on Metrics/Agenda (MODE=json too; SHOTS=<dir>)
    node phone-history.mjs [chromium|webkit] [base]   # Back between pages on a phone: a list comes back where it was scrolled, a page opens at its top; an edge swipe goes back and opens no side menu (a swipe left still closes it); the bottom-menu place showing tapped again adds no step (Calendar to today); the bottom menu's Menu opens the side menu
    node phone-shell.mjs [chromium|webkit] [base]   # the phone shell: the bottom bar (five places, the current one marked, Search opens the palette at 16px), Capture above it, no Search up top and Back on an object page, the view picker's sheet, a popover as a bottom sheet with 44px rows, the More menu with no selection entry, the long-press menu as a sheet with a sliding submenu, the last row clear of the bar, a task's folded fields, nothing of it on a desktop (MODE=json too)
    node pane.mjs [chromium|webkit] [base] [phone]    # the side pane: off by default, Type settings' switch, a view's Full page choice, list, table, board and query clicks, the calendar still opening the page, editing, back/forward, reload, Esc, Open full page, resizing, trash + Undo; phone = the page (MODE=json too)
    node closed.mjs [chromium|webkit] [base]   # closed tasks: Done and Dropped left out by the view's own "Status is not Done, Dropped" filter, not counted (a phone list's first row is open and swipes; one closed there stays until the view is left), Show done and dropped in the Filters sheet and the desktop's Filter menu removing and adding it, saved on the view, the sheet's count and Done; a view asking for Done and a status board unchanged; a new view starts with the filter (MODE=json too; SHOTS=<dir>)
    node sprints.mjs [chromium|webkit] [base]   # Settings › Sprints (on, named Rodada), Current rodada and Backlog, a sprint's panel, Finish, Next (MODE=json too)
    node startpage.mjs [chromium|webkit] [base]   # what a space opens on: "/" opens the chosen page, Today, or the first pinned item (also when the page is in the trash), and Settings › Space's Opens on (SETTINGS=0 skips Settings: it stalls in headless WebKit here)
    node habits.mjs [chromium|webkit] [base]   # habit progress: a daily, a Mon/Wed/Fri, a 3-a-week and a paused habit; "x of 3 this week" on Today, a day off faded in the Tracker (a 3-a-week habit never missed), the Progress tab's headline and rows (against core's habitReport), exactly two charts (trend line, calendar) in the Tracker's Display menu and on the tab, the range and chart kept on reload, old chart ids read as the nearest of the two, Pause/Resume and the same last-4-weeks number on a habit's page, a past day fixed by long press on a phone row, on 5184 the same offline (PHONE=1: 390px, first space; SHOTS=<dir>)
    node sparkyfitness.mjs [chromium|webkit] [base]   # SparkyFitness on a habit against a fake upstream (start the env with VASTA_ALLOW_PRIVATE_FETCH=127.0.0.1): connect, a goal needed for steps/water/sleep, preview without writes, link, import, last sync shown, a tap asks and never saves a value, Use SparkyFitness value, hand clear, Unlink, panel gone without a connection, Disconnect and remove (PHONE=1: 390px)
    node metrics.mjs [chromium|webkit] [base]  # the Tasks page's Metrics: numbers, done per week, cumulative flow (hover), what waits longest (SHOTS=<dir>: light and dark)
    node typelink.mjs [chromium|webkit] [base]  # a link to a type of another space (/t/<id>) switches to that space and shows the type's page
    node viewpin.mjs [chromium|webkit] [base]  # a view pinned in the sidebar from Tasks' … menu or by dragging its tab: its row opens the view and is the raised one, another view drops the link, deleting the view removes the row; Tasks pinned shows in its section; only a picked view is remembered
    node people.mjs [chromium|webkit] [base]   # a shared space: Assignee picked on a task, "Edited … by", Mine, a filter on Me, a board by assignee, assignee: in ⌘K, comments, the bell, activity (needs a second account: see the script; MODE=json too)
    node invites.mjs [base]      # Settings › Server accounts makes an invite link; someone new joins with it, once (seed data: tester is the first account)
    node scale.mjs [base]        # times on a big space (pnpm load-test 50000 --keep): first login, full replica, a big type page, Today, ⌘K, reload
    node panel.mjs               # the desktop capture panel page with the app faked: list, pick, Esc, growing (no server)
    MODE=json node views.mjs     # the same with the replica turned off (HTTP mode)

Notes: WebKit has no OPFS in an ephemeral context, so the scripts use a persistent profile; and
Playwright's WebKit keeps OPFS across profiles, so a WebKit run reuses the replica of the last one
(firstsync.mjs empties OPFS first). Nor do its locks span profiles: two WebKit contexts open at once
must not both run the replica, or they corrupt its database (SQLITE_CORRUPT), so a setup or cleanup
context that only needs the API opens with `vasta.replica` off. device.mjs's banner step times
out (its `context.route` of `/` does not reach the app's fetch in WebKit, likely because the service worker answers it);
update.mjs checks the banner.
For timing with more data, build a copy with extra objects and start the env on it:
`VASTA_TEST_SOURCE=<dir with vasta.db> scripts/test-env.sh`. In
headless Chromium wait a moment between a click and Enter (ProseMirror reads the click's selection
on `selectionchange`). On macOS, Meta+ArrowRight goes to the end of a line. When hover controls are
involved, walk the pointer step by step (see the project's UI test notes).
