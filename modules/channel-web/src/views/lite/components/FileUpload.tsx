import React, { FC, useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import { RootStore } from '../store'

interface Props {
  store: RootStore
  onUploadComplete: (uploadUrl: string, fileName: string, fileType: string) => void
  disabled?: boolean
}

interface UploadProgress {
  loaded: number
  total: number
}

const FileUpload: FC<Props> = ({ store, onUploadComplete, disabled }) => {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Don't render if file uploads are disabled
  if (!store.config.enableFileUploads) {
    return null
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    // Get configuration
    const config = store.config
    const maxSize = config.maxFileSize || 10485760 // 10MB default
    const allowedTypes = config.allowedFileTypes || [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf'
    ]

    // Validate file size
    if (file.size > maxSize) {
      await store.addEventToConversation({
        id: Math.random().toString(),
        authorId: undefined,
        sentOn: new Date(),
        conversationId: store.currentConversationId!,
        timeInMs: 0,
        payload: {
          type: 'text',
          text: `File too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB.`
        }
      })
      return
    }

    // Validate file type
    if (!allowedTypes.includes(file.type)) {
      await store.addEventToConversation({
        id: Math.random().toString(),
        authorId: undefined,
        sentOn: new Date(),
        conversationId: store.currentConversationId!,
        timeInMs: 0,
        payload: {
          type: 'text',
          text: 'Unsupported file type. Only images and PDFs are allowed.'
        }
      })
      return
    }

    setIsUploading(true)
    setUploadProgress({ loaded: 0, total: file.size })

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await store.bp.axios.post(
        `/api/v1/bots/${store.config.botId}/mod/channel-web/messages/files`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: progressEvent => {
            const progress = {
              loaded: progressEvent.loaded,
              total: progressEvent.total || file.size
            }
            setUploadProgress(progress)
          }
        }
      )

      onUploadComplete(response.data.url, file.name, file.type)

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (error) {
      console.error('Upload error:', error)
      await store.addEventToConversation({
        id: Math.random().toString(),
        authorId: undefined,
        sentOn: new Date(),
        conversationId: store.currentConversationId!,
        timeInMs: 0,
        payload: {
          type: 'text',
          text: 'Failed to upload file. Please try again.'
        }
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
    <div className="bpw-file-upload-container">
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
        disabled={disabled || isUploading}
      />

      {isUploading ? (
        <div className="bpw-uploading-state">
          <div className="bpw-progress-container">
            <div className="bpw-progress-bar" style={{ width: `${getProgressPercentage()}%` }} />
            <span className="bpw-progress-text">{getProgressPercentage()}%</span>
          </div>
        </div>
      ) : (
        <button className="bpw-upload-button" disabled={disabled} onClick={triggerFileInput} title="Attach file">
          📎
        </button>
      )}
    </div>
  )
}

export default FileUpload
