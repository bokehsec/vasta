import { createRouter, createWebHistory } from 'vue-router'
import { closeTopLayer } from './lib/back.ts'
import { isPhone } from './lib/viewport.ts'
import HomeView from './views/HomeView.vue'

// Pages load as their own chunks, so the first paint does not wait for the editor or the calendar.
// warmRoutes() fetches the rest once the app is idle, so the service worker has them for offline use.
const pages = {
  object: () => import('./views/ObjectPage.vue'),
  type: () => import('./views/TypePage.vue'),
  day: () => import('./views/DayView.vue'),
  calendar: () => import('./views/CalendarPage.vue'),
  settings: () => import('./views/SettingsView.vue'),
  trash: () => import('./views/TrashView.vue'),
  inbox: () => import('./views/InboxView.vue'),
  nutrition: () => import('./views/NutritionView.vue'),
  remind: () => import('./views/RemindView.vue'),
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    {
      path: '/o/:id',
      component: pages.object,
      // The page reads its address only through these, so the side pane can show it without one.
      props: (route) => ({
        id: route.params.id,
        isNew: route.query.new === '1',
        capture: typeof route.query.capture === 'string' ? route.query.capture : undefined,
        cursor: typeof route.query.cursor === 'string' ? route.query.cursor : undefined,
        block: route.hash.startsWith('#b-') ? route.hash.slice(3) : undefined,
      }),
    },
    { path: '/t/:id', component: pages.type, props: true },
    { path: '/day/:day', component: pages.day, props: true },
    { path: '/calendar', component: pages.calendar },
    { path: '/settings', component: pages.settings },
    { path: '/trash', component: pages.trash },
    { path: '/inbox', component: pages.inbox },
    { path: '/nutrition', component: pages.nutrition },
    // An insistent reminder, answered (also the desktop app's takeover, with ?takeover=1).
    { path: '/remind/:id', component: pages.remind, props: true },
  ],
})

// Back or forward (the history already holds the entry being gone to) on a phone with a sheet,
// dialog, Triage or the side menu open closes that instead, and the page stays (lib/back.ts); the
// router puts the history entry back.
router.beforeEach((to) => {
  if (router.options.history.state.current !== to.fullPath || !isPhone.value) return
  if (closeTopLayer(afterEntryBack)) return false
})

// The router puts the entry back by going the other way; the close waits for that, so a dialog whose
// close changes the address (Type settings, ?settings=1) changes the entry it was opened on.
function afterEntryBack(close: () => void) {
  let done = false
  const run = () => {
    if (done) return
    done = true
    window.removeEventListener('popstate', run)
    close()
  }
  window.addEventListener('popstate', run)
  setTimeout(run, 500) // no entry to go back to (a history state without a position)
}

// The side pane and the popup (lib/open.ts) live in the query, as ?pane=<id>&paneBlock=<id> and
// ?popup=<id>&popupBlock=<id>. A page that changes only its own query (the calendar's view and
// date, a type page closing its settings) keeps them: their part is carried over, so no page has
// to remember it. Not while one is being closed, nor on back/forward (the entry already says).
export const closingOverlay = { pane: false, popup: false }
router.beforeEach((to, from) => {
  const { pane, paneBlock, popup, popupBlock, new: isNew, cursor } = from.query
  if (closingOverlay.pane || closingOverlay.popup || to.path !== from.path) return
  if (router.options.history.state.current === to.fullPath) return
  const carry =
    pane && !('pane' in to.query) ? { pane, ...(paneBlock ? { paneBlock } : {}) } : undefined
  const carryPopup =
    popup && !('popup' in to.query)
      ? { popup, ...(popupBlock ? { popupBlock } : {}), ...(isNew ? { new: isNew } : {}), ...(cursor ? { cursor } : {}) }
      : undefined
  if (!carry && !carryPopup) return
  return { path: to.path, hash: to.hash, query: { ...to.query, ...carry, ...carryPopup } }
})

export function warmRoutes() {
  const run = () => void Promise.all(Object.values(pages).map((load) => load())).catch(() => {})
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 5000 })
  else setTimeout(run, 2000)
}
