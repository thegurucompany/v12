import * as sdk from 'botpress/sdk'
import { VonageConfig, SendMessageResult } from './types'

/**
 * Verifica si Vonage está configurado para un bot
 */
export async function isVonageConfigured(bp: typeof sdk, botId: string): Promise<boolean> {
  try {
    const config = await getVonageConfig(bp, botId)
    return config !== null
  } catch (error) {
    bp.logger.forBot(botId).debug(`[outbound-campaigns] Error checking Vonage config: ${error.message}`)
    return false
  }
}

/**
 * Obtiene la configuración de Vonage del bot
 * Retorna null si no está configurado correctamente
 */
export async function getVonageConfig(bp: typeof sdk, botId: string): Promise<VonageConfig | null> {
  try {
    // Obtener la configuración del bot
    const botConfig = await bp.bots.getBotById(botId)
    
    if (!botConfig) {
      return null
    }

    // Buscar la configuración de messaging.channels.vonage
    const messaging = (botConfig as any).messaging
    
    if (!messaging?.channels?.vonage) {
      return null
    }

    const vonageConfig = messaging.channels.vonage

    // Verificar que todos los campos requeridos tengan valor
    const requiredFields = ['apiKey', 'apiSecret', 'applicationId', 'privateKey']
    for (const field of requiredFields) {
      if (!vonageConfig[field] || vonageConfig[field].trim() === '') {
        return null
      }
    }

    // Verificar que esté habilitado
    if (vonageConfig.enabled === false) {
      return null
    }

    return {
      enabled: vonageConfig.enabled !== false,
      apiKey: vonageConfig.apiKey,
      apiSecret: vonageConfig.apiSecret,
      applicationId: vonageConfig.applicationId,
      privateKey: vonageConfig.privateKey,
      whatsappNumber: vonageConfig.whatsappNumber || vonageConfig.number
    }
  } catch (error) {
    bp.logger.forBot(botId).error(`[outbound-campaigns] Error reading Vonage config: ${error.message}`)
    return null
  }
}

/**
 * Envía un mensaje de WhatsApp usando un template de Meta vía Vonage
 */
export async function sendWhatsAppTemplate(
  bp: typeof sdk,
  botId: string,
  phoneNumber: string,
  templateId: string,
  variables: Record<string, string>,
  templateNamespace?: string,
  templateLanguage: string = 'es-MX'
): Promise<SendMessageResult> {
  try {
    const config = await getVonageConfig(bp, botId)
    if (!config) {
      return { success: false, error: 'Vonage not configured' }
    }

    // Normalizar el número FROM (remitente) - debe estar en formato E.164
    const fromNumber = normalizeFromNumber(config.whatsappNumber)
    if (!fromNumber) {
      return { success: false, error: `Invalid FROM number configured: ${config.whatsappNumber}` }
    }

    // Normalizar el número TO (destino) - Vonage requiere sin el símbolo +
    let toNumber = phoneNumber.replace(/[\s\-\(\)\.]/g, '').trim()
    if (toNumber.startsWith('+')) {
      toNumber = toNumber.substring(1)
    }

    // Construir el nombre del template con namespace (formato: namespace:template_name)
    const templateFullName = templateNamespace 
      ? `${templateNamespace}:${templateId}` 
      : templateId

    // Construir el cuerpo del mensaje para Vonage Messages API v1
    // Documentación: https://developer.vonage.com/en/api/messages#SendWithWhatsAppTemplate
    const messageBody: any = {
      from: fromNumber,
      to: toNumber,
      channel: 'whatsapp',
      message_type: 'template',
      whatsapp: {
        policy: 'deterministic',
        locale: templateLanguage
      },
      template: {
        name: templateFullName
      }
    }

    // Solo agregar parameters si hay variables
    const variableValues = Object.values(variables)
    if (variableValues.length > 0) {
      messageBody.template.parameters = variableValues.map(value => ({ default: value }))
    }

    // Llamar a la API de Vonage
    const response = await makeVonageApiCall(bp, botId, config, messageBody)

    if (response.success) {
      return {
        success: true,
        message_uuid: response.message_uuid
      }
    } else {
      return {
        success: false,
        error: response.error || 'Unknown error from Vonage'
      }
    }
  } catch (error) {
    bp.logger.forBot(botId).error(`[outbound-campaigns] Error sending WhatsApp template: ${error.message}`)
    return { success: false, error: error.message }
  }
}

