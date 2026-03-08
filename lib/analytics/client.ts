'use client'

import posthog from 'posthog-js'
import type { AnalyticsEventName, AnalyticsProperties } from '@/lib/analytics/events'

function cleanProperties(properties?: AnalyticsProperties) {
  if (!properties) return undefined

  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined)
  )
}

export function track(
  event: AnalyticsEventName | string,
  properties?: AnalyticsProperties
) {
  if (typeof window === 'undefined') return

  try {
    posthog.capture(event, cleanProperties(properties))
  } catch (error) {
    console.error('PostHog track error', error)
  }
}

export function identifyUser(params: {
  userId: string
  email?: string | null
  fullName?: string | null
  mode?: string | null
  credits?: number | null
}) {
  if (typeof window === 'undefined') return

  try {
    posthog.identify(params.userId, cleanProperties({
      email: params.email ?? undefined,
      full_name: params.fullName ?? undefined,
      mode: params.mode ?? undefined,
      credits: params.credits ?? undefined,
    }))
  } catch (error) {
    console.error('PostHog identify error', error)
  }
}

export function resetAnalytics() {
  if (typeof window === 'undefined') return

  try {
    posthog.reset()
  } catch (error) {
    console.error('PostHog reset error', error)
  }
}

export function captureClientException(
  error: unknown,
  properties?: AnalyticsProperties
) {
  if (typeof window === 'undefined') return

  try {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error))

    posthog.captureException(normalizedError, cleanProperties(properties))
  } catch (captureError) {
    console.error('PostHog captureException error', captureError)
  }
}