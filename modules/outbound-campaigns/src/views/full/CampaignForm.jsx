import React, { useState, useEffect } from 'react'
import {
  Button,
  Intent,
  Dialog,
  Classes,
  FormGroup,
  InputGroup,
  NumericInput,
  Collapse,
  Callout,
  Toaster,
  Position,
  Spinner
} from '@blueprintjs/core'

const toaster = Toaster.create({ position: Position.TOP })

/**
 * Componente CampaignForm - Formulario para crear/editar campañas
 * 
 * CHECKPOINT 2.3: Formulario de Campaña
 * - Nombre de la campaña (requerido)
 * - Template ID de Meta (requerido, con validación)
 * - Configuración avanzada (colapsable):
 *   - Tamaño de lote (default: 100)
 *   - Intervalo entre lotes en segundos (default: 60)
 */
const CampaignForm = ({ bp, isOpen, onClose, onSuccess, campaign = null }) => {
  // Estado inicial: si estamos editando, usar datos de la campaña
  const [name, setName] = useState(campaign?.name || '')
  const [templateId, setTemplateId] = useState(campaign?.template_id || '')
  const [templateNamespace, setTemplateNamespace] = useState(campaign?.template_namespace || '')
  const [batchSize, setBatchSize] = useState(campaign?.batch_size || 100)
  const [batchIntervalSec, setBatchIntervalSec] = useState(
    campaign?.batch_interval_ms ? Math.round(campaign.batch_interval_ms / 1000) : 60
  )
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  const isEditing = campaign !== null

  // Actualizar valores cuando cambia la campaña
  useEffect(() => {
    if (campaign) {
      setName(campaign.name || '')
      setTemplateId(campaign.template_id || '')
      setTemplateNamespace(campaign.template_namespace || '')
      setBatchSize(campaign.batch_size || 100)
      setBatchIntervalSec(campaign.batch_interval_ms ? Math.round(campaign.batch_interval_ms / 1000) : 60)
    } else {
      // Resetear valores cuando es nueva campaña
      setName('')
      setTemplateId('')
      setTemplateNamespace('')
      setBatchSize(100)
      setBatchIntervalSec(60)
    }
    setErrors({})
  }, [campaign])

  // Validar el formulario
  const validate = () => {
    const newErrors = {}

    if (!name.trim()) {
      newErrors.name = 'El nombre es requerido'
    } else if (name.trim().length < 3) {
      newErrors.name = 'El nombre debe tener al menos 3 caracteres'
    } else if (name.trim().length > 100) {
      newErrors.name = 'El nombre no puede exceder 100 caracteres'
    }

    if (!templateId.trim()) {
      newErrors.templateId = 'El Template ID es requerido'
    }

    if (!templateNamespace.trim()) {
      newErrors.templateNamespace = 'El Namespace es requerido'
    }

    if (batchSize < 1 || batchSize > 1000) {
      newErrors.batchSize = 'El tamaño de lote debe estar entre 1 y 1000'
    }

    if (batchIntervalSec < 10 || batchIntervalSec > 3600) {
      newErrors.batchIntervalSec = 'El intervalo debe estar entre 10 y 3600 segundos'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Manejar el envío del formulario
  const handleSubmit = async () => {
    if (!validate()) {
      return
    }

    const payload = {
      name: name.trim(),
      template_id: templateId.trim(),
      template_namespace: templateNamespace.trim(),
      batch_size: batchSize,
      batch_interval_ms: batchIntervalSec * 1000
    }

    try {
      setSaving(true)

      let response
      if (isEditing) {
        // Actualizar campaña existente
        response = await bp.axios.put(
          `mod/outbound-campaigns/campaigns/${campaign.id}`,
          payload
        )
      } else {
        // Crear nueva campaña
        response = await bp.axios.post('mod/outbound-campaigns/campaigns', payload)
      }

      const { data } = response

      if (data.success) {
        toaster.show({
          message: isEditing 
            ? 'Campaña actualizada correctamente' 
            : 'Campaña creada correctamente',
          intent: Intent.SUCCESS
        })
        
        // Limpiar formulario
        resetForm()
        
        // Notificar éxito con la campaña creada/actualizada
        if (onSuccess) {
          onSuccess(data.campaign)
        }
        
        onClose()
      } else {
        toaster.show({
          message: data.error || 'Error al guardar la campaña',
          intent: Intent.DANGER
        })
      }
    } catch (err) {
      console.error('Error saving campaign:', err)
      
      // Manejar errores de validación del servidor
      if (err.response?.data?.error) {
        toaster.show({
          message: err.response.data.error,
          intent: Intent.DANGER
        })
      } else {
        toaster.show({
          message: 'Error al guardar la campaña',
          intent: Intent.DANGER
        })
      }
    } finally {
      setSaving(false)
    }
  }

  // Limpiar formulario
  const resetForm = () => {
    if (!isEditing) {
      setName('')
      setTemplateId('')
      setTemplateNamespace('')
      setBatchSize(100)
      setBatchIntervalSec(60)
      setShowAdvanced(false)
      setErrors({})
    }
  }

  // Manejar cierre del diálogo
  const handleClose = () => {
    if (!saving) {
      resetForm()
      onClose()
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? 'Editar Campaña' : 'Nueva Campaña'}
      icon={isEditing ? 'edit' : 'plus'}
      className="campaign-form-dialog"
      canEscapeKeyClose={!saving}
      canOutsideClickClose={!saving}
    >
      <div className={Classes.DIALOG_BODY}>
        {/* Nombre de la campaña */}
        <FormGroup
          label="Nombre de la campaña"
          labelFor="campaign-name"
          labelInfo="(requerido)"
          intent={errors.name ? Intent.DANGER : Intent.NONE}
          helperText={errors.name}
          className="campaign-form__field"
        >
          <InputGroup
            id="campaign-name"
            placeholder="Ej: Promoción Black Friday 2024"
            value={name}
            onChange={(e) => setName(e.target.value)}
            intent={errors.name ? Intent.DANGER : Intent.NONE}
            disabled={saving}
            maxLength={100}
            leftIcon="tag"
          />
        </FormGroup>

        {/* Template ID de Meta */}
        <FormGroup
          label="Template ID de Meta"
          labelFor="template-id"
          labelInfo="(requerido)"
          intent={errors.templateId ? Intent.DANGER : Intent.NONE}
          helperText={errors.templateId || 'El nombre del template de WhatsApp aprobado por Meta'}
          className="campaign-form__field"
        >
          <InputGroup
            id="template-id"
            placeholder="Ej: hello_world_v2"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            intent={errors.templateId ? Intent.DANGER : Intent.NONE}
            disabled={saving}
            leftIcon="document"
          />
        </FormGroup>

        {/* Template Namespace */}
        <FormGroup
          label="Template Namespace"
          labelFor="template-namespace"
          labelInfo="(requerido)"
          intent={errors.templateNamespace ? Intent.DANGER : Intent.NONE}
          helperText={errors.templateNamespace || 'El namespace del template de Vonage/Meta (VONAGE_WHATSAPP_TEMPLATE_NAMESPACE)'}
          className="campaign-form__field"
        >
          <InputGroup
            id="template-namespace"
            placeholder="Ej: 12345678-1234-1234-1234-123456789012"
            value={templateNamespace}
            onChange={(e) => setTemplateNamespace(e.target.value)}
            intent={errors.templateNamespace ? Intent.DANGER : Intent.NONE}
            disabled={saving}
            leftIcon="folder-open"
          />
        </FormGroup>

        {/* Configuración avanzada (colapsable) */}
        <div className="campaign-form__advanced">
          <Button
            minimal
            icon={showAdvanced ? 'chevron-down' : 'chevron-right'}
            text="Configuración avanzada"
            onClick={() => setShowAdvanced(!showAdvanced)}
            disabled={saving}
          />
          
          <Collapse isOpen={showAdvanced}>
            <Callout intent={Intent.NONE} icon="info-sign" className="campaign-form__info">
              Configura el throttling para controlar la velocidad de envío. 
              Esto evita saturar el servidor y respeta los límites de la API de Vonage.
            </Callout>

            {/* Tamaño de lote */}
            <FormGroup
              label="Tamaño de lote"
              labelFor="batch-size"
              intent={errors.batchSize ? Intent.DANGER : Intent.NONE}
              helperText={errors.batchSize || 'Cantidad de mensajes a enviar por lote (1-1000)'}
              className="campaign-form__field"
            >
              <NumericInput
                id="batch-size"
                value={batchSize}
                onValueChange={(value) => setBatchSize(value)}
                min={1}
                max={1000}
                intent={errors.batchSize ? Intent.DANGER : Intent.NONE}
                disabled={saving}
                fill
                leftIcon="layers"
              />
            </FormGroup>

            {/* Intervalo entre lotes */}
            <FormGroup
              label="Intervalo entre lotes (segundos)"
              labelFor="batch-interval"
              intent={errors.batchIntervalSec ? Intent.DANGER : Intent.NONE}
              helperText={errors.batchIntervalSec || 'Tiempo de espera entre cada lote (10-3600 segundos)'}
              className="campaign-form__field"
            >
              <NumericInput
                id="batch-interval"
                value={batchIntervalSec}
                onValueChange={(value) => setBatchIntervalSec(value)}
                min={10}
                max={3600}
                intent={errors.batchIntervalSec ? Intent.DANGER : Intent.NONE}
                disabled={saving}
                fill
                leftIcon="time"
              />
            </FormGroup>
          </Collapse>
        </div>

        {/* Información sobre siguiente paso */}
        {!isEditing && (
          <Callout intent={Intent.PRIMARY} icon="lightbulb" className="campaign-form__next-step">
            Después de crear la campaña, podrás subir el archivo CSV con los destinatarios.
          </Callout>
        )}
      </div>

      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button
            text="Cancelar"
            onClick={handleClose}
            disabled={saving}
          />
          <Button
            intent={Intent.PRIMARY}
            text={saving ? 'Guardando...' : (isEditing ? 'Guardar cambios' : 'Crear campaña')}
            onClick={handleSubmit}
            disabled={saving}
            icon={saving ? <Spinner size={16} /> : (isEditing ? 'floppy-disk' : 'plus')}
          />
        </div>
      </div>
    </Dialog>
  )
}

export default CampaignForm
