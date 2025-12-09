# Módulo de Campañas Salientes (Outbound Campaigns)

## 📋 Descripción

Módulo para envío masivo de mensajes de WhatsApp usando templates de Meta a través de Vonage. Incluye throttling inteligente para no saturar el servidor y trazabilidad completa de todos los envíos.

## 🚀 Características

- ✅ **Throttling inteligente**: Envío en lotes configurables para no saturar el servidor
- ✅ **Templates de Meta**: Soporte para templates de WhatsApp Business API
- ✅ **Integración Vonage**: Envío a través de Vonage Messages API
- ✅ **Importación CSV**: Carga masiva de destinatarios desde archivos CSV
- ✅ **Trazabilidad completa**: Logs de cada envío y estado de destinatarios
- ✅ **Control de campañas**: Iniciar, pausar, reanudar y cancelar campañas
- ✅ **Reintentos automáticos**: Reintento automático de mensajes fallidos
- ✅ **Reportes**: Exportación de destinatarios fallidos y métricas

## 📦 Instalación

1. El módulo ya está en: `/modules/outbound-campaigns/`

2. Compilar el módulo:

```bash
cd modules/outbound-campaigns
yarn build
```

3. O compilar todos los módulos:

```bash
yarn build:modules
```

4. Reiniciar Botpress para cargar el módulo

## 🔧 Requisitos

El módulo requiere que el bot tenga configuradas las credenciales de Vonage en su archivo `bot.config.json`:

```json
{
  "messaging": {
    "channels": {
      "vonage": {
        "enabled": true,
        "apiKey": "TU_API_KEY",
        "apiSecret": "TU_API_SECRET",
        "applicationId": "TU_APPLICATION_ID",
        "privateKey": "RUTA_A_PRIVATE_KEY"
      }
    }
  }
}
```

## 🎯 Uso

### Desde el Studio

1. Navega a tu bot en Botpress Studio
2. En el menú lateral, haz clic en **"Campañas Salientes"**
3. Crea una nueva campaña:
   - Nombre de la campaña
   - Template ID de Meta
   - Configuración de lotes (opcional)
4. Sube el archivo CSV con destinatarios
5. Inicia la campaña

### Formato del CSV

El archivo CSV debe tener al menos la columna `phone_number`. Se aceptan números en los siguientes formatos:

- **10 dígitos locales** (recomendado): `4422591631` - Se convierte automáticamente a `+5214422591631`
- **Formato E.164 completo**: `+5214422591631`

```csv
phone_number,var1,var2
4422591631,Juan,Promoción Navidad
4421234567,María,Descuento Especial
```

> **Nota**: Para números mexicanos, el sistema agrega automáticamente el prefijo `+521` (código de país + prefijo de celular) requerido por WhatsApp/Vonage.

### Estados de Campaña

- **draft**: Borrador, aún no iniciada
- **scheduled**: Programada para inicio futuro
- **running**: En ejecución, enviando mensajes
- **paused**: Pausada temporalmente
- **completed**: Completada exitosamente
- **failed**: Fallida por errores

## 📊 API Endpoints

### Estado del módulo
```
GET /api/v1/bots/:botId/mod/outbound-campaigns/status
```

### Campañas
```
GET    /api/v1/bots/:botId/mod/outbound-campaigns/campaigns
POST   /api/v1/bots/:botId/mod/outbound-campaigns/campaigns
GET    /api/v1/bots/:botId/mod/outbound-campaigns/campaigns/:id
PUT    /api/v1/bots/:botId/mod/outbound-campaigns/campaigns/:id
DELETE /api/v1/bots/:botId/mod/outbound-campaigns/campaigns/:id
```

### Acciones de campaña
```
POST /api/v1/bots/:botId/mod/outbound-campaigns/campaigns/:id/upload-csv
POST /api/v1/bots/:botId/mod/outbound-campaigns/campaigns/:id/start
POST /api/v1/bots/:botId/mod/outbound-campaigns/campaigns/:id/pause
POST /api/v1/bots/:botId/mod/outbound-campaigns/campaigns/:id/resume
```

### Reportes
```
GET /api/v1/bots/:botId/mod/outbound-campaigns/campaigns/:id/report
GET /api/v1/bots/:botId/mod/outbound-campaigns/campaigns/:id/export-failed
```

## ⚙️ Configuración de Throttling

Cada campaña puede configurar:

- **batch_size**: Número de mensajes por lote (default: 100)
- **batch_interval_ms**: Milisegundos entre lotes (default: 60000 = 1 minuto)

## 📝 Licencia

AGPL-3.0-only
