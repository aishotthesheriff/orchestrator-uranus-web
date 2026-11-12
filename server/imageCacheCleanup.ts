import { storage } from './storage';

export class ImageCacheCleanup {
  private intervalId: NodeJS.Timeout | null = null;
  
  async getRetentionPolicy(): Promise<{ retentionDays: number; minAccessCount: number }> {
    const retentionDaysSetting = await storage.getSetting('image_cache_retention_days');
    const minAccessCountSetting = await storage.getSetting('image_cache_min_access_count');
    
    return {
      retentionDays: retentionDaysSetting ? parseInt(retentionDaysSetting.value) : 30,
      minAccessCount: minAccessCountSetting ? parseInt(minAccessCountSetting.value) : 5
    };
  }
  
  async cleanupOldImages(): Promise<number> {
    const policy = await this.getRetentionPolicy();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);
    
    const deleted = await storage.deleteGeneratedImages({
      before: cutoffDate,
      maxAccessCount: policy.minAccessCount
    });
    
    console.log(`Image cache cleanup: deleted ${deleted} images older than ${policy.retentionDays} days with < ${policy.minAccessCount} accesses`);
    return deleted;
  }
  
  start(): void {
    if (this.intervalId) return;
    
    // Run cleanup daily at 2 AM
    const runCleanup = async () => {
      const now = new Date();
      if (now.getHours() === 2) {
        await this.cleanupOldImages();
      }
    };
    
    // Check every hour
    this.intervalId = setInterval(runCleanup, 60 * 60 * 1000);
    console.log('Image cache cleanup service started');
  }
  
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Image cache cleanup service stopped');
    }
  }
}
