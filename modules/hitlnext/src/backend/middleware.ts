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
    const { exitType, agentName, handoffTransfer } = event.payload

    _.set(event, 'state.temp.agentName', agentName)
    _.set(event, `state.temp.hitlnext-${exitType}`, true)

    // Set handoff transfer flag for the bot to use
    if (handoffTransfer) {
      _.set(event, 'state.temp.handoffTransfer', true)
      debug.forBot(event.botId, 'Set handoffTransfer flag for bot', { exitType })
    }
  }
}

// Handler to clean up handoffTransfer flag after bot processes message
const cleanupHandoffTransferFlag = (event: sdk.IO.IncomingEvent) => {
  // If handoffTransfer flag is set, schedule cleanup after current event processing
  if (event.state?.temp?.handoffTransfer) {
    // Use setTimeout to clean up the flag after the current event cycle
    setTimeout(() => {
      if (event.state?.temp?.handoffTransfer) {
        _.set(event, 'state.temp.handoffTransfer', false)
        debug.forBot(event.botId, 'Reset handoffTransfer flag after event processing')
      }
    }, 100) // Small delay to ensure bot has processed the message
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
    try {
      const result = await bp.events.replyToEvent(eventDestination, [event.payload])
      debug.forBot(event.botId, 'Successfully piped event', { success: true })
      return result
    } catch (error) {
      debug.forBot(event.botId, 'Failed to pipe event', { error: error.message, eventDestination })
      throw error
    }
  }

  const handoffCacheKey = (botId: string, threadId: string) => [botId, threadId].join('.')

  const getCachedHandoff = (botId: string, threadId: string) => {
    const handoffId = handoffCache.get(handoffCacheKey(botId, threadId))
    debug.forBot(botId, 'Cache lookup', {
      threadId,
      handoffId: handoffId || 'not found',
      cacheSize: handoffCache.length
    })
    return handoffId
  }

  const cacheHandoff = (botId: string, threadId: string, handoff: IHandoff) => {
    debug.forBot(botId, 'Caching handoff', {
      id: handoff.id,
      threadId,
      status: handoff.status,
      agentId: handoff.agentId,
      agentThreadId: handoff.agentThreadId,
      userThreadId: handoff.userThreadId
    })
    handoffCache.set(handoffCacheKey(botId, threadId), handoff.id)
  }

  const expireHandoff = (botId: string, threadId: string) => {
    debug.forBot(botId, 'Expiring handoff from cache', {
      threadId,
      wasInCache: handoffCache.has(handoffCacheKey(botId, threadId))
    })
    handoffCache.del(handoffCacheKey(botId, threadId))
  }

  const handleIncomingFromUser = async (handoff: IHandoff, event: sdk.IO.IncomingEvent) => {
    // Ensure proper payload structure for file, image, video and voice messages from users
    if (event.type === 'image' || event.type === 'file' || event.type === 'video' || event.type === 'voice') {
      // Handle Vonage file/image/video/voice upload to S3
      if (
        (event.type === 'image' || event.type === 'file' || event.type === 'video' || event.type === 'voice') &&
        handoff.userChannel === 'vonage'
      ) {
        const fileUrl =
          event.payload.image || event.payload.url || event.payload.file || event.payload.video || event.payload.audio
        if (fileUrl && fileUrl.includes('api.vonage.com')) {
          bp.logger.info(`Detected Vonage ${event.type}, attempting S3 upload:`, { fileUrl, handoffId: handoff.id })

          try {
            const config = await bp.config.getModuleConfigForBot('hitlnext', handoff.botId)

            if (config?.s3?.accessKeyId && config?.s3?.secretAccessKey && config?.s3?.region && config?.s3?.bucket) {
              const s3Service = new S3FileService(bp, config.s3)

              // Upload to S3 (works for images, files, videos and audios)
              const s3Url = await s3Service.uploadVonageFileToS3(
                fileUrl,
                handoff.botId,
                event.payload.title ||
                  (event.type === 'image'
                    ? 'WhatsApp Image'
                    : event.type === 'video'
                    ? 'WhatsApp Video'
                    : event.type === 'voice'
                    ? 'Audio de WhatsApp.mp3'
                    : 'WhatsApp File'),
                event.type === 'video' ? 'video' : event.type === 'voice' ? 'file' : event.type
              )

              // Replace the temporary Vonage URL with the permanent S3 URL
              if (event.type === 'image') {
                event.payload.image = s3Url
              } else if (event.type === 'video') {
                event.payload.video = s3Url
                event.payload.url = s3Url
              } else if (event.type === 'voice') {
                event.payload.audio = s3Url
                event.payload.url = s3Url
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
          } else if (fileUrl.match(/\.(mp4|mpeg|mov|avi|webm|3gp|flv|mkv|wmv)$/i)) {
            // If it's a video file, also set the video property
            event.payload.video = fileUrl
          }
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
        } else {
          bp.logger.warn('User video message missing URL/video property:', event.payload)
        }
      }

      if (event.type === 'voice') {
        // Make sure audio URL is accessible
        const audioUrl = event.payload.audio || event.payload.url
        if (audioUrl) {
          // Ensure both properties are set for maximum compatibility
          event.payload.audio = audioUrl
          event.payload.url = audioUrl

          if (!event.payload.title) {
            event.payload.title = 'Audio del usuario.mp3'
          }

          // Ensure storage is set
          if (!event.payload.storage) {
            event.payload.storage = 's3'
          }
        } else {
          bp.logger.warn('User audio message missing URL/audio property:', event.payload)
        }
      }
    }

    // There only is an agentId & agentThreadId after assignation
    if (handoff.status === 'assigned') {
      debug.forBot(handoff.botId, 'Piping user message to agent', {
        handoffId: handoff.id,
        agentId: handoff.agentId,
        agentThreadId: handoff.agentThreadId,
        userThreadId: handoff.userThreadId
      })

      const userId = await repository.mapVisitor(handoff.botId, handoff.agentId)
      return pipeEvent(event, {
        botId: handoff.botId,
        target: userId,
        threadId: handoff.agentThreadId,
        channel: 'web'
      })
    } else {
      debug.forBot(handoff.botId, 'Handoff not assigned, not piping to agent', {
        handoffId: handoff.id,
        status: handoff.status
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

    // Handle file, image, video and voice messages specially for WhatsApp
    if (
      handoff.userChannel === 'vonage' &&
      event.payload &&
      (event.payload.type === 'image' ||
        event.payload.type === 'file' ||
        event.payload.type === 'video' ||
        event.payload.type === 'voice')
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
        } else if (event.payload.type === 'video' && event.payload.video) {
          await vonageService.sendVideo(
            handoff.userId,
            event.payload.video,
            event.payload.title || 'Video',
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
        } else if (event.payload.type === 'voice' && event.payload.audio) {
          // Send audio using the new sendAudio method
          await vonageService.sendAudio(
            handoff.userId,
            event.payload.audio,
            event.payload.title || 'Audio',
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

    // Handle file, image, video and voice messages for web channel - ensure proper formatting for display
    if (
      event.payload &&
      (event.payload.type === 'image' ||
        event.payload.type === 'file' ||
        event.payload.type === 'video' ||
        event.payload.type === 'voice')
    ) {
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

      // For videos, ensure the payload is properly formatted for both agent and user chat
      if (event.payload.type === 'video' && event.payload.video) {
        // Ensure payload structure is consistent for rendering
        if (!event.payload.payload) {
          event.payload.payload = {
            type: 'video',
            title: event.payload.title || 'Video',
            video: event.payload.video,
            url: event.payload.url || event.payload.video
          }
        }

        // Ensure preview is set
        if (!event.preview) {
          ;(event as any).preview = `🎥 Video: ${event.payload.title || 'Video'}`
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

      // For voice/audio messages, ensure the payload is properly formatted for both agent and user chat
      if (event.payload.type === 'voice' && event.payload.audio) {
        // Ensure payload structure is consistent for rendering
        if (!event.payload.payload) {
          event.payload.payload = {
            type: 'voice',
            title: event.payload.title || 'Audio',
            audio: event.payload.audio,
            url: event.payload.url || event.payload.audio
          }
        }

        // Ensure preview is set
        if (!event.preview) {
          ;(event as any).preview = `� ${event.payload.title || 'Audio'}`
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
    // Normalize file, image, video and voice messages from Vonage/WhatsApp
    if (
      event.channel === 'vonage' &&
      (event.type === 'image' || event.type === 'file' || event.type === 'video' || event.type === 'voice')
    ) {
      try {
        // Obtener la configuración de S3 para subir imágenes de Vonage
        const config = await bp.config.getModuleConfigForBot('hitlnext', event.botId)
        let s3Service: S3FileService | null = null

        if (config.s3Config && config.s3Config.accessKeyId) {
          s3Service = new S3FileService(bp, config.s3Config)
        } else {
          bp.logger.warn('S3 configuration not found - Vonage images will use temporary URLs')
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
        }

        // Normalize video messages
        if (event.type === 'video') {
          const originalVideoUrl = event.payload.video || event.payload.url

          // Subir video a S3 si está configurado
          if (s3Service && s3Service.isConfigured() && originalVideoUrl) {
            try {
              const s3Url = await s3Service.uploadVonageFileToS3(
                originalVideoUrl,
                event.botId,
                event.payload.title || event.payload.name || 'Video de WhatsApp',
                'video'
              )

              // Actualizar el payload con la nueva URL de S3
              event.payload.video = s3Url
              event.payload.url = s3Url
              event.payload.originalVonageUrl = originalVideoUrl
            } catch (uploadError) {
              bp.logger.error('Failed to upload Vonage video to S3, using original URL:', uploadError)
              // Continuar con la URL original si falla la subida a S3
            }
          }

          // Ensure the payload has the expected structure for the web chat
          if (!event.payload.url && event.payload.video) {
            event.payload.url = event.payload.video
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

          // Ensure the video property is set correctly
          if (!event.payload.video && event.payload.url) {
            event.payload.video = event.payload.url
          }

          // Set preview for videos
          if (!event.preview) {
            ;(event as any).preview = `🎥 Video: ${event.payload.title}`
          }
        }

        // Normalize voice/audio messages
        if (event.type === 'voice') {
          const originalAudioUrl = event.payload.audio || event.payload.url

          // Subir audio a S3 si está configurado
          if (s3Service && s3Service.isConfigured() && originalAudioUrl) {
            try {
              const s3Url = await s3Service.uploadVonageFileToS3(
                originalAudioUrl,
                event.botId,
                event.payload.title || event.payload.name || 'Audio de WhatsApp.mp3',
                'file' // Audio se trata como file para S3
              )

              // Actualizar el payload con la nueva URL de S3
              event.payload.audio = s3Url
              event.payload.url = s3Url
              event.payload.originalVonageUrl = originalAudioUrl
            } catch (uploadError) {
              bp.logger.error('Failed to upload Vonage audio to S3, using original URL:', uploadError)
            }
          }

          // Ensure the payload has the expected structure for the web chat
          if (!event.payload.url && event.payload.audio) {
            event.payload.url = event.payload.audio
          }

          if (!event.payload.title && event.payload.name) {
            event.payload.title = event.payload.name
          }

          if (!event.payload.title && event.payload.filename) {
            event.payload.title = event.payload.filename
          }

          // Set default title if none exists
          if (!event.payload.title) {
            event.payload.title = 'Audio de WhatsApp.mp3'
          }

          // Force storage to be 's3' for better compatibility
          if (!event.payload.storage) {
            event.payload.storage = 's3'
          }

          // Ensure the audio property is set correctly
          if (!event.payload.audio && event.payload.url) {
            event.payload.audio = event.payload.url
          }

          // Set preview for audio
          if (!event.preview) {
            ;(event as any).preview = `� ${event.payload.title}`
          }
        }
      } catch (error) {
        bp.logger.error(`Error normalizing ${event.type} message from Vonage:`, error)
        // Continue processing even if normalization fails
      }
    }

    // Handle text, image, file, video and voice types for HITL
    if (!['text', 'image', 'file', 'video', 'voice'].includes(event.type)) {
      return next(undefined, false, true)
    }

    const handoffId = getCachedHandoff(event.botId, event.threadId)

    if (!handoffId) {
      debug.forBot(event.botId, 'No handoff found in cache', {
        threadId: event.threadId,
        type: event.type,
        direction: event.direction,
        channel: event.channel
      })

      // Schedule cleanup of handoffTransfer flag if it's set (bot will process normally)
      cleanupHandoffTransferFlag(event)

      next(undefined, false)
      return
    }

    debug.forBot(event.botId, 'Found handoff in cache', {
      handoffId,
      threadId: event.threadId,
      type: event.type,
      direction: event.direction,
      channel: event.channel
    })

    const handoff = await repository.getHandoff(handoffId)

    if (!handoff) {
      debug.forBot(event.botId, 'Handoff not found in database', { handoffId, threadId: event.threadId })

      // Schedule cleanup of handoffTransfer flag if it's set (bot will process normally)
      cleanupHandoffTransferFlag(event)

      next(undefined, false)
      return
    }

    debug.forBot(event.botId, 'Retrieved handoff from database', {
      handoffId: handoff.id,
      status: handoff.status,
      agentId: handoff.agentId,
      userThreadId: handoff.userThreadId,
      agentThreadId: handoff.agentThreadId,
      eventThreadId: event.threadId
    })

    const incomingFromUser = handoff.userThreadId === event.threadId
    const incomingFromAgent = handoff.agentThreadId === event.threadId

    debug.forBot(event.botId, 'Message direction analysis', {
      handoffId: handoff.id,
      eventThreadId: event.threadId,
      userThreadId: handoff.userThreadId,
      agentThreadId: handoff.agentThreadId,
      incomingFromUser,
      incomingFromAgent,
      handoffStatus: handoff.status
    })

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

    // Schedule cleanup of handoffTransfer flag if it's set
    cleanupHandoffTransferFlag(event)

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
