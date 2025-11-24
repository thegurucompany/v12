/**
 * Script de Testing Manual para el Módulo de Incidencias Masivas
 *
 * Uso:
 * 1. Asegúrate de que Botpress esté corriendo
 * 2. Modifica BOT_ID con tu bot real
 * 3. Ejecuta: node test-incidents.js
 */

const axios = require('axios')

// ==================== CONFIGURACIÓN ====================
const BOTPRESS_URL = 'http://localhost:3000'
const BOT_ID = 'tu-bot-id-aqui' // ⚠️ CAMBIAR ESTO
const AUTH_TOKEN = 'tu-token-aqui' // ⚠️ CAMBIAR ESTO (opcional si no tienes auth)

// ==================== HELPER FUNCTIONS ====================

const api = axios.create({
  baseURL: `${BOTPRESS_URL}/api/v1/bots/${BOT_ID}/mod/mass-incidents`,
  headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}
})

const log = (message, data) => {
  console.log(`\n${'='.repeat(50)}`)
  console.log(`✓ ${message}`)
  if (data) {
    console.log(JSON.stringify(data, null, 2))
  }
  console.log('='.repeat(50))
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ==================== TESTS ====================

async function testGetStatus() {
  try {
    const { data } = await api.get('/incidents')
    log('GET /incidents - Estado actual', data)
    return data
  } catch (error) {
    console.error('❌ Error obteniendo estado:', error.response?.data || error.message)
    throw error
  }
}

async function testActivateIncident(message) {
  try {
    const { data } = await api.post('/incidents', { message })
    log('POST /incidents - Incidencia activada', data)
    return data
  } catch (error) {
    console.error('❌ Error activando incidencia:', error.response?.data || error.message)
    throw error
  }
}

async function testUpdateIncident(message) {
  try {
    const { data } = await api.post('/incidents', { message })
    log('POST /incidents - Incidencia actualizada', data)
    return data
  } catch (error) {
    console.error('❌ Error actualizando incidencia:', error.response?.data || error.message)
    throw error
  }
}

async function testDeactivateIncident() {
  try {
    const { data } = await api.delete('/incidents')
    log('DELETE /incidents - Incidencia desactivada', data)
    return data
  } catch (error) {
    console.error('❌ Error desactivando incidencia:', error.response?.data || error.message)
    throw error
  }
}

async function testValidation() {
  try {
    // Test 1: Mensaje vacío
    await api.post('/incidents', { message: '' })
  } catch (error) {
    log('Validación: Mensaje vacío (esperado fallar)', error.response?.data)
  }

  try {
    // Test 2: Mensaje muy largo (> 5000 chars)
    const longMessage = 'A'.repeat(5001)
    await api.post('/incidents', { message: longMessage })
  } catch (error) {
    log('Validación: Mensaje muy largo (esperado fallar)', error.response?.data)
  }

  try {
    // Test 3: Sin campo message
    await api.post('/incidents', {})
  } catch (error) {
    log('Validación: Sin campo message (esperado fallar)', error.response?.data)
  }
}

// ==================== SUITE DE TESTS ====================

async function runAllTests() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║   Testing Módulo de Incidencias Masivas                  ║
║   Bot ID: ${BOT_ID.padEnd(40)} ║
╚═══════════════════════════════════════════════════════════╝
  `)

  try {
    // Test 1: Verificar estado inicial
    console.log('\n🧪 Test 1: Verificar estado inicial')
    await testGetStatus()
    await sleep(1000)

    // Test 2: Activar incidencia
    console.log('\n🧪 Test 2: Activar incidencia')
    await testActivateIncident('🚨 Sistema en mantenimiento. Estaremos de vuelta en 30 minutos.')
    await sleep(1000)

    // Test 3: Verificar que está activa
    console.log('\n🧪 Test 3: Verificar incidencia activa')
    const status1 = await testGetStatus()
    console.log('¿Está activa?', status1.data?.active ? '✓ SÍ' : '✗ NO')
    await sleep(1000)

    // Test 4: Actualizar mensaje
    console.log('\n🧪 Test 4: Actualizar mensaje de incidencia')
    await testUpdateIncident('🔧 Mantenimiento extendido. Estaremos disponibles en 1 hora.')
    await sleep(1000)

    // Test 5: Verificar actualización
    console.log('\n🧪 Test 5: Verificar mensaje actualizado')
    await testGetStatus()
    await sleep(1000)

    // Test 6: Desactivar incidencia
    console.log('\n🧪 Test 6: Desactivar incidencia')
    await testDeactivateIncident()
    await sleep(1000)

    // Test 7: Verificar que está inactiva
    console.log('\n🧪 Test 7: Verificar incidencia inactiva')
    const status2 = await testGetStatus()
    console.log('¿Está activa?', status2.data?.active ? '✗ SÍ (ERROR)' : '✓ NO')
    await sleep(1000)

    // Test 8: Validaciones
    console.log('\n🧪 Test 8: Validaciones de input')
    await testValidation()

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║   ✓ Todos los tests completados                          ║
╚═══════════════════════════════════════════════════════════╝
    `)
  } catch (error) {
    console.error('\n❌ Suite de tests falló:', error.message)
    process.exit(1)
  }
}

// ==================== EJECUCIÓN ====================

if (BOT_ID === 'tu-bot-id-aqui') {
  console.error(`
❌ ERROR: Debes configurar BOT_ID antes de ejecutar los tests

Pasos:
1. Abre test-incidents.js
2. Cambia BOT_ID por tu bot real
3. (Opcional) Configura AUTH_TOKEN si tienes autenticación
4. Ejecuta: node test-incidents.js
  `)
  process.exit(1)
}

// Menú interactivo
const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Uso: node test-incidents.js [opción]

Opciones:
  (sin opciones)    Ejecutar todos los tests
  --status          Solo verificar estado actual
  --activate        Activar incidencia de prueba
  --deactivate      Desactivar incidencia
  --help, -h        Mostrar esta ayuda
  `)
  process.exit(0)
}

if (args.includes('--status')) {
  testGetStatus().then(() => process.exit(0))
} else if (args.includes('--activate')) {
  testActivateIncident('🚨 Incidencia de prueba - Testing').then(() => process.exit(0))
} else if (args.includes('--deactivate')) {
  testDeactivateIncident().then(() => process.exit(0))
} else {
  runAllTests().then(() => process.exit(0))
}
