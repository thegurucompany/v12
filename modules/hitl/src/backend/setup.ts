import * as sdk from 'botpress/sdk'
import _ from 'lodash'

import { SDK } from '.'
import Database from './db'

const debug = DEBUG('hitl')
const debugSwallow = debug.sub('swallow')

const ignoredTypes = ['delivery', 'read']

export default async (bp: SDK, db: Database) => {
  bp.events.registerMiddleware({
    name: 'hitl.captureInMessages',
    direction: 'incoming',
    order: 2,
    handler: incomingHandler,
    description: 'Captures incoming messages and if the session if paused, swallow the event.'
  })

  bp.events.registerMiddleware({
    name: 'hitl.captureOutMessages',
    direction: 'outgoing',
    order: 50,
    handler: outgoingHandler,
    description: 'Captures outgoing messages to show inside HITL.'
  })

  async function incomingHandler(event: sdk.IO.IncomingEvent, next) {
    if (!db || ignoredTypes.includes(event.type)) {
      return next()
    }

    // Convert location messages to text for persistence
    if (event.channel === 'vonage' && event.type === 'location') {
      try {
        const latitude = event.payload.latitude
        const longitude = event.payload.longitude
        const address = event.payload.address || ''
        const title = event.payload.title || 'Ubicación'

        // Convert to text message with Google Maps link
        const googleMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`
        let locationText = `📍 ${title}\n`
        locationText += `Coordenadas: ${latitude}, ${longitude}\n`
        if (address) {
          locationText += `Dirección: ${address}\n`
        }
        locationText += `Ver en mapa: ${googleMapsUrl}`

        // Modify event to be treated as text
        ;(event as any).type = 'text'
        ;(event as any).payload = {
          type: 'text',
          text: locationText
        }

        // Set preview
        ;(event as any).preview = `📍 ${title}`

        bp.logger.info('Converted Vonage location message to text in HITL:', {
          latitude,
          longitude,
          address,
          title
        })
      } catch (error) {
        bp.logger.error('Error converting Vonage location to text in HITL:', error)
        // Continue with normal processing
      }
    }

    try {
      const session = await db.getOrCreateUserSession(event)
      if (!session) {
        return next()
      }

      const message = await db.appendMessageToSession(event, session.id, 'in')

      // Verificar si el módulo aún está montado antes de enviar el payload
      if (db && message) {
        bp.realtime.sendPayload(bp.RealTimePayload.forAdmins('hitl.message', message))
      }

      if (session.is_new_session && db) {
        bp.realtime.sendPayload(bp.RealTimePayload.forAdmins('hitl.new_session', session))
      }

      const config = await bp.config.getModuleConfigForBot('hitl', event.botId)

      if (
        (!!session.paused || config.paused) &&
        _.includes(['text', 'message', 'quick_reply', 'image', 'file', 'video', 'voice'], event.type)
      ) {
        debugSwallow('message swallowed / session paused', {
          target: event.target,
          channel: event.channel,
          preview: event.preview,
          type: event.type
        })
        // the session or bot is paused, swallow the message
        // @ts-ignore
        Object.assign(event, { isPause: true })

        return
      }

      next()
    } catch (error) {
      bp.logger.error('Error in HITL incoming handler:', error)
      next() // Continue processing even if HITL fails
    }
  }

  async function outgoingHandler(event: sdk.IO.Event, next) {
    if (!db) {
      return next()
    }

    try {
      const session = await db.getOrCreateUserSession(event)
      if (!session) {
        return next()
      }

      const message = await db.appendMessageToSession(event, session.id, 'out')

      // Verificar si el módulo aún está montado antes de enviar el payload
      if (db && message) {
        bp.realtime.sendPayload(bp.RealTimePayload.forAdmins('hitl.message', message))
      }

      if (session.is_new_session && db) {
        bp.realtime.sendPayload(bp.RealTimePayload.forAdmins('hitl.new_session', session))
      }

      next()
    } catch (error) {
      bp.logger.error('Error in HITL outgoing handler:', error)
      next() // Continue processing even if HITL fails
    }
  }
}
