export const EXPORT_QUEUE = Symbol('EXPORT_QUEUE');

export interface ExportQueueJobData {
  exportJobId: string;
}

export interface ExportQueue {
  enqueueExport(exportJobId: string): Promise<void>;
}
