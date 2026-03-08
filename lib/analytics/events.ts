export const EVENTS = {
  LANDING_VIEWED: 'landing viewed',
  AUTH_SUCCEEDED: 'auth succeeded',
  PROFILE_CREATED: 'profile created',
  MODE_CHANGED: 'mode changed',

  OFFER_SUBMITTED: 'offer submitted',
  FIND_SUBMITTED: 'find submitted',
  MATCH_REQUESTED: 'match requested',
  MATCH_RESULTS_VIEWED: 'match results viewed',
  MATCH_DETAIL_OPENED: 'match detail opened',

  SEARCH_CHARGED: 'search charged',

  CHAT_UNLOCK_STARTED: 'chat unlock started',
  CHAT_UNLOCK_SUCCEEDED: 'chat unlock succeeded',
  MESSAGE_SENT: 'message sent',

  CONTACT_WHATSAPP_CLICKED: 'contact whatsapp clicked',
  CONTACT_EMAIL_CLICKED: 'contact email clicked',

  PROVIDER_INBOX_VIEWED: 'provider inbox viewed',

  MODERATION_FLAGGED: 'moderation flagged',
  MODERATION_UNDER_REVIEW_VIEWED: 'moderation under review viewed',

  PAYMENT_CHECKOUT_STARTED: 'payment checkout started',
  PAYMENT_CHECKOUT_SUCCEEDED: 'payment checkout succeeded',
  PAYMENT_CHECKOUT_FAILED: 'payment checkout failed',

  AUDIO_RECORDING_STARTED: 'audio recording started',
  AUDIO_UPLOAD_STARTED: 'audio upload started',
  AUDIO_TRANSCRIPTION_SUCCEEDED: 'audio transcription succeeded',
  AUDIO_TRANSCRIPTION_FAILED: 'audio transcription failed',
} as const

export type AnalyticsEventName = (typeof EVENTS)[keyof typeof EVENTS]

export type AnalyticsPrimitive = string | number | boolean | null | undefined
export type AnalyticsProperties = Record<
  string,
  AnalyticsPrimitive | AnalyticsPrimitive[]
>