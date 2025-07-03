import * as sdk from 'botpress/sdk'
import AWS from 'aws-sdk'
import axios from 'axios'
import path from 'path'
import { URL } from 'url'
import { v4 as uuidv4 } from 'uuid'

export interface S3Config {
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucket: string
}

export class S3FileService {
  private s3: AWS.S3

  constructor(private bp: typeof sdk, private config: S3Config) {
    this.s3 = new AWS.S3({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region
    })
  }

  /**
   * Descarga una imagen desde Vonage y la sube a S3
   * @param imageUrl URL temporal de Vonage (válida por 10 minutos)
   * @param botId ID del bot
   * @param title Título de la imagen
   * @returns URL permanente en S3
   */
  async uploadVonageImageToS3(imageUrl: string, botId: string, title?: string): Promise<string> {
    return this.uploadVonageFileToS3(imageUrl, botId, title, 'image')
  }

  /**
   * Descarga un archivo desde Vonage y lo sube a S3
   * @param fileUrl URL temporal de Vonage (válida por 10 minutos)
   * @param botId ID del bot
   * @param title Título del archivo
   * @param fileType Tipo de archivo ('image' o 'file')
   * @returns URL permanente en S3
   */
  async uploadVonageFileToS3(fileUrl: string, botId: string, title?: string, fileType: 'image' | 'file' = 'file'): Promise<string> {
    try {
      this.bp.logger.info(`Downloading ${fileType} from Vonage:`, { fileUrl, botId })

      // Descargar el archivo desde Vonage
      const response = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
        timeout: 60000, // 60 segundos de timeout para archivos más grandes
        headers: {
          'User-Agent': 'Botpress/12.0'
        }
      })

      if (response.status !== 200) {
        throw new Error(`Failed to download ${fileType}: HTTP ${response.status}`)
      }

      // Determinar la extensión y tipo de contenido
      const contentType = response.headers['content-type'] || this.getDefaultContentType(fileType)
      const extension = this.getFileExtension(fileUrl, contentType)

      // Generar nombre único para el archivo
      const fileName = `${uuidv4()}${extension}`
      const folderName = fileType === 'image' ? 'vonage-images' : 'vonage-files'
      const key = `${folderName}/${botId}/${fileName}`

      // Subir a S3
      const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: this.config.bucket,
        Key: key,
        Body: Buffer.from(response.data),
        ContentType: contentType,
        ACL: 'public-read',
        Metadata: {
          'original-title': title || `${fileType === 'image' ? 'Imagen' : 'Archivo'} de WhatsApp`,
          'source': 'vonage-whatsapp',
          'bot-id': botId,
          'file-type': fileType,
          'upload-date': new Date().toISOString(),
          'original-url': fileUrl
        }
      }

      this.bp.logger.info(`Uploading ${fileType} to S3:`, {
        bucket: this.config.bucket,
        key,
        contentType,
        size: response.data.length
      })

      const result = await this.s3.upload(uploadParams).promise()

      this.bp.logger.info(`Successfully uploaded ${fileType} to S3:`, {
        s3Url: result.Location,
        originalUrl: fileUrl,
        fileType
      })

      return result.Location

    } catch (error) {
      this.bp.logger.error(`Failed to upload Vonage ${fileType} to S3:`, error)
      throw error
    }
  }

  /**
   * Obtiene la extensión del archivo basándose en la URL o tipo de contenido
   */
  private getFileExtension(url: string, contentType: string): string {
    // Primero intentar obtener la extensión de la URL
    try {
      const urlPath = new URL(url).pathname
      const extensionFromUrl = path.extname(urlPath)
      if (extensionFromUrl) {
        return extensionFromUrl
      }
    } catch {
      // Si falla el parseo de URL, continuar con content-type
    }

    // Mapear content-type a extensiones
    const contentTypeExtensions: { [key: string]: string } = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'video/mp4': '.mp4',
      'video/avi': '.avi',
      'video/quicktime': '.mov'
    }

    return contentTypeExtensions[contentType] || '.bin'
  }

  /**
   * Obtiene el tipo de contenido por defecto según el tipo de archivo
   */
  private getDefaultContentType(fileType: 'image' | 'file'): string {
    return fileType === 'image' ? 'image/jpeg' : 'application/octet-stream'
  }

  /**
   * Verifica si la configuración de S3 está completa
   */
  isConfigured(): boolean {
    return !!(
      this.config.accessKeyId &&
      this.config.secretAccessKey &&
      this.config.region &&
      this.config.bucket
    )
  }

  /**
   * Determina si una URL es una imagen basándose en la extensión
   */
  isImageUrl(url: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
    const lowerUrl = url.toLowerCase()
    return imageExtensions.some(ext => lowerUrl.includes(ext))
  }

  /**
   * Extrae el nombre del archivo desde una URL
   */
  getFileNameFromUrl(url: string): string {
    try {
      const urlParts = url.split('/')
      const fileName = urlParts[urlParts.length - 1]
      return fileName.split('?')[0] || 'imagen'
    } catch {
      return 'imagen'
    }
  }
}
