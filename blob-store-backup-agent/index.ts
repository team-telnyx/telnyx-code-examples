import { Agent, BlobStore, CloudStorage, SQL, env, logger } from '@telnyx/edge-sdk';
import { createHash } from 'crypto';

// Backup registry row type
interface BackupRecord {
  id: string;
  timestamp: number;
  size: number;
  verified: boolean;
}

class BackupAgent extends Agent {
  // Source data
  blobs = new BlobStore({ bucket: env.BLOBSTORE_BUCKET });

  // Backup destination
  storage = new CloudStorage({ bucket: env.CLOUD_STORAGE_BUCKET });

  // Backup registry
  db = new SQL({ table: 'backups' });

  // SMS notification helper
  async notify(message: string): Promise<void> {
    if (env.DEMO_MODE === 'true') {
      logger.info(`[DEMO] SMS would be sent: ${message}`);
      return;
    }

    try {
      await env.TELNYX.messages.send({
        from: env.TELNYX_SMS_FROM,
        to: env.NOTIFY_PHONE_NUMBER,
        text: message,
      });
      logger.info('SMS notification sent successfully');
    } catch (err) {
      logger.exception('Failed to send SMS notification', err);
    }
  }

  // Checksum helper
  private checksum(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  // Verify a single blob backup
  async verifyBackup(blobName: string, expectedChecksum: string): Promise<boolean> {
    try {
      const downloaded = await this.storage.download(blobName);
      const actualChecksum = this.checksum(downloaded);
      return actualChecksum === expectedChecksum;
    } catch (err) {
      logger.exception(`Verification failed for ${blobName}`, err);
      return false;
    }
  }

  // Backup a single blob
  async backupBlob(blobName: string): Promise<BackupRecord | null> {
    try {
      // Read from BlobStore
      const data = await this.blobs.read(blobName);
      const size = data.length;
      const checksum = this.checksum(data);

      // Upload to Cloud Storage
      await this.storage.upload(blobName, data);

      // Verify checksum
      const verified = await this.verifyBackup(blobName, checksum);

      // Log to SQL registry
      const record: BackupRecord = {
        id: blobName,
        timestamp: Date.now(),
        size,
        verified,
      };

      await this.db.insert('backups', record);

      logger.info(`Backed up ${blobName} (${size} bytes), verified=${verified}`);
      return record;
    } catch (err) {
      logger.exception(`Failed to backup ${blobName}`, err);
      return null;
    }
  }

  // Scheduled backup — lists all blobs and backs up each
  async runBackupCycle(): Promise<void> {
    logger.info('Starting backup cycle');

    try {
      const blobNames = await this.blobs.list();
      logger.info(`Found ${blobNames.length} blobs to backup`);

      let successCount = 0;
      let verifiedCount = 0;

      for (const name of blobNames) {
        const record = await this.backupBlob(name);
        if (record) {
          successCount++;
          if (record.verified) {
            verifiedCount++;
          }
        }
      }

      const message = `Backup complete: ${successCount}/${blobNames.length} blobs backed up, ${verifiedCount} verified.`;
      await this.notify(message);

      logger.info('Backup cycle finished');
    } catch (err) {
      logger.exception('Backup cycle failed', err);
      await this.notify('Backup cycle failed. Check logs for details.');
    }
  }

  // Schedule the backup agent
  schedule(cron: string): void {
    this.every(cron, () => this.runBackupCycle());
  }
}

// Instantiate the agent
const agent = new BackupAgent();

// Schedule daily backups (24h)
agent.schedule('24h');

// Export default handler for Edge runtime
export default agent.handler();
</arg_value>
