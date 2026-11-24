# Changelog

What changed in each release, for the people who use Vasta. New entries go under **Unreleased**;
`scripts/release.sh` names that section after the version, and the release workflow puts it on the
GitHub release page.

## Unreleased

### Added

- **Boards grouped by a date: drag cards between columns.** Dropping a card in Today or Tomorrow
  gives it that day; This week gives it the first day after tomorrow, Next week and Later the
  first day of that week; No date clears it. A time of day, a range's end and a repeat are kept.
  Earlier (Overdue) takes no drops. **+ New** in a date column, swimlane or list/table group
  starts the item on that group's day.
- **Review tasks: Today in one press.** Every task in a review has a **Today** button (key `T`)
  beside Defer…, Done and Drop: it sets the Do date to today and goes on to the next task. A new
  task also moves to your first open status (Next); a task that already has a status keeps it.
- **Task reminders:** tick tasks done, move their Do date to tomorrow or another day, or open their notes without leaving the reminder. Due and planned tasks stay in place with Undo; handling every task answers the reminder for you.
- A pin button at the top of every page puts it on your Home (and takes it off again).
- **Home:** every person has their own Home page in each space, opened from the top of the sidebar, `G H`, or Home on the phone.
- **Widgets:** Add widget on your Home (or `/Widget` on any page) adds Agenda, Due soon, Planned, Waiting on, Pinned, Recently changed, a saved query, a page or block, Habits today, Food today or Quick capture. Your Home can use one or two columns.
- **Starting Home:** when a space opens on a page, its owner's Home is that page, and other members start from their own copy of it, with their own saved queries.
- **Upgraded our installation to Vasta 0.13.** Adds the app in five languages (our own screens
  stay in English), Settings › Object types with type templates, a Tasks sidebar on the calendar,
  automatic reminders set per space, and agents that can create and change types, while keeping
  our tasks, Review, phone, Home, habits and reminder customizations. Today's tasks reminders are
  skipped on days with nothing due, overdue or planned.
- **Upgraded our installation to Vasta 0.11.** Adds agent visibility, context and required-field
  settings, agent attribution, and persistent reminders while keeping our phone navigation,
  scoped reviews, task date roles, synced preferences, weekly habits and SparkyFitness imports.
  Completing a reminder follows the same review, recurring-task and habit rules as the app;
  imported habits are acknowledged without replacing their imported amounts.
- **Review tasks: one routine, few clear choices.** A task type's page has one **Review** button
  (with how many are waiting), beside New Task; on a phone it sits beside the view picker. It
  always starts with every **new** task in the space (no status, or an incoming one such as Inbox,
  whichever view you are on), then the **check-ins** of the view you are looking at, with its
  search and Mine: open tasks not reviewed for 7 days. The review header says what it covers, and
  on a phone Mine has a chip to remove it. Tasks go one at a time, with all their notes, Claude's
  take, their steps, and **the plan now**: status, due date, do date, priority, project and next
  step, each changeable in place. Under the task are at most four buttons, never the status it
  already has: a placed task has **Keep in Next** (it records today as the task's new **Last
  reviewed** day, so it comes back after the review interval), **Defer…** (your type's own Defer),
  **Done** and **Drop**; a new task has **Next**, Defer…, Done and Drop. The other statuses are
  links under them ("Move to Waiting · On hold"), and **Decide later** records nothing and keeps it
  in the queue. Keys on a computer: K (or R) keep, N next, F defer, D done, X drop, 1–9 the links,
  → later, ← back, Enter opens the page, Esc pauses; on a phone the buttons are a tray at the
  bottom, swipe right to defer and left to leave it for later. Undo takes a decision off again, and
  the end counts each task once ("Reviewed 6 · Done 3 · 4 left for later") with "Review 4 left for
  later" to go over those. A paused review keeps its place, one for each type, on this device: the
  button reads "Resume 4 of 12", opening a task's page and going Back returns to the same one, and
  starting another review of the same type asks first. If the paused review covers another view
  or search than the one you are on, it says which and offers **Review this view instead**. The
  page's ⋯ menu has **Review all tasks in Main** (your space's name), which ignores filters; Metrics
  and Agenda offer it too. Type settings › **Review** sets how often a task comes back (0: every
  time) and which statuses count as new (only no status or Inbox unless you tick others). A view's
  filter **Due for review** is the same check-in list, to show tasks only when they need a look.
  Any change of a task's status counts as a review (see "A changed status counts as a review").
- **Filters are a temporary narrowing.** On a phone's Filters sheet and a computer's Filter menu,
  what you add narrows the view for this visit only and is gone when you leave the page. The view's
  own filter is shown apart ("This view: Area is Work") and is not counted; the count and **Clear**
  cover only what you narrowed with, plus search and Mine. **Save to view** (shown when you have
  narrowed) adds it to the view's own filter for everyone who uses the view, and **Edit view
  filter** changes that filter on purpose. The phone's sheet has a Done button and says how many
  tasks the filters leave.
- **Your display choices follow you.** Which groups and board columns you folded, Show done, Mine,
  the view a type opens on (until you pick one it opens on its first view), the phone bottom menu,
  the Habits display, the calendar's view and Show menu, tips you hid, and the like are kept with
  your account, so they are the same on every device and nothing you fold or hide changes what
  anyone else sees. Page width, a pane's width and an unsaved capture stay per device. Values you
  already had on a device move over on first use.
