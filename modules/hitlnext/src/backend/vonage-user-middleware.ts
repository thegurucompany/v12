import * as sdk from 'botpress/sdk'

export class VonageUserMiddleware {
  constructor(private bp: typeof sdk) {}

  // Middleware to intercept incoming Vonage events and use phone number as userId
  async beforeIncomingVonage(event: sdk.IO.IncomingEvent, next: sdk.IO.MiddlewareNextCallback) {
    // Only apply to vonage/whatsapp channels
    if (event.channel !== 'vonage' && event.channel !== 'whatsapp') {
      return next()
    }

    try {
      // Extract phone number from event
      const phoneNumber = await this.extractPhoneFromEvent(event)

      if (phoneNumber) {
        // Save original userId for reference
        const originalUserId = event.target

        // Use phone number as userId instead of generated UUID
        // Need to cast to modify readonly property
        ;(event as any).target = phoneNumber

        this.bp.logger.info(`[Vonage] User ID changed: ${originalUserId} → ${phoneNumber}`)

        // Optional: Save mapping in state for reference
        if (!event.state.session) {
          ;(event.state as any).session = {}
        }
        ;(event.state.session as any).originalUserId = originalUserId
        ;(event.state.session as any).userMsisdn = phoneNumber
      }
    } catch (error) {
      this.bp.logger.warn('Error processing WhatsApp number for userId:', error.message)
    }

    return next()
  }

  private async extractPhoneFromEvent(event: sdk.IO.IncomingEvent): Promise<string | null> {
    try {
      const conversationId = event.threadId
      const botId = event.botId

      if (!conversationId) {
        // If no conversationId, try to extract from event payload
        const phoneFromPayload = this.extractPhoneFromPayload(event)
        if (phoneFromPayload) {
          return phoneFromPayload
        }
        return null
      }

      const messaging = this.bp.messaging.forBot(botId)
      const endpoints = await messaging.listEndpoints(conversationId)
      const endpoint = endpoints[0]

      if (!endpoint || !endpoint.sender) {
        return null
      }

      // Process the number (apply same logic as in your setUserPhone function)
      let phoneNumber = endpoint.sender

      // Remove international prefixes if necessary
      phoneNumber = this.cleanPhoneNumber(phoneNumber)

      return phoneNumber
    } catch (error) {
      this.bp.logger.warn('Error extracting phone number from endpoint:', error.message)
      return null
    }
  }

  private extractPhoneFromPayload(event: sdk.IO.IncomingEvent): string | null {
    try {
      // Try to extract number from payload in different formats
      const payload = event.payload as any

      // Look for different fields where the number might be
      const possibleFields = ['from', 'sender', 'msisdn', 'phone', 'phoneNumber']

      for (const field of possibleFields) {
        if (payload[field]) {
          return this.cleanPhoneNumber(payload[field])
        }
      }

      // Look for nested structures
      if (payload.user && typeof payload.user === 'object') {
        for (const field of possibleFields) {
          if (payload.user[field]) {
            return this.cleanPhoneNumber(payload.user[field])
          }
        }
      }

      return null
    } catch (error) {
      this.bp.logger.warn('Error extracting number from payload:', error.message)
      return null
    }
  }

  private cleanPhoneNumber(phoneNumber: string): string {
    // Apply same logic as in your setUserPhone function
    if (phoneNumber.length === 10) {
      return phoneNumber
    }

    if (phoneNumber.length >= 2) {
      return phoneNumber.substring(2)
    }

    return phoneNumber
  }

  // Also intercept outgoing events to maintain consistency
  async beforeOutgoingVonage(event: sdk.IO.OutgoingEvent, next: sdk.IO.MiddlewareNextCallback) {
    // Only apply to vonage/whatsapp channels
    if (event.channel !== 'vonage' && event.channel !== 'whatsapp') {
      return next()
    }

    // The target should already be the phone number if processed correctly in incoming
    // Just log to confirm
    if (event.target && !event.target.includes('-')) {
      // If target has no dashes, it's probably a phone number
      this.bp.logger.debug(`[Vonage] Sending message to number: ${event.target}`)
    }

    return next()
  }
}
