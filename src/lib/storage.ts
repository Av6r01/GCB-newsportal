/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, '../../public/uploads');

export interface StorageProvider {
  uploadFile(buffer: Buffer, filename: string, mimeType: string): Promise<string>;
  deleteFile(url: string): Promise<void>;
}

class LocalStorageProvider implements StorageProvider {
  async uploadFile(buffer: Buffer, filename: string): Promise<string> {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const filePath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    return `/uploads/${filename}`;
  }

  async deleteFile(url: string): Promise<void> {
    const filename = path.basename(url);
    const filePath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

// Placeholder for S3 implementation
// Requires: @aws-sdk/client-s3
/*
class S3StorageProvider implements StorageProvider {
  async uploadFile(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    // Implementation for S3 upload
    return `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${filename}`;
  }
  async deleteFile(url: string): Promise<void> {
    // Implementation for S3 delete
  }
}
*/

export const storageProvider: StorageProvider = process.env.S3_BUCKET 
  ? new LocalStorageProvider() // Replace with S3StorageProvider when configured
  : new LocalStorageProvider();
