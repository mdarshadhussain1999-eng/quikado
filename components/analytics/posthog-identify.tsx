'use client'

import { useEffect, useRef } from 'react'
import { identifyUser, resetAnalytics } from '@/lib/analytics/client'

type PostHogIdentifyProps = {
  isLoaded?: boolean
  userId?: string | null
  email?: string | null
  fullName?: string | null
  mode?: string | null
  credits?: number | null
}

export function PostHogIdentify({
  isLoaded = true,
  userId,
  email,
  fullName,
  mode,
  credits,
}: PostHogIdentifyProps) {
  const lastUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isLoaded) return

    if (!userId) {
      if (lastUserIdRef.current) {
        resetAnalytics()
        lastUserIdRef.current = null
      }
      return
    }

    if (lastUserIdRef.current === userId) return

    identifyUser({
      userId,
      email,
      fullName,
      mode,
      credits,
    })

    lastUserIdRef.current = userId
  }, [isLoaded, userId, email, fullName, mode, credits])

  return null
}