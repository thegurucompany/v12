/**
 * Test Vonage User ID mapping
 * @title Test Vonage User ID
 * @category Custom
 * @author Your Name
 */
const testVonageUserId = async () => {
  const userId = event.target
  const phoneNumber = session.userMsisdn || 'No phone found'
  const originalUserId = session.originalUserId || 'No original ID found'
  
  bp.logger.info('=== Vonage User ID Test ===')
  bp.logger.info(`Current user ID: ${userId}`)
  bp.logger.info(`Phone number: ${phoneNumber}`)
  bp.logger.info(`Original UUID: ${originalUserId}`)
  bp.logger.info(`Channel: ${event.channel}`)
  bp.logger.info('========================')
  
  // También podemos guardar en temp para usar en el flujo
  temp.vonageUserId = userId
  temp.vonagePhone = phoneNumber
  temp.vonageOriginalId = originalUserId
}

return testVonageUserId()
