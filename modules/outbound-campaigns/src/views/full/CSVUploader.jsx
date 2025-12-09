import React, { useState, useCallback, useRef } from 'react'
import {
  Button,
  Intent,
  Card,
  Elevation,
  ProgressBar,
  Callout,
  Tag,
  HTMLTable,
  Icon,
  Spinner,
  Collapse
} from '@blueprintjs/core'

/**
 * Componente CSVUploader - Subida y procesamiento de archivos CSV
 * 
 * CHECKPOINT 2.4: Upload de CSV
 * - Zona de drag & drop para el archivo
 * - Preview de las primeras 5 filas
 * - Indicador de progreso de carga
 * - Mostrar resultado: X válidos, Y inválidos
 * - Lista de errores encontrados
 */
const CSVUploader = ({ bp, campaignId, onUploadSuccess }) => {
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [showErrors, setShowErrors] = useState(false)
  
  const fileInputRef = useRef(null)

  // Parsear CSV para preview
  const parseCSVPreview = (text) => {
    const lines = text.split('\n').filter(line => line.trim())
    if (lines.length === 0) return null

    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''))
    const rows = lines.slice(1, 6).map(line => {
      const values = []
      let current = ''
      let inQuotes = false
      
      for (const char of line) {
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim())
          current = ''
        } else {
          current += char
        }
      }
      values.push(current.trim())
      
      return values
    })

    return {
      headers,
      rows,
      totalRows: lines.length - 1
    }
  }

  // Manejar archivo seleccionado
  const handleFile = useCallback((selectedFile) => {
    if (!selectedFile) return

    // Validar tipo de archivo
    if (!selectedFile.name.endsWith('.csv')) {
      setResult({
        success: false,
        error: 'Por favor selecciona un archivo CSV válido'
      })
      return
    }

    // Validar tamaño (máx 10MB)
    if (selectedFile.size > 10 * 1024 * 1024) {
      setResult({
        success: false,
        error: 'El archivo es demasiado grande. Máximo 10MB'
      })
      return
    }

    setFile(selectedFile)
    setResult(null)

    // Leer preview
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const previewData = parseCSVPreview(text)
      setPreview(previewData)
    }
    reader.readAsText(selectedFile)
  }, [])

  // Eventos de drag & drop
  const handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const droppedFile = e.dataTransfer.files[0]
    handleFile(droppedFile)
  }

  // Click en la zona de drop
  const handleClick = () => {
    fileInputRef.current?.click()
  }

  // Cambio en input de archivo
  const handleInputChange = (e) => {
    const selectedFile = e.target.files[0]
    handleFile(selectedFile)
  }

  // Subir archivo al servidor
  const handleUpload = async () => {
    if (!file || !campaignId) return

    try {
      setUploading(true)
      setUploadProgress(0)

      const formData = new FormData()
      formData.append('file', file)

      const { data } = await bp.axios.post(
        `mod/outbound-campaigns/campaigns/${campaignId}/upload-csv`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            const progress = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            )
            setUploadProgress(progress)
          }
        }
      )

      if (data.success) {
        setResult({
          success: true,
          valid: data.valid,
          invalid: data.invalid,
          duplicates: data.duplicates,
          errors: data.errors || []
        })
        
        // Notificar éxito al padre
        if (onUploadSuccess) {
          onUploadSuccess(data)
        }
      } else {
        setResult({
          success: false,
          error: data.error || 'Error al procesar el archivo'
        })
      }
    } catch (err) {
      console.error('Error uploading CSV:', err)
      setResult({
        success: false,
        error: err.response?.data?.error || 'Error al subir el archivo'
      })
    } finally {
      setUploading(false)
    }
  }

  // Limpiar y empezar de nuevo
  const handleReset = () => {
    setFile(null)
    setPreview(null)
    setResult(null)
    setUploadProgress(0)
    setShowErrors(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Formatear tamaño de archivo
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' bytes'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  return (
    <div className="csv-upload">
      {/* Zona de drag & drop */}
      {!file && !result?.success && (
        <div
          className={`csv-upload__dropzone ${isDragging ? 'csv-upload__dropzone--active' : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={handleClick}
        >
          <Icon icon="cloud-upload" size={48} className="csv-upload__icon" />
          <p className="csv-upload__text">
            <strong>Arrastra un archivo CSV aquí</strong>
            <br />
            o haz clic para seleccionar
          </p>
          <p style={{ fontSize: '12px', color: '#8a8a8a', marginTop: '10px' }}>
            Columna requerida: <code>phone_number</code>
            <br />
            Columnas opcionales: <code>var1, var2, var3...</code> (variables del template)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleInputChange}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {/* Preview del archivo */}
      {file && preview && !result?.success && (
        <Card elevation={Elevation.ONE} style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <div>
              <Icon icon="document" style={{ marginRight: '10px' }} />
              <strong>{file.name}</strong>
              <Tag minimal style={{ marginLeft: '10px' }}>{formatFileSize(file.size)}</Tag>
              <Tag minimal intent={Intent.PRIMARY} style={{ marginLeft: '5px' }}>
                {preview.totalRows} registros
              </Tag>
            </div>
            <Button icon="cross" minimal onClick={handleReset} disabled={uploading} />
          </div>

          {/* Tabla de preview */}
          <div style={{ overflowX: 'auto', marginBottom: '15px' }}>
            <HTMLTable striped condensed style={{ width: '100%' }}>
              <thead>
                <tr>
                  {preview.headers.map((header, i) => (
                    <th key={i}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell || <span style={{ color: '#8a8a8a' }}>(vacío)</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
            {preview.totalRows > 5 && (
              <p style={{ textAlign: 'center', color: '#8a8a8a', marginTop: '10px' }}>
                Mostrando 5 de {preview.totalRows} registros
              </p>
            )}
          </div>

          {/* Verificar columna phone_number */}
          {!preview.headers.includes('phone_number') && (
            <Callout intent={Intent.WARNING} icon="warning-sign" style={{ marginBottom: '15px' }}>
              No se encontró la columna <code>phone_number</code>. Asegúrate de que tu CSV tenga esta columna.
            </Callout>
          )}

          {/* Barra de progreso durante upload */}
          {uploading && (
            <div style={{ marginBottom: '15px' }}>
              <p style={{ marginBottom: '5px' }}>Subiendo archivo... {uploadProgress}%</p>
              <ProgressBar 
                value={uploadProgress / 100} 
                intent={Intent.PRIMARY}
                stripes={uploadProgress < 100}
                animate={uploadProgress < 100}
              />
            </div>
          )}

          {/* Botones de acción */}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <Button 
              text="Cancelar" 
              onClick={handleReset} 
              disabled={uploading}
            />
            <Button
              intent={Intent.PRIMARY}
              icon={uploading ? <Spinner size={16} /> : 'upload'}
              text={uploading ? 'Procesando...' : 'Subir e importar'}
              onClick={handleUpload}
              disabled={uploading || !preview.headers.includes('phone_number')}
            />
          </div>
        </Card>
      )}

      {/* Resultado de error */}
      {result && !result.success && (
        <Callout intent={Intent.DANGER} icon="error" title="Error" style={{ marginTop: '20px' }}>
          {result.error}
          <br />
          <Button 
            text="Intentar de nuevo" 
            intent={Intent.PRIMARY} 
            onClick={handleReset}
            style={{ marginTop: '10px' }}
          />
        </Callout>
      )}

      {/* Resultado exitoso */}
      {result && result.success && (
        <div className="csv-upload__result" style={{ display: 'grid', justifyContent: 'center'}}>
          <Callout intent={Intent.SUCCESS} icon="tick-circle" title="Importación completada">
            <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '10px', flexWrap: 'wrap' }}>
              <div>
                <Tag large intent={Intent.SUCCESS} icon="tick">
                  {result.valid} válidos
                </Tag>
              </div>
              {result.invalid > 0 && (
                <div>
                  <Tag large intent={Intent.DANGER} icon="error">
                    {result.invalid} inválidos
                  </Tag>
                </div>
              )}
              {result.duplicates > 0 && (
                <div>
                  <Tag large intent={Intent.WARNING} icon="duplicate">
                    {result.duplicates} duplicados
                  </Tag>
                </div>
              )}
            </div>
          </Callout>

          {/* Lista de errores encontrados */}
          {result.errors && result.errors.length > 0 && (
            <Card elevation={Elevation.ONE} style={{ marginTop: '15px' }}>
              <Button
                minimal
                fill
                alignText="left"
                icon={showErrors ? 'chevron-down' : 'chevron-right'}
                text={`Ver ${result.errors.length} errores encontrados`}
                onClick={() => setShowErrors(!showErrors)}
              />
              
              <Collapse isOpen={showErrors}>
                <div style={{ maxHeight: '200px', overflowY: 'auto', marginTop: '10px' }}>
                  <HTMLTable condensed striped style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Línea</th>
                        <th>Número</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.slice(0, 50).map((err, i) => (
                        <tr key={i}>
                          <td>{err.line || i + 1}</td>
                          <td><code>{err.phone || '-'}</code></td>
                          <td>{err.message || err.error || 'Error desconocido'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </HTMLTable>
                  {result.errors.length > 50 && (
                    <p style={{ textAlign: 'center', color: '#8a8a8a', marginTop: '10px' }}>
                      Mostrando 50 de {result.errors.length} errores
                    </p>
                  )}
                </div>
              </Collapse>
            </Card>
          )}

          {/* Botón para subir otro archivo */}
          <Button
            text="Subir otro archivo"
            icon="document"
            onClick={handleReset}
            style={{ marginTop: '15px' }}
          />
        </div>
      )}
    </div>
  )
}

export default CSVUploader
