/**
 * Set User Phone (Simplified version)
 * @title Set User Phone - Simplified
 * @category Custom
 * @author Your Name
 */
const setUserPhoneSimplified = async () => {
  // Si el middleware de Vonage funcionó correctamente, 
  // el event.target ya debería ser el número de teléfono
  
  if (event.channel === 'vonage' || event.channel === 'whatsapp') {
    // El número ya está en event.target gracias al middleware
    const phoneNumber = event.target
    
    // Aplicar la limpieza si es necesario
    function removeFirstTwoNumbers(numbers) {
      if (numbers.length === 10) {
        return numbers
      }
      if (numbers.length >= 2) {
        return numbers.substring(2)
      }
      return ''
    }
    
    session.userMsisdn = removeFirstTwoNumbers(phoneNumber)
    bp.logger.info(`[Simplified] Número del usuario desde target: ${session.userMsisdn}`)
    
    // Verificar que el middleware funcionó
    if (phoneNumber.includes('-')) {
      // Si todavía tiene guiones, el middleware no funcionó, usar método original
      bp.logger.warn('Middleware no funcionó, usando método original...')
      
      let conversationId = event.threadId
      let botId = event.botId
      let messaging = bp.messaging.forBot(botId)
      let endpoints = await messaging.listEndpoints(conversationId)
      let endpoint = endpoints[0]
      let mosiMobilePhone = ''
      
      if (!endpoint) {
        const user = event.state.user
        if (!user || !user.webchatCustomId) {
          mosiMobilePhone = ''
        } else {
          mosiMobilePhone = user.webchatCustomId.msisdn
        }
      } else {
        mosiMobilePhone = endpoint.sender
      }
      
      session.userMsisdn = removeFirstTwoNumbers(mosiMobilePhone)
      bp.logger.info('Número del usuario (método original):', session.userMsisdn)
    }
  } else {
    bp.logger.info('Canal no es Vonage/WhatsApp, no se aplica mapeo de teléfono')
  }
}

return setUserPhoneSimplified()
