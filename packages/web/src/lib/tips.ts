// "Getting started" tips for people new to Vasta (TipsCard): shown on Today and on empty type
// pages until hidden. Hidden for the person (an account preference), on every device.
import { ref } from 'vue'
import { authApi } from './api.ts'
import { preference } from './preferences.ts'

export const tipsHidden = preference<boolean>('tips/hidden', false, { scope: 'account' })
export const hideTips = () => (tipsHidden.value = true)

// The tip over swipeable rows on a phone, until hidden.
export const swipeTipHidden = preference<boolean>('tips/swipe', false, { scope: 'account' })
export const hideSwipeTip = () => (swipeTipHidden.value = true)

/** Whether the user is the server's first account, who invites people; asked once. */
export const serverAdmin = ref(false)
let asked = false
export function askServerAdmin() {
  if (asked) return
  asked = true
  authApi
    .accounts()
    .then((accounts) => (serverAdmin.value = accounts.admin))
    .catch(() => {})
}
