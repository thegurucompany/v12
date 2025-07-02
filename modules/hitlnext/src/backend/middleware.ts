import * as sdk from 'botpress/sdk'
import _ from 'lodash'
import LRU from 'lru-cache'
import ms from 'ms'

import { Config } from '../config'
import { MODULE_NAME } from '../constants'

import { StateType } from './index'
import { IAgent, IHandoff } from './../types'
import { extendAgentSession, measure } from './helpers'
import Repository from './repository'
import Socket from './socket'
import { VonageWhatsAppService } from './vonage-whatsapp'

const debug = DEBUG(MODULE_NAME)

const updateHitlStatus = event => {
  if (event.type === 'hitlnext' && event.payload) {
    const { exitType, agentName } = event.payload

    _.set(event, 'state.temp.agentName', agentName)
    _.set(event, `state.temp.hitlnext-${exitType}`, true)
  }
}

const registerMiddleware = async (bp: typeof sdk, state: StateType) => {
  const handoffCache = new LRU<string, string>({ max: 1000, maxAge: ms('1 day') })
  const repository = new Repository(bp, state.timeouts)
  const realtime = Socket(bp)

  const pipeEvent = async (event: sdk.IO.IncomingEvent, eventDestination: sdk.IO.EventDestination) => {
    debug.forBot(event.botId, 'Piping event', eventDestination)
    return bp.events.replyToEvent(eventDestination, [event.payload])
  }

  const handoffCacheKey = (botId: string, threadId: string) => [botId, threadId].join('.')

  const getCachedHandoff = (botId: string, threadId: string) => {
    return handoffCache.get(handoffCacheKey(botId, threadId))
  }

  const cacheHandoff = (botId: string, threadId: string, handoff: IHandoff) => {
    debug.forBot(botId, 'Caching handoff', { id: handoff.id, threadId })
    handoffCache.set(handoffCacheKey(botId, threadId), handoff.id)
  }

  const expireHandoff = (botId: string, threadId: string) => {
    debug.forBot(botId, 'Expiring handoff', { threadId })
    handoffCache.del(handoffCacheKey(botId, threadId))
  }

  const handleIncomingFromUser = async (handoff: IHandoff, event: sdk.IO.IncomingEvent) => {
    // Ensure proper payload structure for file and image messages from users
    if (event.type === 'image' || event.type === 'file') {
      bp.logger.info(`Processing ${event.type} message from user to agent. Handoff: ${handoff.id}`, {
        type: event.type,
        payload: event.payload,
        hasImage: !!event.payload.image,
        hasUrl: !!event.payload.url
      })

      // Ensure the payload is properly structured for agent chat display
      if (event.type === 'image') {
        // Make sure image URL is accessible
        const imageUrl = event.payload.image || event.payload.url
        if (imageUrl) {
          // Ensure both properties are set for maximum compatibility
          event.payload.image = imageUrl
          event.payload.url = imageUrl

          if (!event.payload.title) {
            event.payload.title = 'Imagen del usuario'
          }

          // Ensure storage is set
          if (!event.payload.storage) {
            event.payload.storage = 's3'
          }

          bp.logger.info('User image processed for agent display:', {
            title: event.payload.title,
            imageUrl: event.payload.image,
            url: event.payload.url,
            storage: event.payload.storage
          })
        } else {
          bp.logger.warn('User image message missing URL/image property:', event.payload)
        }
      }

      if (event.type === 'file') {
        // Make sure file URL is accessible
        const fileUrl = event.payload.url || event.payload.file
        if (fileUrl) {
          event.payload.url = fileUrl
          if (!event.payload.title) {
            event.payload.title = 'Archivo del usuario'
          }

          // Check if this file is actually an image
          if (fileUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)) {
            // If it's an image file, also set the image property
            event.payload.image = fileUrl
            bp.logger.info('File detected as image, setting image property:', fileUrl)
          }
        }
      }
    }

    // There only is an agentId & agentThreadId after assignation
    if (handoff.status === 'assigned') {
      const userId = await repository.mapVisitor(handoff.botId, handoff.agentId)
      return pipeEvent(event, {
        botId: handoff.botId,
        target: userId,
        threadId: handoff.agentThreadId,
        channel: 'web'
      })
    }

    // At this moment the event isn't persisted yet so an approximate
    // representation is built and sent to the frontend, which relies on
    // this to update the handoff's preview and read status.
    const partialEvent = {
      event: _.pick(event, ['preview']),
      success: undefined,
      threadId: undefined,
      ..._.pick(event, ['id', 'direction', 'botId', 'channel', 'createdOn', 'threadId'])
    }

    realtime.sendPayload(event.botId, {
      resource: 'handoff',
      type: 'update',
      id: handoff.id,
      payload: {
        ...handoff,
        userConversation: partialEvent
      }
    })

    realtime.sendPayload(event.botId, {
      resource: 'event',
      type: 'create',
      id: null,
      payload: partialEvent
    })
  }

  const handleIncomingFromAgent = async (handoff: IHandoff, event: sdk.IO.IncomingEvent) => {
    const agent = await repository.getAgent(handoff.agentId)

    if (handoff.userChannel === 'web' && agent.attributes) {
      const firstName = agent.attributes.firstname
      const lastname = agent.attributes.lastname
      const avatarUrl = agent.attributes.picture_url

      _.set(event, 'payload.channel.web.userName', `${firstName} ${lastname}`)
      _.set(event, 'payload.channel.web.avatarUrl', avatarUrl)
    }

    // Handle file and image messages specially for WhatsApp
    if (
      handoff.userChannel === 'vonage' &&
      event.payload &&
      (event.payload.type === 'image' || event.payload.type === 'file')
    ) {
      try {
        bp.logger.info(`Processing ${event.payload.type} message for WhatsApp handoff ${handoff.id}`)

        const vonageService = new VonageWhatsAppService(bp)

        if (event.payload.type === 'image' && event.payload.image) {
          await vonageService.sendImage(
            handoff.userId,
            event.payload.image,
            event.payload.title || 'Image',
            handoff.botId,
            handoff.userThreadId
          )
        } else if (event.payload.type === 'file' && event.payload.url) {
          await vonageService.sendDocument(
            handoff.userId,
            event.payload.url,
            event.payload.title || 'Document',
            handoff.botId,
            handoff.userThreadId
          )
        }

        bp.logger.info(`Successfully sent ${event.payload.type} via Vonage WhatsApp`)
        // Continue with normal flow to show in agent chat too
      } catch (error) {
        bp.logger.error(`Failed to send ${event.payload.type} via Vonage WhatsApp:`, error)
        // Continue with normal flow as fallback
      }
    }

    // Handle file and image messages for web channel - ensure proper formatting for display
    if (event.payload && (event.payload.type === 'image' || event.payload.type === 'file')) {
      bp.logger.info(`Processing ${event.payload.type} message for handoff ${handoff.id}`)

      // For images, ensure the payload is properly formatted for both agent and user chat
      if (event.payload.type === 'image' && event.payload.image) {
        // Ensure payload structure is consistent for rendering
        if (!event.payload.payload) {
          event.payload.payload = {
            type: 'image',
            title: event.payload.title || 'Image',
            image: event.payload.image
          }
        }

        // Ensure preview is set
        if (!event.preview) {
          ;(event as any).preview = `🖼️ ${event.payload.title || 'Image'}`
        }
      }

      // For files, ensure the payload is properly formatted for both agent and user chat
      if (event.payload.type === 'file' && event.payload.url) {
        // Ensure payload structure is consistent for rendering
        if (!event.payload.payload) {
          event.payload.payload = {
            type: 'file',
            title: event.payload.title || 'File',
            url: event.payload.url
          }
        }

        // Ensure preview is set
        if (!event.preview) {
          ;(event as any).preview = `📎 ${event.payload.title || 'File'}`
        }
      }
    }

    await pipeEvent(event, {
      botId: handoff.botId,
      threadId: handoff.userThreadId,
      target: handoff.userId,
      channel: handoff.userChannel
    })

    await extendAgentSession(repository, realtime, event.botId, handoff.agentId)
  }

  const incomingHandler = async (event: sdk.IO.IncomingEvent, next: sdk.IO.MiddlewareNextCallback) => {
    updateHitlStatus(event)

    // Normalize file and image messages from Vonage/WhatsApp
    if (event.channel === 'vonage' && (event.type === 'image' || event.type === 'file')) {
      try {
        // Normalize image messages
        if (event.type === 'image') {
          // Ensure the payload has the expected structure for the web chat
          if (!event.payload.image && event.payload.url) {
            event.payload.image = event.payload.url
          }

          if (!event.payload.title && event.payload.name) {
            event.payload.title = event.payload.name
          }

          // Set default title if none exists
          if (!event.payload.title) {
            event.payload.title = 'Imagen de WhatsApp'
          }

          // Ensure preview exists with image emoji
          if (!event.preview) {
            ;(event as any).preview = `🖼️ ${event.payload.title}`
          }

          // Force storage to be 's3' for better compatibility
          if (!event.payload.storage) {
            event.payload.storage = 's3'
          }

          // IMPORTANT: Ensure we have a valid URL for the image
          if (!event.payload.url && event.payload.image) {
            event.payload.url = event.payload.image
          }

          bp.logger.info('Normalized image payload for user preview:', {
            type: event.payload.type,
            hasImage: !!event.payload.image,
            hasUrl: !!event.payload.url,
            title: event.payload.title,
            storage: event.payload.storage,
            finalUrl: event.payload.url || event.payload.image
          })
        }

        // Normalize file messages
        if (event.type === 'file') {
          // Ensure the payload has the expected structure for the web chat
          if (!event.payload.url && event.payload.file) {
            event.payload.url = event.payload.file
          }

          if (!event.payload.title && event.payload.name) {
            event.payload.title = event.payload.name
          }

          if (!event.payload.title && event.payload.filename) {
            event.payload.title = event.payload.filename
          }

          // Set default title if none exists
          if (!event.payload.title) {
            event.payload.title = 'Archivo de WhatsApp'
          }

          // Force storage to be 's3' for better compatibility
          if (!event.payload.storage) {
            event.payload.storage = 's3'
          }

          // Determine if this is actually an image file
          const isImageFile = event.payload.url && event.payload.url.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)

          // If it's an image file but came as 'file' type, keep it as file but add image property
          if (isImageFile) {
            event.payload.image = event.payload.url
            ;(event as any).preview = `🖼️ ${event.payload.title}`
          } else {
            // Ensure preview exists for non-image files
            ;(event as any).preview = `📎 ${event.payload.title}`
          }
        }
      } catch (error) {
        bp.logger.error(`Error normalizing ${event.type} message from Vonage:`, error)
        // Continue processing even if normalization fails
      }
    }

    // Handle text, image, and file types for HITL
    if (!['text', 'image', 'file'].includes(event.type)) {
      return next(undefined, false, true)
    }

    const handoffId = getCachedHandoff(event.botId, event.threadId)

    if (!handoffId) {
      next(undefined, false)
      return
    }

    const handoff = await repository.getHandoff(handoffId)

    const incomingFromUser = handoff.userThreadId === event.threadId
    const incomingFromAgent = handoff.agentThreadId === event.threadId

    if (incomingFromUser) {
      debug.forBot(event.botId, 'Handling message from User', { direction: event.direction, threadId: event.threadId })
      await handleIncomingFromUser(handoff, event)
    } else if (incomingFromAgent) {
      debug.forBot(event.botId, 'Handling message from Agent', { direction: event.direction, threadId: event.threadId })
      await handleIncomingFromAgent(handoff, event)
    }

    // the session or bot is paused, swallow the message
    // TODO deprecate usage of isPause
    // @ts-ignore
    Object.assign(event, { isPause: true, handoffId: handoff.id })

    next()
  }

  // Performance: Eager load and cache handoffs that will be required on every incoming message.
  // - Only 'active' handoffs are cached because they are the only ones for which the middleware
  // handles agent <-> user event piping
  // - Handoffs must be accessible both via their respective agent thread ID and user thread ID
  // for two-way message piping
  const warmup = async () => {
    return repository.listActiveHandoffs().then((handoffs: IHandoff[]) => {
      handoffs.forEach(handoff => {
        handoff.agentThreadId && cacheHandoff(handoff.botId, handoff.agentThreadId, handoff)
        handoff.userThreadId && cacheHandoff(handoff.botId, handoff.userThreadId, handoff)
      })
    })
  }

  if (debug.enabled) {
    await measure('cache-warmup', warmup(), items => {
      items.getEntries().forEach(entry => {
        debug('performance', _.pick(entry, 'name', 'duration'))
      })
    })
  } else {
    await warmup()
  }

  state.cacheHandoff = await bp.distributed.broadcast(cacheHandoff)
  state.expireHandoff = await bp.distributed.broadcast(expireHandoff)

  bp.events.registerMiddleware({
    name: 'hitlnext.incoming',
    direction: 'incoming',
    order: 0,
    description: 'Handles message-passing between users and agents',
    handler: incomingHandler
  })
}

const unregisterMiddleware = async (bp: typeof sdk) => {
  bp.events.removeMiddleware('hitlnext.incoming')
}

export { registerMiddleware, unregisterMiddleware }
