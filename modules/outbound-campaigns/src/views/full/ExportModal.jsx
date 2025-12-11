import React, { useState } from 'react'
import {
  Dialog,
  Button,
  FormGroup,
  Intent,
  Toaster,
  Position,
  Spinner,
  Callout,
  Popover
} from '@blueprintjs/core'
import { DateRangePicker } from '@blueprintjs/datetime'
import '@blueprintjs/datetime/lib/css/blueprint-datetime.css'

const toaster = Toaster.create({ position: Position.TOP })

/**
 * Modal para exportar historial de envíos masivos
 * Permite seleccionar rango de fechas y descargar CSV + MD
 */
const ExportModal = ({ bp, isOpen, onClose }) => {
  const [dateRange, setDateRange] = useState([null, null])
  const [loading, setLoading] = useState(false)

  const handleExport = async () => {
    const [startDate, endDate] = dateRange
    
    if (!startDate || !endDate) {
      toaster.show({
        message: 'Por favor selecciona ambas fechas',
        intent: Intent.WARNING
      })
      return
    }

    if (startDate > endDate) {
      toaster.show({
        message: 'La fecha de inicio debe ser anterior a la fecha de fin',
        intent: Intent.WARNING
      })
      return
    }

    try {
      setLoading(true)

      // Formatear fechas a ISO 8601
      const startISO = startDate.toISOString()
      const endISO = endDate.toISOString()

      // Llamar a la API
      const { data } = await bp.axios.get(
        `mod/outbound-campaigns/export-bulk-sends?startDate=${startISO}&endDate=${endISO}`
      )

      if (!data.success) {
        throw new Error(data.error || 'Error al exportar datos')
      }

      // Descargar CSV
      const csvBlob = new Blob([data.csv], { type: 'text/csv;charset=utf-8;' })
      const csvUrl = URL.createObjectURL(csvBlob)
      const csvLink = document.createElement('a')
      csvLink.href = csvUrl
      const csvFilename = `bulk_sends_${formatDateForFilename(startDate)}_to_${formatDateForFilename(endDate)}.csv`
      csvLink.download = csvFilename
      document.body.appendChild(csvLink)
      csvLink.click()
      document.body.removeChild(csvLink)
      URL.revokeObjectURL(csvUrl)

      // Descargar MD
      const mdBlob = new Blob([data.markdown], { type: 'text/markdown;charset=utf-8;' })
      const mdUrl = URL.createObjectURL(mdBlob)
      const mdLink = document.createElement('a')
      mdLink.href = mdUrl
      const mdFilename = `bulk_sends_report_${formatDateForFilename(startDate)}_to_${formatDateForFilename(endDate)}.md`
      mdLink.download = mdFilename
      document.body.appendChild(mdLink)
      mdLink.click()
      document.body.removeChild(mdLink)
      URL.revokeObjectURL(mdUrl)

      toaster.show({
        message: `Archivos descargados exitosamente (${data.stats.total} registros)`,
        intent: Intent.SUCCESS
      })

      onClose()
    } catch (error) {
      console.error('Error al exportar:', error)
      toaster.show({
        message: error.message || 'Error al exportar los datos',
        intent: Intent.DANGER
      })
    } finally {
      setLoading(false)
    }
  }

  const formatDateForFilename = (date) => {
    if (!date) return ''
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }

  const formatDateDisplay = (date) => {
    if (!date || (date instanceof Date && isNaN(date.getTime()))) return 'Sin seleccionar'
    return date.toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const handleReset = () => {
    setDateRange([null, null])
  }

  const handleDateRangeChange = (selectedRange) => {
    setDateRange(selectedRange)
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Exportar Historial de Envíos Masivos"
      icon="download"
      style={{ width: '600px' }}
    >
      <div className="bp3-dialog-body">
        <Callout intent={Intent.PRIMARY} icon="info-sign" style={{ marginBottom: '20px' }}>
          <p style={{ margin: 0 }}>
            <strong>¿Qué se exportará?</strong>
          </p>
          <ul style={{ marginBottom: 0, paddingLeft: '20px' }}>
            <li>
              <strong>CSV:</strong> Detalle completo de todos los envíos masivos (campaign ID, nombres, 
              destinatarios, estados, UUIDs de mensajes, fechas, errores, variables)
            </li>
            <li>
              <strong>MD:</strong> Reporte con estadísticas generales, desglose por campaña y resumen ejecutivo
            </li>
          </ul>
        </Callout>

        <FormGroup
          label="Rango de Fechas"
          labelInfo="(requerido)"
          helperText="Selecciona el rango de fechas para exportar los envíos masivos"
        >
          <Popover>
            <Button
              icon="calendar"
              text={
                dateRange[0] && dateRange[1]
                  ? `${formatDateDisplay(dateRange[0])} - ${formatDateDisplay(dateRange[1])}`
                  : 'Seleccionar rango de fechas'
              }
              rightIcon="caret-down"
              style={{ width: '100%', justifyContent: 'space-between', textAlign: 'left' }}
            />
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
              <DateRangePicker
                onChange={handleDateRangeChange}
                value={dateRange}
                maxDate={new Date()}
                allowSingleDayRange={true}
                contiguousCalendarMonths={false}
              />
            </div>
          </Popover>
        </FormGroup>

        {dateRange[0] && dateRange[1] && (
          <Callout intent={Intent.SUCCESS} icon="calendar">
            <strong>Período seleccionado:</strong>
            <br />
            Del {formatDateDisplay(dateRange[0])} al {formatDateDisplay(dateRange[1])}
          </Callout>
        )}
      </div>

      <div className="bp3-dialog-footer">
        <div className="bp3-dialog-footer-actions">
          <Button onClick={handleReset} disabled={loading}>
            Limpiar
          </Button>
          <Button onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            intent={Intent.PRIMARY}
            onClick={handleExport}
            disabled={!dateRange[0] || !dateRange[1] || loading}
            icon={loading ? <Spinner size={16} /> : 'download'}
          >
            {loading ? 'Exportando...' : 'Descargar CSV y MD'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export default ExportModal
