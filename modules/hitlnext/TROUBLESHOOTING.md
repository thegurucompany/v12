# Solución de Problemas - Ícono de Bloqueo en HITL Next

## Problema: Botón de "Adjuntar Archivo" Bloqueado

### Síntomas
- Aparece un ícono de bloqueo 🔒 junto al botón "Adjuntar Archivo"
- Los botones están deshabilitados y no se pueden hacer clic
- El área de texto también puede estar deshabilitada

### Causas Principales

#### 1. **Agente No Está Online**
El componente verifica que el agente esté marcado como "online" antes de habilitar los controles.

**Solución:**
1. Ve a la interfaz de HITL Next
2. Asegúrate de que tu estado aparezca como "Online"
3. Si apareces como "Offline", haz clic en "Get Online"

#### 2. **Problemas de Autenticación**
El cliente no puede obtener la información del agente actual.

**Solución:**
1. Cierra sesión y vuelve a iniciar sesión
2. Refresca la página del navegador
3. Verifica que tengas los permisos correctos en Botpress

#### 3. **Error en la API del Cliente**
El método `getCurrentAgent()` puede estar fallando.

**Solución:**
1. Abre las herramientas de desarrollador del navegador (F12)
2. Ve a la pestaña "Console"
3. Busca errores relacionados con "could not fetch current agent"
4. Si hay errores de red, verifica la conectividad con el servidor

#### 4. **Configuración de Permisos Incorrecta**
El usuario puede no tener permisos de escritura en el módulo HITL.

**Solución:**
1. Verifica que tu usuario tenga permisos de "write" en el recurso "module.hitlnext"
2. Contacta al administrador para verificar los permisos de rol

### Pasos de Diagnóstico

#### Paso 1: Verificar Estado del Agente
```javascript
// En la consola del navegador:
// Verificar si el agente está online
console.log(window.botpressWebChat); // Debe existir
```

#### Paso 2: Verificar Configuración S3
```json
{
  "s3Config": {
    "accessKeyId": "TU_ACCESS_KEY",
    "secretAccessKey": "TU_SECRET_KEY", 
    "region": "us-east-1",
    "bucket": "tu-bucket-name"
  }
}
```

#### Paso 3: Verificar Logs del Servidor
```bash
# Buscar errores relacionados con HITL
grep -i "hitlnext" /path/to/botpress/logs/
```

#### Paso 4: Verificar Estado en Base de Datos
```sql
-- Verificar agentes online
SELECT * FROM hitlnext_agents WHERE online = true;

-- Verificar configuración del bot
SELECT * FROM bot_configs WHERE key LIKE '%hitlnext%';
```

### Soluciones Específicas

#### Solución Rápida #1: Forzar Estado Online
```javascript
// En la consola del navegador, ejecutar:
fetch('/api/v1/bots/BOT_ID/mod/hitlnext/agents/me/online', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ online: true })
});
```

#### Solución Rápida #2: Recargar Configuración
```javascript
// Recargar la página después de verificar configuración
window.location.reload();
```

#### Solución Rápida #3: Verificar en Modo Incógnito
Abre la aplicación en una ventana de incógnito para descartar problemas de caché.

### Prevención de Problemas

#### 1. **Configuración Automática de Estado Online**
Configura el timeout de sesión adecuadamente:
```json
{
  "agentSessionTimeout": "30m"
}
```

#### 2. **Monitoring de Conexión**
Implementa alertas para detectar cuando los agentes se desconectan.

#### 3. **Backup de Configuración**
Mantén una copia de respaldo de la configuración de HITL:
```bash
# Exportar configuración
bp export --config --modules hitlnext
```

### Logs Útiles para Debugging

#### Frontend (Consola del Navegador)
```javascript
// Habilitar logs de debug
localStorage.setItem('debug', 'bp:*');
```

#### Backend (Servidor Botpress)  
```bash
# Ejecutar con logs de debug
DEBUG=bp:module:hitlnext* npm start
```

### Contacto para Soporte

Si el problema persiste después de seguir estos pasos:

1. **Recopila la siguiente información:**
   - Versión de Botpress
   - Configuración del módulo HITL
   - Logs de error de la consola del navegador
   - Logs del servidor Botpress

2. **Pasos reproducibles:**
   - Describe exactamente qué pasos llevan al problema
   - Incluye capturas de pantalla

3. **Información del entorno:**
   - Navegador y versión
   - Sistema operativo
   - Configuración de red/proxy

Este documento debe resolver la mayoría de problemas relacionados con botones bloqueados en HITL Next.
