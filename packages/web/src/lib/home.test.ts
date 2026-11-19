// Home's choice is independent of navigation; the app-facing checks also cover creation races
// and preferences following the person rather than the shared space's start page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { BODY_PROPERTY_ID, builtinTypeId, docToPlainText, type ObjectRecord, type ObjectSummary, type Space } from '@vasta/core'

type HomeObject = Pick<ObjectSummary, 'id' | 'spaceId' | 'deletedAt' | 'createdBy'>
const space = (extra: Partial<Space> = {}): Space => ({ id: 's', name: 'Space', sidebar: [], createdAt: '2026-11-19T00:00:00Z', ...extra })
const page = (extra: Partial<HomeObject> = {}): HomeObject => ({ id: 'existing', spaceId: 's', createdBy: 'me', ...extra })
const workspace = reactive<{ space: Space | null }>({ space: space() })
const session = reactive({ user: { id: 'me' } as { id: string } | null })
const lastError = ref('')
const summaries = vi.fn<(ids: string[]) => Promise<HomeObject[]>>()
const createObject = vi.fn<(typeId: string, data?: Partial<ObjectRecord>, open?: boolean) => Promise<{ id: string }>>(async () => ({ id: 'new-home' }))
const push = vi.fn(async (_path: string) => {})
vi.mock('../router.ts', () => ({ router: { push } }))
vi.mock('./actions.ts', () => ({ createObject }))
vi.mock('./api.ts', () => ({ api: { summaries }, authApi: { updateProfile: vi.fn(async () => ({})) } }))
vi.mock('./state.ts', () => ({ workspace, lastError }))
vi.mock('./session.ts', () => ({ session }))

const { homePage, myHomeId, openHome, resolveHome } = await import('./home.ts')
const { getPreference, setPreference, startPreferences, stopPreferences } = await import('./preferences.ts')

beforeEach(() => {
  vi.clearAllMocks()
  summaries.mockResolvedValue([])
  createObject.mockResolvedValue({ id: 'new-home' })
  workspace.space = space()
  session.user = { id: 'me' }
  lastError.value = ''
  startPreferences({ id: 'me' })
})
afterEach(() => stopPreferences())

describe('choosing my Home', () => {
  it('uses a remembered page before the space start page, even when another person made it', () => {
    expect(homePage(space({ opensOn: { kind: 'object', id: 'start' } }), page({ createdBy: 'other' }), page({ id: 'start' }), 'me')).toBe('existing')
  })

  it.each([{ deletedAt: '2026-11-19T00:00:00Z' }, { spaceId: 'elsewhere' }])('ignores an unusable remembered page: %o', (extra) => {
    expect(homePage(space(), page(extra), undefined, 'me')).toBeUndefined()
  })

  it('adopts the space start page only when it is usable and made by me', () => {
    const chosen = space({ opensOn: { kind: 'object', id: 'existing' } })
    expect(homePage(chosen, undefined, page(), 'me')).toBe('existing')
    for (const extra of [{ createdBy: 'other' }, { createdBy: undefined }, { deletedAt: '2026-11-19T00:00:00Z' }, { spaceId: 'elsewhere' }, { id: 'wrong' }]) {
      expect(homePage(chosen, undefined, page(extra), 'me')).toBeUndefined()
    }
    expect(homePage(chosen, undefined, undefined, 'me')).toBeUndefined()
  })
})

describe('resolving and opening my Home', () => {
  it('uses the remembered id without creating a page', async () => {
    setPreference('account', 'home/s', 'existing')
    summaries.mockResolvedValue([page()])
    expect(await resolveHome()).toBe('existing')
    expect(myHomeId.value).toBe('existing')
    expect(createObject).not.toHaveBeenCalled()
  })

  it.each([{ deletedAt: '2026-11-19T00:00:00Z' }, { spaceId: 'elsewhere' }, undefined])('replaces an unusable remembered id: %o', async (extra) => {
    setPreference('account', 'home/s', 'existing')
    summaries.mockResolvedValue(extra ? [page(extra)] : [])
    expect(await resolveHome()).toBe('new-home')
    expect(myHomeId.value).toBe('new-home')
    expect(createObject).toHaveBeenCalledOnce()
  })

  it('adopts and remembers my existing start page without rebuilding it', async () => {
    workspace.space = space({ opensOn: { kind: 'object', id: 'existing' } })
    setPreference('account', 'home/s', 'gone')
    summaries.mockResolvedValue([page()])
    expect(await resolveHome()).toBe('existing')
    expect(getPreference('account', 'home/s')).toBe('existing')
    expect(createObject).not.toHaveBeenCalled()
  })

  it.each(['other', undefined])('creates my own page when the start page was made by %s', async (createdBy) => {
    workspace.space = space({ opensOn: { kind: 'object', id: 'existing' } })
    summaries.mockResolvedValue([page({ createdBy })])
    expect(await resolveHome()).toBe('new-home')
    expect(myHomeId.value).toBe('new-home')
    expect(createObject).toHaveBeenCalledOnce()
  })

  it.each([undefined, { kind: 'today' as const }])('creates a Page with a starter body when no start page can be adopted: %o', async (opensOn) => {
    workspace.space = space({ opensOn })
    expect(await resolveHome()).toBe('new-home')
    expect(createObject).toHaveBeenCalledWith(builtinTypeId('s', 'page'), {
      title: 'Home',
      content: { [BODY_PROPERTY_ID]: expect.any(Object) },
    }, false)
    const data = createObject.mock.calls[0]![1]!
    expect(docToPlainText(data.content![BODY_PROPERTY_ID]!)).toBe('Your Home. Type / to add a query or embed a page.')
    expect(getPreference('account', 'home/s')).toBe('new-home')
  })

  it('creates once when two callers race, then opens the result as a page', async () => {
    const [first, second] = await Promise.all([resolveHome(), openHome()])
    expect(first).toBe('new-home')
    expect(second).toBeUndefined()
    expect(createObject).toHaveBeenCalledOnce()
    expect(push).toHaveBeenCalledWith('/o/new-home')
  })

  it('reads a different Home when the space or person changes', () => {
    setPreference('account', 'home/s', 'mine')
    setPreference('account', 'home/other-space', 'also-mine')
    expect(myHomeId.value).toBe('mine')
    workspace.space = space({ id: 'other-space' })
    expect(myHomeId.value).toBe('also-mine')
    startPreferences({ id: 'other', preferences: { 'home/other-space': 'theirs' } })
    expect(myHomeId.value).toBe('theirs')
  })

  it('opens a remembered Home when the lookup fails (offline)', async () => {
    setPreference('account', 'home/s', 'existing')
    summaries.mockRejectedValueOnce(new Error('Offline'))
    await openHome()
    expect(createObject).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/o/existing')
  })

  it('shows a lookup failure without creating a Home when none is remembered, and allows a retry', async () => {
    workspace.space = space({ opensOn: { kind: 'object', id: 'start' } })
    summaries.mockRejectedValueOnce(new Error('Offline'))
    await openHome()
    expect(lastError.value).toBe('Offline')
    expect(createObject).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })
})
