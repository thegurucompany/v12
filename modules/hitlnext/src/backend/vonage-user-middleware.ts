import * as sdk from 'botpress/sdk'

export class VonageUserMiddleware {
  constructor(private bp: typeof sdk) {}

  // Middleware para interceptar eventos entrantes de Vonage y usar el número de teléfono como userId
  async beforeIncomingVonage(event: sdk.IO.IncomingEvent, next: sdk.IO.MiddlewareNextCallback) {
    // Solo aplicar a canales vonage/whatsapp
    if (event.channel !== 'vonage' && event.channel !== 'whatsapp') {
      return next()
    }

    try {
      // Obtener el número de teléfono del evento
      const phoneNumber = await this.extractPhoneFromEvent(event)

      if (phoneNumber) {
        // Guardar el userId original para referencia
        const originalUserId = event.target

        // Usar el número de teléfono como userId en lugar del UUID generado
        // Necesitamos hacer casting para modificar la propiedad readonly
        ;(event as any).target = phoneNumber

        this.bp.logger.info(`[Vonage] Usuario ID cambiado: ${originalUserId} → ${phoneNumber}`)

        // Opcional: Guardar el mapeo en state para referencia
        if (!event.state.session) {
          ;(event.state as any).session = {}
        }
        ;(event.state.session as any).originalUserId = originalUserId
        ;(event.state.session as any).userMsisdn = phoneNumber
      }
    } catch (error) {
      this.bp.logger.warn('Error procesando número de WhatsApp para userId:', error.message)
    }

    return next()
  }

  private async extractPhoneFromEvent(event: sdk.IO.IncomingEvent): Promise<string | null> {
    try {
      const conversationId = event.threadId
      const botId = event.botId

      if (!conversationId) {
        // Si no hay conversationId, intentar extraer del payload del evento
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

      // Procesar el número (aplicar la misma lógica que en tu función)
      let phoneNumber = endpoint.sender

      // Remover prefijos internacionales si es necesario
      phoneNumber = this.cleanPhoneNumber(phoneNumber)

      return phoneNumber
    } catch (error) {
      this.bp.logger.warn('Error extrayendo número de teléfono del endpoint:', error.message)
      return null
    }
  }

  private extractPhoneFromPayload(event: sdk.IO.IncomingEvent): string | null {
    try {
      // Intentar extraer número del payload en diferentes formatos
      const payload = event.payload as any

      // Buscar en diferentes campos donde podría estar el número
      const possibleFields = ['from', 'sender', 'msisdn', 'phone', 'phoneNumber']

      for (const field of possibleFields) {
        if (payload[field]) {
          return this.cleanPhoneNumber(payload[field])
        }
      }

      // Buscar en estructuras anidadas
      if (payload.user && typeof payload.user === 'object') {
        for (const field of possibleFields) {
          if (payload.user[field]) {
            return this.cleanPhoneNumber(payload.user[field])
          }
        }
      }

      return null
    } catch (error) {
      this.bp.logger.warn('Error extrayendo número del payload:', error.message)
      return null
    }
  }

  private cleanPhoneNumber(phoneNumber: string): string {
    // Aplicar la misma lógica que tienes en tu función setUserPhone
    if (phoneNumber.length === 10) {
      return phoneNumber
    }

    if (phoneNumber.length >= 2) {
      return phoneNumber.substring(2)
    }

    return phoneNumber
  }

  // También interceptar eventos salientes para mantener consistencia
  async beforeOutgoingVonage(event: sdk.IO.OutgoingEvent, next: sdk.IO.MiddlewareNextCallback) {
    // Solo aplicar a canales vonage/whatsapp
    if (event.channel !== 'vonage' && event.channel !== 'whatsapp') {
      return next()
    }

    // El target ya debería ser el número de teléfono si se procesó correctamente en incoming
    // Solo logear para confirmar
    if (event.target && !event.target.includes('-')) {
      // Si el target no tiene guiones, probablemente es un número de teléfono
      this.bp.logger.debug(`[Vonage] Enviando mensaje a número: ${event.target}`)
    }

    return next()
  }
}
