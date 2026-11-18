# Vasta Design System

Calm, dense and quiet, in the spirit of Capacities: a warm canvas around a white page, color only
where it carries meaning (types, select options, tags), the content as the loudest thing on screen.

## Tokens

**Color**: surface and text tokens in `packages/web/src/style.css` (`@theme`, redefined under
`.dark`); the 18 named colors' class sets (chips, icons, groups, highlights) in
`packages/web/src/lib/colors.ts`.
**Typography**: the system font (`--font-sans`); UI at 14px (`text-sm`), 15px in the phone drawer;
notes at 16px, line height 1.6. Page titles bold with tight tracking.
**Spacing**: Tailwind's 4px scale. Sidebar rows 30px on desktop, 40px+ on phones.
**Theme**: system, light or dark per browser (`lib/theme.ts`, Settings › Appearance and the sidebar's
footer).

## Patterns

**Preferences** (`lib/preferences.ts`): every choice about how Vasta *looks to one person* goes through
one store, never a bare `localStorage` key. A key is a path that names what it belongs to first
(`type/<id>/view/<id>/phone-table`, `page-width`), so deleting a view or type drops its keys with one
prefix (`dropPreferences`). Three scopes: **account**, kept on the server with the user's profile and
cached here (works offline, sent when back): folds, "Show done", Mine, the last view, the phone menu,
the Habits display, calendar choices, dismissed tips; **device**, this device and this person
(`vasta.device.<user>.<key>`): page width, a pane's width, capture drafts, where a board's camera is;
**browser**, this device for anyone (`vasta.browser.<key>`): the theme, caches, what shows before login.
Nothing a person folds, hides or picks changes what anyone else sees: views, types and objects are
shared data; only their *starting values* (a view's saved filter, a type's habit display) come from
there. A temporary state (a filter's narrowing) lives in the page, not in a preference. Old keys are
converted once in `lib/preferences-legacy.ts`. Technical switches that are not choices
(`vasta.replica`, the review session) stay outside.

**Type saves** (`lib/type-patch.ts`): a type is changed by `patchType(id, { fields })`, which shows the
change at once and sends only the named fields (core `type-patch.ts`; server `PATCH /api/types/:id`,
replica `patchType`). Nothing saves a whole type, so a dialog, a view setting and another device never
overwrite each other's fields.

**Buttons** (`lib/buttons.ts`): five kinds, each with one job, the same on every screen (after Apple's
filled, tinted, grey and plain styles). **Main**, ink fill: the one most likely action of a place
(New Task, Save, a dialog's confirm). **Tinted**, the accent at 12% with accent text: a way into a
feature, with its count inside ("Review 12"), or the action a page leads with when it isn't a save
(Mark done). **Grey**, the hover grey filled: ordinary actions (Cancel, Defer…, Drop, Sync now, a
phone's view picker and Filters). **Quiet**, text or icon tinted only on hover: toolbars, menus,
rows and icon buttons, where controls are expected; never a way into a feature. **Delete**: red
text (grey in a page, quiet in a menu), solid red only to confirm in the "Are you sure?" dialog.
32px tall on a desktop, 44px and 15px text on a phone; size never tells kinds apart. Each has hover,
pressed, disabled and keyboard-focus states. Settings' `primary`/`secondary` are Main and Grey.
Review on the Tasks page (`ReviewButton`) is tinted while work waits and grey when it doesn't; a press
starts the review of every new task in the space, then the check-ins of the current view, search
and Mine; the paused one (one per type, `lib/use-review-session.ts`) says "Resume 4 of 12" and, when
it covers another scope than this view, which, with Review this view instead beside it. Inside a
review, its header names the scope; a paused review keeps its original scope. On a phone it sits beside the view picker, with a removable Mine chip below. More offers
"Review all tasks in Main" (using the space’s name) for a whole-space sweep. Metrics and Agenda explicitly say Review all.
Inside a review, at most four buttons and never the status the task already
has: Keep in that status is Main (the one highlighted; a new task has none), Defer…, Done and
Drop are Grey (`ReviewDecisionBar`), other statuses are underlined links, Decide later quiet. On a big screen they are
centred under the task, the plan in a column beside it; on a phone a 2×2 tray at the bottom. Navigation (sidebar, tab bar, calendar grids), segmented controls,
chips, menu rows (`MenuRow`: icon, label, then a value, tick or caret; one look for every menu and
sheet) and the whiteboard keep their own looks; they are not buttons of these kinds.

**Bottom sheets** (`components/BottomSheet.vue`): every menu, picker, question and card that comes up
from the bottom of a phone is this one component: a dimmed page that closes on a tap, a rounded
panel with the grabber (pulled down it closes), kept above the keyboard (`keyboardInset`, at most
`sheetMaxHeight`) and clear of the home bar, 44px rows and 16px text boxes (`.vasta-sheet`), focus
moved in and given back, Escape (the top sheet only) and Back. It only emits `close`; the owner
decides. `desktop` draws the same content as a centred or top dialog on a wide screen; `tall` is the
object window (under the top safe area); `layer` is `surface` (z-40: a page's card) or `menu` (z-50).
Nothing else draws a bottom sheet.

**Back** (`lib/back.ts`): on a phone Back closes what is open instead of changing the page. Overlays
kept in the address (`?popup`, `?pane`, `?settings`) are closed by Back popping history, and closing
them goes back too (or replaces the entry when the one before is another page); they never register.
Transient layers (sheets, dialogs, the drawer, Review, Capture, the quick card, Search, a full-screen
board) register with `closesOnBack`. On a desktop Back is plain history and App.vue closes the
transient layers when the page changes.

**One "+"** (`lib/new-item.ts`): every New asks core's `newItemValues` for its starting values (the
view's filter, Mine, the day, the group, column and lane) and opens the quick card; nothing is made
until Add. A phone has one "+", the floating one: on a type's page it opens the card for that type
and view, elsewhere quick capture. A type's own New button is for wide screens.

**The shell**: the sidebar runs the full height with the space switcher on top; the top bar holds
back/forward and where you are (an object's type, then the object); the page is a rounded panel
(`bg-surface`, border, faint shadow) sitting on the canvas. On phones the panel is flat and full
width, the sidebar is a drawer, and the top bar shows the menu (and Back beside it on an object's
page, when there is history), the page and the bell. A bottom bar (`PhoneTabBar`) holds places only, as iPhone apps
do: Home, Tasks, Inbox, Calendar, Search; the one you are on is accent-coloured. The one "+" is a round
ink button above it on the right (it rises while a notice shows). The bar hides while the keyboard is
up (`keyboardInset`; a zoom is not a keyboard) or a whiteboard is full screen (`ui.surfaceFull`),
and pages get bottom padding so their last row clears it. Layers on a phone: bar and "+" 20,
the drawer and its backdrop 30, a review 40, sheets and notices 50 and up. Notices sit above
the bar, above the keyboard when it is up, and above a review's buttons (`ui.noticeLift`). Every `PopoverMenu` is a sheet from the bottom on a phone (dimmed page,
rounded top, safe area, 80% high at most and never more than the keyboard leaves (`sheetMaxHeight`),
full-width rows 44px, 16px text boxes; a modal dialog: a tap on the dimmed page closes it without
reaching what is underneath, focus moves in and goes back);
`anchored` keeps a panel. The context menu is a sheet too, its submenu replacing the list with a Back
row. A type page shows one "View ▾" button with the views in a sheet instead of tabs. A task's page
folds its fields into one outlined line under the quick actions, opened with a tap.

**Where objects open** (`lib/open.ts`, the one place that decides): a **window** over the page
(`PopupHost`, `?popup=<id>`; the default), the **side pane** next to it (`SidePane`, `?pane=<id>`),
or the object's own **page**. Views and queries say `openIn`, else their type does (Type settings ›
Open in: Window / Side pane / Its own page; unset is the window). A link in text, the sidebar and
quick capture open the page; ⌘K's results, notifications, mentions, the calendar and a row menu's
Open open it where its type says on a phone (the window unless the type's Open in is another) and
on its page on a desktop. Every New opens what it made, once Added, in the window. The window: centred over a dimmed page (a raised surface, 16px radius, soft offset shadow),
the object as in the pane (no comments or activity), **Open full page** and Close at the top; Esc,
Back or a click outside close it. On a phone it is a sheet from the bottom (grabber, Close and Open
full page at 44px). The pane: same surface and border as the
page; phones have none. The link of the object the pane shows is tinted (`bg-hover`).

**Quick card** (`QuickAdd`): every New of a plain object (a type page's, the sidebar's and top bar's,
a group's "+", a board column's "+", the phone's "+"). A large title (20px semibold),
**Add a note** (the type's text), the fields a row can hold as chips (field icon and name, the value
once set; not text blocks, formulas or fields shown only with a value), and a footer on the raised
surface: the type, the keys (↵ add · ⌘↵ add and open), Cancel, Open, Add <type> (Main). Nothing is
made until it is added; Enter adds and the card stays for the next one, with an "Added …" line
(Open, Undo). On a phone a sheet above the keyboard, chips in one scrolling row, 44px controls. Its fields start with
what the view on show filters on (`fillFromFilter` in core: what a filter states plainly, never
what it rules out), and go back to that after each add. On Today, a New from the sidebar or the
top bar puts today in the type's first date field.

**Sidebar top**: Calendar, Inbox and Tasks (⌘1, ⌘2, ⌘3, in that order), the places visited every
day, above the user's sections; Tasks is never listed again among the types. Today is not a row:
⌘D ("day"), G then T.

**Sidebar rows**: the open page's row is raised (surface, `ring-1 ring-line`, small shadow) rather
than tinted, so it reads as "the card you're on". Section carets and the "+" of All types show on
hover only (always on touch). The footer holds icon tools: Settings, theme, shortcuts, Trash with
its count.

**Pinning**: any type, view of a type or object can sit in one or more sidebar sections, mixed
(Tasks too, besides their row at the top). Every right-click menu on one, a view's tab included, has
"Pin to sidebar ›", a submenu with a checkbox per section (it stays open, so several can be ticked)
and New section…; the More menus of type and object pages open the same list, for the type and for
the open view. In the sidebar, rows drag within and between sections (⌥ copies), types drag in from
All types, links to objects or types (cards, list rows) and a type page's view tabs drag in from the
page, and section headers drag to reorder.

**Phones** (below 768px; touch is `hover: none`): nothing scrolls sideways. A table view is drawn
as list rows: its shown columns become the row's fields, on a quiet line under the title (the
first four with a value), its Quick actions column the next step line; "Show as table on this
phone" in the layout menu keeps the table for that view on that device. Row titles are 16px, every
control has a 44px tap area. A board shows one column at a time (85% of the width, snapping),
with a strip of the columns' names and counts that jumps to one. Questions that would open under
a small button (a quick action's day or text) rise as a sheet from the bottom, within reach of the
thumb.

**Subtasks**: a parent's steps sit under it in lists, indented 1.5rem a level (four at most), with a
caret before the parent that folds them for the session; rows of an outline keep the caret's place.
Any object with steps shows a small outlined count ("2/5"), green with "Ready to close" once all
are closed. A step listed without its parent says "in <parent>" on a faint line. On its page, a
Subtasks section under the quick actions: a quiet header with a thin progress line and "1 of 3 done", ruled rows (checkbox,
title, short due date), and an "Add subtask" line at the end; when every step is closed, a bordered
line "All subtasks done" with the type's Done action as a button.

**Row actions**: tasks have one leading completion circle. Rows open their object; their menu
and quick actions operate on that object only. Lists and tables have no row multiselect or bulk
action mode, on desktop or phone.
The row's menu is one function (`lib/object-menu.ts`, `objectRowMenu`) for every list, table, board
and query: Open, Copy link, Pin, the quick actions and steps while open, Move to trash; a place that
cannot change anything (a whiteboard card) leaves the last two out. On a phone every row has a ⋯ for it.
A collection (`ObjectCollection`) draws its layouts with `ObjectTable` and `ObjectRows` (the rows of a
list, and of a table on a phone), cards, board or agenda; `FieldValue` shows a field in a cell or a row,
`StepProgress` the "2/5" pill and `ShowMore` the end of a group drawn in part.

**A type's page** is `TypePage` with its parts: `ViewSwitcher` (tabs, or a phone's view button),
`ViewToolbar` (a desktop's search, Mine, Filter and arrange buttons) or `FiltersSheet` (a phone's),
both driven by one model (`lib/view-toolbar.ts`) whose menus are `ArrangeMenus`. **Filters are a
narrowing**: what a person adds in the Filter menu or sheet lives in the page and is gone when they
leave it; the view's own filter is shown apart ("This view: …") and never counted; Clear (and the
count) cover only the narrowing, search and Mine; **Save to view** copies the narrowing into the
view's filter (everyone's) and **Edit view filter** changes it on purpose. Done and Dropped are
hidden by a visible view filter ("Status is not Done, Dropped"), which "Show done and dropped" turns
off for this person only (a preference); `ReviewButton` and
the review (`lib/use-review-session.ts`); the views themselves are `lib/use-type-views.ts`.

**Grouped collections**: `GroupHeading` uses the standard Quiet button and 13px Phosphor
caret-down/right, beside the existing colour chip and full matching count. Plain group labels
fold with the button; tag, relation and person chips remain independent links beside the caret.
Group controls above the collection are Quiet Collapse all / Expand all buttons, disabled when
already in that state. A table retains one shared header, column widths and scroll area, without
frames around groups. Folded bodies (including Show more) are not drawn. On phones the standard
44px button targets apply and a table's row layout keeps the same folds. Choices stay personal
per account (every device), view/query instance and grouping field; new scopes start open. A board's
column folds work the same way (the view's saved `collapsed` is only what shows until you fold one).
Folding changes visibility only, not filters, task state or Review scope. Subtask and kanban
folding remain independent. Grouped query previews limit rows per group, keeping full counts.

**Embedded queries** have no frame: the page is the frame. The title line (icon, name, Edit query on
hover) reads as a small heading; a table inside one, or inside a whiteboard card, draws no box or
header fill of its own (`bare`) and its first column lines up with the text around it. Never nest
one framed surface in another.

**Review** (`ProcessMode`, with `ReviewDecisionBar`): the tasks of a review one at a time, in a
centred panel (full screen on a phone) over the dimmed page: which review and where in it (the new
tasks, then the check-ins) with Pause, the task in full (notes, steps) and the plan beside it
(status, dates, priority, project, next step, each edited in place), then the decision under it:
Keep, Defer…, Done, Drop, the other statuses as links, Back and Decide later (buttons and keys:
Buttons above). Another type's view review has its quick actions as the buttons. It ends with what
was done and "Review N left for later".

**Swipes** (`SwipeRow`, touch screens): on a row of a type with quick actions, a swipe right past 35%,
or a flick past 15%, runs the type's Defer (else its first quick action); a slower one past 40px
uncovers it as a button. A swipe left past 40px (or a flick) uncovers the other actions, Done first,
then More (the row's long-press menu). As on iOS a release is judged by distance and speed
(`lib/swipe.ts`), so a deliberate short swipe never springs back; an open row closes when swiped
back 40px, flicked back or tapped, and settles with an ease-out (no bounce). A review's card
goes past 25% of the screen, or flicked past 40px. One row is open at a time; a tap elsewhere closes it. On phones
swipes replace the row's buttons; tablets keep both. Swipes start 24px in from the left edge (the
drawer's). Done is a deep green, Defer the (light theme's) accent blue, the rest warm greys: fixed
shades, so the white labels stay readable in both themes. A tip says it once per account.

**Hover-only affordances**: secondary actions that would clutter an empty page (an object's Icon
and Cover buttons, section carets) appear on hover or focus, and are always visible on touch
screens (`[@media(hover:none)]:opacity-100`), which have no hover.

**Chips**: soft background, dark text of the same color and a hairline ring of that color
(`chipClasses`). One shape for types, select options and tags everywhere. A tag chip takes the
tag's color (its own, else its nearest parent's, else violet) and shows its path with the parents
faded: `recipe/`**`breakfast`** (`ObjectChip`, `lib/tags.ts`).

**Type icons**: in a rounded square tinted with the type's color (the default, as in Capacities) or
bare in that color, per device (Settings › Appearance, `iconStyle` in `lib/theme.ts`). Everything
that shows a type's or an object's icon goes through `TypeIcon`; emoji are never boxed. App
navigation icons (Today, Inbox, Settings…) stay bare and gray.

**Properties**: a two-column table: name | value, with a hairline between the columns and between
rows (`.vasta-prop-row`, `.vasta-prop-name` in `style.css`), shared by own and reverse relations.

**Settings**: one page of cards (`SettingsSection`), one per area, with a sticky side list that
marks the card in view on wide screens and a wrap of buttons above on narrow ones. Section
labels and icons live in `components/settings/sections.ts`.

**Today is a day in the calendar**: Today (⌘D, G then T, ⌘K, the desktop app's menu, `/day/…`; not a
sidebar row, Calendar is) opens
the calendar's Day view for today, not the daily note alone. The Day view is a page (`DayPage`):
what is scheduled that day, the daily note edited in place (`ObjectPage` with `embedded`) with what
refers to the day, and what was created that day. Today's note is started on open; other days wait
for "Start the daily note", so browsing does not litter empty notes.

**The month beside the calendar**: week, three-day and day views have a small month on the right
(toggle in the header, remembered per account). Dots under a day say what it holds, one color each
(`DAY_MARKS` in `lib/calendar.ts`): a daily note with text, tasks due, dated objects, references
(objects linking to the day's note or date objects), events. A legend sits under it and the day's
tooltip gives the counts. The dots follow the calendar's Show filters.

**Fixed views**: some built-in types open on a view of their own before their saved views (`FIXED_VIEWS`
in `TypePage`): Tags a Tree (sub-tags fold under their parent like folders, folding remembered per
account), Habits a Tracker (habits × the last 14 days, 7 on phones). They are not stored on the type.

**Habits**: checked off where the day is: the calendar's day view (in the side column under the
month, or as pills in the page when that column is hidden), daily notes (pills), the habit's page
(as many weeks as fit, up to a year: click to change, right click for an amount) and the Tracker. A
habit with a daily goal ("8 glasses") shows a ring filling toward it; a click adds 1, a right click
or long press types the amount; its squares fill from the bottom as far as the day got. Hovering a square shows its day, amount
and state at once (a tooltip, not the browser's slow title). A check shows at once and rolls back if the
save fails. Days a habit does not repeat on are shown faded ("day off"), never as missed.

**Food** (once a space tracks food, Settings › Food tracking): a Food block where the day is (the
calendar's day page under the habits, a daily note's page), never anywhere else. It leads with the
week's budget when the goal shares its week (eaten of the target, what is left, and on today how
much today may take), then the day against its goal (kcal and macro bars, amber past 105%), then
the meals with their entries. A past day with nothing logged is one line ("Log food" opens it); a
future day cannot be logged. "+" on a meal opens the picker: search (most eaten lately first), pick,
type the amount ("150", "2 fatias") with a live preview and the food's portions as chips, Enter;
it stays open for the next item and lists what was added; a food not found is made right there
(numbers as on the label, per any amount). A tap on an entry changes its amount or meal; right
click or long press for move, update from the food, open it, delete; a meal's menu copies it from
another day or saves it as a recipe. Foods and recipes edit their portions and ingredients on their
own page, under the properties.

**Nutrient colors**: kcal blue, protein pink, carbs yellow, fat green, fiber gray (`--color-kcal`…
in style.css, `nutrientColor` in lib/nutrition.ts), the same everywhere a nutrient shows: the Food
block's bars, a food's property rows, recipes' and entries' numbers (`NutrientLine`), the
Nutrition page. Always a dot or bar beside the nutrient's name, never colored text. Past the goal,
the bar keeps its color, the goal shows as a tick and the number turns amber.

**The Nutrition page** (`/nutrition`; ⌘K, a day's Food menu, Settings › Food tracking): the
week's budget first, then the last 7/30/90 days (stat tiles, a column chart, where the kcal came
from), then the goals over time with New goal. The calendar's month shows each day's kcal.

**Charts** (`components/charts/BarChart.vue`): one series of columns (≤24px, 4px rounded top,
square at the baseline) with an optional target per column as a hairline across its slot;
recessive hairline gridlines with compact ticks (0 / 1.5k / 3k); a column past its target in the
"over" color, with the tooltip saying so in words. Every column has a hover and keyboard-focus
tooltip (value first, then the day), and "Show as a table" holds every value. Colors are the
`--color-chart` and `--color-chart-over` tokens, checked with the dataviz validator for both
themes. One series has no legend: the heading names it.

**Keyboard shortcuts**: one list in `lib/shortcuts.ts`, which drives the handler, the ⌘/ dialog and
the hints (sidebar rows, ⌘K). Navigation uses ⌘1–3 for the sidebar's top rows in order (Calendar,
Inbox, Tasks; Things uses the same idea) and ⌘D for today, and works while typing (⌘D duplicates
blocks instead while blocks are selected in a note); "G then a letter" works outside text fields and in browser tabs,
where ⌘1–3 belong to the browser. Pages with their own single-key shortcuts (the calendar) skip
keys the app already handled (`defaultPrevented`).

## Open questions

- In the desktop app, an overlay title bar (traffic lights inside the top bar, like Capacities)
  instead of the native one. Needs a desktop release and the drag permission for the server's
  origin.
- Tabs or split view were set aside on 2026-10-19; the top bar has room for them if that changes.
  The side pane's `lib/open.ts` (a place to open an object in) is where they would plug in.
