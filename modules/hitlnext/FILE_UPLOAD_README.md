# HITL Next - File Upload Feature

## Overview

This version of the HITL Next module includes file and image upload capabilities with Amazon S3 integration and WhatsApp forwarding support.

## New Features

### 📎 File Upload Component
- Upload button with paperclip icon next to the message input
- Support for images (JPEG, PNG, GIF, WebP) and documents (PDF, DOC, DOCX, XLS, XLSX, TXT)
- 10MB file size limit
- Real-time upload progress indicator
- Automatic file type detection

### 🖼️ Image Preview
- Inline thumbnail preview for uploaded images
- Generic file icon for non-image files
- Remove uploaded file before sending option

### ☁️ Amazon S3 Integration
- Direct upload to S3 bucket
- Configurable AWS credentials
- Unique file naming with UUID
- Public read access for easy sharing

### 📱 WhatsApp Integration
- Automatic forwarding of uploaded files to end users via Vonage WhatsApp
- Images sent as image messages
- Documents sent as file messages
- Text messages with file context

## Configuration

### S3 Setup
Add the following configuration to your bot's HITL Next module config:

```json
{
  "s3Config": {
    "accessKeyId": "YOUR_AWS_ACCESS_KEY_ID",
    "secretAccessKey": "YOUR_AWS_SECRET_ACCESS_KEY", 
    "region": "us-east-1",
    "bucket": "your-hitlnext-uploads-bucket"
  }
}
```

### Required AWS Permissions
Your AWS IAM user needs the following S3 permissions:
- `s3:PutObject`
- `s3:PutObjectAcl`
- `s3:GetObject`

## Database Changes

### New Column: uploadUrl
The `comments` table now includes an optional `uploadUrl` column to store S3 file URLs.

Migration is automatically handled when the module starts.

## Usage

### For Agents
1. Click the paperclip icon (📎) next to the message input
2. Select a file or image to upload (max 10MB)
3. Preview the uploaded content
4. Add optional text message
5. Send to user via WhatsApp

### Supported File Types
- **Images**: .jpg, .jpeg, .png, .gif, .webp
- **Documents**: .pdf, .txt, .doc, .docx, .xls, .xlsx

## API Endpoints

### POST /mod/hitlnext/upload
Upload a file to S3 and return the URL.

**Request**: multipart/form-data with 'file' field
**Response**: 
```json
{
  "uploadUrl": "https://s3.amazonaws.com/bucket/file.jpg",
  "fileName": "original-name.jpg", 
  "fileType": "image/jpeg",
  "fileSize": 12345
}
```

### POST /mod/hitlnext/handoffs/:id/comments
Create a comment with optional file attachment.

**Request**:
```json
{
  "content": "Here's the document you requested",
  "uploadUrl": "https://s3.amazonaws.com/bucket/file.pdf"
}
```

## Security Considerations

- Files are uploaded to S3 with public-read access
- File type validation prevents malicious uploads
- File size limited to 10MB
- Unique file names prevent conflicts and guessing

## Troubleshooting

### Common Issues

1. **S3 Upload Failed**: Check AWS credentials and bucket permissions
2. **File Too Large**: Maximum size is 10MB
3. **Unsupported File Type**: Only listed file types are allowed
4. **WhatsApp Not Receiving**: Check Vonage integration and bot configuration

### Logs
Check Botpress logs for detailed error messages:
```bash
DEBUG=bp:module:hitlnext* npm start
```

## Development

### Building the Module
```bash
cd modules/hitlnext
yarn install
yarn build
```

### Dependencies Added
- `aws-sdk@^2.1500.0` - Amazon S3 integration
- `multer@^1.4.5-lts.1` - File upload handling
- `uuid@^9.0.0` - Unique file naming

## Migration from Previous Versions

Existing installations will automatically:
1. Add the `uploadUrl` column to the comments table
2. Preserve all existing functionality
3. Enable file upload features when S3 is configured

No manual migration steps required.
