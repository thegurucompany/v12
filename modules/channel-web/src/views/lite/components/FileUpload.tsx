import React, { FC, useRef, useState } from 'react'

interface FileUploadProps {
  onFileSelect: (file: File) => Promise<void>
  disabled?: boolean
  className?: string
}

const FileUpload: FC<FileUploadProps> = ({ onFileSelect, disabled = false, className = '' }) => {
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    // Validate file type - images and PDFs
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'application/pdf'
    ]

    if (!allowedTypes.includes(file.type)) {
      alert('Solo se permiten archivos de imagen (JPG, PNG, GIF, WebP, BMP) y documentos PDF')
      return
    }

    // Validate file size - max 10MB
    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      alert('El archivo es demasiado grande. El tamaño máximo es 10MB.')
      return
    }

    setIsUploading(true)

    try {
      await onFileSelect(file)
    } catch (error) {
      // Handle server errors
      const errorMessage = error instanceof Error ? error.message : 'Error al subir la imagen'
      alert(errorMessage)
    } finally {
      setIsUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const triggerFileInput = () => {
    if (!disabled && !isUploading) {
      fileInputRef.current?.click()
    }
  }

  return (
    <div className={className}>
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,application/pdf"
        disabled={disabled || isUploading}
      />
      <button
        type="button"
        className="bpw-file-upload-button"
        onClick={triggerFileInput}
        disabled={disabled || isUploading}
        title="Adjuntar archivo (imagen o PDF)"
        aria-label="Adjuntar archivo"
      >
        {isUploading ? <span>📤</span> : <span>📎</span>}
      </button>
    </div>
  )
}

export default FileUpload
