/**
 * iOS 1.3 — "Reply" on a chat notification (owner, 2026-11-23: "make it super native" → rich notifications).
 *
 * ⛔ THE WEB SENDS THE REPLY, NEVER THE NOTIFICATION. The action is a FOREGROUND text input (EnoSystem.swift
 * EnoChatNotifications): typing a reply under the notification opens the app, Capacitor hands the text to
 * native-push.tsx (`pushNotificationActionPerformed`, actionId + inputValue), and the page POSTs it the way the thread's
 * own composer does — with the WebView's session, to /api/conversations/<id>/messages. No credential ever leaves the
 * WebView for a background send, and no new server path exists for this.
 *
 * These names are the contract between the server's APNs payload (native-push.ts), the Swift category and the web
 * listener; ios-native-shell.test.ts reads the Swift side and fails if the three drift.
 */
export const CHAT_CATEGORY = 'eno.chat'
export const CHAT_REPLY_ACTION = 'reply'

/** What Capacitor's `pushNotificationActionPerformed` carries, as far as the reply reads it. */
export type PushAction = {
  actionId?: string
  inputValue?: string
  notification?: { id?: string; data?: unknown }
}

export type ReplyPlan = { conversationId: string; text: string; clientId: string; path: string }

const THREAD = /^\/messages\/([\w-]{1,64})$/

/**
 * The reply to send, or null when this action is not one: not the reply action, no text, not a thread push, or a push
 * addressed to another account than the one signed in now (`to` is the recipient's profile id — a notification left in
 * Notification Center from before an account switch must never post as the new account).
 * `path` is the already-validated app path the caller navigates to (canonicalAppPath's answer); the thread id comes from it.
 * `clientId` makes the send idempotent per notification (the messages route replays a seen clientId instead of
 * writing twice), within its 64-character cap.
 */
export function replyPlan(action: PushAction, path: string | null, signedInId: string | null | undefined): ReplyPlan | null {
  if (action.actionId !== CHAT_REPLY_ACTION || !path || !signedInId) return null
  const text = typeof action.inputValue === 'string' ? action.inputValue.trim() : ''
  if (!text) return null
  const conversationId = THREAD.exec(path)?.[1]
  if (!conversationId) return null
  const data = action.notification?.data as { to?: unknown } | undefined
  if (typeof data?.to !== 'string' || data.to !== signedInId) return null
  // iOS always names the request (a UUID for an APNs push); without one the send is simply not deduplicated.
  const id = typeof action.notification?.id === 'string' && action.notification.id ? action.notification.id : globalThis.crypto.randomUUID()
  return { conversationId, text, clientId: `push-reply-${id}`.slice(0, 64), path }
}
