import { type SupportMessage } from './types'

export function mergeSupportMessage(current: SupportMessage[], incoming: SupportMessage) {
  const optimistic = current.find((item) => item.id === incoming.id || (
    item.delivery === 'sending' &&
    item.sender_id === incoming.sender_id &&
    item.body === incoming.body &&
    item.conversation_id === incoming.conversation_id
  ))
  if (optimistic) return current.map((item) => item === optimistic ? incoming : item).sort((a, b) => a.created_at.localeCompare(b.created_at))
  return current.some((item) => item.id === incoming.id)
    ? current
    : [...current, incoming].sort((a, b) => a.created_at.localeCompare(b.created_at))
}
