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
import { S3FileService } from './s3-image-service'
import { logS3Status } from './s3-test-utils'
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

  // Log S3 configuration status on startup
  bp.logger.info('🤖 HITL Next middleware initializing...')

  // Check S3 configuration for all bots
  try {
    const botIds = await bp.bots.getAllBots()
    for (const botId of Object.keys(botIds)) {
      try {
        const config = await bp.config.getModuleConfigForBot('hitlnext', botId)
        logS3Status(bp, config)
      } catch (error) {
        // Bot might not have hitlnext config yet
      }
    }
  } catch (error) {
    bp.logger.warn('Could not check S3 configuration on startup:', error.message)
  }

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
    // Ensure proper payload structure for file, image, and video messages from users
    if (event.type === 'image' || event.type === 'file' || event.type === 'video') {
      // Handle Vonage file/image/video upload to S3
      if (
        (event.type === 'image' || event.type === 'file' || event.type === 'video') &&
        handoff.userChannel === 'vonage'
      ) {
        const fileUrl = event.payload.image || event.payload.url || event.payload.file || event.payload.video
        if (fileUrl && fileUrl.includes('api.vonage.com')) {
          bp.logger.info(`Detected Vonage ${event.type}, attempting S3 upload:`, { fileUrl, handoffId: handoff.id })

          try {
            const config = await bp.config.getModuleConfigForBot('hitlnext', handoff.botId)

            if (config?.s3?.accessKeyId && config?.s3?.secretAccessKey && config?.s3?.region && config?.s3?.bucket) {
              const s3Service = new S3FileService(bp, config.s3)

              // Upload to S3 (works for images, files, and videos)
              const s3Url = await s3Service.uploadVonageFileToS3(
                fileUrl,
                handoff.botId,
                event.payload.title ||
                  (event.type === 'image'
                    ? 'WhatsApp Image'
                    : event.type === 'video'
                    ? 'WhatsApp Video'
                    : 'WhatsApp File'),
                event.type as 'image' | 'file' | 'video'
              )

              // Replace the temporary Vonage URL with the permanent S3 URL
              if (event.type === 'image') {
                event.payload.image = s3Url
              } else if (event.type === 'video') {
                event.payload.video = s3Url
              } else {
                event.payload.file = s3Url
              }
              event.payload.url = s3Url
              event.payload.storage = 's3'
            } else {
              bp.logger.warn('S3 not configured for bot, using temporary Vonage URL (expires in 10 minutes):', {
                botId: handoff.botId,
                handoffId: handoff.id,
                fileType: event.type
              })
            }
          } catch (error) {
            bp.logger.error(`Failed to upload Vonage ${event.type} to S3, using original URL:`, {
              error: error.message,
              fileUrl,
              handoffId: handoff.id,
              fileType: event.type
            })
            // Continue with the original URL as fallback
          }
        }
      }

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

      if (event.type === 'video') {
        // Make sure video URL is accessible
        const videoUrl = event.payload.video || event.payload.url
        if (videoUrl) {
          // Ensure both properties are set for maximum compatibility
          event.payload.video = videoUrl
          event.payload.url = videoUrl

          if (!event.payload.title) {
            event.payload.title = 'Video del usuario'
          }

          // Ensure storage is set
          if (!event.payload.storage) {
            event.payload.storage = 's3'
          }

          bp.logger.info('User video processed for agent display:', {
            title: event.payload.title,
            videoUrl: event.payload.video,
            url: event.payload.url,
            storage: event.payload.storage
          })
        } else {
          bp.logger.warn('User video message missing URL/video property:', event.payload)
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

          // Check if this file is actually an image or video
          if (fileUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)) {
            // If it's an image file, also set the image property
            event.payload.image = fileUrl
            bp.logger.info('File detected as image, setting image property:', fileUrl)
          } else if (fileUrl.match(/\.(mp4|webm|mov|avi|mkv|m4v|3gp)$/i)) {
            // If it's a video file, also set the video property
            event.payload.video = fileUrl
            bp.logger.info('File detected as video, setting video property:', fileUrl)
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
    if (event.channel === 'vonage' && (event.type === 'image' || event.type === 'file' || event.type === 'video')) {
      try {
        // Obtener la configuración de S3 para subir imágenes de Vonage
        const config = await bp.config.getModuleConfigForBot('hitlnext', event.botId)
        let s3Service: S3FileService | null = null

        if (config.s3Config && config.s3Config.accessKeyId) {
          s3Service = new S3FileService(bp, config.s3Config)
        } else {
          bp.logger.warn('S3 configuration not found - Vonage videos/images will use temporary URLs')
        }

        // Normalize image messages
        if (event.type === 'image') {
          const originalImageUrl = event.payload.image || event.payload.url

          // Subir imagen a S3 si está configurado
          if (s3Service && s3Service.isConfigured() && originalImageUrl) {
            try {
              bp.logger.info('Uploading Vonage image to S3:', { originalUrl: originalImageUrl })

              const s3Url = await s3Service.uploadVonageFileToS3(
                originalImageUrl,
                event.botId,
                event.payload.title || event.payload.name || 'Imagen de WhatsApp',
                'image'
              )

              // Actualizar el payload con la nueva URL de S3
              event.payload.image = s3Url
              event.payload.url = s3Url
              event.payload.originalVonageUrl = originalImageUrl

              bp.logger.info('Successfully uploaded Vonage image to S3:', {
                originalUrl: originalImageUrl,
                s3Url
              })
            } catch (uploadError) {
              bp.logger.error('Failed to upload Vonage image to S3, using original URL:', uploadError)
              // Continuar con la URL original si falla la subida a S3
            }
          }

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
        }

        // Normalize file messages
        if (event.type === 'file') {
          const originalFileUrl = event.payload.file || event.payload.url

          // Subir archivo a S3 si está configurado
          if (s3Service && s3Service.isConfigured() && originalFileUrl) {
            try {
              bp.logger.info('Uploading Vonage file to S3:', { originalUrl: originalFileUrl })

              const s3Url = await s3Service.uploadVonageFileToS3(
                originalFileUrl,
                event.botId,
                event.payload.title || event.payload.name || event.payload.filename || 'Archivo de WhatsApp',
                'file'
              )

              // Actualizar el payload con la nueva URL de S3
              event.payload.file = s3Url
              event.payload.url = s3Url
              event.payload.originalVonageUrl = originalFileUrl

              bp.logger.info('Successfully uploaded Vonage file to S3:', {
                originalUrl: originalFileUrl,
                s3Url
              })
            } catch (uploadError) {
              bp.logger.error('Failed to upload Vonage file to S3, using original URL:', uploadError)
              // Continuar con la URL original si falla la subida a S3
            }
          }

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

          bp.logger.info('Normalized file payload for user preview:', {
            type: event.payload.type,
            hasFile: !!event.payload.file,
            hasUrl: !!event.payload.url,
            title: event.payload.title,
            storage: event.payload.storage,
            finalUrl: event.payload.url || event.payload.file,
            isS3Upload: !!event.payload.originalVonageUrl,
            isImageFile
          })
        }

        // Normalize video messages
        if (event.type === 'video') {
          const originalVideoUrl = event.payload.video || event.payload.url

          // Subir video a S3 si está configurado
          if (s3Service && s3Service.isConfigured() && originalVideoUrl) {
            try {
              bp.logger.info('Uploading Vonage video to S3:', { originalUrl: originalVideoUrl })

              const s3Url = await s3Service.uploadVonageFileToS3(
                originalVideoUrl,
                event.botId,
                event.payload.title || event.payload.name || event.payload.filename || 'Video de WhatsApp',
                'video'
              )

              // Actualizar el payload con la nueva URL de S3
              event.payload.video = s3Url
              event.payload.url = s3Url
              event.payload.originalVonageUrl = originalVideoUrl

              bp.logger.info('Successfully uploaded Vonage video to S3:', {
                originalUrl: originalVideoUrl,
                s3Url
              })
            } catch (uploadError) {
              bp.logger.error('Failed to upload Vonage video to S3, using original URL:', uploadError)
              // Continuar con la URL original si falla la subida a S3
            }
          }

          // Ensure the payload has the expected structure for the web chat
          if (!event.payload.url && event.payload.video) {
            event.payload.url = event.payload.video
          }

          if (!event.payload.video && event.payload.url) {
            event.payload.video = event.payload.url
          }

          if (!event.payload.title && event.payload.name) {
            event.payload.title = event.payload.name
          }

          if (!event.payload.title && event.payload.filename) {
            event.payload.title = event.payload.filename
          }

          // Set default title if none exists
          if (!event.payload.title) {
            event.payload.title = 'Video de WhatsApp'
          }

          // Force storage to be 's3' for better compatibility
          if (!event.payload.storage) {
            event.payload.storage = 's3'
          }

          // Ensure preview exists for video files
          ;(event as any).preview = `🎥 ${event.payload.title}`

          bp.logger.info('Normalized video payload for user preview:', {
            type: event.payload.type,
            hasVideo: !!event.payload.video,
            hasUrl: !!event.payload.url,
            title: event.payload.title,
            storage: event.payload.storage,
            finalUrl: event.payload.url || event.payload.video,
            isS3Upload: !!event.payload.originalVonageUrl
          })
        }
      } catch (error) {
        bp.logger.error(`Error normalizing ${event.type} message from Vonage:`, error)
        // Continue processing even if normalization fails
      }
    }

    // Handle text, image, file, and video types for HITL
    if (!['text', 'image', 'file', 'video'].includes(event.type)) {
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

      // CRITICAL: Stop the event from being processed by the dialog engine
      // This prevents the bot from responding to user messages during HITL
      debug.forBot(event.botId, 'Intercepted user message during HITL - stopping dialog processing', {
        type: event.type,
        handoffId: handoff.id
      })
      return next(undefined, false, true)
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