- **Fold grouped views.** Use the chevron beside a group to hide or show its items, or Collapse all
  and Expand all above the groups. Its name and matching count stay visible (embedded groups count
  the matches beyond the preview); tables keep one shared header. Works in lists, tables, cards and
  boards (a board's columns), including embedded queries and phone rows. Folds are yours, kept for
  this view on every device you use, and do not change the view for anyone else, its filters or
  what Review covers.
- **Habits from SparkyFitness.** Connect a space to your SparkyFitness server with a read-only
  API key, choose how much history to bring in, then preview seven days before linking a habit.
  Steps, water and sleep fill its daily amount (they need a daily goal, which the link asks for;
  sleep is kept in the habit's unit, hours or minutes); named workouts and calories on target mark
  it done. Hand entries win, including clearing a day. A tap on a linked habit never saves a value:
  it opens the amount, shows what SparkyFitness gave and offers **Use SparkyFitness value** to
  take a hand entry away. Values refresh every 30 minutes, reading again from two days before the
  last good sync, so a long outage is caught up. The habit's page shows when it last synced and the
  last error, and the habit can be unlinked; the panel is hidden when the space has no connection.
  Disconnecting keeps filled days, or removes them with the links and the properties the connection
  added. The connection sits above Delete space in space settings.
- **Habits by the week.** A habit has a new field, **Times a week**: set it to 3 and the habit counts
  by the week (Monday to Sunday), on any days. Today's list, the Tracker, the habit's page,
  reminders and the agent tools say "2 of 3 this week", count streaks in weeks, and stop asking
  once the week's goal is met. A space that already had a field with this id keeps its own.
- **Habit progress.** The Habits page has a **Progress** tab beside Tracker: how much of what your
  habits asked for got done over the last 4, 8 or 13 weeks, as a percent with "94 of 120", a chart
  and a row per habit with its goal and its own weeks as small columns. There are two charts, a
  trend line or a calendar of done days, and one range. The Tracker's **Display** button, beside
  Filter, chooses where progress shows (above the habits, beside them — below them on a phone — or
  off), the chart and the range, the same ones as on the tab: your own choice on every device you
  use (the habit type's saved setting is only what shows until you pick). It starts with the
  calendar above; settings saved when there were more charts read as the nearest of the two. On a
  phone each habit is one row, as in the Habit Tracker app: its whole name, "2 of 3 this week" or
  its streak, its last two weeks as ticks (a day a "3 a week" habit does not need is never shown as
  missed) and a round check for today; a long press on a tick changes that past day. It works
  offline. The agent tools' `list_habits` can add the same numbers (`weeks`).
- **Pauses with dates.** A habit's page has **Pause** and **Resume**, and lists its pauses with a
  first and a last day to change. Paused days are days off in the Tracker, Today, the calendar,
  streaks, progress, reminders and the agent tools: not asked, not missed. A habit that was paused
  before is paused from the day of this update.
- **One number for how a habit is doing.** The Habits Tracker's last column is **4 weeks**, and a
  habit's page says **Last 4 weeks** and **This week so far** (days still to come no longer count),
  all counted the same way as the Progress tab and the agent tools (it was the last 30 days,
  counted differently for weekly habits).
- **Objects in a window over the page.** A click on an object in a list, table, board, query,
  the calendar, Search, notifications, a mention or a row menu's **Open** — and every New — opens
  it in a window over what you were looking at, a sheet from the bottom on a phone, instead of
  taking you to its page. In it the object is read and edited as on its page; Esc, Back, a click
  outside or **Open full page** leaves the window. Closing it goes back a step, so the next Back
  leaves the page instead of opening the window again (reading three tasks costs one Back), and
  **Open full page** takes the window's place, so one Back returns to the list. On a phone the
  window sits above the keyboard and under the notch. Type settings' **Open in** chooses the window
  (the default), the side pane or its own page, and a view's layout menu can choose for itself.
- **One way to start something new: the quick card.** Every New (a type page's New button, the
  sidebar's and the top bar's New, a "+" on a group's header in a list or table, a board column's
  "+") opens a small card over the list: a large title, **Add a note**, and the type's fields as a
  row of chips (Status, Due, Priority…). Nothing is made until it is added. Enter adds it and the
  card stays for the next one, saying what was added (with Open and Undo); ⌘↩ or **Open** adds it
  and opens it in the window; Cancel, Esc or a click outside leave nothing behind. The card starts
  with what the view you are on filters on (on a Work view, Area is Work), with you as Assignee
  while Mine is on, and with the group, column or lane you added into, so what you add shows there;
  on Today, a New is dated today. Types with a default template keep their flow on a computer, and
  a template button stays on a phone. On a phone the card is a sheet from the bottom, and there is
  one "+", the round one above the bottom bar: on a type's page it starts a new item of that type
  from the view, with a "Capture a note instead" link; elsewhere it opens quick capture.
- **Quick capture made for a phone.** It says where the text will go, lets you pick Note or a type
  (no need to type "/Book"), and has a Save capture button above the keyboard (Return adds a line).
  The types you create most (in the last 90 days, four) are offered first, the rest under More….
  Text you have not saved is kept on this device and comes back next time, with Discard, also after
  the app is reloaded, and on a computer too.
- **A phone layout that fits the hand.** A bar at the bottom goes to Home, Tasks, Inbox, Calendar
  and Search, with the round "+" above it. Pickers and menus (a status, a date, a long-press menu)
  rise from the bottom with larger rows and stay above the keyboard. A type's page shows the view
  picker and a Filters button on one row, with a count of what is on; Filters opens a sheet with
  Search this view, Mine, the filters and Arrange (sort, group, layout, fields). A task's fields
  fold into one line under its buttons, and its page has Back at the top. Every row has a ⋯ button
  with its actions, so nothing needs a long press to be found.
- **Choose your phone bottom menu.** Settings › Appearance › Phone bottom menu lets you pick one
  to five places (including Today, Settings, **Menu**, which opens the side menu within reach of
  your thumb, and your object types), reorder them with arrows, or reset to the original menu.
  Changes appear immediately, belong to you on every device (you can set it from a computer too),
  and are the same in every space; a type shows in each space that has a type of that name.
- **Quick actions: buttons that change an object in one click, on any type.** Type settings ›
  Quick actions sets them up. They show on its objects' pages, as a view's row buttons, in a
  **Quick actions** column and in Review. Each sets fields to a value, a day (today, tomorrow, next week, in N days), you (people),
  nothing, or asks for the value when pressed (a day, a line of text). A task type starts with
  **Mark done**, **Defer…** (sets the Do date, see "A task's dates mean something"), **Drop** (a
  second "done" status such as "Dropped"; without one there is no Drop) and Next step; another type
  starts empty. Turn on "Quick actions" in a task view's menu or a query's settings and every open
  task's row has its actions, with a text property chosen in Type settings › Quick actions shown
  under the title as the next step. On a phone they go under each title, so nothing scrolls
  sideways. Done, Defer and the others save at once, so a failed save says so instead of showing a
  "Done" notice, and every one has Undo.
- **Subtasks: split a task into steps.** Turn it on in Type settings › Subtasks (it can add a
  "Part of" field, or use one you have). A task's page lists its steps with how many are done; type
  a step and press Return for the next, or paste several lines at once. New steps take the task's
  Area, Project, people and tags. Lists show the steps under their task, folded with its caret, with
  a "2/5" count, and "Ready to close" once all are done, with a button for the type's Done (the task
  is never closed for you). Closing a task with open steps, however it is closed (Done, Drop, a
  board drag, a review), asks once "Close its 3 open subtasks too?" with **Close them too** or
  **Leave open**; they close with Done, or Drop when the task was dropped, and one Undo puts the
  task and its steps back. "Nest subtasks" in a view's layout menu or a query's settings lists them
  flat instead. A row's menu has Add subtask…, Make subtask of… and Remove from parent. Marking a
  step done shows a notice with Undo.
- **Tasks on a phone: swipe a row.** Swipe right to defer a task (pick the day in the sheet that
  rises from the bottom); swipe left for Done, Drop, Next step and More. A quick flick counts as
  much as a long drag; a short, slow swipe uncovers the button, and swiping back closes it.
  Long-press a row for the same actions in its menu. On a tablet the buttons stay and the swipes
  work too. A subtask in a task's page swipes the same way.
- **Tables fit a phone.** A table view is drawn as rows on a phone, with its columns as a short
  line under each title, so nothing scrolls sideways. "Show as table on this phone" in the layout
  menu keeps the table for that view on that phone.
- **Boards on a phone show one column at a time**: swipe sideways and it snaps to the next column,
  or tap a column's name in the strip above (with its count) to jump there.
- **Apple Mail links work in notes.** A link to an email (`message://…`) stays a link in the editor and in previews, and opens Mail when clicked, also from the desktop app.
- **An embedded query can be shown compact**: just its results, without the header bar and the
  border, for a page that has its own heading above each list. Pick Show as → Compact in the
  block's menu; Edit query and Open query move there. A compact query that finds nothing
  disappears, with the heading right above it; it stays while it loads, while its settings are open
  and when the query fails, and while you edit the page it shows a faint "Nothing here yet".
- **An embedded block can be shown compact** too: just its content, without the frame and the
  object's name (a colored group without its panel), and nothing at all while the block is empty,
  for a block another page or a script keeps up to date. Show as → Compact in the block's menu;
  Open block moves there.
- **An Agenda layout** for queries and type views: the next few days from today, one section
  each, for a home page. What the query or view selects that has a date shows under its day:
  all-day events as chips in one wrapping row, then timed items in time order with a thin line
  marking now and what is over faded, and tasks keep their checkbox. Options set the date field to
  place things by, how many days (1 to 14, three by default) and whether to include the events of
  your subscribed calendars, all or some. Drag a task or an event of your own to another day (after
  a long press on a phone) to move that date there; a timed one
  keeps its time of day, and dragging near the top or bottom scrolls to days off screen. A build
  without the layout shows it as a grid.
- **Choose what a space opens on**, in Settings › Space: its first pinned item (as before), Today,
  or any page.
- **"Next week" in date pickers**, beside Today and Tomorrow.

### Changed

- **Dragging on the calendar moves the date you drag**, as in Vasta itself: a task's Due chip moves
  its Due date, its Do date chip moves its Do date, with Undo. A task dropped from the Tasks
  sidebar gets that Due date.
- **Habits on a phone: earlier days are easy to fix.** Pick any of the last two weeks to use
  each row's round check for that day, or tap a habit's ticks to open all fourteen days as large
  checks. Plain habits offer **Done** and **Not done** instead of asking you to type 1 or 0.
- Text sizes are the same across Today, Home's lists and widgets: section headings match, and
  small text is one size.
- **The tasks reminder lists planned work.** Besides tasks due today or overdue, it now lists open
  tasks planned (Do date) for today or earlier under "Planned today"; a task in both appears once,
  under its due date.
- **One Done, everywhere.** The circle on a list, table, card, query or calendar row, a subtask's
  circle, the Done button, a swipe and a board drag into a Done column all run the task type's own
  Done action, so a Done you customised (extra changes, another name) behaves the same wherever you
  press it, with the same notice and Undo. Dropped tasks look dropped everywhere: a cross in the
  circle, as on the calendar, instead of looking just like Done. "All subtasks done" in a task's
  page offers the type's Done, not whatever action comes first.
- **A task you mark Done stays where it was until you leave.** On a type's page (in every layout:
  list, table, phone rows, cards and board, plus the Done button, swipe and menu), in an agenda, in
  a list embedded in a page (Home's Today, a project page, a dashboard) and on the Calendar page, a
  completed task keeps its place, shows a checked circle and a muted, struck-through title, and
  counts as done. It only leaves when you reload, leave the page, switch views or change the
  filters, sort or layout; searching keeps matching rows. A list whose last open task you complete
  keeps that task in view instead of saying nothing matches. Uncheck it, or press Undo in the
  notice, to put back everything the completion changed, not only the status (a Next task returns to
  Next). A repeating task says "Done this time · Next: <date>". A failed save puts the task back
  with a Retry. Its Done, Defer and Drop buttons are hidden meanwhile, leaving the circle and Undo.
  On a board, the card stays in its column; dragging it to a Done or Dropped column still moves it
  and runs that status's action, with the same notice and Undo as the Done button. On a phone,
  opening a task, marking it Done and going Back shows the list fresh, without it.
- **Done and dropped tasks are hidden in every view, the calendar and embedded queries.** A task
  list shows what is still open, so the rows you can swipe come first. Views hide them with a filter
  you can see, **Status is not Done, Dropped**: new views and new queries of tasks start with it,
  and your existing views and embedded queries got it once. Turn on **Show done and dropped** in a
  view's filters (Filters on a phone, Filter on a desktop) to list them again: it is your own choice
  for that view, on every device you use, and does not change the view for anyone else. The filter
  count and **Clear** leave it alone. On the Calendar page, tick **Done and dropped tasks** in the
  Show menu to show them (remembered for you). A view that asks for a closed status ("Status is
  Done") and a board with a Done column show them as before. The count at the top of a type's page
  counts what the view shows.
- **A changed status counts as a review.** Whenever a task's status changes (Done, a board drag, a
  status picked on its page, the agent tools, a device working offline), its Last reviewed day
  becomes today in your time zone, unless that save sets the day itself. Undo puts the earlier day
  back with the status. In a task's history the change shows as "Last reviewed" next to the status.
  The Last reviewed day is not an entry on the calendar or in agendas.
- **Reopening a task from the calendar goes to a to-do status.** Unticking a done or dropped task
  (including the cross on a dropped row) sets the first to-do status that is not incoming, so a
  reopened task no longer falls back into the review's new tasks.
- **Only Inbox tasks are new in a review.** A task type with no Inbox status (the built-in Task)
  used to count every To do task as new, in every review, forever. Now new means a task with no
  status, or one in an Inbox status (or the statuses you tick as incoming in Type settings ›
  Review); To do tasks are check-ins.
- **A task's dates mean something.** Each task type has a **Do date** (the day you will work on it)
  and a **Due** date (the deadline); Type settings › a date's Meaning says which is which (a new
  Task starts with both, and your existing task types were given them: the date your Defer set, or
  a new "Do date", is the plan). The calendar, Review, Defer and Claude all read them the same way.
  **Defer…** (one name on rows, pages and Review) plans the work: it sets the Do date
  and keeps the deadline, a timed date keeps its time of day (also across a clock change), and a
  repeating date moves only this occurrence. Planning after the deadline shows a warning, and the
  question's box "Also move the due date, if the new day is after it", unticked, takes a
  deadline along when you want it to; a repeating deadline never moves. A task's date picker shows
  the other date and, when the deadline now falls before the plan, offers to plan for it too. A
  repeating task you finish moves its due date to the next occurrence and clears a Do date on or
  before the day just done.
- **Defer questions are quick to answer.** The Defer question names the task, picks no day until
  you do (today is only marked as today), and has Cancel and Save, on a computer as on a phone,
  where it is a sheet along the bottom within reach of the thumb, with larger days and month arrows
  and Save in reach when it has to scroll. **Tomorrow** and **Next week** save at once, with Undo in
  the notice, unless that day is after the deadline: then the warning shows and Save waits. Any
  other question (a next step, a number or link) shows Cancel and Save too, and a next step's sheet on a
  phone has a Save button. If saving fails, the question stays open with what you typed and
  offers Retry; a second tap while saving does nothing.
- **Calendar plans and deadlines are clear.** The Day view separates planned work, deadlines,
  completed tasks and dropped tasks. Empty circles mean unfinished work; a checkmark means done.
  A task's plan and deadline on the same day are one entry with both badges (Planned, Due) on the
  Day view, week, month, agendas and the small month's dots alike, and each task shows its other
  date. A date that is neither (a "Check back") shows its own name. Planned after the deadline is
  marked with a warning on every chip and row. There are no extra Reschedule buttons on the calendar.
- **Overdue.** Today (the calendar's Day view for today) and every agenda start with an Overdue
  section: open tasks whose deadline or plan is before today, each saying what is late ("Due Tue",
  "Planned Mon") with a one-tap **Move to today** that plans it for today, keeps the deadline, and
  can be undone. A repeating task counts only at its current occurrence.
- **One row menu everywhere.** The menu of a task, note or other row is the same on a type's page
  and in a query: Open, Copy link, Pin, its quick actions and steps, and **Move to trash** (queries
  did not have it).
- **Inbox: "Clear".** An inbox item's button is **Clear** (and **Bring back**), and the list says
  "Show cleared". A word you chose in Settings › Inbox stays: the button reads "Mark" and your word.
- **Buttons that look like buttons.** Buttons come in a few consistent kinds: the main action in
  dark ink (New Task, Save), a light blue one for a way into a feature or the action a page leads
  with (Review, Mark done), and grey for everyday actions (Cancel, Defer…, Drop, Sync now).
  Settings' outlined buttons and dialogs' plain Cancel are grey now. The same kinds run through
  Review, Quick capture, comments, type settings and templates, sprints, subtasks, the calendar's
  quick create and event details, food logging and the Nutrition page, Trash (Empty trash and
  Delete in red, Restore grey), Settings, password and login, and a notice's Undo. A task's page
  buttons are named with verbs (**Mark done**, tinted so it stands out, **Defer…** and **Drop**);
  an existing type keeps its names (Type settings › Quick actions), and none is filled, so none
  looks like the task's current status. On a phone buttons, the page's ⋯ and a notice's Undo and
  close are full finger size, and a notice with Undo stays while your finger or pointer is on it.
- **Grouped tables read as one table.** Column headings appear once above all groups, with aligned
  columns and a shared horizontal scroll. Group labels and counts stay, as shaded rows inside the
  same rounded box an ungrouped table has, so a type's views look alike grouped or not.
- **Queries in a page lose their boxes.** An embedded query is no longer a framed card holding a
  second framed table: its title sits in the page like a small heading, the results follow with only
  a hairline between rows, and Edit query shows when you point at it (always on touch). The same
  table on a whiteboard card loses its inner box. Tables everywhere drop the shaded header row.
- **Whole titles on a phone.** Task lists, search results, a page's links and a tag's list wrap
  long titles onto more lines instead of cutting them off. Phone task rows no longer show when a task
  was last edited or keep a blank indent for subtask arrows, so the title has the row's width.
- **The page a space opens on is calmer**: its icon is a small tile beside the title, and the tags
  row and the "Add property" line show only once there is something in them. Tags and Property
  join Icon and Cover in the buttons that appear when you hover the page's top, so they stay
  one click away. Other pages look as before.
- **Dates on list rows are shorter**: this year's show as "Tue Nov 17" (or "Tue Nov 17, 9:00 AM"
  with a time), without the year. Other years, tables and boards are unchanged.

### Fixed

- **Review tasks: scheduling a new task settles it.** Defer… on a new (Inbox) task used to save the
  day and leave the task in Inbox, still waiting in the review. It now moves to Scheduled (or your
  first open status when there is none) and the review goes on to the next task. Tasks that already
  have a status keep it.
- **iPhone: the line you are typing in a note stays above the keyboard.** Writing low in a note, or at the end of a long one, went on behind the keyboard and its toolbar (also in a note opened in a window).

- **Back on a phone with Type settings open** closes them and leaves no `?settings=1` behind, so a reload no longer reopens them. Menus kept by their button close on Back too, and going back to a list no longer fights a scrollbar drag or a key press while it finds its place.

- Subscribed calendars show times without a zone in the zone the feed names (X-WR-TIMEZONE) instead of yours. A swim club feed set to Mountain time showed a 5:20 am practice in Toronto as 3:20 am. Feeds naming America/Edmonton are read by Alberta's pre-2026 rules, which their servers still use.
- **Overdue tasks read normally on a phone.** In an agenda's Overdue list (on Home, for one), a
  task late on both dates had its title squeezed to one letter per line beside its "Due" and
  "Planned" labels, and lost its Today button. The title now uses the row's width, the labels
  follow it (under it when there is no room), and the empty time column is gone on phones.
- **Calorie-limit habits wait for the day to end.** A habit done by staying under your calories
  (SparkyFitness "Calories on target", or "kcal, at most" and "Day on target" from food) no longer
  shows as done in the middle of the day while you are still logging food. Today shows as not
  needed yet, and the day is counted once it is over.
- **Saving an object after going back to an older version no longer blanks newer details.** Objects
  are saved by changing only the fields Vasta knows, so details a newer version stored (such as who
  or what made a change) survive.
- **Moving a task stops its old reminder.** When you put a task off, drag it or change its date, the
  reminder that was asking about the old time ends, and one starts at the new time.
- **Telegram says when a task isn't closed.** Typing a reminder's text for a task with open steps
  now answers "Not done" with the reason, and the reminder keeps asking.
- **A habit unlinked from SparkyFitness reminds like any other habit.** Marking it done from a
  reminder works again; old imported amounts no longer make it acknowledge-only.
- **Agents find the visible habit by name.** A trashed or hidden habit with the same name no longer
  gets picked instead.
- **A type changed elsewhere shows at once on an open page**, also in a browser that works without
  the offline copy: views, filters and settings edited on another device or by an agent used to
  appear only after a reload there. A filter you are typing in is never overwritten meanwhile.
- **Saving a type never undoes another change.** Type settings, a view's settings, a new select
  option or property, and a duplicated or renamed view each save only what they changed, in order, so
  a view made while Type settings was open, or on another device, is no longer overwritten.
- **A link to a type of another space** (its page, e.g. Habits) opens that space and shows the
  page, as a link to an object already did; it used to stay blank, then flash "Type not found".
- **Swiping back on an iPhone goes back.** A swipe from the screen's left edge could leave you on
  the same page: it also started opening the side menu, and Back then closed that menu instead of
  leaving. The edge swipe now only goes back; the side menu opens from the ☰ button (or Menu in the
  bottom menu) and still closes with a swipe left. Going back to a list returns to where you had
  scrolled, and a page you open starts at its top. Tapping the bottom-menu place you are already on
  no longer adds a step to Back: it scrolls to the top (Calendar goes back to today).
- **Back on a phone closes what is open instead of leaving the page.** With a menu, a question such
  as Defer, the Filters or View sheet, the side menu, Search, Quick capture, the quick card, a
  full-screen whiteboard, a review or a dialog open, Back (the button, or swiping from the edge)
  closes it and you stay where you were; in a menu's submenu it goes back to the menu. Before, the
  page behind changed and a sheet like Defer stayed open over another page. Quick capture keeps
  what you typed for next time. Every sheet is the same one now: the same backdrop, the same safe
  space above the keyboard and under the home bar, tap outside to close, a bar at the top that can
  be pulled down to close it, as on iOS, and 44px rows. Escape closes the sheet on top only.
  Dialogs stay above the keyboard. On a computer, Back puts away Quick capture and the quick card
  instead of leaving them over the page that came back.
- **Enter in ⌘K always takes the top row of what you just typed.** Opening the palette again after
  picking a lower row could make Enter do nothing, so a line like `/food 300 kcal at snack` was not
  logged and the palette stayed open. A ⌘K pressed while the app is still loading opens the palette
  once it is ready instead of being lost.
- **The desktop app's quick capture says where a capture goes.** With "Add quick captures to the
  daily note" off (the default), the capture box and the capture panel no longer promise "in
  today's note": they name the space, or the inbox when only that is on.
- **Phone controls are easier to use.** View, Filters, template choices, filter-building buttons,
  board column chips, the fields and columns ticks and "Open type" in a page's ⋯ menu have
  full-height touch targets. Capture types wrap in a bounded picker without keyboard-only hints;
  subtasks have a visible Add button. Lists scroll clear of the round "+", including while a notice
  shows. Faint text and placeholders are more readable in both themes. On a phone a notice no
  longer hides behind the keyboard, a picker's search box stays on screen while you type, and the
  "Make subtask of…" search and a board's new card no longer zoom the page. A type's page names
  itself once (the top bar), not twice.
- **A menu on a phone stays open when the page moves under it.** The ⋯ menu of a day's Food block
  (and any menu shown as a sheet) closed itself the moment the page scrolled, which opening it can do.
- **Quick capture saves with no connection.** On a phone or computer that could not reach
  the server (Tailscale off, no signal), Save capture showed "null is not an object" and saved
  nothing. It now saves on this device and reaches the server when the connection is back, like
  the other changes made offline.
- **Copy link works where the clipboard is blocked** (such as the server's plain-http address): it
  copies another way, and failing that opens the phone's share sheet or a box with the link to copy
  by hand, instead of only saying it could not.
- **No connection says so in words.** A change that cannot reach the server says "Couldn't reach the
  server. Check the connection and try again." instead of the browser's "Load failed".
- **Undo after Done on a repeating task** puts its date back on the occurrence it had; it stayed
  on the next one.
- **The ⋮⋮ handle of a block in a second or third column** sits in the gap before that column
  and holds still while the pointer goes to it. It sat at the page's left edge, so on the way the
  pointer crossed the first column and the handle jumped to a block there.

## 0.13.0 (2026-11-23)

### Added

- **Manage object types in Settings & create types from templates.** **Settings › Object types**
  lists every custom and built-in type in a grid so you can edit or delete types from one place.
  Creating a new type (from Settings, the sidebar or ⌘K) opens a dialog with **Create your own**
  front and center — with icon and color pickers — alongside a growing template catalog (starting
  with **Books**). When a template includes relations to other template types (like *Author → Person
  → Organization*), you can import the referenced type too in a chain, link an existing type in your
  space, or ignore the property.
- **Schedule tasks from the calendar sidebar.** The calendar's right panel now switches between the
  mini month and a **Tasks** sidebar (available in Month, Week, Three-day and Day views). Drag open,
  overdue or all-day tasks straight onto an hour slot to timeblock them as a 1-hour resizable block
  (or onto the all-day row or a month cell for a day-only date), drag blocks back onto the sidebar
  to clear their date, add tasks inline, filter by saved views or "Mine", and opt in custom types
  that have a date property — shown with a colored type chip when multiple types are enabled.

## 0.12.0 (2026-11-21)

### Added

- **Agents can make types.** Through the MCP, Claude Code or Codex can create a type (its
  description, properties and rules) and change one: rename it, describe it, set its rules and add
  properties. Removing or changing properties stays yours.
- **Pin a view to the sidebar.** "Pin view to sidebar" in a type's "…" menu, a right-click on the
  view's tab, or the tab dragged into a sidebar section puts that one view, such as a "Today" view
  of Tasks, in the sidebar; its row opens the type on that view.
- **Group by a date.** Views and queries can group by a date field: Earlier, Today, Tomorrow,
  This week, Next week, Later and No date. Boards show the date groups as columns or swimlanes,
  without moving or adding cards between them.
- **Choose the fields on a list's rows.** In a list view or query (also one embedded in a page),
  the new **Fields** menu picks what follows each title, a due date, a status or any property, puts
  them in order by dragging, and can wrap long titles. Only fields with a value show; without a
  choice, rows keep their tags and last-edited time.
- **Page width, on this device.** Settings › Appearance offers **Standard**, **Wide** or **Full
  width** for object pages and daily notes. Standard keeps text at its usual width and gives
  notes built with columns more room; side panes and whiteboards keep their own layout.
- **Automatic reminders for tasks, events, habits and food are configured per space in Settings › Reminders**,
  with timed tasks separated from timed events and a style picker for each (simple notification,
  pop-up, full screen, repeating notification, escalating or relentless). Pausing a custom reminder
  on an object also silences the automatic reminder for it.
- **Skip empty reminders.** Reminders showing today's tasks now skip days with no due or overdue
  tasks by default (configurable per rule, and available for tag and query reminders too).
- **Five languages in the app.** Vasta is now available in **English**, **Português**,
  **Español**, **简体中文** and **日本語**. It follows your browser or system language by default
  (falling back to English), and you can pick one per device in **Settings › Appearance › Language**;
  dates, numbers, calendar week start and built-in types/properties follow the chosen language
  (keeping any built-ins you renamed untouched).

### Changed

- **Settings › Reminders is scoped to the current space.** Switching spaces now shows only that
  space's rules, ongoing alerts ("Going on now") and automatic reminders, and new reminders save to
  the open space. Delivery channels, quiet hours and others' work notifications stay account-wide in
  Settings › Reminder channels.

### Fixed

- **A type's rules (needs a cover, needs a tag) are saved on the server.** Set in a type's
  settings, they stayed on that device and Settings › This device said the server did not take
  them. Set them again once: turn the rule off and on.
- **A type opens on the view you last picked in it** only once you pick one: the view it opened
  on by default was remembered too, so reordering views later didn't change where it opened.

## 0.11.0 (2026-11-17)

### Added

- **Reminders have styles.** Pick how a reminder reaches you: **Pop-up** (a window of the desktop
  app floats over everything until you answer), **Full screen**, **Notification**, **Escalating**
  or **Relentless**, or set its steps yourself with **Custom**. The pop-up needs Vasta for desktop
  0.11; it has rounded corners like the rest of Vasta.
- **Once you answer a pop-up or full-screen reminder, Vasta gets out of the way**: the app you were
  in comes back. Or pick a note for it to open instead (**Once I answer › Open a note…**).
- **Agents can set up reminders.** Claude Code, Codex and other agents connected through the MCP
  can list your reminders with their stats, make and change them (by style or step by step,
  showing a tag or a saved query by name), remove them, and start one right now so you can see how
  it feels.

### Changed

- **Insistent reminders are now just Reminders**, in Settings › Reminders, with their editor in
  parts: when it starts, what it shows, how it reaches you, how you answer it. The channels they
  and the habit, event and food reminders go through are Settings › Reminder channels.

### Fixed

- **A reminder answered by typing waits for Enter.** It took the phrase as soon as most of it was
  typed, before you finished.
- **Edit** and **New reminder…** in Settings did nothing once a reminder had been opened for
  editing.
- **Desktop (macOS): clicking a reminder's notification opens it.** The app now sends
  notifications through macOS's current notification system, which reports the click; macOS may ask
  once to allow Vasta's notifications.

## 0.10.0 (2026-11-17)

### Added

- **Insistent reminders.** A reminder that keeps asking until it gets a real answer. Set one on
  any habit, task, event or note with **Remind me…** in its menu, or on its own in Settings ›
  Insistent reminders ("an affirmation every morning"). It starts at the object's own time, at a
  time of day, or the first time you are at the computer after an hour; it shows the object,
  random notes with a tag or from a query, or today's tasks; and it stops only when you answer:
  OK, doing the habit or task, typing its text, or saying it out loud (which also marks the habit
  done). Until then it repeats every few minutes and climbs a ladder of channels you choose:
  phone, desktop, ntfy (up to its highest priority), Telegram (with buttons, or reply with the
  text), and at the top the desktop app taking the whole screen, which always offers a way out
  after a few seconds. Snoozing works, but every few snoozes climb a step; "Not today" asks why.
  Quiet hours hold everything. Each reminder has honest stats: how often it was done, snoozed,
  skipped (with your reasons) or ignored, so you can tune it.

### Fixed

- **Updating the desktop app looked like it did nothing.** After Install and Restart, the update
  downloaded with no sign of it, which takes minutes when GitHub serves it slowly. The window now
  shows how far the download is, then that it is installing; clicking again while it downloads
  no longer starts a second download.

## 0.9.0 (2026-11-17)

### Added

- **Instructions for agents.** Settings › Agents has a text box per space ("read the page About
  me first; save quotes as Echo with an Author") that every agent connecting through the MCP
  receives, so you no longer set up a CLAUDE.md or AGENTS.md on each machine.
- **Agent context and recall.** Mark any object as agent context from its ⋯ menu (a profile, your
  preferences, a project page). The new MCP tool `recall` gives an agent, in one call, the space's
  instructions, those objects with their text, and what matches a topic (`vasta recall` in the CLI).
- **Keep things from agents.** Per space, in Settings › Agents: make the space read-only for
  agents, hide it from them entirely, or hide every object with certain tags (and the tags nested
  under them) from search, queries, backlinks and recall.
- **See what agents wrote.** What an agent creates or changes is marked with its token's name:
  "Edited by arie via Claude Code" on the object and in its activity. Queries can filter on
  "Created by agent" and "Last edited by agent".
- **Required properties, covers and tags.** Make any property of a type required (in its
  settings, next to "Hide when empty"), and ask for a cover or at least one tag in the type's
  Rules. Agents and API scripts can't save an object without them (the error says what is
  missing); in the app the object shows a warning instead, so you are never stopped mid-edit.
- **Agents can move objects to the trash** (`trash_object`, `restore_object`; `vasta trash` and
  `vasta restore`), never delete them for good: you can restore them for 30 days.
- **"Copy link to page" in object menus**: the right-click menu of an object in the sidebar, a
  type view or query results, and the ⋯ More menu of an object's page and side pane now have a
  "Copy link to page" action. It copies `<server>/o/<id>` in the browser and `vasta://o/<id>`
  in the desktop app, matching existing block-link behaviour.

### Changed

- **Type descriptions reach agents**: an agent reading or creating an object gets its type's
  description with it, and follows the conventions you wrote there.

### Fixed

- **"Pin to sidebar" on Tasks did nothing**: the sidebar left Tasks out of its sections, as they
  have their own row at the top. Pinned to a section, Tasks now show there too. New spaces no
  longer pin Tasks, since they have that row; in an older space, Tasks may show once under Pinned
  (Remove from Pinned takes it away).

## 0.8.0 (2026-11-08)

### Added

- **A type opens on the view you last picked in it**, per type, on this device (it opened on its
  first view before).

### Changed

- **A repeating task set to done is due next time**: it keeps its to-do status with its due date
  at the next occurrence, as in other reminder apps; done on the last occurrence of a series that
  ends, it stays done, and another status meaning done (a "Dropped") ends it. On the calendar,
  only the occurrence it is due next has a checkbox (the first one not cancelled), and every
  occurrence of a series that ended shows as done. Done from two devices at once completes one
  occurrence, not two. Before, done finished the whole series.

### Fixed

- **A query embedded in a page** keeps its settings open while you edit them; they closed after
  each change, in the middle of setting up a filter.
- **Daily note templates on the calendar.** When the Daily note type has a default template, a
  day without a note shows a Start the daily note button that makes it from the template; the box
  to write in hid the template until something was saved.
- **A link to an object of another space** opens that space and shows the object's text and
  properties; only its title showed before.
- **Whiteboards**: on touch screens, zooming with two fingers keeps its anchor under the fingers
  without sliding or flashing on an iPad; fingers pan and only move what is already selected, while
  tapping selects an element or arrow (or clears the selection on empty space).
- **A link or embed** no longer loses its title and preview when its object is saved while its
  summary is loading.

## 0.7.1 (2026-11-07)

A hotfix for [0.7.0](https://github.com/ariedotme/vasta/releases/tag/v0.7.0).

### Added

- **Loose arrows on whiteboards.** The arrow tool dragged from empty space draws an arrow
  between two points, not joined to elements (from an element it still connects two elements).
  It takes the arrow tool's look, changes like any arrow in the selection bar (course, ends,
  line, width, color), moves, scales and copies like other elements, and each end has a handle
  to drag it.

### Fixed

- The text tool did nothing: a click on the board opened a text that closed (and went away)
  at once.
- On an iPad once the Pencil had been used, a finger with the text, sticky note, shape, frame,
  arrow or lasso tool only moved the view; those tools work with a finger again (with select,
  hand, pen and eraser a finger still moves the view).

## 0.7.0 (2026-11-07)

### Added

- **Side pane.** Type settings have **Open in side pane** (off unless turned on): a click on one of
  the type's objects in a list, table, board, gallery or query opens it in a pane next to the page,
  where it can be edited without losing your place; another click switches it. A view's layout
  menu and a query's settings can choose otherwise (Side pane or Full page).
  The pane has Open full page and Close (Esc), is made wider or narrower by its left edge (kept on
  this device), and is part of the address, so back, forward, reload and copied links keep it.
  Comments and activity stay on the full page. Mentions in text still open the page, ⌘-click
  still opens a new tab, and phones open the page as before.
- **Whiteboard styles for agents.** `edit_board` sets an element's rotation, a shape's fill,
  border and dashes, a sticky note's text size, an arrow's tips (arrow, dot or none at each end),
  sides, dashes and width, a card's properties view, and the board's default scene (a frame as the
  cover); `get_board` returns them.
- **Better flowchart layouts.** Mermaid flowcharts turned into boards cross fewer arrows, size
  each node to what it is (a card or a shape), and turn `subgraph` blocks into frames; dotted
  (`-.->`) and two-way (`<-->`) links keep their look. Agents can lay a whole board out
  (`edit_board` with `layout`: down, right, up, left or grid) and read a board as a Mermaid
  flowchart (`get_board` with format `mermaid`).
- **Undo and redo buttons on whiteboards**, next to the zoom, for when there is no keyboard (the
  two- and three-finger taps still work).

### Changed

- **Apple Pencil on whiteboards.** Once a pen touches a board it draws whatever tool is picked,
  and fingers move the view: a tap selects, and a finger drags only what is already selected, so
  panning never drags a card along. A palm, or a touch just as the pen lifts, is ignored. **Pen and
  fingers** in the board menu sets this per device (Auto, Pen draws, Fingers draw).
- **A new whiteboard toolbar.** The pen, shapes, sticky notes and arrows show a row above the
  tools: four pen presets (each a pen or a highlighter with its color, width and, for pens, a
  dashed or dotted line), the shapes, the notes' colors, the arrows' courses, and settings for
  the rest (a shape's fill and outline, a note's text size, an arrow's ends, line and color). The
  highlighter now has colors and widths too. The settings are kept on each device.
- **Lasso, turning and scaling on whiteboards.** The lasso tool (**Q**) selects what a loop
  encloses; a knob above a selected element turns it (snapping upright and to 45°, Shift in steps
  of 15°); several selected elements scale together by the corner of their box.
- **Better connectors on whiteboards.** Arrows at right angles route around elements (a U when
  both ends leave the same way, around the boxes when they face away), and a handle moves their
  middle segment. Each end can have an arrowhead, a dot or nothing, in three sizes; lines can be
  dotted, thin or thick, and leave from or arrive at a chosen side (let go on a side's dot while
  connecting).
- **Shape and note styles on whiteboards.** Shapes can be filled (a tint, none, white or solid)
  with a thin, regular or thick, solid, dashed or dotted outline; sticky notes have four text
  sizes, and show their color while dragged out. Both from the selection bar or the tool's
  settings.
- **Cards with properties on whiteboards.** A card's view can be its title and the properties
  you pick (a task's status and due date, a book's author…), shown live.
- **A default scene for whiteboards.** The scenes list renames frames and stars one as the
  board's default scene: where it opens the first time on a device, and what embeds without a
  scene of their own show.
- **Export a whiteboard as a picture** (PNG or SVG) or copy it as a Mermaid flowchart, and **lay
  it out** (down or right along its arrows, or in a grid) from the board menu; both act on the
  selection when there is one. `vasta board <id> --flowchart` and `--layout` do the same in the
  terminal.
- **A whiteboard fills its page.** The title is in a thin bar above the board, and tags,
  properties, comments and backlinks are in a **Details** panel beside it (closed until opened).

### Fixed

- Whiteboard arrowheads were missing in older Safari (an arrow showed only a gap before the
  element); they are now drawn in the arrow's color everywhere.
- A whiteboard's dot grid no longer drifts away from the elements while zooming in Safari.

## 0.6.2 (2026-11-06)

### Added

- Reminders as notifications on your phone and in browsers (Web Push): turn them on in Settings › Reminders on each device, and pick what each one reminds you of. On iPhone and iPad, in Vasta added to the Home Screen (iOS 16.4 or later); on Android and computers, in the browser too. Nothing to set up on the server.

### Fixed

- A blank white window after an update (desktop app, Safari, the installed web app). The browser could keep opening the previous version's page, whose files the new version no longer has; now the page is always checked with the server, the files of the current version stay saved for offline use, and a page that still comes up broken reloads itself once.

## 0.6.1 (2026-11-06)

### Added

- Name the other side of a relation: in a type's settings, a relation's "Name on the other side" is what the objects it links to show, e.g. "Wrote" on a person instead of "Books · Author". Agents see it too.

### Fixed

- Reminders reach the desktop app again after it reconnects (after an update, a restart or a network hiccup). Before, the server could lose track of the new connection and say "no desktop app open".
- Desktop (macOS): reminders show as a banner while Vasta is the app in front, not only in Notification Center.

## 0.6.0 (2026-11-06)

### Added

- **Whiteboards** (first version): a new built-in type whose page is an endless canvas. Put
  objects on it as cards (drag them in, or press @), write text anywhere, and link elements with
  arrows that can have a label. Pan, zoom and pinch with a mouse, a trackpad or a touch screen;
  undo and redo; a full-screen mode. Boards sync and merge across devices, offline too, and cards
  show up in their objects' backlinks. [Whiteboards →](docs/whiteboards.md)
- **Drawing on whiteboards**: shapes, sticky notes, a pen with pressure and a highlighter, an
  eraser, and frames that carry what is inside them. A bar over the selection sets colors and
  shapes, brings things forward or back, duplicates and deletes; moving lines things up with
  their neighbors; copy and paste work across boards. With an Apple Pencil, fingers only move the
  view, a resting hand draws nothing, and two- and three-finger taps undo and redo.
- **Draw on a card, note or frame**: pick the pen in the selection bar and what you draw sticks to
  that element, moving and resizing with it.
- A whiteboard's page fits the board to the screen, so it opens without scrolling.
- **Flowcharts and JSON Canvas on whiteboards**: paste a Mermaid flowchart on a board, or turn a
  Mermaid diagram in a note into a whiteboard, and it becomes shapes and arrows you can move, with
  nodes named like your objects becoming their cards. Export a board as a JSON Canvas (Obsidian's
  `.canvas`) and import one, from the board's menu.
- **Whiteboards in notes, live cards, linking arrows**: embed a whiteboard in a note, whole or
  one of its frames; show a card as one line or with its contents (a query's live results, a
  page's text); turn an arrow between two cards into a relation, so it shows in backlinks and
  queries. The board menu lists its frames to jump to.
- **Scenes on whiteboards**: a menu at the board's top left goes to each frame, with ‹ › to step
  through them like slides; an embedded scene fades out what lies outside its frame. Letting an
  arrow go over empty space offers a new note, text, shape or object at its end, and cards
  showing their contents scroll with the wheel.
- **Arrow styles and mentions on whiteboards**: arrows can curve or turn at right angles, have
  heads at either end or none, and be dashed; an arrow between two cards can mention one object
  in the other's text. Resizing lines edges up with neighbors, and cards showing their contents
  scroll by touch.
- **Agents edit whiteboards**: `get_board` and `edit_board` over MCP, and `vasta board` in the
  terminal, read a board and add, move, change and connect its elements, flowcharts and canvases
  included.
- Tag objects and set their icon and color from MCP and the CLI: `tags` (with `tagsMode` add,
  remove or replace), `icon` (an emoji or `ph:<name>`) and `color` on `create_object` and
  `update_object`; `--tag`, `--remove-tag`, `--set-tags`, `--icon` and `--color` on `vasta new`
  and `vasta set`. Missing tags are created, nested ones by path (`recipe/breakfast`).
- **Edit in tables.** Click a property's cell in a table view, or in a query shown as a table (also
  one embedded in a page), to change it right there: pick from a select, a person or a related
  object, set a date, type a text, number or link, and a checkbox toggles with one click. With the
  keyboard, Tab moves between cells, Enter or Space opens one, Enter saves what you typed and
  Escape puts it back. Formulas and long text stay read-only; the title still opens the object.
  Thanks to @bokehsec (#50).
- **Export a space** (Settings › Space › Export…, or `pnpm vasta space export` on the server):
  a ZIP with a Markdown file per object (properties in front matter, links between objects as
  links between files, so Obsidian and other apps read it), whiteboards as JSON Canvas, the files
  objects use, and everything as JSON with nothing left out. [Export →](docs/export.md)

### Changed

- **A new logo**: a soft tile with a V cut from its top, Vasta's own mark instead of a planet icon.
  It is the app icon (installed web app, desktop app, browser extension), the favicon (light and
  dark tabs), and the logo on the login screen and in the README. The files, colours and usage
  are in `design/logo/`.

### Fixed

- **Files are only served to the spaces that use them.** A picture, PDF, cover or link preview
  opens for members of a space whose objects use it; before, anyone logged in who knew a file's
  name could fetch it (#2).
- **No blur over the top of the app on iOS and iPadOS 27** when it is installed on the home screen
  (#45). The fix works around a system effect and may need another look after iOS updates.

## 0.5.1 (2026-11-04)

### Fixed

- **Vasta at a plain-http address** (e.g. `http://192.168.1.10:3000` on your network) can add
  properties, select options, views and the other things that get a new id again; browsers only
  offer `crypto.randomUUID` over HTTPS or localhost. Thanks to @natedwhite for finding the cause
  (#43).
- **Mentions with Markdown characters in their title**, such as an underscore, no longer gain
  backslashes each time an agent rewrites the page. Thanks to @bokehsec (#46).

## 0.5.0 (2026-11-03)

### Added

- Set, inspect or remove object covers by URL and pin or unpin objects from MCP and the CLI.
- Choose editor block spacing in Appearance settings, with a roomier default.
- Independently opt into logging desktop quick captures in the daily note or showing them in the inbox.

### Fixed

- Opening a calendar day or reading it through MCP and the CLI no longer creates an empty daily note.
- Markdown object links open their targets from headings and table cells, and imported task lists
  can be checked as soon as the editor opens.
- Instagram Reel weblinks use short titles and skip automatic readable-text extraction.
- The Tags tree displays custom tag icons.

### Changed

- **The toggle's arrow** is bigger and sits centered on the title's line; the lines inside line up
  with the title.

## 0.4.1 (2026-10-27)

### Added

- **Quick capture asks a template's questions.** With Settings › Desktop app › "Ask a template’s
  questions in quick capture" (off by default), a `/Type …` line whose template asks something
  shows those questions before it saves, in the dialog and in the desktop app's floating panel
  (after updating the desktop app). Questions the line already answers (`body:yes`) are not asked.
- **Tab nests lines in toggles, as in Capacities.** Tab on a line puts it inside the toggle above
  it, or turns the line above into a toggle holding it; Shift+Tab takes it back out (a toggle left
  empty is a plain line again). Lists keep their own Tab.

### Fixed

- **/Toggle on a line you already wrote** makes that line the toggle's title, instead of an empty
  title with the line inside. "Turn into" in the block menu offers Toggle too.
- **Templates: a formula with `{{…}}` or braces inside it** no longer lands in the new object as raw
  text. It is read as one formula, and a formula that does not work leaves nothing.

## 0.4.0 (2026-10-26)

### Added

- **Mermaid diagrams.** `/Diagram` (or typing ```` ```mermaid ````) adds one; it is drawn on the
  page, in your colors and in dark mode, and its code shows when you click it. Agents read and
  write diagrams as Mermaid code blocks.
- **Import from Capacities in the app.** Settings › Import takes a Capacities full export (the ZIP
  of Markdown files), on Windows, Linux and macOS and without the Capacities app, into a new
  space or one you have. Types, properties, tags, links, daily notes and media come over, and a
  report says what did not (queries need their filters again). [Import →](https://github.com/ariedotme/vasta/blob/main/docs/import.md)

### Fixed

- **Inbox:** objects you moved to the trash or deleted for good no longer show up there, as
  empty items that could not be opened.

## 0.3.3 (2026-10-25)

### Added

- **Templates: `ask()` with answers.** `ask("Body", "Yes", "No")` in a condition or a formula
  asks with buttons to pick from, so a choice can decide what a template adds without printing
  anything.

### Fixed

- macOS: **On this computer** starts again. Its server stopped right away ("signal: 5
  (SIGTRAP)") because the bundled Node.js was not allowed the memory it compiles JavaScript into.

## 0.3.2 (2026-10-23)

### Added

- **Ctrl+Enter in Quick Capture** (on macOS too) saves and opens what it made: the new object
  for a `/Type …` line, else today's note. Both the desktop app's floating panel and the app's
  own Quick capture dialog say so under the text.

### Fixed

- macOS: Quick Capture from another app no longer brings Vasta's window to the front from its
  second use on.

## 0.3.1 (2026-10-23)

### Added

- **The desktop app works without a server.** On first start, choose **Start on this computer**:
  the app runs Vasta itself, with nothing to install or set up, and your notes stay on that
  computer. The start page says what you give up (your phone, Telegram captures, backups are
  yours to make). The menu-bar item's **Open Notes Folder** shows where the notes are.
- **Move to a server**, from Settings › Server in the desktop app: paste a server's setup code or
  an invite link, choose a username and password, and your notes, their history and your files
  move into a new account there. Then the app switches to that server.
- Servers take notes moved from another Vasta (needed for the above): update your server before
  moving notes to it.

### Changed

- On the desktop app's own server, the account menu has no Log out or Change password, and
  Settings › Server accounts explains why there are no other accounts.

## 0.3.0 (2026-10-22)

### Added

- **Templates**: start a type's objects or each day's note from a template, with placeholders
  (`{{date:+7d}}`, `{{ask:With whom?}}`) and blocks shown only when a condition holds.
- **Snippets**: save a piece of text and insert it with `/`.
- Agents can list and use templates and snippets.

### Changed

- Typed lines (`/Task Ask Lena due:fri`) take English words only.

## 0.2.0 (2026-10-22)

The first public version.
