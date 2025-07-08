import * as sdk from 'botpress/sdk'
import { IComment } from '../types'

export class VonageWhatsAppService {
  constructor(private bp: typeof sdk) {}

  async sendImage(userId: string, imageUrl: string, title: string, botId?: string, threadId?: string): Promise<void> {
    try {
      await this.bp.events.sendEvent(
        this.bp.IO.Event({
          direction: 'outgoing',
          botId,
          channel: 'whatsapp',
          threadId,
          target: userId,
          type: 'image',
          payload: {
            type: 'image',
            title,
            image: imageUrl
          }
        } as sdk.IO.EventCtorArgs)
      )
    } catch (error) {
      this.bp.logger.error('Failed to send image via Vonage WhatsApp:', error)
      throw error
    }
  }

  async sendDocument(
    userId: string,
    documentUrl: string,
    title: string,
    botId?: string,
    threadId?: string
  ): Promise<void> {
    try {
      await this.bp.events.sendEvent(
        this.bp.IO.Event({
          direction: 'outgoing',
          botId,
          channel: 'whatsapp',
          threadId,
          target: userId,
          type: 'file',
          payload: {
            type: 'file',
            title,
            url: documentUrl
          }
        } as sdk.IO.EventCtorArgs)
      )
    } catch (error) {
      this.bp.logger.error('Failed to send document via Vonage WhatsApp:', error)
      throw error
    }
  }

  async sendVideo(userId: string, videoUrl: string, title: string, botId?: string, threadId?: string): Promise<void> {
    try {
      await this.bp.events.sendEvent(
        this.bp.IO.Event({
          direction: 'outgoing',
          botId,
          channel: 'whatsapp',
          threadId,
          target: userId,
          type: 'video',
          payload: {
            type: 'video',
            title,
            video: videoUrl,
            url: videoUrl
          }
        } as sdk.IO.EventCtorArgs)
      )
    } catch (error) {
      this.bp.logger.error('Failed to send video via Vonage WhatsApp:', error)
      throw error
    }
  }

  async forwardFileToUser(comment: IComment, botId: string, threadId: string): Promise<void> {
    if (!comment.uploadUrl) {
      return
    }

    try {
      const isImage = this.isImageFile(comment.uploadUrl)
      const isVideo = this.isVideoFile(comment.uploadUrl)

      if (isImage) {
        // Send as image message
        await this.bp.events.sendEvent(
          this.bp.IO.Event({
            direction: 'outgoing',
            botId,
            channel: 'whatsapp',
            threadId,
            type: 'image',
            payload: {
              type: 'image',
              title: this.getFileNameFromUrl(comment.uploadUrl),
              image: comment.uploadUrl
            }
          } as sdk.IO.EventCtorArgs)
        )
      } else if (isVideo) {
        // Send as video message
        await this.bp.events.sendEvent(
          this.bp.IO.Event({
            direction: 'outgoing',
            botId,
            channel: 'whatsapp',
            threadId,
            type: 'video',
            payload: {
              type: 'video',
              title: this.getFileNameFromUrl(comment.uploadUrl),
              video: comment.uploadUrl,
              url: comment.uploadUrl
            }
          } as sdk.IO.EventCtorArgs)
        )
      } else {
        // Send as file message
        await this.bp.events.sendEvent(
          this.bp.IO.Event({
            direction: 'outgoing',
            botId,
            channel: 'whatsapp',
            threadId,
            type: 'file',
            payload: {
              type: 'file',
              title: this.getFileNameFromUrl(comment.uploadUrl),
              url: comment.uploadUrl
            }
          } as sdk.IO.EventCtorArgs)
        )
      }

      // Also send a text message if there's content
      if (comment.content && comment.content.trim()) {
        await this.bp.events.sendEvent(
          this.bp.IO.Event({
            direction: 'outgoing',
            botId,
            channel: 'whatsapp',
            threadId,
            type: 'text',
            payload: {
              type: 'text',
              text: comment.content
            }
          } as sdk.IO.EventCtorArgs)
        )
      }
    } catch (error) {
      this.bp.logger.error('Error forwarding file to WhatsApp user:', error)
      throw error
    }
  }

  private isImageFile(url: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
    const lowerUrl = url.toLowerCase()
    return imageExtensions.some(ext => lowerUrl.includes(ext))
  }

  private isVideoFile(url: string): boolean {
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.3gp']
    const lowerUrl = url.toLowerCase()
    return videoExtensions.some(ext => lowerUrl.includes(ext))
  }

  private getFileNameFromUrl(url: string): string {
    try {
      const urlParts = url.split('/')
      return urlParts[urlParts.length - 1] || 'file'
    } catch {
      return 'file'
    }
  }
}
