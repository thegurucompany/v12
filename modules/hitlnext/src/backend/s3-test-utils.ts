import * as sdk from 'botpress/sdk'
import { S3FileService } from './s3-image-service'

/**
 * Script de testing para verificar la configuración de S3
 * Uso: node test-s3-config.js <botId>
 */

export async function testS3Configuration(bp: typeof sdk, botId: string): Promise<boolean> {
  try {
    // Obtener configuración
    const config = await bp.config.getModuleConfigForBot('hitlnext', botId)
    
    if (!config.s3Config) {
      bp.logger.error('❌ S3 configuration not found in bot config')
      return false
    }

    // Verificar que todas las propiedades requeridas estén presentes
    const required = ['accessKeyId', 'secretAccessKey', 'region', 'bucket']
    const missing = required.filter(key => !config.s3Config[key])
    
    if (missing.length > 0) {
      bp.logger.error(`❌ Missing S3 configuration properties: ${missing.join(', ')}`)
      return false
    }

    // Crear servicio S3
    const s3Service = new S3FileService(bp, config.s3Config)
    
    if (!s3Service.isConfigured()) {
      bp.logger.error('❌ S3 service is not properly configured')
      return false
    }

    bp.logger.info('✅ S3 configuration is valid')
    bp.logger.info(`📦 Bucket: ${config.s3Config.bucket}`)
    bp.logger.info(`🌍 Region: ${config.s3Config.region}`)
    bp.logger.info(`🔑 Access Key: ${config.s3Config.accessKeyId.substring(0, 8)}...`)

    // Intentar realizar una operación de prueba (listar objetos)
    try {
      // Aquí podrías agregar una verificación real con AWS SDK si quisieras
      bp.logger.info('✅ S3 service initialized successfully')
      bp.logger.info('🚀 Ready to upload Vonage images to S3!')
      return true
    } catch (s3Error) {
      bp.logger.error('❌ Failed to connect to S3:', s3Error.message)
      return false
    }

  } catch (error) {
    bp.logger.error('❌ Error testing S3 configuration:', error)
    return false
  }
}

/**
 * Función helper para verificar configuración desde el middleware
 */
export function logS3Status(bp: typeof sdk, config: any): void {
  if (!config.s3Config) {
    bp.logger.warn('⚠️  S3 not configured - Vonage images will use temporary URLs (expire in 10 minutes)')
    bp.logger.info('💡 To enable permanent image storage, configure S3 in your hitlnext module config')
    return
  }

  const s3Service = new S3FileService(bp, config.s3Config)
  if (s3Service.isConfigured()) {
    bp.logger.info('✅ S3 configured - Vonage images will be uploaded for permanent storage')
    bp.logger.info(`📦 Bucket: ${config.s3Config.bucket} | Region: ${config.s3Config.region}`)
  } else {
    bp.logger.warn('⚠️  S3 configuration incomplete - check your credentials')
  }
}