/**
 * Realiza una llamada a la API de Vonage Messages
 * Esta función hace la llamada HTTP real a Vonage
 */
async function makeVonageApiCall(
  bp: typeof sdk,
  botId: string,
  config: VonageConfig,
  messageBody: any
): Promise<{ success: boolean; message_uuid?: string; error?: string }> {
  try {
    const axios = require('axios')

    // JWT Authentication para Vonage Messages API
    const jwt = generateVonageJwt(config.applicationId, config.privateKey)

    const response = await axios.post(
      'https://api.nexmo.com/v1/messages',
      messageBody,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`
        },
        timeout: 30000 // 30 segundos
      }
    )

    if (response.status === 202 && response.data?.message_uuid) {
      return { success: true, message_uuid: response.data.message_uuid }
    }

    return { success: false, error: `Unexpected response: ${response.status}` }
  } catch (error) {
    if (error.response) {
      // Error de la API de Vonage - capturar todos los detalles
      const errorData = error.response.data
      const statusCode = error.response.status
      
      // Construir mensaje de error detallado
      const errorParts = []
      
      if (statusCode) {
        errorParts.push(`HTTP ${statusCode}`)
      }
      if (errorData?.type) {
        errorParts.push(`Type: ${errorData.type}`)
      }
      if (errorData?.title) {
        errorParts.push(`Title: ${errorData.title}`)
      }
      if (errorData?.detail) {
        errorParts.push(`Detail: ${errorData.detail}`)
      }
      if (errorData?.instance) {
        errorParts.push(`Instance: ${errorData.instance}`)
      }
      if (errorData?.invalid_parameters && Array.isArray(errorData.invalid_parameters)) {
        const params = errorData.invalid_parameters.map((p: any) => `${p.name}: ${p.reason}`).join('; ')
        errorParts.push(`Invalid params: ${params}`)
      }
      if (errorData?.error_title) {
        errorParts.push(`Error: ${errorData.error_title}`)
      }
      if (errorData?.error?.message) {
        errorParts.push(`Message: ${errorData.error.message}`)
      }
      
      const errorMessage = errorParts.length > 0 ? errorParts.join(' | ') : JSON.stringify(errorData)
      
      return { success: false, error: errorMessage }
    }
    return { success: false, error: error.message }
  }
}

/**
 * Genera un JWT para autenticación con Vonage Messages API
 */
function generateVonageJwt(applicationId: string, privateKey: string): string {
  try {
    const jwt = require('jsonwebtoken')
    const uuid = require('uuid')

    const now = Math.floor(Date.now() / 1000)
    const payload = {
      application_id: applicationId,
      iat: now,
      exp: now + 3600, // 1 hora de validez
      jti: uuid.v4()
    }

    // Decodificar el private key si está en base64
    let key = privateKey
    if (!privateKey.includes('-----BEGIN')) {
      key = Buffer.from(privateKey, 'base64').toString('utf-8')
    }

    return jwt.sign(payload, key, { algorithm: 'RS256' })
  } catch (error) {
    throw new Error(`Failed to generate Vonage JWT: ${error.message}`)
  }
}

/**
 * Valida el formato E.164 de un número de teléfono
 * Formato: +[código país][número] (10-15 dígitos total)
 */
export function isValidE164(phoneNumber: string): boolean {
  if (!phoneNumber) return false
  
  // E.164: + seguido de 10-15 dígitos
  const e164Regex = /^\+[1-9]\d{9,14}$/
  return e164Regex.test(phoneNumber.trim())
}

/**
 * Normaliza un número de teléfono al formato E.164
 * Intenta agregar el prefijo +521 para números mexicanos (celulares)
 * 
 * Para México:
 * - Números locales de 10 dígitos (ej: 4422591631) se convierten a +521XXXXXXXXXX
 * - El prefijo "1" es requerido por Vonage/WhatsApp para celulares mexicanos
 */
export function normalizePhoneNumber(phoneNumber: string, defaultCountryCode: string = '52'): string | null {
  if (!phoneNumber) return null

  let cleaned = phoneNumber.replace(/[\s\-\(\)\.]/g, '').trim()

  // Si ya tiene formato E.164 válido
  if (isValidE164(cleaned)) {
    return cleaned
  }

  // Si empieza con + pero no es válido, intentar corregir
  if (cleaned.startsWith('+')) {
    // Ya tiene + pero no es válido, retornar null
    return null
  }

  // Si empieza con el código de país sin + (ej: 521XXXXXXXXXX)
  if (cleaned.startsWith(defaultCountryCode + '1') && cleaned.length === 13) {
    cleaned = '+' + cleaned
    if (isValidE164(cleaned)) {
      return cleaned
    }
  }

  // Si empieza con el código de país sin + y sin 1 (ej: 52XXXXXXXXXX)
  if (cleaned.startsWith(defaultCountryCode) && cleaned.length === 12) {
    // Agregar el 1 después del código de país para celulares mexicanos
    cleaned = '+' + defaultCountryCode + '1' + cleaned.substring(2)
    if (isValidE164(cleaned)) {
      return cleaned
    }
  }

  // Si es un número local de 10 dígitos (sin código de país)
  // Para México, agregar +521 (código país + 1 para celulares)
  if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
    cleaned = '+' + defaultCountryCode + '1' + cleaned
    if (isValidE164(cleaned)) {
      return cleaned
    }
  }

  // Intentar con 11 dígitos (si el usuario puso el 1 pero sin código de país)
  if (cleaned.length === 11 && cleaned.startsWith('1') && /^\d{11}$/.test(cleaned)) {
    cleaned = '+' + defaultCountryCode + cleaned
    if (isValidE164(cleaned)) {
      return cleaned
    }
  }

  return null
}

/**
 * Normaliza el número FROM (remitente) para Vonage WhatsApp API
 * 
 * Vonage requiere el número FROM SIN el símbolo + para WhatsApp
 * Formato esperado: [código país][número] (ej: 5215512345678)
 * 
 * Acepta entradas como:
 * - 5215512345678 (correcto, se retorna tal cual)
 * - +5215512345678 (se quita el +)
 * - 15512345678 (se agrega 52)
 * - 5512345678 (se agrega 521)
 */
export function normalizeFromNumber(phoneNumber: string): string | null {
  if (!phoneNumber) return null

  let cleaned = phoneNumber.replace(/[\s\-\(\)\.]/g, '').trim()

  // Quitar el + si lo tiene
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1)
  }

  // Validar que solo tenga dígitos
  if (!/^\d+$/.test(cleaned)) {
    return null
  }

  // Si ya tiene el formato correcto (13-15 dígitos con código de país)
  if (cleaned.length >= 12 && cleaned.length <= 15) {
    return cleaned
  }

  // Si tiene 11 dígitos y empieza con 1 (ej: 15512345678), agregar 52
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return '52' + cleaned
  }

  // Si tiene 10 dígitos, agregar 521 (para México celulares)
  if (cleaned.length === 10) {
    return '521' + cleaned
  }

  // Si tiene 12 dígitos y empieza con 52 pero no tiene el 1 (ej: 525512345678)
  if (cleaned.length === 12 && cleaned.startsWith('52') && !cleaned.startsWith('521')) {
    // Insertar el 1 después del 52
    return '521' + cleaned.substring(2)
  }

  return null
}
