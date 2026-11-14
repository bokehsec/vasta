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
    node desktop.mjs [base]      # Settings › This device: download links, the desktop app's version and shortcut
    node firstsync.mjs [chromium|webkit]   # LAST_OBJECT=<id>: also open it offline
    node refused.mjs             # a refused change: toast, Settings list, dismiss (PHONE=1, SHOTS=<dir>)
    node httpsave.mjs            # HTTP mode: a rename made elsewhere while typing is not undone
    node calendar.mjs [chromium|webkit] [base] [phone]   # repeating dates: drag, resize, the three choices, bars, a repeating task's checkbox; phone = long press (chromium)
    node table.mjs [chromium|webkit] [base]   # Columns menu, resizing, filters through a relation (MODE=json too)
    node listrows.mjs [chromium|webkit] [base]   # fields on list rows: the Fields menu (Due, wrap titles), a task's checkbox, reset to default (MODE=json too)
    node formula.mjs [chromium|webkit] [base]  # a formula column, writing one in Type settings, sort, filter, the object page (MODE=json too)
    node blocks.mjs [chromium|webkit] [base]   # block colors, copy link to block, opening it, ids of duplicates (MODE=json too)
    node columnhandle.mjs [chromium|webkit] [base]   # the ⋮⋮ handle of a block in a second column: in the gap, holds still, opens its menu
    node quotes.mjs [chromium|webkit] [base]   # save a passage as a quote, open it from the highlight, delete it (MODE=json too)
    node compactembed.mjs [chromium|webkit] [base]   # a query embedded in a page shown Compact (block menu): no header, Edit query + Done, kept on reload, back to Full (MODE=json too)
    node agenda.mjs [chromium|webkit] [base]   # the Agenda layout: a query in a page as day sections (chips, timed rows, the line for now, a checkbox, an empty day), Days in its settings, a type view and its date field (MODE=json too)
    node compactblock.mjs [chromium|webkit] [base]   # an embedded block shown compact: no frame or group panel, Open block in the block menu, hidden while empty
    node calmhome.mjs [chromium|webkit] [base]   # a calm home page: a space's start page has its icon beside the title and no empty tags row or "Add property" line (Tags/Property on hover; another page unchanged), an Agenda's all-day events as chips beside timed rows, an empty compact query and its heading hidden, this year's dates on list rows without the year (replica off: the agenda's calendar is faked in the browser; SHOTS=<dir>)
    node handover.mjs [base]     # a second tab takes the replica over when the first closes
    node capture.mjs [base]      # /Type in quick capture (embedded in today's note), a relation's values, ⌘K, the panel's bridge (MODE=json too)
    node toggles.mjs [base]      # Tab nests under the line above (a toggle), ⇧Tab takes it out, /Toggle on a written line (MODE=json too)
    node blockrefs.mjs [base]    # @Title#… mentions a block, @@ embeds one read-only; it follows edits; links open the block (MODE=json too)
    node channels.mjs [base]     # Settings › Capture channels and Telegram's chats (the bot's state faked)
    node inbox.mjs [base]        # Settings › Inbox: the word for reviewed items, fading, in the inbox and the daily note
    node diagram.mjs [base]      # Mermaid: /Diagram drawn, code hidden and shown, a mistake's line, ```mermaid typed (SHOTS=<dir>: light and dark)
    node import.mjs <export.zip> [base]   # Settings › Import: a Capacities full export into a new space, the report, a type and an object (SHOTS=<dir>)
    node nutrition.mjs [chromium|webkit] [base] [phone]   # food tracking: Settings, a weekly goal, the picker, editing, a recipe, portions, /food in ⌘K, the Nutrition page, kcal in the month (MODE=json too)
    node board.mjs [chromium|webkit] [base] [phone]   # drag between columns and within one (manual order), "+", WIP limit, folding, swimlanes, card fields, Blocked; phone = long press (chromium) (MODE=json too)
    node phone-rows.mjs [chromium|webkit] [base]   # tasks on a phone (390×844, touch): a table view as rows (its columns as row fields, no sideways scroll), the swipe tip, swipe right = Defer in the bottom sheet + Undo, swipe left = Done…More without opening the task, a vertical move scrolls, the long-press menu's quick actions, "Show as table on this phone", a board one column at a time, a swipe inside a query embedded in a page (Chromium: CDP touches; WebKit: touch events in the page, hover: none faked) (MODE=json too)
    node subtasks.mjs [chromium|webkit] [base]   # subtasks: Type settings › Subtasks adds "Part of"; a task's page adds steps (Return, pasted lines; they take the parent's priority and tags), ticks them, "All subtasks done" + Done (never by itself), "still open" when closed early; a list nests steps (caret folds, "3/4" chip), "Nest subtasks" off, a step without its listed parent names it, "Make subtask of…" leaves out its own steps, a row's menu takes a step out, a phone at 16px (MODE=json too)
    node bulk.mjs [chromium|webkit] [base]   # many at once: a row's box + Shift-click range, bulk Defer (one question, one Undo), Select all, Escape, a click picking a row while selecting, Move to trash + Undo, process mode by keys (1, →, ←, 2, the end's counts); phone: Select from the long-press menu, taps, no swipes, Done from the bar, process mode full screen with a swipe to skip (MODE=json too)
    node quick-actions.mjs [chromium|webkit] [base]   # a task's quick actions: the defaults and old settings shaping them, custom actions (Done/Defer/Drop/Waiting, an asking one), the page and row buttons, the view toggle and table column, the query checkbox, Undo everywhere, a phone width; a non-task type with its own action (settings, page, row, column, bulk bar, process mode) (MODE=json too)
    node phone-shell.mjs [chromium|webkit] [base]   # the phone shell: the bottom bar (five places, the current one marked, Search opens the palette at 16px), Capture above it, no Search up top and Back on an object page, the view picker's sheet, a popover as a bottom sheet with 44px rows, the long-press menu as a sheet with a sliding submenu, the last row clear of the bar, a task's folded fields, nothing of it on a desktop (MODE=json too)
    node pane.mjs [chromium|webkit] [base] [phone]    # the side pane: off by default, Type settings' switch, a view's Full page choice, list, table, board and query clicks, the calendar still opening the page, editing, back/forward, reload, Esc, Open full page, resizing, trash + Undo; phone = the page (MODE=json too)
    node sprints.mjs [chromium|webkit] [base]   # Settings › Sprints (on, named Rodada), Current rodada and Backlog, a sprint's panel, Finish, Next (MODE=json too)
    node startpage.mjs [chromium|webkit] [base]   # what a space opens on: "/" opens the chosen page, Today, or the first pinned item (also when the page is in the trash), and Settings › Space's Opens on (SETTINGS=0 skips Settings: it stalls in headless WebKit here)
    node metrics.mjs [chromium|webkit] [base]  # the Tasks page's Metrics: numbers, done per week, cumulative flow (hover), what waits longest (SHOTS=<dir>: light and dark)
    node viewpin.mjs [chromium|webkit] [base]  # a view pinned in the sidebar from Tasks' … menu or by dragging its tab: its row opens the view and is the raised one, another view drops the link, deleting the view removes the row; Tasks pinned shows in its section; only a picked view is remembered
    node people.mjs [chromium|webkit] [base]   # a shared space: Assignee picked on a task, "Edited … by", Mine, a filter on Me, a board by assignee, assignee: in ⌘K, comments, the bell, activity (needs a second account: see the script; MODE=json too)
    node invites.mjs [base]      # Settings › Server accounts makes an invite link; someone new joins with it, once (seed data: tester is the first account)
    node scale.mjs [base]        # times on a big space (pnpm load-test 50000 --keep): first login, full replica, a big type page, Today, ⌘K, reload
    node panel.mjs               # the desktop capture panel page with the app faked: list, pick, Esc, growing (no server)
    MODE=json node views.mjs     # the same with the replica turned off (HTTP mode)

Notes: WebKit has no OPFS in an ephemeral context, so the scripts use a persistent profile; and
Playwright's WebKit keeps OPFS across profiles, so a WebKit run reuses the replica of the last one
(firstsync.mjs empties OPFS first). device.mjs's banner step times out (its `context.route` of `/`
does not reach the app's fetch in WebKit, likely because the service worker answers it);
update.mjs checks the banner.
For timing with more data, build a copy with extra objects and start the env on it:
`VASTA_TEST_SOURCE=<dir with vasta.db> scripts/test-env.sh`. In
headless Chromium wait a moment between a click and Enter (ProseMirror reads the click's selection
on `selectionchange`). On macOS, Meta+ArrowRight goes to the end of a line. When hover controls are
involved, walk the pointer step by step (see the project's UI test notes).
