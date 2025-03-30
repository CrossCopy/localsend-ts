import { getDeviceInfo, LocalSendClient, MulticastDiscovery, HttpDiscovery } from '../src';
import type { FileMetadata } from '../src';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';

async function main() {
  if (process.argv.length < 4) {
    console.error('Usage: bun examples/basic-sender.ts <target-device-ip> <file-path>');
    process.exit(1);
  }

  // Since we check for arguments length above, we can safely assert these as strings
  const targetIp = process.argv[2] as string;
  const filePath = process.argv[3] as string;

  try {
    // Get device info with a custom alias
    const deviceInfo = getDeviceInfo({
      alias: 'TypeScript Sender',
    });

    console.log('Starting LocalSend sender with device info:', deviceInfo);

    // Create client
    const client = new LocalSendClient(deviceInfo);

    // Get target device info
    console.log(`Getting device info for ${targetIp}...`);
    const targetDevice = await client.getDeviceInfo({
      ip: targetIp,
      port: deviceInfo.port
    });

    if (!targetDevice) {
      console.error('Failed to get device info for target');
      process.exit(1);
    }

    console.log(`Target device: ${targetDevice.alias}`);

    // Prepare file metadata
    const fileId = createHash('md5').update(filePath).digest('hex');
    const fileName = path.basename(filePath);
    const fileStats = await readFile(filePath);
    const fileSize = fileStats.length;
    
    // Calculate file hash
    const fileHash = createHash('sha256').update(fileStats).digest('hex');

    const fileMetadata: FileMetadata = {
      id: fileId,
      fileName,
      size: fileSize,
      fileType: 'application/octet-stream', // You might want to detect the content type
      sha256: fileHash,
      metadata: {
        modified: new Date().toISOString()
      }
    };

    // Prepare upload
    console.log('Preparing upload...');
    const uploadPrepare = await client.prepareUpload(
      {
        ip: targetIp,
        port: deviceInfo.port,
        protocol: 'http'
      },
      { [fileId]: fileMetadata },
      '123456' // PIN (if required)
    );

    if (!uploadPrepare) {
      console.error('Failed to prepare upload');
      process.exit(1);
    }

    console.log('Upload prepared, session ID:', uploadPrepare.sessionId);

    // Upload file
    console.log('Uploading file...');
    const success = await client.uploadFile(
      {
        ip: targetIp,
        port: deviceInfo.port,
        protocol: 'http'
      },
      uploadPrepare.sessionId,
      fileId,
      uploadPrepare.files[fileId],
      filePath
    );

    if (success) {
      console.log('File uploaded successfully!');
    } else {
      console.error('Failed to upload file');
      
      // Cancel session
      await client.cancelSession(
        {
          ip: targetIp,
          port: deviceInfo.port,
          protocol: 'http'
        },
        uploadPrepare.sessionId
      );
      
      console.log('Session canceled');
    }
  } catch (err) {
    console.error('Error sending file:', err);
    process.exit(1);
  }
}

main().catch(console.error); 