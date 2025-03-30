import type { DeviceInfo, PrepareUploadRequest, PrepareUploadResponse, FileMetadata } from '../types';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { request } from 'http';
import { IncomingMessage } from 'http';

export class LocalSendClient {
  constructor(private deviceInfo: DeviceInfo) {}

  /**
   * Register with another device (discovery)
   */
  async register(targetDevice: { ip: string; port: number }): Promise<DeviceInfo | null> {
    try {
      const response = await this.sendRequest<DeviceInfo>({
        method: 'POST',
        hostname: targetDevice.ip,
        port: targetDevice.port,
        path: '/api/localsend/v2/register',
        headers: {
          'Content-Type': 'application/json'
        },
        body: this.deviceInfo
      });
      
      return response;
    } catch (err) {
      console.error('Error registering with device:', err);
      return null;
    }
  }

  /**
   * Prepare file upload by sending metadata to receiver
   */
  async prepareUpload(
    targetDevice: { ip: string; port: number; protocol: 'http' | 'https' },
    files: Record<string, FileMetadata>,
    pin?: string
  ): Promise<PrepareUploadResponse | null> {
    try {
      const path = '/api/localsend/v2/prepare-upload' + (pin ? `?pin=${pin}` : '');
      
      const payload: PrepareUploadRequest = {
        info: this.deviceInfo,
        files
      };

      const response = await this.sendRequest<PrepareUploadResponse>({
        method: 'POST',
        hostname: targetDevice.ip,
        port: targetDevice.port,
        path,
        headers: {
          'Content-Type': 'application/json'
        },
        body: payload
      });

      return response;
    } catch (err) {
      console.error('Error preparing upload:', err);
      return null;
    }
  }

  /**
   * Upload a file to the receiver
   */
  async uploadFile(
    targetDevice: { ip: string; port: number; protocol: 'http' | 'https' },
    sessionId: string,
    fileId: string,
    fileToken: string,
    filePath: string
  ): Promise<boolean> {
    try {
      // Get file size
      const stats = await stat(filePath);
      
      // Create URL
      const path = `/api/localsend/v2/upload?sessionId=${sessionId}&fileId=${fileId}&token=${fileToken}`;
      
      // Create file read stream
      const fileStream = createReadStream(filePath);
      
      // Send the file
      const success = await new Promise<boolean>((resolve) => {
        const req = request({
          method: 'POST',
          hostname: targetDevice.ip,
          port: targetDevice.port,
          path,
          headers: {
            'Content-Length': stats.size
          }
        }, (res) => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            console.error(`Failed to upload file. Status: ${res.statusCode}`);
            resolve(false);
          }
          
          // Consume response data to free up memory
          res.resume();
        });
        
        req.on('error', (err) => {
          console.error('Error uploading file:', err);
          resolve(false);
        });
        
        fileStream.pipe(req);
      });
      
      return success;
    } catch (err) {
      console.error('Error uploading file:', err);
      return false;
    }
  }

  /**
   * Cancel an ongoing session
   */
  async cancelSession(
    targetDevice: { ip: string; port: number; protocol: 'http' | 'https' },
    sessionId: string
  ): Promise<boolean> {
    try {
      const path = `/api/localsend/v2/cancel?sessionId=${sessionId}`;
      
      const response = await this.sendRequest({
        method: 'POST',
        hostname: targetDevice.ip,
        port: targetDevice.port,
        path
      });
      
      return response !== null;
    } catch (err) {
      console.error('Error canceling session:', err);
      return false;
    }
  }

  /**
   * Get information about a device
   */
  async getDeviceInfo(targetDevice: { ip: string; port: number }): Promise<DeviceInfo | null> {
    try {
      const response = await this.sendRequest<DeviceInfo>({
        method: 'GET',
        hostname: targetDevice.ip,
        port: targetDevice.port,
        path: '/api/localsend/v2/info'
      });
      
      return response;
    } catch (err) {
      console.error('Error getting device info:', err);
      return null;
    }
  }

  /**
   * Generic method to send HTTP requests
   */
  private sendRequest<T>(options: {
    method: string;
    hostname: string;
    port: number;
    path: string;
    headers?: Record<string, string | number>;
    body?: any;
  }): Promise<T | null> {
    return new Promise((resolve) => {
      const req = request({
        method: options.method,
        hostname: options.hostname,
        port: options.port,
        path: options.path,
        headers: options.headers
      }, (res: IncomingMessage) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              if (data) {
                resolve(JSON.parse(data) as T);
              } else {
                resolve(null);
              }
            } catch (err) {
              console.error('Error parsing response:', err);
              resolve(null);
            }
          } else {
            // console.error(`Request failed with status: ${res.statusCode}`);
            resolve(null);
          }
        });
      });
      
      req.on('error', (err) => {
        console.error('Request error:', err);
        resolve(null);
      });
      
      if (options.body) {
        const bodyData = JSON.stringify(options.body);
        req.write(bodyData);
      }
      
      req.end();
    });
  }
} 