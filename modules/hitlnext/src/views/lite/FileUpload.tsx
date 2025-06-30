import { Button, FileInput, Icon, Intent, ProgressBar, Spinner, Tooltip } from '@blueprintjs/core'
import cx from 'classnames'
import React, { FC, useRef, useState } from 'react'

import { makeClient } from '../client'
import lang from '../lang'

import style from './style.scss'

interface Props {
  bp: any
  onUploadComplete: (uploadUrl: string, fileName: string, fileType: string) => void
  disabled?: boolean
}

interface UploadProgress {
  loaded: number
  total: number
}

const FileUpload: FC<Props> = ({ bp, onUploadComplete, disabled }) => {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hitlClient = makeClient(bp)

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      bp.toast?.show({
        message: lang.tr('module.hitlnext.fileUpload.fileTooLarge'),
        intent: Intent.DANGER
      })
      return
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]

    if (!allowedTypes.includes(file.type)) {
      bp.toast?.show({
        message: lang.tr('module.hitlnext.fileUpload.unsupportedFileType'),
        intent: Intent.DANGER
      })
      return
    }

    setIsUploading(true)
    setUploadProgress({ loaded: 0, total: file.size })

    try {
      const result = await hitlClient.uploadFile(file, (progress) => {
        setUploadProgress(progress)
      })
      
      onUploadComplete(result.uploadUrl, file.name, file.type)
      
      bp.toast?.show({
        message: lang.tr('module.hitlnext.fileUpload.uploadSuccess'),
        intent: Intent.SUCCESS
      })

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (error) {
      console.error('Upload error:', error)
      bp.toast?.show({
        message: lang.tr('module.hitlnext.fileUpload.uploadError'),
        intent: Intent.DANGER
      })
    } finally {
      setIsUploading(false)
      setUploadProgress(null)
    }
  }

  const triggerFileInput = () => {
    fileInputRef.current?.click()
  }

  const getProgressPercentage = () => {
    if (!uploadProgress) {
      return 0
    }
    return Math.round((uploadProgress.loaded / uploadProgress.total) * 100)
  }

  return (
    <div className={style.fileUploadContainer}>
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.doc,.docx,.xls,.xlsx"
        disabled={disabled || isUploading}
      />
      
      {isUploading ? (
        <div className={style.uploadingState}>
          <Spinner size={16} />
          {uploadProgress && (
            <div className={style.progressContainer}>
              <ProgressBar
                value={getProgressPercentage() / 100}
                className={style.progressBar}
              />
              <span className={style.progressText}>
                {getProgressPercentage()}%
              </span>
            </div>
          )}
        </div>
      ) : (
        <Tooltip
          content={lang.tr('module.hitlnext.fileUpload.attachFile')}
          position="top"
        >
          <Button
            className={style.uploadButton}
            icon="paperclip"
            minimal
            disabled={disabled}
            onClick={triggerFileInput}
          />
        </Tooltip>
      )}
    </div>
  )
}

export default FileUpload
