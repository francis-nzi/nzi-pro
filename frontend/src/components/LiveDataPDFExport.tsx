/**
 * LiveDataPDFExport Component
 * 
 * PHASE 1 IMPLEMENTATION
 * File: frontend/src/components/LiveDataPDFExport.tsx
 * Integration: Use in Job report page or dashboard
 * 
 * Features:
 * - Queue PDF generation (non-blocking)
 * - Real-time progress via WebSocket
 * - Fallback to polling if WebSocket fails
 * - Download when complete
 * - Cancel in progress PDFs
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, Loader2, AlertCircle, CheckCircle, X } from 'lucide-react';

interface LiveDataPDFExportProps {
  jobId: number;
  templateId?: number;
  onComplete?: (downloadUrl: string) => void;
  onError?: (error: string) => void;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

type ExportState = 'idle' | 'queued' | 'generating' | 'completed' | 'error' | 'canceled';

interface PDFProgress {
  status: string;
  progress?: number;
  message?: string;
  result?: { download_url?: string };
  error?: string;
}

export function LiveDataPDFExport({
  jobId,
  templateId,
  onComplete,
  onError,
  variant = 'default',
  size = 'md',
}: LiveDataPDFExportProps) {
  const [state, setState] = useState<ExportState>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const jobTokenRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Handle export button click
   */
  const handleExportPDF = async () => {
    try {
      setProgress(0);
      setMessage('Queuing PDF generation...');
      setState('queued');
      setError(null);

      // Queue PDF generation on backend
      const params = new URLSearchParams();
      if (templateId) {
        params.append('template_id', templateId.toString());
      }

      const response = await fetch(`/api/jobs/${jobId}/queue-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.detail ||
          errorData.message ||
          `Failed to queue PDF (${response.status})`
        );
      }

      const data = await response.json();
      jobTokenRef.current = data.job_token;

      logger.info('PDF queued:', data.job_token);

      // Try WebSocket first, fallback to polling
      await connectWebSocket(data.job_token);
    } catch (err) {
      setState('error');
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      if (onError) onError(errorMsg);
      logger.error('Export error:', err);
    }
  };

  /**
   * Connect to WebSocket for real-time progress
   */
  const connectWebSocket = async (jobToken: string) => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/ws/pdf-progress/${jobToken}`;

      logger.info('Connecting to WebSocket:', wsUrl);

      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        logger.info('WebSocket connected');
      };

      wsRef.current.onmessage = (event) => {
        try {
          const update: PDFProgress = JSON.parse(event.data);

          setProgress(update.progress || 0);
          setMessage(update.message || 'Processing...');

          logger.debug('Progress update:', update.status, update.progress);

          if (update.status === 'completed') {
            setState('completed');
            const url = update.result?.download_url || '';
            setDownloadUrl(url);
            if (onComplete) onComplete(url);
            wsRef.current?.close();
          } else if (update.status === 'failed' || update.status === 'error') {
            setState('error');
            const errorMsg = update.error || update.message || 'PDF generation failed';
            setError(errorMsg);
            if (onError) onError(errorMsg);
            wsRef.current?.close();
          } else if (update.status === 'generating') {
            setState('generating');
          }
        } catch (parseErr) {
          logger.error('Failed to parse WebSocket message:', parseErr);
        }
      };

      wsRef.current.onerror = (event) => {
        logger.warn('WebSocket error, falling back to polling:', event);
        wsRef.current = null;
        startPolling(jobToken);
      };

      wsRef.current.onclose = () => {
        logger.info('WebSocket closed');
        wsRef.current = null;
      };
    } catch (err) {
      logger.error('WebSocket connection failed:', err);
      startPolling(jobToken);
    }
  };

  /**
   * Fallback: Poll server for progress every 1 second
   */
  const startPolling = (jobToken: string) => {
    logger.info('Starting polling for:', jobToken);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/pdf-progress/${jobToken}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data: PDFProgress = await response.json();

        setProgress(data.progress || 0);
        setMessage(data.message || 'Processing...');

        logger.debug('Poll update:', data.status, data.progress);

        if (data.status === 'completed') {
          clearInterval(pollIntervalRef.current!);
          setState('completed');
          const url = data.result?.download_url || '';
          setDownloadUrl(url);
          if (onComplete) onComplete(url);
        } else if (data.status === 'failed') {
          clearInterval(pollIntervalRef.current!);
          setState('error');
          const errorMsg = data.error || 'PDF generation failed';
          setError(errorMsg);
          if (onError) onError(errorMsg);
        }
      } catch (err) {
        logger.error('Polling error:', err);
        clearInterval(pollIntervalRef.current!);
        setState('error');
        setError('Lost connection to server');
      }
    }, 1000);
  };

  /**
   * Handle cancel button click
   */
  const handleCancel = async () => {
    if (!jobTokenRef.current) return;

    try {
      const response = await fetch(`/api/pdf/${jobTokenRef.current}/cancel`, {
        method: 'DELETE',
      });

      if (response.ok) {
        logger.info('PDF generation canceled');
        setState('canceled');
        setMessage('Canceled');
        setProgress(0);
      }
    } catch (err) {
      logger.error('Failed to cancel PDF:', err);
    } finally {
      // Cleanup
      wsRef.current?.close();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    }
  };

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // ============================================================================
  // Render different states
  // ============================================================================

  // Idle state (button)
  if (state === 'idle') {
    return (
      <Button
        onClick={handleExportPDF}
        variant={variant}
        size={size}
        className="gap-2"
      >
        <Download className="w-4 h-4" />
        Export to PDF
      </Button>
    );
  }

  // Completed state (success)
  if (state === 'completed' && downloadUrl) {
    return (
      <div className="space-y-2">
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
          <AlertDescription className="text-green-800">
            PDF generated successfully!
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <a
            href={downloadUrl}
            download
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download PDF
          </a>
          <Button
            onClick={() => setState('idle')}
            variant="outline"
            size="sm"
          >
            Generate Another
          </Button>
        </div>
      </div>
    );
  }

  // Error state
  if (state === 'error' || state === 'canceled') {
    return (
      <div className="space-y-2">
        <Alert className={`${
          state === 'canceled'
            ? 'bg-yellow-50 border-yellow-200'
            : 'bg-red-50 border-red-200'
        }`}>
          {state === 'canceled' ? (
            <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          )}
          <AlertDescription className={
            state === 'canceled'
              ? 'text-yellow-800'
              : 'text-red-800'
          }>
            {error || 'Something went wrong'}
          </AlertDescription>
        </Alert>
        <Button onClick={handleExportPDF} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  // Queued/Generating state (progress)
  return (
    <div className="space-y-3 w-full max-w-md">
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
        <span className="text-sm font-medium text-gray-700">
          {state === 'queued' ? 'Queued...' : 'Generating PDF...'}
        </span>
      </div>

      <Progress value={progress} max={100} className="w-full" />

      <p className="text-sm text-gray-600 min-h-[20px]">
        {message || 'Processing...'}
      </p>

      <Button
        onClick={handleCancel}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        <X className="w-4 h-4" />
        Cancel
      </Button>
    </div>
  );
}

// ============================================================================
// Simple logging helper
// ============================================================================

const logger = {
  info: (message: string, ...args: any[]) => {
    console.log(`[LiveDataPDFExport] ${message}`, ...args);
  },
  debug: (message: string, ...args: any[]) => {
    console.debug(`[LiveDataPDFExport] ${message}`, ...args);
  },
  warn: (message: string, ...args: any[]) => {
    console.warn(`[LiveDataPDFExport] ${message}`, ...args);
  },
  error: (message: string, ...args: any[]) => {
    console.error(`[LiveDataPDFExport] ${message}`, ...args);
  },
};
